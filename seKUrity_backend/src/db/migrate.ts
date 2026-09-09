import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './database';

export async function runMigrations(database: Database): Promise<void> {
  await migrate(database, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });
}
