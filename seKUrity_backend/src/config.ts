import 'dotenv/config';

export interface AppConfig {
  databaseUrl: string;
  host: string;
  internalApiToken: string;
  nodeEnv: string;
  port: number;
  weeklyTestDate: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

export function resolveWeeklyTestDate(
  nodeEnv: string,
  value: string | undefined,
): string | null {
  const testDate = value?.trim();

  if (!testDate) {
    return null;
  }

  if (nodeEnv !== 'test') {
    throw new Error('WEEKLY_TEST_DATE can only be used when NODE_ENV=test.');
  }

  const parsed = new Date(`${testDate}T00:00:00.000Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(testDate)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== testDate
  ) {
    throw new Error('WEEKLY_TEST_DATE must use the YYYY-MM-DD format.');
  }

  return testDate;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';

  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    host: process.env.HOST?.trim() || '0.0.0.0',
    internalApiToken: requireEnv('INTERNAL_API_TOKEN'),
    nodeEnv,
    port: parsePort(process.env.PORT),
    weeklyTestDate: resolveWeeklyTestDate(
      nodeEnv,
      process.env.WEEKLY_TEST_DATE,
    ),
  };
}
