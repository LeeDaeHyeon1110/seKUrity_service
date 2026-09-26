import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import type {
  CreateWeeklyReportBody,
  DeleteWeeklyReportBody,
  ProcessWeeklyReportMissesBody,
  ProcessWeeklyReportRemindersBody,
  ScrumResult,
  SyncWeeklyReportBody,
  UpdateWeeklyReportBody,
  WeeklyPendingScrum,
  WeeklyReport,
  WeeklyReportPreview,
  WeeklyReportThread,
  WeeklyScrumResult,
} from '../../contracts';
import type { Database } from '../../db/database';
import {
  guildWeeklySettings,
  scrumCurrentTodos,
  scrumEntries,
  scrumEntryAttachments,
  scrumEntryItems,
  scrumEntryLinks,
  scrumEntryNextTodos,
  scrumMembers,
  scrums,
  weeklyReportAttachments,
  weeklyReportDeletions,
  weeklyReportItems,
  weeklyReportLinks,
  weeklyReportMisses,
  weeklyReportReminders,
  weeklyReports,
  weeklyReportThreads,
  weeklyMissCountResets,
} from '../../db/schema';
import { ApiError } from '../../errors';
import {
  getWeeklyReportCycleEnd,
  isWeeklyReportDeadlineClosed,
  isWeeklyReportReminderWindow,
} from '../weeklyCycle';
import { isQualifyingScrumResult, requiresQualifyingScrum } from './qualification';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type WeeklyReportRow = typeof weeklyReports.$inferSelect;
type WeeklyReportThreadRow = typeof weeklyReportThreads.$inferSelect;

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ApiError(400, 'INVALID_DATE', 'weekEnd must be a valid date.');
  }

  return parsed;
}

function getWeekPeriod(weekEnd: string): {
  weekStart: string;
  weekEnd: string;
} {
  const end = parseDate(weekEnd);

  if (end.getUTCDay() !== 0) {
    throw new ApiError(
      400,
      'WEEK_END_MUST_BE_SUNDAY',
      'weekEnd must be a Sunday.',
    );
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);

  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd,
  };
}

function getKstDateString(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

export function assertWeeklyReportSubmissionDate(
  weekEnd: string,
  current: Date | string = new Date(),
): void {
  getWeekPeriod(weekEnd);

  if (weekEnd !== getWeeklyReportCycleEnd(current)) {
    throw new ApiError(
      409,
      'WEEKLY_REPORT_DATE_CLOSED',
      'A weekly report can only be submitted before its weekly cycle closes.',
    );
  }
}

function assertResultRequirements(results: ScrumResult[]): void {
  if (results.some((result) => result.attachments.length > 1)) {
    throw new ApiError(
      400,
      'EVIDENCE_ATTACHMENT_LIMIT_EXCEEDED',
      'Each task can have at most one evidence attachment.',
    );
  }

  const invalidResult = results.find((result) =>
    result.attachments.length === 0
    && result.links.length === 0
    && result.comment.trim().length === 0,
  );

  if (invalidResult) {
    throw new ApiError(
      400,
      'EVIDENCE_OR_COMMENT_REQUIRED',
      'Every extra completed item requires evidence or a comment.',
    );
  }
}

function mapThread(row: WeeklyReportThreadRow): WeeklyReportThread {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function insertReportItems(
  transaction: Transaction,
  reportId: string,
  input: {
    completedItems: WeeklyScrumResult[];
    extraItems: ScrumResult[];
    nextTodos: string[];
    pendingTodos: string[];
  },
): Promise<void> {
  const items = [
    ...input.completedItems.map((item) => ({
      kind: 'completed' as const,
      item,
    })),
    ...input.extraItems.map((item) => ({
      kind: 'extra' as const,
      item,
    })),
    ...input.nextTodos.map((title) => ({
      kind: 'next' as const,
      item: {
        title,
        comment: '',
        attachments: [],
        links: [],
      },
    })),
    ...input.pendingTodos.map((title) => ({
      kind: 'pending' as const,
      item: {
        title,
        comment: '',
        attachments: [],
        links: [],
      },
    })),
  ];

  for (const [position, { kind, item }] of items.entries()) {
    const itemId = randomUUID();

    await transaction.insert(weeklyReportItems).values({
      id: itemId,
      reportId,
      kind,
      scrumCategory: kind === 'completed' && 'scrumCategory' in item
        ? item.scrumCategory ?? null
        : null,
      title: item.title,
      comment: item.comment,
      position,
    });

    if (item.attachments.length > 0) {
      await transaction.insert(weeklyReportAttachments).values(
        item.attachments.map((attachment, attachmentPosition) => ({
          ...attachment,
          itemId,
          position: attachmentPosition,
        })),
      );
    }

    if (item.links.length > 0) {
      await transaction.insert(weeklyReportLinks).values(
        item.links.map((url, linkPosition) => ({
          id: randomUUID(),
          itemId,
          url,
          position: linkPosition,
        })),
      );
    }
  }
}

export class WeeklyRepository {
  constructor(
    private readonly database: Database,
    private readonly weeklyTestDate: string | null = null,
  ) {}

  async getRoleId(guildId: string): Promise<string | null> {
    const [setting] = await this.database
      .select({ roleId: guildWeeklySettings.roleId })
      .from(guildWeeklySettings)
      .where(eq(guildWeeklySettings.guildId, guildId))
      .limit(1);

    return setting?.roleId ?? null;
  }

  async setRoleId(guildId: string, roleId: string): Promise<string> {
    const [setting] = await this.database
      .insert(guildWeeklySettings)
      .values({
        guildId,
        roleId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: guildWeeklySettings.guildId,
        set: {
          roleId,
          updatedAt: new Date(),
        },
      })
      .returning({ roleId: guildWeeklySettings.roleId });

    return setting.roleId;
  }

  async unsetRoleId(guildId: string): Promise<string | null> {
    const [setting] = await this.database
      .delete(guildWeeklySettings)
      .where(eq(guildWeeklySettings.guildId, guildId))
      .returning({ roleId: guildWeeklySettings.roleId });

    return setting?.roleId ?? null;
  }

  async getThread(
    guildId: string,
    userId: string,
  ): Promise<WeeklyReportThread | null> {
    const [row] = await this.database
      .select()
      .from(weeklyReportThreads)
      .where(and(
        eq(weeklyReportThreads.guildId, guildId),
        eq(weeklyReportThreads.userId, userId),
      ))
      .limit(1);

    return row
      ? mapThread(row)
      : null;
  }

  async listThreads(guildId: string): Promise<WeeklyReportThread[]> {
    const rows = await this.database
      .select()
      .from(weeklyReportThreads)
      .where(eq(weeklyReportThreads.guildId, guildId))
      .orderBy(asc(weeklyReportThreads.userId));

    return rows.map(mapThread);
  }

  async upsertThread(input: {
    guildId: string;
    userId: string;
    channelId: string;
    threadId: string;
  }): Promise<WeeklyReportThread> {
    const now = new Date();
    const [row] = await this.database
      .insert(weeklyReportThreads)
      .values({
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          weeklyReportThreads.guildId,
          weeklyReportThreads.userId,
        ],
        set: {
          channelId: input.channelId,
          threadId: input.threadId,
          updatedAt: now,
        },
      })
      .returning();

    return mapThread(row);
  }

  async processMisses(
    guildId: string,
    input: ProcessWeeklyReportMissesBody,
  ): Promise<string[]> {
    getWeekPeriod(input.weekEnd);
    const current = this.weeklyTestDate ?? new Date();

    if (!isWeeklyReportDeadlineClosed(input.weekEnd, current)) {
      throw new ApiError(
        409,
        'WEEKLY_REPORT_DEADLINE_NOT_CLOSED',
        'Missing reports can only be counted after Tuesday at 19:00 KST.',
      );
    }

    const userIds = [...new Set(input.userIds)];

    if (userIds.length === 0) {
      return [];
    }

    const incrementedUserIds: string[] = [];

    await this.database.transaction(async (transaction) => {
      const [threads, reports, resetRows] = await Promise.all([
        transaction
          .select()
          .from(weeklyReportThreads)
          .where(and(
            eq(weeklyReportThreads.guildId, guildId),
            inArray(weeklyReportThreads.userId, userIds),
          )),
        transaction
          .select({ userId: weeklyReports.userId })
          .from(weeklyReports)
          .where(and(
            eq(weeklyReports.guildId, guildId),
            eq(weeklyReports.weekEnd, input.weekEnd),
            inArray(weeklyReports.userId, userIds),
          )),
        transaction
          .select({ countAfter: weeklyMissCountResets.countAfter })
          .from(weeklyMissCountResets)
          .where(eq(weeklyMissCountResets.guildId, guildId))
          .limit(1),
      ]);
      const reportedUserIds = requiresQualifyingScrum(input.weekEnd)
        ? await this.getUsersWithQualifyingReports(
          guildId, input.weekEnd, userIds, transaction,
        )
        : new Set(reports.map((report) => report.userId));
      const countAfter = resetRows[0]?.countAfter ?? null;

      for (const thread of threads) {
        if (
          reportedUserIds.has(thread.userId)
          || getKstDateString(thread.createdAt) > input.weekEnd
        ) {
          continue;
        }

        const inserted = await transaction
          .insert(weeklyReportMisses)
          .values({
            guildId,
            userId: thread.userId,
            weekEnd: input.weekEnd,
          })
          .onConflictDoNothing()
          .returning({ userId: weeklyReportMisses.userId });

        if (inserted.length === 0) {
          continue;
        }

        if (countAfter && input.weekEnd <= countAfter) {
          continue;
        }

        await transaction
          .update(weeklyReportThreads)
          .set({
            missedReportCount: sql`${weeklyReportThreads.missedReportCount} + 1`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(weeklyReportThreads.guildId, guildId),
            eq(weeklyReportThreads.userId, thread.userId),
          ));
        incrementedUserIds.push(thread.userId);
      }
    });

    return incrementedUserIds;
  }

  async processReminders(
    guildId: string,
    input: ProcessWeeklyReportRemindersBody,
  ): Promise<string[]> {
    getWeekPeriod(input.weekEnd);
    const current = this.weeklyTestDate ?? new Date();

    if (!isWeeklyReportReminderWindow(input.weekEnd, current)) {
      throw new ApiError(
        409,
        'WEEKLY_REPORT_REMINDER_DATE_INVALID',
        'Reminders can only be processed from Tuesday noon until 19:00 KST.',
      );
    }

    const userIds = [...new Set(input.userIds)];

    if (userIds.length === 0) {
      return [];
    }

    return this.database.transaction(async (transaction) => {
      const [contentRows, reminderRows] = await Promise.all([
        transaction
          .select({ userId: weeklyReports.userId })
          .from(weeklyReports)
          .innerJoin(
            weeklyReportItems,
            eq(weeklyReportItems.reportId, weeklyReports.id),
          )
          .where(and(
            eq(weeklyReports.guildId, guildId),
            eq(weeklyReports.weekEnd, input.weekEnd),
            inArray(weeklyReports.userId, userIds),
            inArray(weeklyReportItems.kind, ['completed', 'extra']),
          )),
        transaction
          .select({ userId: weeklyReportReminders.userId })
          .from(weeklyReportReminders)
          .where(and(
            eq(weeklyReportReminders.guildId, guildId),
            eq(weeklyReportReminders.weekEnd, input.weekEnd),
            inArray(weeklyReportReminders.userId, userIds),
          )),
      ]);
      const usersWithContent = requiresQualifyingScrum(input.weekEnd)
        ? await this.getUsersWithQualifyingReports(
          guildId, input.weekEnd, userIds, transaction,
        )
        : new Set(contentRows.map((row) => row.userId));
      const alreadyReminded = new Set(
        reminderRows.map((row) => row.userId),
      );
      const candidates = userIds.filter((userId) =>
        !usersWithContent.has(userId)
        && !alreadyReminded.has(userId),
      );
      const claimedUserIds: string[] = [];

      for (const userId of candidates) {
        const inserted = await transaction
          .insert(weeklyReportReminders)
          .values({
            guildId,
            userId,
            weekEnd: input.weekEnd,
          })
          .onConflictDoNothing()
          .returning({ userId: weeklyReportReminders.userId });

        if (inserted[0]) {
          claimedUserIds.push(inserted[0].userId);
        }
      }

      return claimedUserIds;
    });
  }

  private async getUsersWithQualifyingReports(
    guildId: string,
    weekEnd: string,
    userIds: string[],
    database: Database | Transaction,
  ): Promise<Set<string>> {
    const rows = await database
      .select({
        userId: weeklyReports.userId,
        scrumCategory: weeklyReportItems.scrumCategory,
      })
      .from(weeklyReports)
      .innerJoin(weeklyReportItems, eq(weeklyReportItems.reportId, weeklyReports.id))
      .where(and(
        eq(weeklyReports.guildId, guildId),
        eq(weeklyReports.weekEnd, weekEnd),
        inArray(weeklyReports.userId, userIds),
        eq(weeklyReportItems.kind, 'completed'),
      ));
    const qualified = new Set(
      rows.filter(isQualifyingScrumResult).map((row) => row.userId),
    );
    const legacyUsers = new Set(rows
      .filter((row) => row.scrumCategory === null && !qualified.has(row.userId))
      .map((row) => row.userId));

    // Reports saved before source categories existed are checked against their
    // scrum sources until the bot refreshes their stored snapshot.
    for (const userId of legacyUsers) {
      const preview = await this.getPreview(guildId, userId, weekEnd);
      if (preview.completedItems.some(isQualifyingScrumResult)) {
        qualified.add(userId);
      }
    }
    return qualified;
  }

  async getPreview(
    guildId: string,
    userId: string,
    weekEnd: string,
  ): Promise<WeeklyReportPreview> {
    const period = getWeekPeriod(weekEnd);
    const scrumRows = await this.database
      .select({ scrum: scrums })
      .from(scrums)
      .innerJoin(
        scrumMembers,
        and(
          eq(scrumMembers.scrumId, scrums.id),
          eq(scrumMembers.userId, userId),
        ),
      )
      .where(eq(scrums.guildId, guildId));
    const scrumIds = scrumRows.map((row) => row.scrum.id);
    const entryRows = scrumIds.length > 0
      ? await this.database
        .select()
        .from(scrumEntries)
        .where(and(
          inArray(scrumEntries.scrumId, scrumIds),
          gte(scrumEntries.scrumDate, period.weekStart),
          lte(scrumEntries.scrumDate, period.weekEnd),
        ))
        .orderBy(
          asc(scrumEntries.scrumDate),
          asc(scrumEntries.createdAt),
        )
      : [];
    const entryIds = entryRows.map((entry) => entry.id);
    const itemRows = entryIds.length > 0
      ? await this.database
        .select()
        .from(scrumEntryItems)
        .where(inArray(scrumEntryItems.entryId, entryIds))
        .orderBy(asc(scrumEntryItems.position))
      : [];
    const itemIds = itemRows.map((item) => item.id);
    const attachmentRows = itemIds.length > 0
      ? await this.database
        .select()
        .from(scrumEntryAttachments)
        .where(inArray(scrumEntryAttachments.itemId, itemIds))
        .orderBy(asc(scrumEntryAttachments.position))
      : [];
    const linkRows = itemIds.length > 0
      ? await this.database
        .select()
        .from(scrumEntryLinks)
        .where(inArray(scrumEntryLinks.itemId, itemIds))
        .orderBy(asc(scrumEntryLinks.position))
      : [];
    const nextTodoRows = entryIds.length > 0
      ? await this.database
        .select()
        .from(scrumEntryNextTodos)
        .where(inArray(scrumEntryNextTodos.entryId, entryIds))
        .orderBy(asc(scrumEntryNextTodos.position))
      : [];
    const itemsByEntry = new Map<string, typeof itemRows>();
    const nextTodosByEntry = new Map<string, string[]>();

    for (const item of itemRows) {
      const values = itemsByEntry.get(item.entryId) ?? [];
      values.push(item);
      itemsByEntry.set(item.entryId, values);
    }

    for (const todo of nextTodoRows) {
      const values = nextTodosByEntry.get(todo.entryId) ?? [];
      values.push(todo.content);
      nextTodosByEntry.set(todo.entryId, values);
    }

    const completedItems: WeeklyScrumResult[] = [];
    const nextTodos: string[] = [];

    for (const { scrum } of scrumRows) {
      if (
        scrum.status !== 'closed'
        || !scrum.completedAt
        || !scrum.completionResults
      ) {
        continue;
      }

      if (getWeeklyReportCycleEnd(scrum.completedAt) === weekEnd) {
        completedItems.push(...scrum.completionResults.map((item) => ({
          ...item,
          scrumCategory: scrum.category as WeeklyScrumResult['scrumCategory'],
        })));
      }
    }

    const categoryByScrumId = new Map(scrumRows.map(({ scrum }) =>
      [scrum.id, scrum.category as WeeklyScrumResult['scrumCategory']],
    ));
    for (const entry of entryRows) {
      for (const item of itemsByEntry.get(entry.id) ?? []) {
        const attachments = attachmentRows
          .filter((attachment) => attachment.itemId === item.id)
          .map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            url: attachment.url,
            contentType: attachment.contentType,
            size: attachment.size,
          }));
        const links = linkRows
          .filter((link) => link.itemId === item.id)
          .map((link) => link.url);

        if (
          item.kind === 'extra'
          || (
            item.kind === 'completed'
            && (attachments.length > 0 || links.length > 0)
          )
        ) {
          completedItems.push({
            scrumCategory: categoryByScrumId.get(entry.scrumId),
            title: item.title,
            comment: item.comment,
            attachments,
            links,
          });
        }
      }

      nextTodos.push(...(nextTodosByEntry.get(entry.id) ?? []));
    }

    const entryScrumIds = new Set(entryRows.map((entry) => entry.scrumId));
    const submittedScrumIds = new Set(
      entryRows
        .filter((entry) => entry.scrumDate === weekEnd)
        .map((entry) => entry.scrumId),
    );
    const pendingRows = scrumRows
      .map((row) => row.scrum)
      .filter((scrum) =>
        scrum.status === 'active'
        && scrum.nextScrumDate <= weekEnd
        && !submittedScrumIds.has(scrum.id),
      );
    const pendingIds = pendingRows.map((scrum) => scrum.id);
    const upcomingRows = scrumRows
      .map((row) => row.scrum)
      .filter((scrum) =>
        scrum.status === 'active'
        && getKstDateString(scrum.createdAt) >= period.weekStart
        && getKstDateString(scrum.createdAt) <= period.weekEnd
        && scrum.nextScrumDate > weekEnd
        && !entryScrumIds.has(scrum.id),
      );
    const upcomingIds = upcomingRows.map((scrum) => scrum.id);
    const currentTodoScrumIds = [...pendingIds, ...upcomingIds];
    const currentTodoRows = currentTodoScrumIds.length > 0
      ? await this.database
        .select()
        .from(scrumCurrentTodos)
        .where(inArray(scrumCurrentTodos.scrumId, currentTodoScrumIds))
        .orderBy(asc(scrumCurrentTodos.position))
      : [];
    const upcomingIdSet = new Set(upcomingIds);
    nextTodos.push(
      ...currentTodoRows
        .filter((todo) => upcomingIdSet.has(todo.scrumId))
        .map((todo) => todo.content),
    );
    const pendingScrums: WeeklyPendingScrum[] = pendingRows.map((scrum) => ({
      scrumId: scrum.id,
      projectName: scrum.projectName,
      todos: currentTodoRows
        .filter((todo) => todo.scrumId === scrum.id)
        .map((todo) => todo.content),
    }));
    const [existingReport] = await this.database
      .select({ id: weeklyReports.id })
      .from(weeklyReports)
      .where(and(
        eq(weeklyReports.guildId, guildId),
        eq(weeklyReports.userId, userId),
        eq(weeklyReports.weekEnd, weekEnd),
      ))
      .limit(1);

    return {
      ...period,
      completedItems,
      nextTodos,
      pendingScrums,
      existingReportId: existingReport?.id ?? null,
    };
  }

  private async hydrateReport(row: WeeklyReportRow): Promise<WeeklyReport> {
    const items = await this.database
      .select()
      .from(weeklyReportItems)
      .where(eq(weeklyReportItems.reportId, row.id))
      .orderBy(asc(weeklyReportItems.position));
    const itemIds = items.map((item) => item.id);
    const attachments = itemIds.length > 0
      ? await this.database
        .select()
        .from(weeklyReportAttachments)
        .where(inArray(weeklyReportAttachments.itemId, itemIds))
        .orderBy(asc(weeklyReportAttachments.position))
      : [];
    const links = itemIds.length > 0
      ? await this.database
        .select()
        .from(weeklyReportLinks)
        .where(inArray(weeklyReportLinks.itemId, itemIds))
        .orderBy(asc(weeklyReportLinks.position))
      : [];
    const mapResult = (
      item: typeof weeklyReportItems.$inferSelect,
    ): WeeklyScrumResult => ({
      scrumCategory: item.scrumCategory,
      title: item.title,
      comment: item.comment,
      attachments: attachments
        .filter((attachment) => attachment.itemId === item.id)
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      links: links
        .filter((link) => link.itemId === item.id)
        .map((link) => link.url),
    });

    return {
      id: row.id,
      guildId: row.guildId,
      userId: row.userId,
      threadId: row.threadId,
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      completedItems: items
        .filter((item) => item.kind === 'completed')
        .map(mapResult),
      extraItems: items
        .filter((item) => item.kind === 'extra')
        .map(mapResult),
      nextTodos: items
        .filter((item) => item.kind === 'next')
        .map((item) => item.title),
      pendingTodos: items
        .filter((item) => item.kind === 'pending')
        .map((item) => item.title),
      discordMessageIds: row.discordMessageIds,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getReport(reportId: string): Promise<WeeklyReport | null> {
    const [row] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.id, reportId))
      .limit(1);

    return row ? this.hydrateReport(row) : null;
  }

  async getLatestReportByThread(
    threadId: string,
  ): Promise<WeeklyReport | null> {
    const [row] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.threadId, threadId))
      .orderBy(
        desc(weeklyReports.weekEnd),
        desc(weeklyReports.createdAt),
      )
      .limit(1);

    return row ? this.hydrateReport(row) : null;
  }

  async findReport(
    guildId: string,
    userId: string,
    weekEnd: string,
  ): Promise<WeeklyReport | null> {
    getWeekPeriod(weekEnd);
    const [row] = await this.database
      .select()
      .from(weeklyReports)
      .where(and(
        eq(weeklyReports.guildId, guildId),
        eq(weeklyReports.userId, userId),
        eq(weeklyReports.weekEnd, weekEnd),
      ))
      .limit(1);

    return row ? this.hydrateReport(row) : null;
  }

  async syncReport(
    guildId: string,
    input: SyncWeeklyReportBody,
  ): Promise<WeeklyReport> {
    assertWeeklyReportSubmissionDate(
      input.weekEnd,
      this.weeklyTestDate ?? new Date(),
    );
    const preview = await this.getPreview(guildId, input.userId, input.weekEnd);
    const existing = preview.existingReportId
      ? await this.getReport(preview.existingReportId)
      : null;
    const pendingTodos = preview.pendingScrums.flatMap(
      (scrum) => scrum.todos,
    );
    const reportId = existing?.id ?? input.id;
    const now = new Date();

    await this.database.transaction(async (transaction) => {
      if (existing) {
        const [locked] = await transaction
          .select({ id: weeklyReports.id })
          .from(weeklyReports)
          .where(eq(weeklyReports.id, existing.id))
          .for('update')
          .limit(1);

        if (!locked) {
          throw new ApiError(
            404,
            'WEEKLY_REPORT_NOT_FOUND',
            'Weekly report not found.',
          );
        }

        await transaction
          .delete(weeklyReportItems)
          .where(eq(weeklyReportItems.reportId, existing.id));
        await transaction
          .update(weeklyReports)
          .set({
            threadId: input.threadId,
            updatedAt: now,
          })
          .where(eq(weeklyReports.id, existing.id));
      } else {
        await transaction.insert(weeklyReports).values({
          id: reportId,
          guildId,
          userId: input.userId,
          threadId: input.threadId,
          weekStart: preview.weekStart,
          weekEnd: preview.weekEnd,
          discordMessageIds: [],
          createdAt: now,
          updatedAt: now,
        });
      }

      await insertReportItems(transaction, reportId, {
        completedItems: preview.completedItems,
        extraItems: existing?.extraItems ?? [],
        nextTodos: preview.nextTodos,
        pendingTodos,
      });
    });

    const report = await this.getReport(reportId);

    if (!report) {
      throw new ApiError(
        500,
        'WEEKLY_REPORT_NOT_FOUND',
        'The synchronized weekly report could not be loaded.',
      );
    }

    return report;
  }

  async createReport(
    guildId: string,
    input: CreateWeeklyReportBody,
  ): Promise<WeeklyReport> {
    assertWeeklyReportSubmissionDate(
      input.weekEnd,
      this.weeklyTestDate ?? new Date(),
    );
    assertResultRequirements(input.extraItems);
    const preview = await this.getPreview(guildId, input.userId, input.weekEnd);

    if (preview.existingReportId) {
      throw new ApiError(
        409,
        'WEEKLY_REPORT_EXISTS',
        'A weekly report already exists for this week.',
      );
    }

    if (preview.completedItems.length + input.extraItems.length === 0) {
      throw new ApiError(
        400,
        'WEEKLY_COMPLETED_ITEM_REQUIRED',
        'At least one completed item is required.',
      );
    }

    const pendingTodos = preview.pendingScrums.flatMap(
      (scrum) => scrum.todos,
    );
    const now = new Date();

    await this.database.transaction(async (transaction) => {
      await transaction.insert(weeklyReports).values({
        id: input.id,
        guildId,
        userId: input.userId,
        threadId: input.threadId,
        weekStart: preview.weekStart,
        weekEnd: preview.weekEnd,
        discordMessageIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await insertReportItems(transaction, input.id, {
        completedItems: preview.completedItems,
        extraItems: input.extraItems,
        nextTodos: preview.nextTodos,
        pendingTodos,
      });
    });

    const [row] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.id, input.id))
      .limit(1);

    if (!row) {
      throw new ApiError(
        500,
        'WEEKLY_REPORT_NOT_FOUND',
        'The weekly report could not be loaded after creation.',
      );
    }

    return this.hydrateReport(row);
  }

  async updateReport(
    reportId: string,
    input: UpdateWeeklyReportBody,
  ): Promise<WeeklyReport> {
    assertResultRequirements(input.extraItems);
    const [existing] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.id, reportId))
      .limit(1);

    if (!existing) {
      throw new ApiError(
        404,
        'WEEKLY_REPORT_NOT_FOUND',
        'Weekly report not found.',
      );
    }

    if (input.actorType !== 'administrator') {
      assertWeeklyReportSubmissionDate(
        existing.weekEnd,
        this.weeklyTestDate ?? new Date(),
      );
    }

    const preview = await this.getPreview(
      existing.guildId,
      existing.userId,
      existing.weekEnd,
    );
    const pendingTodos = preview.pendingScrums.flatMap(
      (scrum) => scrum.todos,
    );

    await this.database.transaction(async (transaction) => {
      const [locked] = await transaction
        .select({ id: weeklyReports.id })
        .from(weeklyReports)
        .where(eq(weeklyReports.id, reportId))
        .for('update')
        .limit(1);

      if (!locked) {
        throw new ApiError(
          404,
          'WEEKLY_REPORT_NOT_FOUND',
          'Weekly report not found.',
        );
      }

      await transaction
        .delete(weeklyReportItems)
        .where(eq(weeklyReportItems.reportId, reportId));
      await insertReportItems(transaction, reportId, {
        completedItems: preview.completedItems,
        extraItems: input.extraItems,
        nextTodos: preview.nextTodos,
        pendingTodos,
      });
      await transaction
        .update(weeklyReports)
        .set({
          discordMessageIds: input.discordMessageIds,
          updatedAt: new Date(),
        })
        .where(eq(weeklyReports.id, reportId));
    });

    const [updated] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.id, reportId))
      .limit(1);

    if (!updated) {
      throw new ApiError(
        500,
        'WEEKLY_REPORT_NOT_FOUND',
        'The weekly report could not be loaded after update.',
      );
    }

    return this.hydrateReport(updated);
  }

  async deleteReport(
    reportId: string,
    input: DeleteWeeklyReportBody,
  ): Promise<WeeklyReport> {
    const reason = input.reason.trim();

    if (!reason) {
      throw new ApiError(
        400,
        'WEEKLY_DELETE_REASON_REQUIRED',
        'A weekly report deletion reason is required.',
      );
    }

    const [existing] = await this.database
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.id, reportId))
      .limit(1);

    if (!existing) {
      throw new ApiError(
        404,
        'WEEKLY_REPORT_NOT_FOUND',
        'Weekly report not found.',
      );
    }

    const report = await this.hydrateReport(existing);

    if (input.actorType === 'owner') {
      if (report.userId !== input.deletedBy) {
        throw new ApiError(
          403,
          'WEEKLY_REPORT_OWNER_REQUIRED',
          'Only the report owner can delete this weekly report.',
        );
      }

      if (
        report.weekEnd
        !== getWeeklyReportCycleEnd(this.weeklyTestDate ?? new Date())
      ) {
        throw new ApiError(
          409,
          'WEEKLY_REPORT_DELETE_CLOSED',
          'A report owner can only delete a report before its weekly cycle closes.',
        );
      }
    }

    await this.database.transaction(async (transaction) => {
      const [locked] = await transaction
        .select({ id: weeklyReports.id })
        .from(weeklyReports)
        .where(eq(weeklyReports.id, reportId))
        .for('update')
        .limit(1);

      if (!locked) {
        throw new ApiError(
          404,
          'WEEKLY_REPORT_NOT_FOUND',
          'Weekly report not found.',
        );
      }

      await transaction.insert(weeklyReportDeletions).values({
        id: randomUUID(),
        reportId,
        guildId: report.guildId,
        userId: report.userId,
        weekEnd: report.weekEnd,
        deletedBy: input.deletedBy,
        reason,
        deletedAt: new Date(),
      });
      await transaction
        .delete(weeklyReports)
        .where(eq(weeklyReports.id, reportId));
    });

    return report;
  }
}
