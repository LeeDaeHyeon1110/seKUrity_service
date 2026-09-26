import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock } from 'node:test';
import type { Pool } from 'pg';
import { buildApp } from '../src/app';
import { validateWebAuthUrls, type AppConfig } from '../src/config';
import type { Database } from '../src/db/database';
import { WebRepository } from '../src/modules/web/web.repository';

const config: AppConfig = {
  databaseUrl: 'postgresql://unused', host: '127.0.0.1', port: 3000,
  internalApiToken: 'test-internal-token', nodeEnv: 'test', weeklyTestDate: null,
  siteUrl: 'http://127.0.0.1:8080',
  discordRedirectUri: 'http://127.0.0.1:8080/api/v1/auth/discord/callback',
  discordClientId: 'test-client-id', discordClientSecret: 'test-client-secret',
  sessionSecret: 'test-session-secret-at-least-32-characters',
  sessionTokenPepper: 'test-session-pepper-at-least-32-characters',
  webAuthGuildId: '1507335622719967292',
  webActiveMemberRoleId: '1507362589619912734',
  webBoardMemberRoleId: '1507362663339135047',
  uploadDir: '/tmp/sekurity-test-uploads', uploadMaxBytes: 5 * 1024 * 1024,
};

async function main(): Promise<void> {
  validateWebAuthUrls(config.siteUrl, config.discordRedirectUri);
  validateWebAuthUrls('https://sekurity.kr', 'https://sekurity.kr/api/v1/auth/discord/callback');
  for (const invalidCallback of [
    'http://localhost:8080/api/v1/auth/discord/callback',
    'https://127.0.0.1:8080/api/v1/auth/discord/callback',
    'http://127.0.0.1:3000/api/v1/auth/discord/callback',
    'http://127.0.0.1:8080/wrong-path',
    `${config.discordRedirectUri}?extra=1`,
  ]) {
    assert.throws(() => validateWebAuthUrls(config.siteUrl, invalidCallback), /DISCORD_REDIRECT_URI/);
  }
  for (const invalidSite of ['https://sekurity.kr/subpath', 'https://sekurity.kr?extra=1']) {
    assert.throws(() => validateWebAuthUrls(invalidSite, config.discordRedirectUri), /SITE_URL/);
  }

  // Keep tests offline and isolated from real users. Exercise the actual routes,
  // cookie signing/parsing, redirects and token-exchange request contract.
  const pendingStates = new Map<string, string>();
  const createState = mock.method(WebRepository.prototype, 'createOauthState', async (returnTo: string) => {
    const state = randomBytes(32).toString('base64url');
    pendingStates.set(state, returnTo);
    return state;
  });
  const consumeState = mock.method(WebRepository.prototype, 'consumeOauthState', async (state: string) => {
    const returnTo = pendingStates.get(state) ?? null;
    pendingStates.delete(state);
    return returnTo;
  });
  const login = mock.method(WebRepository.prototype, 'loginWithDiscord', async () => ({
    token: 'test-session-token', expiresAt: new Date(Date.now() + 60_000),
  }));
  const discordFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://discord.com/api/v10/oauth2/token') {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init.headers).get('content-type'), 'application/x-www-form-urlencoded');
      assert(init.body instanceof URLSearchParams);
      assert.equal(init.body.get('grant_type'), 'authorization_code');
      assert.equal(init.body.get('code'), 'test-authorization-code');
      assert.equal(init.body.get('redirect_uri'), config.discordRedirectUri);
      assert.equal(init.body.get('client_id'), config.discordClientId);
      assert.equal(init.body.get('client_secret'), config.discordClientSecret);
      return Response.json({ access_token: 'test-access-token', token_type: 'Bearer' });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-access-token');
    if (url === 'https://discord.com/api/v10/users/@me') {
      return Response.json({ id: '123456789012345678', username: 'test-user', global_name: null, avatar: null });
    }
    assert.equal(url, `https://discord.com/api/v10/users/@me/guilds/${config.webAuthGuildId}/member`);
    return Response.json({ nick: '테스트 회원', roles: [config.webActiveMemberRoleId] });
  };
  const fetchMock = mock.method(globalThis, 'fetch', discordFetch);
  const app = await buildApp({
    config, database: {} as Database, pool: { end: async () => undefined } as unknown as Pool,
  });

  try {
    // A noncanonical browser must move BEFORE a host-only state cookie exists.
    for (const path of ['/api/v1/auth/discord', '/api/v1/auth/discord/start']) {
      const response = await app.inject({
        url: `${path}?returnTo=%2Fmembers`, headers: { host: 'localhost:8080' },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, `${config.siteUrl}/api/v1/auth/discord?returnTo=%2Fmembers`);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.equal(createState.mock.callCount(), 0);

    const start = await app.inject({
      url: '/api/v1/auth/discord?returnTo=%2Fmembers', headers: { host: '127.0.0.1:8080' },
    });
    assert.equal(start.statusCode, 302);
    const authorization = new URL(start.headers.location!);
    assert.equal(authorization.origin, 'https://discord.com');
    assert.equal(authorization.pathname, '/oauth2/authorize');
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    assert.equal(authorization.searchParams.get('scope'), 'identify guilds.members.read');
    assert.equal(authorization.searchParams.get('redirect_uri'), config.discordRedirectUri);
    const state = authorization.searchParams.get('state')!;
    assert.match(state, /^[A-Za-z0-9_-]{43}$/);
    const stateCookie = start.cookies.find(({ name }) => name === 'sekurity_oauth_state')!;
    assert(stateCookie);
    assert.equal(stateCookie.path, '/api/v1/auth/discord');
    assert.equal(stateCookie.httpOnly, true);
    assert.equal(stateCookie.sameSite, 'Lax');
    assert.equal(stateCookie.domain, undefined);
    assert.equal(stateCookie.secure, undefined); // Local HTTP must be able to send it.
    assert.equal(stateCookie.maxAge, 600);
    const cookies = { sekurity_oauth_state: stateCookie.value };
    const callback = `/api/v1/auth/discord/callback?code=test-authorization-code&state=${state}`;

    for (const invalid of [
      { url: callback }, // Host mismatch in the old flow meant no cookie arrived.
      { url: callback, cookies: { sekurity_oauth_state: `${stateCookie.value}tampered` } },
      { url: `${callback}different`, cookies },
      { url: '/api/v1/auth/discord/callback?code=test-authorization-code', cookies },
      { url: `/api/v1/auth/discord/callback?state=${state}`, cookies },
    ]) {
      const response = await app.inject({ ...invalid, headers: { host: '127.0.0.1:8080' } });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, 'INVALID_OAUTH_STATE');
    }
    assert.equal(consumeState.mock.callCount(), 0);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(login.mock.callCount(), 0);

    const success = await app.inject({ url: callback, cookies, headers: { host: '127.0.0.1:8080' } });
    assert.equal(success.statusCode, 302);
    assert.equal(success.headers.location, `${config.siteUrl}/members`);
    assert.equal(success.headers['cache-control'], 'no-store');
    assert(success.cookies.some(({ name, httpOnly }) => name === 'sekurity_session' && httpOnly));
    assert.equal(fetchMock.mock.callCount(), 3);
    assert.equal(login.mock.callCount(), 1);
    assert.deepEqual(login.mock.calls[0].arguments[0], {
      discordUserId: '123456789012345678', username: 'test-user', globalName: null,
      avatarHash: null, guildNickname: '테스트 회원',
      roleIds: [config.webActiveMemberRoleId], isGuildMember: true,
    });

    // A copied cookie cannot make a consumed state valid again.
    const replay = await app.inject({ url: callback, cookies });
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().code, 'EXPIRED_OAUTH_STATE');
    assert.equal(fetchMock.mock.callCount(), 3);

    const expiredStart = await app.inject({ url: '/api/v1/auth/discord', headers: { host: '127.0.0.1' } });
    const expiredState = new URL(expiredStart.headers.location!).searchParams.get('state')!;
    pendingStates.delete(expiredState); // Simulate the repository rejecting an expired state.
    const expired = await app.inject({
      url: `/api/v1/auth/discord/callback?code=test-authorization-code&state=${expiredState}`,
      cookies: { sekurity_oauth_state: expiredStart.cookies[0].value },
    });
    assert.equal(expired.json().code, 'EXPIRED_OAUTH_STATE');
    assert.equal(fetchMock.mock.callCount(), 3);

    const denied = await app.inject({ url: '/api/v1/auth/discord/callback?error=access_denied' });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().code, 'DISCORD_AUTHORIZATION_DENIED');

    const unsafeReturn = await app.inject({
      url: '/api/v1/auth/discord?returnTo=https%3A%2F%2Fexample.com', headers: { host: 'localhost' },
    });
    assert.equal(unsafeReturn.headers.location, `${config.siteUrl}/api/v1/auth/discord?returnTo=%2F`);
    console.log('Validated OAuth canonical redirects, cookie binding, invalid/tampered/missing state, expiry/replay, token exchange, session creation and URL configuration. Discord and persistence were mocked.');
  } finally {
    await app.close();
    mock.restoreAll();
  }
}

void main();
