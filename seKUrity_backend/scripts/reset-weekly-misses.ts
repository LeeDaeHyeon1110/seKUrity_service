import 'dotenv/config';

import { Client } from 'pg';

interface CliOptions {
  after: string;
  guildId: string | null;
  apply: boolean;
}

interface CountRow {
  guildId: string;
  userId: string;
  currentCount: number;
  recalculatedCount: number;
}

const USAGE = `Usage:
  npm run db:reset:weekly-misses -- --after YYYY-MM-DD [--guild-id DISCORD_ID] [--apply]

Options:
  --after       Only misses with a week_end later than this date are counted.
  --guild-id    Limit the reset to one Discord guild. Omit to target all guilds.
  --apply       Persist the reset. Without this flag, only a preview is shown.
  --help        Show this help message.`;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  return databaseUrl;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]?.trim();

  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.\n\n${USAGE}`);
  }

  return value;
}

function parseOptions(args: string[]): CliOptions | null {
  if (args.includes('--help')) {
    return null;
  }

  let after = '';
  let guildId: string | null = null;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--after') {
      after = readOptionValue(args, index, '--after');
      index += 1;
      continue;
    }

    if (arg === '--guild-id') {
      guildId = readOptionValue(args, index, '--guild-id');
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
  }

  if (!isCalendarDate(after)) {
    throw new Error(`--after must be a valid YYYY-MM-DD date.\n\n${USAGE}`);
  }

  if (guildId && !/^[0-9]{1,32}$/.test(guildId)) {
    throw new Error('--guild-id must be a Discord guild ID containing only digits.');
  }

  return { after, guildId, apply };
}

async function readCounts(
  client: Client,
  options: Pick<CliOptions, 'after' | 'guildId'>,
): Promise<CountRow[]> {
  const result = await client.query<CountRow>(`
    SELECT
      threads.guild_id AS "guildId",
      threads.user_id AS "userId",
      threads.missed_report_count AS "currentCount",
      count(misses.week_end)::int AS "recalculatedCount"
    FROM weekly_report_threads AS threads
    LEFT JOIN weekly_report_misses AS misses
      ON misses.guild_id = threads.guild_id
      AND misses.user_id = threads.user_id
      AND misses.week_end > $1::date
    WHERE ($2::text IS NULL OR threads.guild_id = $2::text)
    GROUP BY
      threads.guild_id,
      threads.user_id,
      threads.missed_report_count
    ORDER BY threads.guild_id, threads.user_id
  `, [options.after, options.guildId]);

  return result.rows;
}

async function persistReset(
  client: Client,
  options: Pick<CliOptions, 'after' | 'guildId'>,
): Promise<number> {
  const resetResult = await client.query<{ guildId: string }>(`
    WITH target_guilds AS (
      SELECT $2::text AS guild_id
      WHERE $2::text IS NOT NULL
      UNION
      SELECT guild_id
      FROM guild_weekly_settings
      WHERE $2::text IS NULL
      UNION
      SELECT guild_id
      FROM weekly_report_threads
      WHERE $2::text IS NULL
    )
    INSERT INTO weekly_miss_count_resets (guild_id, count_after, updated_at)
    SELECT guild_id, $1::date, now()
    FROM target_guilds
    WHERE guild_id IS NOT NULL
    ON CONFLICT (guild_id) DO UPDATE SET
      count_after = EXCLUDED.count_after,
      updated_at = EXCLUDED.updated_at
    RETURNING guild_id AS "guildId"
  `, [options.after, options.guildId]);

  await client.query(`
    WITH recalculated AS (
      SELECT
        threads.guild_id,
        threads.user_id,
        count(misses.week_end)::int AS missed_report_count
      FROM weekly_report_threads AS threads
      LEFT JOIN weekly_report_misses AS misses
        ON misses.guild_id = threads.guild_id
        AND misses.user_id = threads.user_id
        AND misses.week_end > $1::date
      WHERE ($2::text IS NULL OR threads.guild_id = $2::text)
      GROUP BY threads.guild_id, threads.user_id
    )
    UPDATE weekly_report_threads AS threads
    SET
      missed_report_count = recalculated.missed_report_count,
      updated_at = now()
    FROM recalculated
    WHERE threads.guild_id = recalculated.guild_id
      AND threads.user_id = recalculated.user_id
      AND threads.missed_report_count IS DISTINCT FROM recalculated.missed_report_count
  `, [options.after, options.guildId]);

  return resetResult.rowCount ?? 0;
}

function printSummary(
  rows: CountRow[],
  options: CliOptions,
): void {
  const changedRows = rows.filter((row) =>
    row.currentCount !== row.recalculatedCount,
  );
  const currentTotal = rows.reduce((sum, row) => sum + row.currentCount, 0);
  const recalculatedTotal = rows.reduce(
    (sum, row) => sum + row.recalculatedCount,
    0,
  );

  console.log(options.apply ? 'Weekly miss count reset applied.' : 'Weekly miss count reset preview.');
  console.log(`Count misses after: ${options.after}`);
  console.log(`Guild: ${options.guildId ?? 'all configured guilds'}`);
  console.log(`Users: ${rows.length}, changed: ${changedRows.length}`);
  console.log(`Total count: ${currentTotal} -> ${recalculatedTotal}`);

  if (changedRows.length > 0) {
    console.table(changedRows);
  }

  if (!options.apply) {
    console.log('No data was changed. Run again with --apply to persist this reset point.');
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  if (!options) {
    console.log(USAGE);
    return;
  }

  const client = new Client({
    connectionString: requireDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
  });

  await client.connect();

  try {
    if (!options.apply) {
      printSummary(await readCounts(client, options), options);
      return;
    }

    await client.query('BEGIN');

    try {
      await client.query(`
        LOCK TABLE
          weekly_report_threads,
          weekly_report_misses,
          weekly_miss_count_resets
        IN SHARE ROW EXCLUSIVE MODE
      `);
      const rows = await readCounts(client, options);
      const resetGuildCount = await persistReset(client, options);
      await client.query('COMMIT');
      printSummary(rows, options);
      console.log(`Stored reset point for ${resetGuildCount} guild(s).`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
