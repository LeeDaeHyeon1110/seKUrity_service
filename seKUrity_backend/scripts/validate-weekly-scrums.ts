import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Scrum, ScrumResult } from '../src/contracts';
import { createDatabase } from '../src/db/database';
import { runMigrations } from '../src/db/migrate';
import {
  scrums,
  weeklyReportItems,
  weeklyReportMisses,
  weeklyReportReminders,
  weeklyReports,
  weeklyReportThreads,
} from '../src/db/schema';
import { ScrumRepository } from '../src/modules/scrums/scrum.repository';
import { WeeklyRepository } from '../src/modules/weekly/weekly.repository';
import { getWeeklyReportCycleEnd } from '../src/modules/weeklyCycle';

async function main(): Promise<void> {
  const url = process.env.WEEKLY_VALIDATION_DATABASE_URL;
  assert(url, 'WEEKLY_VALIDATION_DATABASE_URL is required.');
  assert(new URL(url).pathname.startsWith('/sekurity_weekly_validation'),
    'Use a dedicated sekurity_weekly_validation database.');
  const { database, pool } = createDatabase(url);
  const guildId = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`));
  const current = new ScrumRepository(database, '2026-09-27');
  const weekly = new WeeklyRepository(database, '2026-09-27');
  const reminders = new WeeklyRepository(database, '2026-09-29');
  const closed = new WeeklyRepository(database, '2026-09-30');
  const users = Array.from({ length: 10 }, (_, i) => `${guildId}${i}`);
  let threadNumber = 0;
  const evidence = (title: string): ScrumResult => ({
    title, comment: '', attachments: [], links: ['https://example.com/proof'],
  });
  const document = (name: string, contentType: string) => ({
    id: '123', name, contentType, size: 100, url: `https://example.com/${name}`,
  });
  const create = async (
    userId: string,
    category: Scrum['category'] = 'study',
    repository = current,
    nextScrumDate = '2026-09-27',
  ) => repository.create({
    guildId, creatorId: userId, ownerIds: [userId], category,
    scrumChannelId: '111', threadId: `${guildId}${++threadNumber}00`,
    projectName: 'Regression scrum', overview: 'Weekly policy validation',
    planningDocument: category === 'project' || category === 'personal_study'
      ? document('plan.pdf', 'application/pdf') : null,
    projectScoreDocument: category === 'project'
      ? document('score.md', 'text/markdown') : null,
    currentTodos: ['Original task'], nextScrumDate,
  });
  const save = async (scrum: Scrum, repository = current) => {
    const next = new Date(`${scrum.nextScrumDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    return repository.saveEntry(scrum.id, {
      authorId: scrum.creatorId, scrumDate: scrum.nextScrumDate,
      nextScrumDate: next.toISOString().slice(0, 10),
      completedItems: scrum.currentTodos.map(evidence), extraItems: [],
      nextTodos: ['Next week task'],
    });
  };
  const sync = async (userId: string) => weekly.syncReport(guildId, {
    id: randomUUID(), userId, threadId: `${userId}99`, weekEnd: '2026-09-27',
  });

  try {
    await runMigrations(database);
    await database.insert(weeklyReportThreads).values(users.map((userId) => ({
      guildId, userId, channelId: '222', threadId: `${userId}99`,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    })));

    // Saving, editing and deleting the first entry must not replace initial work.
    const original = await create(users[0]!);
    await current.updateInitialTodosByThread(original.threadId, {
      updatedBy: original.creatorId, currentTodos: ['Edited initial task'],
    });
    const edited = (await current.getActiveByThread(original.threadId))!;
    const entry = await save(edited);
    assert.deepEqual((await current.getFirstEntryByThread(original.threadId))
      .entry.completedItems.map((item) => item.title), ['Edited initial task']);
    await current.updateEntry(entry.id, {
      actorId: original.creatorId, actorType: 'member',
      completedItems: entry.completedItems, extraItems: [], nextTodos: ['Discarded task'],
    });
    const restored = await current.deleteLatestEntry(entry.id, { authorId: original.creatorId });
    assert.deepEqual(restored.scrum.currentTodos, ['Edited initial task']);
    assert.equal(restored.scrum.nextScrumDate, '2026-09-27');
    await assert.rejects(current.getFirstEntryByThread(original.threadId),
      { code: 'SCRUM_ENTRY_NOT_FOUND' });
    await save(restored.scrum);

    const previous = new ScrumRepository(database, '2026-09-20');
    const multiWeek = await create(users[0]!, 'study', previous, '2026-09-20');
    const first = await save(multiWeek, previous);
    const second = await save((await current.getActiveByThread(multiWeek.threadId))!);
    assert.equal((await current.getFirstEntryByThread(multiWeek.threadId)).entry.id, first.id);
    const previousRestored = await current.deleteLatestEntry(second.id, { authorId: users[0]! });
    assert.deepEqual(previousRestored.scrum.currentTodos, ['Next week task']);
    assert.equal((await current.getFirstEntryByThread(multiWeek.threadId)).entry.id, first.id);

    const project = await create(users[1]!, 'project');
    await save(project);
    const personalStudy = await create(users[2]!, 'personal_study');
    await save(personalStudy);
    const personal = await create(users[3]!, 'personal');
    await save(personal);
    const reports = await Promise.all(users.slice(0, 4).map(sync));
    assert.deepEqual(reports.map((report) => report.completedItems[0]?.scrumCategory),
      ['study', 'project', 'personal_study', 'personal']);
    const withManualWork = await weekly.updateReport(reports[1]!.id, {
      extraItems: [evidence('Manual note')], discordMessageIds: ['123'],
    });
    assert.equal(withManualWork.completedItems[0]?.scrumCategory, 'project');
    assert.equal(withManualWork.extraItems[0]?.title, 'Manual note');

    // A forged category in the title of manual work does not qualify.
    await weekly.createReport(guildId, {
      id: randomUUID(), userId: users[4]!, threadId: `${users[4]}99`,
      weekEnd: '2026-09-27', extraItems: [evidence('[스터디] Manual task')],
    });
    const incomplete = await create(users[5]!);
    await current.saveEntry(incomplete.id, {
      authorId: incomplete.creatorId, scrumDate: '2026-09-27', nextScrumDate: '2026-10-04',
      completedItems: [{ title: 'Original task', comment: 'Not finished', attachments: [], links: [] }],
      extraItems: [], nextTodos: ['Original task'],
    });
    const incompleteReport = await sync(users[5]!);
    assert.equal(incompleteReport.completedItems.length, 0);

    // A report created before the category column is still recognized correctly.
    await database.update(weeklyReportItems).set({ scrumCategory: null })
      .where(eq(weeklyReportItems.reportId, reports[0]!.id));

    const completed = await create(users[6]!, 'personal_study');
    await current.completeByThread(completed.threadId, {
      completedBy: completed.creatorId, completedItems: completed.currentTodos.map(evidence),
    });
    for (const [time, cycle] of [
      ['2026-09-28T00:00:00+09:00', '2026-09-27'],
      ['2026-09-29T18:59:59+09:00', '2026-09-27'],
      ['2026-09-29T19:00:00+09:00', '2026-10-04'],
    ]) {
      assert.equal(getWeeklyReportCycleEnd(new Date(time!)), cycle);
      await database.update(scrums).set({ completedAt: new Date(time!) })
        .where(eq(scrums.id, completed.id));
      const preview = await weekly.getPreview(guildId, users[6]!, '2026-09-27');
      assert.equal(preview.completedItems.length, cycle === '2026-09-27' ? 1 : 0);
      if (cycle === '2026-09-27') {
        assert.equal(preview.completedItems[0]?.scrumCategory, 'personal_study');
      }
    }
    await database.update(scrums).set({ completedAt: new Date('2026-09-29T18:59:59+09:00') })
      .where(eq(scrums.id, completed.id));
    await sync(users[6]!);

    const revoked = await create(users[8]!);
    const revokedEntry = await save(revoked);
    await sync(users[8]!);
    await current.updateEntry(revokedEntry.id, {
      actorId: users[8]!, actorType: 'administrator',
      completedItems: [{ title: 'Original task', comment: 'Evidence rejected', attachments: [], links: [] }],
      extraItems: [], nextTodos: ['Original task'],
    });
    assert.equal((await sync(users[8]!)).completedItems.length, 0);
    const deleted = await create(users[9]!);
    const deletedEntry = await save(deleted);
    await sync(users[9]!);
    await current.deleteLatestEntry(deletedEntry.id, { authorId: users[9]! });
    assert.equal((await sync(users[9]!)).completedItems.length, 0);

    const expectedMissing = [users[3]!, users[4]!, users[5]!, ...users.slice(7)];
    assert.deepEqual(new Set(await reminders.processReminders(guildId, {
      weekEnd: '2026-09-27', userIds: users,
    })), new Set(expectedMissing));
    assert.deepEqual(await reminders.processReminders(guildId, {
      weekEnd: '2026-09-27', userIds: users,
    }), []);
    await assert.rejects(reminders.processMisses(guildId, {
      weekEnd: '2026-09-27', userIds: users,
    }), { code: 'WEEKLY_REPORT_DEADLINE_NOT_CLOSED' });

    // Completing qualifying work after a reminder prevents a miss at the deadline.
    const rescued = await create(users[7]!);
    const rescuedEntry = await save(rescued);
    await sync(users[7]!);
    const actualMissing = expectedMissing.filter((id) => id !== users[7]);
    assert.deepEqual(new Set(await closed.processMisses(guildId, {
      weekEnd: '2026-09-27', userIds: users,
    })), new Set(actualMissing));
    assert.deepEqual(await closed.processMisses(guildId, {
      weekEnd: '2026-09-27', userIds: users,
    }), []);
    const counts = await database.select().from(weeklyReportThreads)
      .where(eq(weeklyReportThreads.guildId, guildId));
    for (const row of counts) {
      assert.equal(row.missedReportCount, actualMissing.includes(row.userId) ? 1 : 0);
    }

    // Removing the only source task removes its category and work from the report.
    await current.deleteLatestEntry(rescuedEntry.id, { authorId: users[7]! });
    const cleared = await sync(users[7]!);
    assert.equal(cleared.completedItems.length, 0);

    // Earlier cycles keep the original rule, even when rechecked after deployment.
    const old = new WeeklyRepository(database, '2026-09-20');
    await old.createReport(guildId, {
      id: randomUUID(), userId: users[4]!, threadId: `${users[4]}99`, weekEnd: '2026-09-20',
      extraItems: [evidence('Previously accepted manual work')],
    });
    assert.deepEqual(await closed.processMisses(guildId, {
      weekEnd: '2026-09-20', userIds: [users[4]!],
    }), []);
    const [unchanged] = await database.select().from(weeklyReportThreads)
      .where(and(eq(weeklyReportThreads.guildId, guildId), eq(weeklyReportThreads.userId, users[4]!)));
    assert.equal(unchanged?.missedReportCount, 1);
    console.log('Validated initial-todo rollback, category snapshots, qualification, reminders, idempotent misses, legacy reports, and Tuesday completion boundaries.');
  } finally {
    await database.delete(weeklyReports).where(eq(weeklyReports.guildId, guildId));
    await database.delete(weeklyReportMisses).where(eq(weeklyReportMisses.guildId, guildId));
    await database.delete(weeklyReportReminders).where(eq(weeklyReportReminders.guildId, guildId));
    await database.delete(weeklyReportThreads).where(eq(weeklyReportThreads.guildId, guildId));
    await database.delete(scrums).where(and(eq(scrums.guildId, guildId), inArray(scrums.creatorId, users)));
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
