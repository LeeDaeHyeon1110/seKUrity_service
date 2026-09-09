import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/database';
import { runMigrations } from './db/migrate';

async function main(): Promise<void> {
  const config = loadConfig();
  const { database, pool } = createDatabase(config.databaseUrl);

  try {
    await runMigrations(database);
    const app = await buildApp({
      config,
      database,
      pool,
    });
    await app.listen({
      host: config.host,
      port: config.port,
    });
  } catch (error) {
    await pool.end();
    throw error;
  }
}

void main();
