import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import type { AppConfig } from '../../config';
import type { Database } from '../../db/database';
import { ApiError } from '../../errors';
import {
  WebFeaturesRepository,
  type AttendanceStatus,
} from './web.features.repository';
import { WebRepository, type SyncedDiscordMember, type WebPrincipal } from './web.repository';

const SESSION_COOKIE = 'sekurity_session';
const CSRF_COOKIE = 'sekurity_csrf';
const OAUTH_STATE_COOKIE = 'sekurity_oauth_state';
const DiscordIdSchema = Type.String({ pattern: '^[0-9]+$', maxLength: 32 });
const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableDateTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()]);
const ErrorSchema = Type.Object({ code: Type.String(), message: Type.String() });
const UuidSchema = Type.String({ format: 'uuid' });
const AttendanceStatusSchema = Type.Union([
  Type.Literal('present'),
  Type.Literal('late'),
  Type.Literal('absent'),
  Type.Literal('excused'),
]);
const AttendanceSessionStatusSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('closed'),
  Type.Literal('cancelled'),
]);
const ScoreEventSchema = Type.Object({
  id: UuidSchema,
  amount: Type.Integer({ minimum: 1 }),
  reason: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  createdByName: NullableString,
  voidedAt: NullableDateTime,
  voidReason: NullableString,
});
const ProfileLinkSchema = Type.Object({
  label: Type.Optional(Type.String({ maxLength: 40 })),
  url: Type.String({ minLength: 1, maxLength: 2048 }),
});
const MemberProfileSchema = Type.Object({
  userId: UuidSchema,
  name: Type.String(),
  introduction: Type.String({ maxLength: 100 }),
  specialties: Type.Array(Type.String({ minLength: 1, maxLength: 30 }), {
    maxItems: 5,
    uniqueItems: true,
  }),
  links: Type.Array(ProfileLinkSchema, { maxItems: 5 }),
  photoUrl: NullableString,
  updatedAt: NullableDateTime,
});
const AttendanceRecordSchema = Type.Object({
  userId: UuidSchema,
  name: Type.String(),
  status: Type.Union([AttendanceStatusSchema, Type.Null()]),
  note: NullableString,
  updatedAt: NullableDateTime,
});
const AttendanceSessionSchema = Type.Object({
  id: UuidSchema,
  date: Type.String({ format: 'date' }),
  status: AttendanceSessionStatusSchema,
  records: Type.Array(AttendanceRecordSchema),
  cancelledReason: NullableString,
  closedAt: NullableDateTime,
});

const acceptedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const acceptedSharpFormats = new Set(['jpeg', 'png', 'webp']);

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordMemberResponse {
  nick: string | null;
  roles: string[];
}

function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/';
}

function avatarUrl(discordUserId: string, avatarHash: string | null): string | null {
  return avatarHash
    ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.webp?size=256`
    : null;
}

function requireActiveMember(principal: WebPrincipal): void {
  if (!principal.isActiveMember) {
    throw new ApiError(403, 'ACTIVE_MEMBER_REQUIRED', 'Active member access is required.');
  }
}

function requireBoardMember(principal: WebPrincipal): void {
  if (!principal.isActiveMember || !principal.isBoardMember) {
    throw new ApiError(403, 'BOARD_MEMBER_REQUIRED', 'Board member access is required.');
  }
}

function nonBlank(value: string, code: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ApiError(400, code, message);
  return normalized;
}

function isTuesday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && date.getUTCDay() === 2;
}

function normalizeProfileInput(input: {
  introduction: string;
  specialties: string[];
  links: Array<{ label?: string; url: string }>;
}) {
  const introduction = input.introduction.trim();
  const specialties = input.specialties.map((specialty) => specialty.trim());
  if (specialties.some((specialty) => !specialty)) {
    throw new ApiError(400, 'INVALID_SPECIALTY', 'Specialties cannot be blank.');
  }
  if (new Set(specialties).size !== specialties.length) {
    throw new ApiError(400, 'DUPLICATE_SPECIALTY', 'Specialties cannot contain duplicates.');
  }
  const links = input.links.map((link) => {
    let url: URL;
    try {
      url = new URL(link.url.trim());
    } catch {
      throw new ApiError(400, 'INVALID_PROFILE_LINK', 'Profile links must be valid URLs.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ApiError(400, 'INVALID_PROFILE_LINK_PROTOCOL', 'Profile links must use http or https.');
    }
    const label = link.label?.trim();
    return { ...(label ? { label } : {}), url: url.toString() };
  });
  return { introduction, specialties, links };
}

function safePhotoPath(uploadDir: string, storageKey: string): string {
  if (
    storageKey !== basename(storageKey)
    || !/^[0-9a-f-]+\.webp$/i.test(storageKey)
  ) {
    throw new ApiError(500, 'INVALID_PHOTO_STORAGE_KEY', 'The profile photo storage key is invalid.');
  }
  return join(uploadDir, storageKey);
}

function readSignedCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const result = request.unsignCookie(raw);
  return result.valid ? result.value : null;
}

async function discordJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    throw new ApiError(502, 'DISCORD_API_ERROR', `Discord ${operation} failed.`);
  }
  return response.json() as Promise<T>;
}

export function createWebRoutes(database: Database, config: AppConfig): FastifyPluginAsync {
  const repository = new WebRepository(
    database,
    config.sessionTokenPepper,
    config.webAuthGuildId,
    config.webActiveMemberRoleId,
    config.webBoardMemberRoleId,
  );
  const features = new WebFeaturesRepository(database, config.webAuthGuildId);
  const secureCookies = config.siteUrl.startsWith('https://');
  const siteOrigin = new URL(config.siteUrl).origin;
  const siteHostname = new URL(siteOrigin).hostname;
  const sessionCookieOptions = {
    path: '/',
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    signed: true,
  };

  function getSessionToken(request: FastifyRequest): string | null {
    return readSignedCookie(request, SESSION_COOKIE);
  }

  async function authenticate(request: FastifyRequest): Promise<{
    token: string;
    principal: WebPrincipal;
  }> {
    const token = getSessionToken(request);
    if (!token) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Login is required.');
    const principal = await repository.getPrincipal(token);
    if (!principal) throw new ApiError(401, 'SESSION_EXPIRED', 'The session has expired.');
    return { token, principal };
  }

  function assertBrowserMutation(request: FastifyRequest, sessionToken: string | null): void {
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    let sourceOrigin: string | null = null;
    try {
      sourceOrigin = origin ? new URL(origin).origin : referer ? new URL(referer).origin : null;
    } catch {
      throw new ApiError(403, 'INVALID_ORIGIN', 'The request origin is invalid.');
    }
    if (sourceOrigin !== siteOrigin) {
      throw new ApiError(403, 'INVALID_ORIGIN', 'The request origin is not allowed.');
    }
    if (sessionToken) {
      const cookieToken = request.cookies[CSRF_COOKIE];
      const headerToken = request.headers['x-csrf-token'];
      if (
        typeof cookieToken !== 'string'
        || typeof headerToken !== 'string'
        || cookieToken !== headerToken
        || !repository.verifyCsrfToken(sessionToken, headerToken)
      ) {
        throw new ApiError(403, 'CSRF_CHECK_FAILED', 'The CSRF token is missing or invalid.');
      }
    }
  }

  function setSessionCookies(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions, expires: expiresAt });
    reply.setCookie(CSRF_COOKIE, repository.createCsrfToken(token), {
      path: '/',
      httpOnly: false,
      secure: secureCookies,
      sameSite: 'lax',
      expires: expiresAt,
    });
  }

  function clearSessionCookies(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  return async function webRoutes(fastify): Promise<void> {
    await fastify.register(cookie, { secret: config.sessionSecret });
    await fastify.register(rateLimit, { global: false });
    await fastify.register(multipart, {
      limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 0 },
      throwFileSizeLimit: true,
    });

    const oauthStartOptions = {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['web-auth'],
          querystring: Type.Object({ returnTo: Type.Optional(Type.String({ maxLength: 500 })) }),
          response: { 302: Type.Any(), 429: ErrorSchema },
        },
      };
    const oauthStartHandler = async (
      request: FastifyRequest<{ Querystring: { returnTo?: string } }>,
      reply: FastifyReply,
    ) => {
        reply.header('Cache-Control', 'no-store');
        const returnTo = safeReturnTo(request.query.returnTo);
        // localhost and 127.0.0.1 do not share host-only cookies. Move the
        // browser before creating state; never forward a callback's code/state.
        if (request.hostname !== siteHostname) {
          const canonicalStart = new URL('/api/v1/auth/discord', siteOrigin);
          canonicalStart.searchParams.set('returnTo', returnTo);
          return reply.redirect(canonicalStart.toString());
        }
        const state = await repository.createOauthState(returnTo);
        reply.setCookie(OAUTH_STATE_COOKIE, state, {
          path: '/api/v1/auth/discord',
          httpOnly: true,
          secure: secureCookies,
          sameSite: 'lax',
          signed: true,
          maxAge: 10 * 60,
        });
        const url = new URL('https://discord.com/oauth2/authorize');
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: config.discordClientId,
          redirect_uri: config.discordRedirectUri,
          scope: 'identify guilds.members.read',
          state,
        }).toString();
        return reply.redirect(url.toString());
      };
    fastify.get<{ Querystring: { returnTo?: string } }>(
      '/auth/discord',
      oauthStartOptions,
      oauthStartHandler,
    );
    fastify.get<{ Querystring: { returnTo?: string } }>(
      '/auth/discord/start',
      { ...oauthStartOptions, schema: { ...oauthStartOptions.schema, hide: true } },
      oauthStartHandler,
    );

    fastify.get<{
      Querystring: { code?: string; state?: string; error?: string };
    }>(
      '/auth/discord/callback',
      {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['web-auth'],
          querystring: Type.Object({
            code: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
            state: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
            error: Type.Optional(Type.String({ maxLength: 128 })),
          }),
        },
      },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const cookieState = readSignedCookie(request, OAUTH_STATE_COOKIE);
        reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/v1/auth/discord' });
        if (request.query.error) {
          throw new ApiError(401, 'DISCORD_AUTHORIZATION_DENIED', 'Discord authorization was denied.');
        }
        if (!request.query.code || !request.query.state || request.query.state !== cookieState) {
          throw new ApiError(400, 'INVALID_OAUTH_STATE', 'The OAuth state is missing or invalid.');
        }
        const returnTo = await repository.consumeOauthState(request.query.state);
        if (!returnTo) throw new ApiError(400, 'EXPIRED_OAUTH_STATE', 'The OAuth state has expired.');

        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: request.query.code,
            client_id: config.discordClientId,
            client_secret: config.discordClientSecret,
            redirect_uri: config.discordRedirectUri,
          }),
        });
        const discordToken = await discordJson<DiscordTokenResponse>(tokenResponse, 'token exchange');
        const authorization = { authorization: `Bearer ${discordToken.access_token}` };
        const [userResponse, memberResponse] = await Promise.all([
          fetch('https://discord.com/api/v10/users/@me', { headers: authorization }),
          fetch(`https://discord.com/api/v10/users/@me/guilds/${config.webAuthGuildId}/member`, { headers: authorization }),
        ]);
        const user = await discordJson<DiscordUserResponse>(userResponse, 'user lookup');
        let membership: DiscordMemberResponse | null = null;
        if (memberResponse.status !== 404) {
          membership = await discordJson<DiscordMemberResponse>(memberResponse, 'guild member lookup');
        }
        const session = await repository.loginWithDiscord({
          discordUserId: user.id,
          username: user.username,
          globalName: user.global_name,
          avatarHash: user.avatar,
          guildNickname: membership?.nick ?? null,
          roleIds: membership?.roles ?? [],
          isGuildMember: membership !== null,
        });
        setSessionCookies(reply, session.token, session.expiresAt);
        return reply.redirect(`${config.siteUrl}${returnTo}`);
      },
    );

    fastify.get('/me', {
      schema: {
        tags: ['web-account'],
        response: {
          200: Type.Object({
            id: Type.String({ format: 'uuid' }),
            discordId: DiscordIdSchema,
            name: Type.String(),
            avatarUrl: NullableString,
            membership: Type.Union([Type.Literal('guest'), Type.Literal('active')]),
            isBoardMember: Type.Boolean(),
            csrfToken: Type.String(),
          }),
          401: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      return {
        id: principal.userId,
        discordId: principal.discordUserId,
        name: principal.guildNickname ?? principal.globalName ?? principal.username,
        avatarUrl: avatarUrl(principal.discordUserId, principal.avatarHash),
        membership: principal.isActiveMember ? 'active' as const : 'guest' as const,
        isBoardMember: principal.isActiveMember && principal.isBoardMember,
        csrfToken: repository.createCsrfToken(token),
      };
    });

    fastify.post('/auth/logout', {
      schema: { tags: ['web-auth'], response: { 204: Type.Null(), 403: ErrorSchema } },
    }, async (request, reply) => {
      const token = getSessionToken(request);
      assertBrowserMutation(request, token);
      if (token) await repository.logout(token);
      clearSessionCookies(reply);
      return reply.code(204).send();
    });

    fastify.post('/auth/logout-all', {
      schema: { tags: ['web-auth'], response: { 204: Type.Null(), 401: ErrorSchema, 403: ErrorSchema } },
    }, async (request, reply) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      await repository.logoutAll(principal.userId);
      clearSessionCookies(reply);
      return reply.code(204).send();
    });

    fastify.post('/auth/refresh', {
      schema: { tags: ['web-auth'], response: { 204: Type.Null(), 401: ErrorSchema, 403: ErrorSchema } },
    }, async (request, reply) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      const next = await repository.rotateSession(principal.sessionId, principal.userId);
      setSessionCookies(reply, next.token, next.expiresAt);
      return reply.code(204).send();
    });

    fastify.get('/me/summary', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({
            score: Type.Integer(),
            lateCount: Type.Integer({ minimum: 0 }),
            absentCount: Type.Integer({ minimum: 0 }),
            missedWeeklyReportCount: Type.Integer({ minimum: 0 }),
            recentScoreEvents: Type.Array(ScoreEventSchema),
            weeklyReportMisses: Type.Array(Type.Object({
              weekEnd: Type.String({ format: 'date' }),
            })),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      return features.getSummary(principal.userId, principal.discordUserId);
    });

    fastify.get('/me/scores', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({
            score: Type.Integer(),
            scoreEvents: Type.Array(ScoreEventSchema),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      return features.getScores(principal.userId);
    });

    fastify.get('/me/attendance', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({
            lateCount: Type.Integer({ minimum: 0 }),
            absentCount: Type.Integer({ minimum: 0 }),
            records: Type.Array(Type.Object({
              sessionId: UuidSchema,
              date: Type.String({ format: 'date' }),
              sessionStatus: AttendanceSessionStatusSchema,
              status: AttendanceStatusSchema,
              note: NullableString,
              updatedAt: NullableDateTime,
            })),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      return features.getAttendance(principal.userId);
    });

    fastify.get('/me/profile', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        response: { 200: MemberProfileSchema, 401: ErrorSchema, 403: ErrorSchema },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      return features.getProfile(principal.userId);
    });

    fastify.put<{
      Body: {
        introduction: string;
        specialties: string[];
        links: Array<{ label?: string; url: string }>;
      };
    }>('/me/profile', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        body: Type.Object({
          introduction: Type.String({ maxLength: 100 }),
          specialties: Type.Array(Type.String({ minLength: 1, maxLength: 30 }), {
            maxItems: 5,
            uniqueItems: true,
          }),
          links: Type.Array(ProfileLinkSchema, { maxItems: 5 }),
        }),
        response: {
          200: MemberProfileSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireActiveMember(principal);
      return features.updateProfile(principal.userId, normalizeProfileInput(request.body));
    });

    fastify.post('/me/profile/photo', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        consumes: ['multipart/form-data'],
        response: {
          200: Type.Object({ photoUrl: Type.String() }),
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          413: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireActiveMember(principal);

      const part = await request.file({
        limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 0 },
      });
      if (!part || part.fieldname !== 'photo') {
        throw new ApiError(400, 'PROFILE_PHOTO_REQUIRED', 'A profile photo is required.');
      }
      if (!acceptedPhotoTypes.has(part.mimetype)) {
        throw new ApiError(400, 'UNSUPPORTED_PROFILE_PHOTO', 'The photo must be JPEG, PNG, or WebP.');
      }
      const input = await part.toBuffer();
      if (part.file.truncated || input.length > config.uploadMaxBytes) {
        throw new ApiError(413, 'PROFILE_PHOTO_TOO_LARGE', 'The profile photo is too large.');
      }

      let output: Buffer;
      try {
        const image = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 });
        const metadata = await image.metadata();
        if (!metadata.format || !acceptedSharpFormats.has(metadata.format)) {
          throw new Error('Unsupported image format.');
        }
        output = await image
          .rotate()
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
      } catch {
        throw new ApiError(400, 'INVALID_PROFILE_PHOTO', 'The uploaded file is not a valid supported image.');
      }

      await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
      const storageKey = `${principal.userId}-${randomUUID()}.webp`;
      const finalPath = safePhotoPath(config.uploadDir, storageKey);
      const temporaryPath = `${finalPath}.tmp`;
      await writeFile(temporaryPath, output, { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, finalPath);

      let previousStorageKey: string | null;
      try {
        previousStorageKey = await features.updateProfilePhoto(principal.userId, storageKey);
      } catch (error) {
        await unlink(finalPath).catch(() => undefined);
        throw error;
      }
      if (previousStorageKey && previousStorageKey !== storageKey) {
        await unlink(safePhotoPath(config.uploadDir, previousStorageKey)).catch(() => undefined);
      }
      return {
        photoUrl: `/api/v1/members/${principal.userId}/photo?v=${encodeURIComponent(storageKey)}`,
      };
    });

    fastify.get('/members', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({ members: Type.Array(MemberProfileSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      return { members: await features.listProfiles() };
    });

    fastify.get<{ Params: { userId: string } }>('/members/:userId/photo', {
      schema: {
        tags: ['web-member'],
        security: [{ webSession: [] }],
        params: Type.Object({ userId: UuidSchema }),
        response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    }, async (request, reply) => {
      const { principal } = await authenticate(request);
      requireActiveMember(principal);
      const storageKey = await features.getProfilePhotoStorageKey(request.params.userId);
      if (!storageKey) throw new ApiError(404, 'PROFILE_PHOTO_NOT_FOUND', 'The profile photo was not found.');
      let photo: Buffer;
      try {
        photo = await readFile(safePhotoPath(config.uploadDir, storageKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ApiError(404, 'PROFILE_PHOTO_NOT_FOUND', 'The profile photo was not found.');
        }
        throw error;
      }
      return reply
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .type('image/webp')
        .send(photo);
    });

    fastify.get('/admin/members', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({
            members: Type.Array(Type.Object({
              userId: UuidSchema,
              name: Type.String(),
              avatarUrl: NullableString,
              score: Type.Integer(),
              scoreEvents: Type.Array(ScoreEventSchema),
            })),
          }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireBoardMember(principal);
      return { members: await features.listAdminMembers() };
    });

    fastify.post<{
      Params: { userId: string };
      Body: { amount: number; reason: string };
    }>('/admin/members/:userId/scores', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        params: Type.Object({ userId: UuidSchema }),
        body: Type.Object({
          amount: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
          reason: Type.String({ minLength: 1, maxLength: 200 }),
        }),
        response: {
          201: ScoreEventSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    }, async (request, reply) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireBoardMember(principal);
      const reason = nonBlank(request.body.reason, 'SCORE_REASON_REQUIRED', 'A score reason is required.');
      const event = await features.addScore(
        request.params.userId,
        request.body.amount,
        reason,
        principal.userId,
      );
      return reply.code(201).send(event);
    });

    fastify.post<{
      Params: { eventId: string };
      Body: { reason: string };
    }>('/admin/score-events/:eventId/void', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        params: Type.Object({ eventId: UuidSchema }),
        body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 200 }) }),
        response: {
          200: ScoreEventSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireBoardMember(principal);
      return features.voidScore(
        request.params.eventId,
        nonBlank(request.body.reason, 'VOID_REASON_REQUIRED', 'A void reason is required.'),
        principal.userId,
      );
    });

    fastify.get('/admin/attendance-sessions', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        response: {
          200: Type.Object({ sessions: Type.Array(AttendanceSessionSchema) }),
          401: ErrorSchema,
          403: ErrorSchema,
        },
      },
    }, async (request) => {
      const { principal } = await authenticate(request);
      requireBoardMember(principal);
      return { sessions: await features.listAttendanceSessions() };
    });

    fastify.post<{ Body: { date: string } }>('/admin/attendance-sessions', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        body: Type.Object({ date: Type.String({ format: 'date' }) }),
        response: {
          201: AttendanceSessionSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
        },
      },
    }, async (request, reply) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireBoardMember(principal);
      if (!isTuesday(request.body.date)) {
        throw new ApiError(400, 'ATTENDANCE_DATE_NOT_TUESDAY', 'Attendance sessions can only be created for Tuesday.');
      }
      const session = await features.createAttendanceSession(request.body.date, principal.userId);
      return reply.code(201).send(session);
    });

    fastify.patch<{
      Params: { sessionId: string };
      Body: { action: 'close' | 'cancel'; reason?: string };
    }>('/admin/attendance-sessions/:sessionId', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        params: Type.Object({ sessionId: UuidSchema }),
        body: Type.Union([
          Type.Object({ action: Type.Literal('close') }),
          Type.Object({
            action: Type.Literal('cancel'),
            reason: Type.String({ minLength: 1, maxLength: 200 }),
          }),
        ]),
        response: {
          200: AttendanceSessionSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireBoardMember(principal);
      if (request.body.action === 'close') {
        return features.closeAttendanceSession(request.params.sessionId, principal.userId);
      }
      return features.cancelAttendanceSession(
        request.params.sessionId,
        nonBlank(request.body.reason ?? '', 'CANCELLATION_REASON_REQUIRED', 'A cancellation reason is required.'),
        principal.userId,
      );
    });

    fastify.patch<{
      Params: { sessionId: string; userId: string };
      Body: { status: AttendanceStatus; note?: string };
    }>('/admin/attendance-sessions/:sessionId/records/:userId', {
      schema: {
        tags: ['web-admin'],
        security: [{ webSession: [] }],
        params: Type.Object({ sessionId: UuidSchema, userId: UuidSchema }),
        body: Type.Object({
          status: AttendanceStatusSchema,
          note: Type.Optional(Type.String({ maxLength: 200 })),
        }),
        response: {
          200: AttendanceRecordSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    }, async (request) => {
      const { token, principal } = await authenticate(request);
      assertBrowserMutation(request, token);
      requireBoardMember(principal);
      return features.updateAttendanceRecord(
        request.params.sessionId,
        request.params.userId,
        request.body.status,
        request.body.note?.trim() || null,
        principal.userId,
      );
    });
  };
}

export function createWebMemberSyncRoutes(database: Database, config: AppConfig): FastifyPluginAsync {
  const repository = new WebRepository(
    database,
    config.sessionTokenPepper,
    config.webAuthGuildId,
    config.webActiveMemberRoleId,
    config.webBoardMemberRoleId,
  );
  const MemberSchema = Type.Object({
    discordUserId: DiscordIdSchema,
    username: Type.String({ minLength: 1, maxLength: 80 }),
    globalName: NullableString,
    avatarHash: NullableString,
    guildNickname: NullableString,
    roleIds: Type.Array(DiscordIdSchema, { maxItems: 100, uniqueItems: true }),
    isGuildMember: Type.Boolean(),
  });

  return async function memberSyncRoutes(fastify): Promise<void> {
    fastify.post<{
      Params: { guildId: string };
      Body: { members: SyncedDiscordMember[]; fullReconciliation?: boolean };
    }>('/guilds/:guildId/web-members/sync', {
      schema: {
        tags: ['internal-web-members'],
        params: Type.Object({ guildId: DiscordIdSchema }),
        body: Type.Object({
          members: Type.Array(MemberSchema, { maxItems: 1000 }),
          fullReconciliation: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            synced: Type.Integer({ minimum: 0 }),
            deactivated: Type.Integer({ minimum: 0 }),
            sessionsRevoked: Type.Integer({ minimum: 0 }),
          }),
          400: ErrorSchema,
          401: ErrorSchema,
        },
      },
    }, async (request) => {
      if (request.params.guildId !== config.webAuthGuildId) {
        throw new ApiError(400, 'GUILD_NOT_CONFIGURED', 'This guild is not configured for web authentication.');
      }
      return repository.syncMembers(request.body.members, request.body.fullReconciliation ?? false);
    });
  };
}
