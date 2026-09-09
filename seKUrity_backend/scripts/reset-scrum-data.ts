import 'dotenv/config';

import { Client } from 'pg';

const CONFIRMATION_FLAG = '--confirm-reset-scrums';

function requireConfirmation(args: string[]): void {
  const unexpected = args.filter((arg) => arg !== CONFIRMATION_FLAG);

  if (!args.includes(CONFIRMATION_FLAG)) {
    throw new Error(
      `Refusing to reset scrum data without ${CONFIRMATION_FLAG}.`,
    );
  }

  if (unexpected.length > 0) {
    throw new Error(`Unknown option: ${unexpected.join(', ')}`);
  }
}

interface ScrumDataCounts {
  scrumCurrentTodos: number;
  scrumEntries: number;
  scrumEntryAttachments: number;
  scrumEntryItems: number;
  scrumEntryLinks: number;
  scrumEntryNextTodos: number;
  scrumMembers: number;
  scrumRequests: number;
  scrumRequestTodos: number;
  scrums: number;
  weeklyReportAttachments: number;
  weeklyReportItems: number;
  weeklyReportLinks: number;
  weeklyReports: number;
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  return databaseUrl;
}

async function readScrumDataCounts(
  client: Client,
): Promise<ScrumDataCounts> {
  const result = await client.query<ScrumDataCounts>(`
    SELECT
      (SELECT count(*)::int FROM scrum_current_todos) AS "scrumCurrentTodos",
      (SELECT count(*)::int FROM scrum_entries) AS "scrumEntries",
      (SELECT count(*)::int FROM scrum_entry_attachments) AS "scrumEntryAttachments",
      (SELECT count(*)::int FROM scrum_entry_items) AS "scrumEntryItems",
      (SELECT count(*)::int FROM scrum_entry_links) AS "scrumEntryLinks",
      (SELECT count(*)::int FROM scrum_entry_next_todos) AS "scrumEntryNextTodos",
      (SELECT count(*)::int FROM scrum_members) AS "scrumMembers",
      (SELECT count(*)::int FROM scrum_requests) AS "scrumRequests",
      (SELECT count(*)::int FROM scrum_request_todos) AS "scrumRequestTodos",
      (SELECT count(*)::int FROM scrums) AS "scrums",
      (SELECT count(*)::int FROM weekly_report_attachments) AS "weeklyReportAttachments",
      (SELECT count(*)::int FROM weekly_report_items) AS "weeklyReportItems",
      (SELECT count(*)::int FROM weekly_report_links) AS "weeklyReportLinks",
      (SELECT count(*)::int FROM weekly_reports) AS "weeklyReports"
  `);
  const counts = result.rows[0];

  if (!counts) {
    throw new Error('Failed to read scrum data counts.');
  }

  return counts;
}

async function resetScrumData(client: Client): Promise<ScrumDataCounts> {
  await client.query('BEGIN');

  try {
    await client.query(
      'LOCK TABLE scrum_requests, scrums, weekly_reports IN ACCESS EXCLUSIVE MODE',
    );
    const counts = await readScrumDataCounts(client);

    // Approved requests reference scrums, so requests must be deleted first.
    await client.query('DELETE FROM weekly_reports');
    await client.query('DELETE FROM scrum_requests');
    await client.query('DELETE FROM scrums');
    await client.query('COMMIT');

    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  requireConfirmation(process.argv.slice(2));

  const client = new Client({
    connectionString: requireDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
  });

  await client.connect();

  try {
    const deletedCounts = await resetScrumData(client);

    console.log('Scrum data reset completed.');
    console.table(deletedCounts);
    console.log('Guild channel, role, weekly thread mappings, and deletion audit settings were preserved.');
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
