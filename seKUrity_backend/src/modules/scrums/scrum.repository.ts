import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
} from 'drizzle-orm';
import type {
  AbandonScrumBody,
  CompleteScrumBody,
  CreateScrumBody,
  DeleteScrumBody,
  DeleteScrumEntryBody,
  SaveScrumEntryBody,
  Scrum,
  ScrumEntry,
  ScrumResult,
  UpdateScrumCompletionResultsBody,
  UpdateScrumEntryBody,
  UpdateScrumEntryResultsBody,
  UpdateScrumInitialTodosBody,
  UpdateScrumMetadataBody,
} from '../../contracts';
import type { Database } from '../../db/database';
import {
  scrumCurrentTodos,
  scrumEntries,
  scrumEntryAttachments,
  scrumEntryItems,
  scrumEntryLinks,
  scrumEntryNextTodos,
  scrumMembers,
  scrumRequests,
  scrums,
} from '../../db/schema';
import { ApiError } from '../../errors';
import {
  assertProjectDocuments,
  mapPlanningDocument,
  mapProjectScoreDocument,
  planningDocumentColumns,
  projectScoreDocumentColumns,
} from '../planningDocuments';
import { getWeeklyCycleEnd } from '../weeklyCycle';

type ScrumRow = typeof scrums.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function toIsoString(value: Date): string {
  return value.toISOString();
}

function assertValidDate(date: string, fieldName: string): void {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ApiError(
      400,
      'INVALID_DATE',
      `${fieldName} must be a valid ISO calendar date.`,
    );
  }
}

function nextWeeklyDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 7);
  return parsed.toISOString().slice(0, 10);
}

function assertResultRequirements(results: ScrumResult[]): void {
  assertAttachmentLimits(results);
  const invalidResult = results.find((result) =>
    result.attachments.length === 0
    && result.links.length === 0
    && result.comment.trim().length === 0,
  );

  if (invalidResult) {
    throw new ApiError(
      400,
      'EVIDENCE_OR_COMMENT_REQUIRED',
      'Every scrum result requires an attachment, a link, or a comment.',
    );
  }
}

function assertAttachmentLimits(results: ScrumResult[]): void {
  if (results.some((result) => result.attachments.length > 1)) {
    throw new ApiError(
      400,
      'EVIDENCE_ATTACHMENT_LIMIT_EXCEEDED',
      'Each task can have at most one evidence attachment.',
    );
  }
}

function assertCompletionEvidence(results: ScrumResult[]): void {
  assertAttachmentLimits(results);
  const resultWithoutEvidence = results.find((result) =>
    result.attachments.length === 0 && result.links.length === 0,
  );

  if (resultWithoutEvidence) {
    throw new ApiError(
      400,
      'COMPLETION_EVIDENCE_REQUIRED',
      'Every completed scrum todo requires an attachment or a link.',
    );
  }
}

function mapScrum(
  row: ScrumRow,
  ownerIds: string[],
  currentTodos: string[],
): Scrum {
  return {
    id: row.id,
    guildId: row.guildId,
    scrumChannelId: row.scrumChannelId,
    threadId: row.threadId,
    creatorId: row.creatorId,
    ownerIds,
    projectName: row.projectName,
    overview: row.overview,
    category: row.category as Scrum['category'],
    planningDocument: mapPlanningDocument(row),
    projectScoreDocument: mapProjectScoreDocument(row),
    status: row.status as Scrum['status'],
    currentTodos,
    nextScrumDate: row.nextScrumDate,
    completedBy: row.completedBy,
    completionSummary: row.completionSummary,
    completionResults: row.completionResults,
    completedAt: row.completedAt?.toISOString() ?? null,
    abandonedBy: row.abandonedBy,
    abandonmentReason: row.abandonmentReason,
    abandonedAt: row.abandonedAt?.toISOString() ?? null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function insertEntryItems(
  transaction: Transaction,
  entryId: string,
  completedItems: ScrumResult[],
  extraItems: ScrumResult[],
): Promise<void> {
  const allItems = [
    ...completedItems.map((item) => ({
      item,
      kind: 'completed' as const,
    })),
    ...extraItems.map((item) => ({
      item,
      kind: 'extra' as const,
    })),
  ];

  for (const [position, { item, kind }] of allItems.entries()) {
    const itemId = randomUUID();

    await transaction.insert(scrumEntryItems).values({
      id: itemId,
      entryId,
      kind,
      title: item.title,
      comment: item.comment,
      position,
    });

    if (item.attachments.length > 0) {
      await transaction.insert(scrumEntryAttachments).values(
        item.attachments.map((attachment, attachmentPosition) => ({
          ...attachment,
          itemId,
          position: attachmentPosition,
        })),
      );
    }

    if (item.links.length > 0) {
      await transaction.insert(scrumEntryLinks).values(
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

export class ScrumRepository {
  constructor(
    private readonly database: Database,
    private readonly weeklyTestDate: string | null = null,
  ) {}

  private async hydrate(rows: ScrumRow[]): Promise<Scrum[]> {
    if (rows.length === 0) {
      return [];
    }

    const scrumIds = rows.map((row) => row.id);
    const [members, todos] = await Promise.all([
      this.database
        .select()
        .from(scrumMembers)
        .where(inArray(scrumMembers.scrumId, scrumIds)),
      this.database
        .select()
        .from(scrumCurrentTodos)
        .where(inArray(scrumCurrentTodos.scrumId, scrumIds))
        .orderBy(asc(scrumCurrentTodos.position)),
    ]);
    const membersByScrum = new Map<string, string[]>();
    const todosByScrum = new Map<string, string[]>();

    for (const member of members) {
      const values = membersByScrum.get(member.scrumId) ?? [];
      values.push(member.userId);
      membersByScrum.set(member.scrumId, values);
    }

    for (const todo of todos) {
      const values = todosByScrum.get(todo.scrumId) ?? [];
      values.push(todo.content);
      todosByScrum.set(todo.scrumId, values);
    }

    return rows.map((row) => mapScrum(
      row,
      membersByScrum.get(row.id) ?? [],
      todosByScrum.get(row.id) ?? [],
    ));
  }

  private async hydrateEntry(
    entry: typeof scrumEntries.$inferSelect,
  ): Promise<ScrumEntry> {
    const items = await this.database
      .select()
      .from(scrumEntryItems)
      .where(eq(scrumEntryItems.entryId, entry.id))
      .orderBy(asc(scrumEntryItems.position));
    const itemIds = items.map((item) => item.id);
    const [attachments, links, nextTodos] = await Promise.all([
      itemIds.length > 0
        ? this.database
          .select()
          .from(scrumEntryAttachments)
          .where(inArray(scrumEntryAttachments.itemId, itemIds))
          .orderBy(asc(scrumEntryAttachments.position))
        : Promise.resolve([]),
      itemIds.length > 0
        ? this.database
          .select()
          .from(scrumEntryLinks)
          .where(inArray(scrumEntryLinks.itemId, itemIds))
          .orderBy(asc(scrumEntryLinks.position))
        : Promise.resolve([]),
      this.database
        .select()
        .from(scrumEntryNextTodos)
        .where(eq(scrumEntryNextTodos.entryId, entry.id))
        .orderBy(asc(scrumEntryNextTodos.position)),
    ]);
    const resultForItem = (
      item: typeof scrumEntryItems.$inferSelect,
    ): ScrumResult => ({
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
      id: entry.id,
      scrumId: entry.scrumId,
      authorId: entry.authorId,
      scrumDate: entry.scrumDate,
      nextScrumDate: entry.nextScrumDate,
      completedItems: items
        .filter((item) => item.kind === 'completed')
        .map(resultForItem),
      extraItems: items
        .filter((item) => item.kind === 'extra')
        .map(resultForItem),
      nextTodos: nextTodos.map((todo) => todo.content),
      discordMessageIds: entry.discordMessageIds,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  async getEntryWithScrum(
    entryId: string,
  ): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
    const [row] = await this.database
      .select({ entry: scrumEntries, scrum: scrums })
      .from(scrumEntries)
      .innerJoin(scrums, eq(scrums.id, scrumEntries.scrumId))
      .where(eq(scrumEntries.id, entryId))
      .limit(1);

    if (!row) {
      throw new ApiError(404, 'SCRUM_ENTRY_NOT_FOUND', 'Scrum entry not found.');
    }

    const [entry, hydratedScrums] = await Promise.all([
      this.hydrateEntry(row.entry),
      this.hydrate([row.scrum]),
    ]);
    const [scrum] = hydratedScrums;

    if (!scrum) {
      throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
    }

    return { entry, scrum };
  }

  async getLatestEntryByThread(
    threadId: string,
    scrumDate?: string,
  ): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
    if (scrumDate) {
      assertValidDate(scrumDate, 'scrumDate');
    }

    const [row] = await this.database
      .select({ entry: scrumEntries })
      .from(scrumEntries)
      .innerJoin(scrums, eq(scrums.id, scrumEntries.scrumId))
      .where(scrumDate
        ? and(
          eq(scrums.threadId, threadId),
          eq(scrumEntries.scrumDate, scrumDate),
        )
        : eq(scrums.threadId, threadId))
      .orderBy(
        desc(scrumEntries.scrumDate),
        desc(scrumEntries.createdAt),
      )
      .limit(1);

    if (!row) {
      throw new ApiError(404, 'SCRUM_ENTRY_NOT_FOUND', 'Scrum entry not found.');
    }

    return this.getEntryWithScrum(row.entry.id);
  }

  async getFirstEntryByThread(
    threadId: string,
  ): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
    const [row] = await this.database
      .select({ id: scrumEntries.id })
      .from(scrumEntries)
      .innerJoin(scrums, eq(scrums.id, scrumEntries.scrumId))
      .where(eq(scrums.threadId, threadId))
      .orderBy(asc(scrumEntries.scrumDate), asc(scrumEntries.createdAt))
      .limit(1);

    if (!row) {
      throw new ApiError(404, 'SCRUM_ENTRY_NOT_FOUND', 'Scrum entry not found.');
    }

    return this.getEntryWithScrum(row.id);
  }

  async updateMetadataByThread(
    threadId: string,
    input: UpdateScrumMetadataBody,
  ): Promise<Scrum> {
    const projectName = input.projectName.trim();
    const overview = input.overview.trim();

    if (!projectName || !overview) {
      throw new ApiError(
        400,
        'SCRUM_METADATA_REQUIRED',
        'The scrum title and overview are required.',
      );
    }

    const updatedRow = await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      if (scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_NOT_ACTIVE',
          'Only an active scrum can be edited.',
        );
      }

      const now = new Date();
      const [updated] = await transaction
        .update(scrums)
        .set({
          projectName,
          overview,
          updatedAt: now,
        })
        .where(eq(scrums.id, scrum.id))
        .returning();

      await transaction
        .update(scrumRequests)
        .set({
          projectName,
          overview,
          updatedAt: now,
        })
        .where(eq(scrumRequests.scrumId, scrum.id));

      return updated;
    });
    const [updated] = await this.hydrate([updatedRow]);

    if (!updated) {
      throw new ApiError(500, 'SCRUM_UPDATE_FAILED', 'Scrum update failed.');
    }

    return updated;
  }

  async updateInitialTodosByThread(
    threadId: string,
    input: UpdateScrumInitialTodosBody,
  ): Promise<Scrum> {
    const currentTodos = [...new Set(
      input.currentTodos.map((todo) => todo.trim()).filter(Boolean),
    )];

    if (currentTodos.length === 0) {
      throw new ApiError(
        400,
        'SCRUM_TODOS_REQUIRED',
        'At least one initial scrum todo is required.',
      );
    }

    const scrumId = await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      if (scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_NOT_ACTIVE',
          'Only an active scrum can be edited.',
        );
      }

      const [memberRows, entryRows] = await Promise.all([
        transaction
          .select({ userId: scrumMembers.userId })
          .from(scrumMembers)
          .where(and(
            eq(scrumMembers.scrumId, scrum.id),
            eq(scrumMembers.userId, input.updatedBy),
          ))
          .limit(1),
        transaction
          .select({ id: scrumEntries.id })
          .from(scrumEntries)
          .where(eq(scrumEntries.scrumId, scrum.id))
          .limit(1),
      ]);

      if (!memberRows[0]) {
        throw new ApiError(
          403,
          'SCRUM_MEMBER_REQUIRED',
          'Only a scrum member can edit its initial todos.',
        );
      }

      if (entryRows[0]) {
        throw new ApiError(
          409,
          'SCRUM_INITIAL_TODOS_LOCKED',
          'Initial todos cannot be edited after the first scrum entry.',
        );
      }

      await transaction
        .delete(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrum.id));
      await transaction.insert(scrumCurrentTodos).values(
        currentTodos.map((content, position) => ({
          id: randomUUID(),
          scrumId: scrum.id,
          content,
          position,
        })),
      );
      await transaction
        .update(scrums)
        .set({ updatedAt: new Date() })
        .where(eq(scrums.id, scrum.id));

      return scrum.id;
    });
    const [updated] = await this.hydrate(
      await this.database
        .select()
        .from(scrums)
        .where(eq(scrums.id, scrumId))
        .limit(1),
    );

    if (!updated) {
      throw new ApiError(500, 'SCRUM_UPDATE_FAILED', 'Scrum update failed.');
    }

    return updated;
  }

  async updateEntry(
    entryId: string,
    input: UpdateScrumEntryBody,
  ): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
    assertResultRequirements([
      ...input.completedItems,
      ...input.extraItems,
    ]);

    await this.database.transaction(async (transaction) => {
      const [entry] = await transaction
        .select()
        .from(scrumEntries)
        .where(eq(scrumEntries.id, entryId))
        .for('update')
        .limit(1);

      if (!entry) {
        throw new ApiError(404, 'SCRUM_ENTRY_NOT_FOUND', 'Scrum entry not found.');
      }

      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.id, entry.scrumId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      const [latest] = await transaction
        .select({ id: scrumEntries.id })
        .from(scrumEntries)
        .where(eq(scrumEntries.scrumId, entry.scrumId))
        .orderBy(
          desc(scrumEntries.scrumDate),
          desc(scrumEntries.createdAt),
        )
        .limit(1);
      const isLatest = latest?.id === entry.id;

      if (input.actorType === 'member') {
        if (scrum.status !== 'active') {
          throw new ApiError(409, 'SCRUM_NOT_ACTIVE', 'The scrum is not active.');
        }

        if (entry.authorId !== input.actorId) {
          throw new ApiError(
            403,
            'SCRUM_ENTRY_AUTHOR_REQUIRED',
            'Only the entry author can edit it.',
          );
        }

        if (
          entry.scrumDate
          !== getWeeklyCycleEnd(this.weeklyTestDate ?? new Date())
        ) {
          throw new ApiError(
            409,
            'SCRUM_ENTRY_EDIT_EXPIRED',
            'A scrum entry can only be edited before its cycle closes.',
          );
        }

        if (!isLatest) {
          throw new ApiError(
            409,
            'SCRUM_ENTRY_NOT_LATEST',
            'Only the latest scrum entry can be edited.',
          );
        }
      }

      await transaction
        .delete(scrumEntryItems)
        .where(eq(scrumEntryItems.entryId, entry.id));
      await insertEntryItems(
        transaction,
        entry.id,
        input.completedItems,
        input.extraItems,
      );
      await transaction
        .delete(scrumEntryNextTodos)
        .where(eq(scrumEntryNextTodos.entryId, entry.id));
      await transaction.insert(scrumEntryNextTodos).values(
        input.nextTodos.map((content, position) => ({
          id: randomUUID(),
          entryId: entry.id,
          content,
          position,
        })),
      );

      if (isLatest) {
        await transaction
          .delete(scrumCurrentTodos)
          .where(eq(scrumCurrentTodos.scrumId, scrum.id));
        await transaction.insert(scrumCurrentTodos).values(
          input.nextTodos.map((content, position) => ({
            id: randomUUID(),
            scrumId: scrum.id,
            content,
            position,
          })),
        );
        await transaction
          .update(scrums)
          .set({ updatedAt: new Date() })
          .where(eq(scrums.id, scrum.id));
      }
    });

    return this.getEntryWithScrum(entryId);
  }

  async create(input: CreateScrumBody): Promise<Scrum> {
    assertValidDate(input.nextScrumDate, 'nextScrumDate');
    assertProjectDocuments(
      input.category,
      input.planningDocument,
      input.projectScoreDocument,
    );
    const ownerIds = [...new Set(input.ownerIds)];

    if (!ownerIds.includes(input.creatorId)) {
      throw new ApiError(
        400,
        'CREATOR_NOT_MEMBER',
        'The scrum creator must be included in ownerIds.',
      );
    }

    const id = randomUUID();
    const now = new Date();

    await this.database.transaction(async (transaction) => {
      await transaction.insert(scrums).values({
        id,
        guildId: input.guildId,
        scrumChannelId: input.scrumChannelId,
        threadId: input.threadId,
        creatorId: input.creatorId,
        projectName: input.projectName,
        overview: input.overview,
        category: input.category,
        ...planningDocumentColumns(input.planningDocument),
        ...projectScoreDocumentColumns(input.projectScoreDocument),
        status: 'active',
        nextScrumDate: input.nextScrumDate,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(scrumMembers).values(
        ownerIds.map((userId) => ({
          scrumId: id,
          userId,
        })),
      );
      await transaction.insert(scrumCurrentTodos).values(
        input.currentTodos.map((content, position) => ({
          id: randomUUID(),
          scrumId: id,
          content,
          position,
        })),
      );
    });

    return {
      id,
      ...input,
      ownerIds,
      status: 'active',
      completedBy: null,
      completionSummary: null,
      completionResults: null,
      completedAt: null,
      abandonedBy: null,
      abandonmentReason: null,
      abandonedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getActiveByThread(threadId: string): Promise<Scrum | null> {
    const rows = await this.database
      .select()
      .from(scrums)
      .where(and(
        eq(scrums.threadId, threadId),
        eq(scrums.status, 'active'),
      ))
      .limit(1);
    const [scrum] = await this.hydrate(rows);

    return scrum ?? null;
  }

  async abandonByThread(
    threadId: string,
    input: AbandonScrumBody,
  ): Promise<Scrum> {
    const reason = input.reason.trim();

    if (!reason) {
      throw new ApiError(
        400,
        'ABANDONMENT_REASON_REQUIRED',
        'An abandonment reason is required.',
      );
    }

    const abandonedAt = new Date();
    const updatedRow = await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      if (scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_NOT_ACTIVE',
          'Only an active scrum can be abandoned.',
        );
      }

      const [member] = await transaction
        .select({ userId: scrumMembers.userId })
        .from(scrumMembers)
        .where(and(
          eq(scrumMembers.scrumId, scrum.id),
          eq(scrumMembers.userId, input.abandonedBy),
        ))
        .limit(1);

      if (!member) {
        throw new ApiError(
          403,
          'SCRUM_MEMBER_REQUIRED',
          'Only a scrum member can abandon this scrum.',
        );
      }

      const [updated] = await transaction
        .update(scrums)
        .set({
          status: 'abandoned',
          abandonedBy: input.abandonedBy,
          abandonmentReason: reason,
          abandonedAt,
          updatedAt: abandonedAt,
        })
        .where(eq(scrums.id, scrum.id))
        .returning();

      if (!updated) {
        throw new ApiError(
          500,
          'SCRUM_ABANDONMENT_FAILED',
          'The scrum could not be abandoned.',
        );
      }

      return updated;
    });
    const [abandoned] = await this.hydrate([updatedRow]);

    if (!abandoned) {
      throw new ApiError(
        500,
        'SCRUM_ABANDONMENT_FAILED',
        'The abandoned scrum could not be loaded.',
      );
    }

    return abandoned;
  }

  async deleteByThread(
    threadId: string,
    input: DeleteScrumBody,
  ): Promise<Scrum> {
    const reason = input.reason.trim();

    if (!reason) {
      throw new ApiError(
        400,
        'SCRUM_DELETE_REASON_REQUIRED',
        'A scrum deletion reason is required.',
      );
    }

    return this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      if (scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_NOT_ACTIVE',
          'Only an active scrum can be deleted through abandonment.',
        );
      }

      const members = await transaction
        .select({ userId: scrumMembers.userId })
        .from(scrumMembers)
        .where(eq(scrumMembers.scrumId, scrum.id));

      if (!members.some((member) => member.userId === input.deletedBy)) {
        throw new ApiError(
          403,
          'SCRUM_MEMBER_REQUIRED',
          'Only a scrum member can delete this scrum.',
        );
      }

      const todos = await transaction
        .select({ content: scrumCurrentTodos.content })
        .from(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrum.id))
        .orderBy(asc(scrumCurrentTodos.position));
      const deletedScrum = mapScrum(
        scrum,
        members.map((member) => member.userId),
        todos.map((todo) => todo.content),
      );

      await transaction
        .delete(scrumRequests)
        .where(eq(scrumRequests.scrumId, scrum.id));
      await transaction
        .delete(scrums)
        .where(eq(scrums.id, scrum.id));

      return deletedScrum;
    });
  }

  async completeByThread(
    threadId: string,
    input: CompleteScrumBody,
  ): Promise<Scrum> {
    assertCompletionEvidence(input.completedItems);

    const updatedRow = await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (!scrum) {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Scrum not found.');
      }

      const [member] = await transaction
        .select({ userId: scrumMembers.userId })
        .from(scrumMembers)
        .where(and(
          eq(scrumMembers.scrumId, scrum.id),
          eq(scrumMembers.userId, input.completedBy),
        ))
        .limit(1);

      if (!member) {
        throw new ApiError(
          403,
          'SCRUM_MEMBER_REQUIRED',
          'Only a scrum member can complete this scrum.',
        );
      }

      if (scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_ALREADY_CLOSED',
          'This scrum has already been closed.',
        );
      }

      const currentTodos = await transaction
        .select({ content: scrumCurrentTodos.content })
        .from(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrum.id))
        .orderBy(asc(scrumCurrentTodos.position));
      const expectedTodos = currentTodos.map((todo) => todo.content);

      if (
        expectedTodos.length !== input.completedItems.length
        || expectedTodos.some(
          (todo, index) => todo !== input.completedItems[index]?.title,
        )
      ) {
        throw new ApiError(
          409,
          'ALL_SCRUM_TODOS_REQUIRED',
          'Every current scrum todo must be completed before closing the scrum.',
        );
      }

      const completedAt = new Date();
      const completionSummary = input.completedItems
        .map((item) => item.title)
        .join('\n')
        .slice(0, 1_000);
      const [updated] = await transaction
        .update(scrums)
        .set({
          status: 'closed',
          completedBy: input.completedBy,
          completionSummary,
          completionResults: input.completedItems,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(scrums.id, scrum.id))
        .returning();

      if (!updated) {
        throw new ApiError(
          500,
          'SCRUM_COMPLETION_FAILED',
          'The scrum could not be closed.',
        );
      }

      return updated;
    });
    const [completed] = await this.hydrate([updatedRow]);

    if (!completed) {
      throw new ApiError(
        500,
        'SCRUM_COMPLETION_FAILED',
        'The completed scrum could not be loaded.',
      );
    }

    return completed;
  }

  async updateCompletionResults(
    threadId: string,
    input: UpdateScrumCompletionResultsBody,
  ): Promise<void> {
    assertCompletionEvidence(input.completedItems);

    await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.threadId, threadId))
        .for('update')
        .limit(1);

      if (
        !scrum
        || scrum.status !== 'closed'
        || !scrum.completedAt
      ) {
        throw new ApiError(
          404,
          'SCRUM_COMPLETION_NOT_FOUND',
          'Completed scrum not found.',
        );
      }

      const currentTodos = await transaction
        .select({ content: scrumCurrentTodos.content })
        .from(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrum.id))
        .orderBy(asc(scrumCurrentTodos.position));

      if (
        currentTodos.length !== input.completedItems.length
        || currentTodos.some(
          (todo, index) => todo.content !== input.completedItems[index]?.title,
        )
      ) {
        throw new ApiError(
          409,
          'SCRUM_COMPLETION_ITEMS_CHANGED',
          'Completion results do not match the completed scrum todos.',
        );
      }

      await transaction
        .update(scrums)
        .set({
          completionResults: input.completedItems,
          updatedAt: new Date(),
        })
        .where(eq(scrums.id, scrum.id));
    });
  }

  async getActiveForUser(guildId: string, userId: string): Promise<Scrum[]> {
    const rows = await this.database
      .select({ scrum: scrums })
      .from(scrums)
      .innerJoin(
        scrumMembers,
        and(
          eq(scrumMembers.scrumId, scrums.id),
          eq(scrumMembers.userId, userId),
        ),
      )
      .where(and(
        eq(scrums.guildId, guildId),
        eq(scrums.status, 'active'),
      ))
      .orderBy(desc(scrums.createdAt));

    return this.hydrate(rows.map((row) => row.scrum));
  }

  async getActiveForGuild(guildId: string): Promise<Scrum[]> {
    const rows = await this.database
      .select()
      .from(scrums)
      .where(and(
        eq(scrums.guildId, guildId),
        eq(scrums.status, 'active'),
      ))
      .orderBy(desc(scrums.createdAt));

    return this.hydrate(rows);
  }

  async getInitialTodosEditableForGuild(guildId: string): Promise<Scrum[]> {
    const rows = await this.database
      .select({ scrum: scrums })
      .from(scrums)
      .leftJoin(scrumEntries, eq(scrumEntries.scrumId, scrums.id))
      .where(and(
        eq(scrums.guildId, guildId),
        eq(scrums.status, 'active'),
        isNull(scrumEntries.id),
      ))
      .orderBy(desc(scrums.createdAt));

    return this.hydrate(rows.map((row) => row.scrum));
  }

  async getActiveForUserById(
    scrumId: string,
    guildId: string,
    userId: string,
  ): Promise<Scrum | null> {
    const rows = await this.database
      .select({ scrum: scrums })
      .from(scrums)
      .innerJoin(
        scrumMembers,
        and(
          eq(scrumMembers.scrumId, scrums.id),
          eq(scrumMembers.userId, userId),
        ),
      )
      .where(and(
        eq(scrums.id, scrumId),
        eq(scrums.guildId, guildId),
        eq(scrums.status, 'active'),
      ))
      .limit(1);
    const [scrum] = await this.hydrate(rows.map((row) => row.scrum));

    return scrum ?? null;
  }

  async hasEntryForDate(scrumId: string, scrumDate: string): Promise<boolean> {
    const [entry] = await this.database
      .select({ id: scrumEntries.id })
      .from(scrumEntries)
      .where(and(
        eq(scrumEntries.scrumId, scrumId),
        eq(scrumEntries.scrumDate, scrumDate),
      ))
      .limit(1);

    return Boolean(entry);
  }

  async saveEntry(
    scrumId: string,
    input: SaveScrumEntryBody,
  ): Promise<ScrumEntry> {
    assertValidDate(input.scrumDate, 'scrumDate');
    assertValidDate(input.nextScrumDate, 'nextScrumDate');
    assertResultRequirements([
      ...input.completedItems,
      ...input.extraItems,
    ]);
    const currentCycleEnd = getWeeklyCycleEnd(
      this.weeklyTestDate ?? new Date(),
    );

    if (input.scrumDate !== currentCycleEnd) {
      throw new ApiError(
        409,
        'SCRUM_ENTRY_DATE_CLOSED',
        `Scrum entries for the current cycle must use ${currentCycleEnd}.`,
      );
    }

    const entryId = randomUUID();
    const createdAt = new Date();

    await this.database.transaction(async (transaction) => {
      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.id, scrumId))
        .for('update')
        .limit(1);

      if (!scrum || scrum.status !== 'active') {
        throw new ApiError(404, 'SCRUM_NOT_FOUND', 'Active scrum not found.');
      }

      const [member] = await transaction
        .select({ userId: scrumMembers.userId })
        .from(scrumMembers)
        .where(and(
          eq(scrumMembers.scrumId, scrumId),
          eq(scrumMembers.userId, input.authorId),
        ))
        .limit(1);

      if (!member) {
        throw new ApiError(
          403,
          'SCRUM_MEMBER_REQUIRED',
          'The author is not a scrum member.',
        );
      }

      const [existingEntry] = await transaction
        .select({ id: scrumEntries.id })
        .from(scrumEntries)
        .where(and(
          eq(scrumEntries.scrumId, scrumId),
          eq(scrumEntries.scrumDate, input.scrumDate),
        ))
        .limit(1);

      if (existingEntry) {
        throw new ApiError(
          409,
          'SCRUM_ENTRY_EXISTS',
          'An entry already exists for this scrum date.',
        );
      }

      if (scrum.nextScrumDate > input.scrumDate) {
        throw new ApiError(
          409,
          'SCRUM_NOT_SCHEDULED',
          `This scrum cannot be submitted before ${scrum.nextScrumDate}.`,
        );
      }

      if (input.nextScrumDate !== nextWeeklyDate(input.scrumDate)) {
        throw new ApiError(
          400,
          'INVALID_NEXT_SCRUM_DATE',
          'The next scrum date must be exactly seven days later.',
        );
      }

      const currentTodos = await transaction
        .select({ content: scrumCurrentTodos.content })
        .from(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrumId))
        .orderBy(asc(scrumCurrentTodos.position));

      if (
        currentTodos.length !== input.completedItems.length
        || currentTodos.some(
          (todo, index) => todo.content !== input.completedItems[index]?.title,
        )
      ) {
        throw new ApiError(
          409,
          'SCRUM_TODOS_CHANGED',
          'The submitted completed items do not match the current scrum todos.',
        );
      }

      await transaction.insert(scrumEntries).values({
        id: entryId,
        scrumId,
        authorId: input.authorId,
        scrumDate: input.scrumDate,
        nextScrumDate: input.nextScrumDate,
        createdAt,
      });
      await insertEntryItems(
        transaction,
        entryId,
        input.completedItems,
        input.extraItems,
      );
      await transaction.insert(scrumEntryNextTodos).values(
        input.nextTodos.map((content, position) => ({
          id: randomUUID(),
          entryId,
          content,
          position,
        })),
      );
      await transaction
        .delete(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrumId));
      await transaction.insert(scrumCurrentTodos).values(
        input.nextTodos.map((content, position) => ({
          id: randomUUID(),
          scrumId,
          content,
          position,
        })),
      );
      await transaction
        .update(scrums)
        .set({
          nextScrumDate: input.nextScrumDate,
          updatedAt: createdAt,
        })
        .where(eq(scrums.id, scrumId));
    });

    return {
      id: entryId,
      scrumId,
      ...input,
      discordMessageIds: [],
      createdAt: createdAt.toISOString(),
    };
  }

  async deleteLatestEntry(
    entryId: string,
    input: DeleteScrumEntryBody,
  ): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
    const deleted = await this.database.transaction(async (transaction) => {
      const [entry] = await transaction
        .select()
        .from(scrumEntries)
        .where(eq(scrumEntries.id, entryId))
        .for('update')
        .limit(1);

      if (!entry) {
        throw new ApiError(
          404,
          'SCRUM_ENTRY_NOT_FOUND',
          'Scrum entry not found.',
        );
      }

      const [scrum] = await transaction
        .select()
        .from(scrums)
        .where(eq(scrums.id, entry.scrumId))
        .for('update')
        .limit(1);

      if (!scrum || scrum.status !== 'active') {
        throw new ApiError(
          409,
          'SCRUM_NOT_ACTIVE',
          'The scrum is no longer active.',
        );
      }

      if (entry.authorId !== input.authorId) {
        throw new ApiError(
          403,
          'SCRUM_ENTRY_AUTHOR_REQUIRED',
          'Only the entry author can delete it.',
        );
      }

      if (
        entry.scrumDate
        !== getWeeklyCycleEnd(
          this.weeklyTestDate ?? new Date(),
        )
      ) {
        throw new ApiError(
          409,
          'SCRUM_ENTRY_DELETE_EXPIRED',
          'A scrum entry can only be deleted before its weekly cycle closes.',
        );
      }

      const [latestEntry] = await transaction
        .select({ id: scrumEntries.id })
        .from(scrumEntries)
        .where(eq(scrumEntries.scrumId, entry.scrumId))
        .orderBy(
          desc(scrumEntries.scrumDate),
          desc(scrumEntries.createdAt),
        )
        .limit(1);

      if (latestEntry?.id !== entry.id) {
        throw new ApiError(
          409,
          'SCRUM_ENTRY_NOT_LATEST',
          'Only the latest scrum entry can be deleted.',
        );
      }

      const items = await transaction
        .select()
        .from(scrumEntryItems)
        .where(eq(scrumEntryItems.entryId, entry.id))
        .orderBy(asc(scrumEntryItems.position));
      const itemIds = items.map((item) => item.id);
      const attachments = itemIds.length > 0
        ? await transaction
          .select()
          .from(scrumEntryAttachments)
          .where(inArray(scrumEntryAttachments.itemId, itemIds))
          .orderBy(asc(scrumEntryAttachments.position))
        : [];
      const links = itemIds.length > 0
        ? await transaction
          .select()
          .from(scrumEntryLinks)
          .where(inArray(scrumEntryLinks.itemId, itemIds))
          .orderBy(asc(scrumEntryLinks.position))
        : [];
      const nextTodos = await transaction
        .select()
        .from(scrumEntryNextTodos)
        .where(eq(scrumEntryNextTodos.entryId, entry.id))
        .orderBy(asc(scrumEntryNextTodos.position));
      const resultForItem = (
        item: typeof scrumEntryItems.$inferSelect,
      ): ScrumResult => ({
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
      const completedItems = items
        .filter((item) => item.kind === 'completed')
        .map(resultForItem);
      const extraItems = items
        .filter((item) => item.kind === 'extra')
        .map(resultForItem);
      const deletedEntry: ScrumEntry = {
        id: entry.id,
        scrumId: entry.scrumId,
        authorId: entry.authorId,
        scrumDate: entry.scrumDate,
        nextScrumDate: entry.nextScrumDate,
        completedItems,
        extraItems,
        nextTodos: nextTodos.map((todo) => todo.content),
        discordMessageIds: entry.discordMessageIds,
        createdAt: entry.createdAt.toISOString(),
      };

      await transaction
        .delete(scrumCurrentTodos)
        .where(eq(scrumCurrentTodos.scrumId, scrum.id));
      await transaction.insert(scrumCurrentTodos).values(
        completedItems.map((item, position) => ({
          id: randomUUID(),
          scrumId: scrum.id,
          content: item.title,
          position,
        })),
      );
      const [restoredRow] = await transaction
        .update(scrums)
        .set({
          nextScrumDate: entry.scrumDate,
          updatedAt: new Date(),
        })
        .where(eq(scrums.id, scrum.id))
        .returning();
      await transaction
        .delete(scrumEntries)
        .where(eq(scrumEntries.id, entry.id));

      if (!restoredRow) {
        throw new ApiError(
          500,
          'SCRUM_ENTRY_DELETE_FAILED',
          'The scrum entry could not be deleted.',
        );
      }

      return {
        entry: deletedEntry,
        scrum: restoredRow,
      };
    });
    const [restoredScrum] = await this.hydrate([deleted.scrum]);

    if (!restoredScrum) {
      throw new ApiError(
        500,
        'SCRUM_ENTRY_DELETE_FAILED',
        'The restored scrum could not be loaded.',
      );
    }

    return {
      entry: deleted.entry,
      scrum: restoredScrum,
    };
  }

  async updateEntryResults(
    entryId: string,
    input: UpdateScrumEntryResultsBody,
  ): Promise<void> {
    assertResultRequirements([
      ...input.completedItems,
      ...input.extraItems,
    ]);

    await this.database.transaction(async (transaction) => {
      const [entry] = await transaction
        .select({ id: scrumEntries.id })
        .from(scrumEntries)
        .where(eq(scrumEntries.id, entryId))
        .for('update')
        .limit(1);

      if (!entry) {
        throw new ApiError(404, 'SCRUM_ENTRY_NOT_FOUND', 'Scrum entry not found.');
      }

      await transaction
        .delete(scrumEntryItems)
        .where(eq(scrumEntryItems.entryId, entryId));
      await insertEntryItems(
        transaction,
        entryId,
        input.completedItems,
        input.extraItems,
      );
      await transaction
        .update(scrumEntries)
        .set({
          discordMessageIds: input.discordMessageIds,
        })
        .where(eq(scrumEntries.id, entryId));
    });
  }
}
