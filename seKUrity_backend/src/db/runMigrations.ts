import { loadConfig } from '../config';
import { createDatabase } from './database';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  const config = loadConfig();
  const { database, pool } = createDatabase(config.databaseUrl);

  try {
    await runMigrations(database);
  } finally {
    await pool.end();
  }
}

void main();
