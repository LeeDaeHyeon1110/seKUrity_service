import 'dotenv/config';

export interface AppConfig {
  databaseUrl: string;
  host: string;
  internalApiToken: string;
  nodeEnv: string;
  port: number;
  weeklyTestDate: string | null;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
  siteUrl: string;
  sessionSecret: string;
  sessionTokenPepper: string;
  webAuthGuildId: string;
  webActiveMemberRoleId: string;
  webBoardMemberRoleId: string;
  uploadDir: string;
  uploadMaxBytes: number;
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

function requireSecret(name: string): string {
  const value = requireEnv(name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters.`);
  }
  return value;
}

function parseAbsoluteUrl(name: string): string {
  const value = requireEnv(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  return url.toString().replace(/\/$/, '');
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function validateWebAuthUrls(siteUrl: string, discordRedirectUri: string): void {
  const site = new URL(siteUrl);
  const callback = new URL(discordRedirectUri);
  if (
    !['http:', 'https:'].includes(site.protocol)
    || site.username || site.password || site.search || site.hash
    || site.pathname !== '/'
  ) {
    throw new Error('SITE_URL must be an http(s) origin without a path, credentials, query, or fragment.');
  }
  const expectedCallback = new URL('/api/v1/auth/discord/callback', site);
  if (callback.href !== expectedCallback.href) {
    throw new Error('DISCORD_REDIRECT_URI must equal SITE_URL + /api/v1/auth/discord/callback (same protocol, host, and port).');
  }
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

  const siteUrl = parseAbsoluteUrl('SITE_URL');
  const discordRedirectUri = parseAbsoluteUrl('DISCORD_REDIRECT_URI');
  validateWebAuthUrls(siteUrl, discordRedirectUri);

  if (nodeEnv === 'production' && (!siteUrl.startsWith('https://') || !discordRedirectUri.startsWith('https://'))) {
    throw new Error('SITE_URL and DISCORD_REDIRECT_URI must use HTTPS in production.');
  }

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
    discordClientId: requireEnv('DISCORD_CLIENT_ID'),
    discordClientSecret: requireEnv('DISCORD_CLIENT_SECRET'),
    discordRedirectUri,
    siteUrl,
    sessionSecret: requireSecret('SESSION_SECRET'),
    sessionTokenPepper: requireSecret('SESSION_TOKEN_PEPPER'),
    webAuthGuildId: process.env.WEB_AUTH_GUILD_ID?.trim() || '1507335622719967292',
    webActiveMemberRoleId: process.env.WEB_ACTIVE_MEMBER_ROLE_ID?.trim() || '1507362589619912734',
    webBoardMemberRoleId: process.env.WEB_BOARD_MEMBER_ROLE_ID?.trim() || '1507362663339135047',
    uploadDir: process.env.UPLOAD_DIR?.trim() || '/app/data/profile-photos',
    uploadMaxBytes: parsePositiveInteger('UPLOAD_MAX_BYTES', process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
  };
}
