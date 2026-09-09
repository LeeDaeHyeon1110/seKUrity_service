import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import {
  CreateWeeklyReportBodySchema,
  DeleteWeeklyReportBodySchema,
  ErrorResponseSchema,
  ProcessWeeklyReportMissesBodySchema,
  ProcessWeeklyReportMissesResponseSchema,
  ProcessWeeklyReportRemindersBodySchema,
  ProcessWeeklyReportRemindersResponseSchema,
  SyncWeeklyReportBodySchema,
  UpdateWeeklyReportBodySchema,
  WeeklyReportPreviewSchema,
  WeeklyReportSchema,
  WeeklyReportThreadSchema,
} from '../../contracts';
import type {
  CreateWeeklyReportBody,
  DeleteWeeklyReportBody,
  ProcessWeeklyReportMissesBody,
  ProcessWeeklyReportRemindersBody,
  SyncWeeklyReportBody,
  UpdateWeeklyReportBody,
} from '../../contracts';
import type { Database } from '../../db/database';
import { WeeklyRepository } from './weekly.repository';

const DiscordIdSchema = Type.String({
  pattern: '^[0-9]+$',
  maxLength: 32,
});
const UuidSchema = Type.String({ format: 'uuid' });
const DateSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});
const GuildParamsSchema = Type.Object({
  guildId: DiscordIdSchema,
});
const UserParamsSchema = Type.Object({
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
});
const ReportParamsSchema = Type.Object({
  reportId: UuidSchema,
});
const ThreadParamsSchema = Type.Object({
  threadId: DiscordIdSchema,
});
const UserWeekParamsSchema = Type.Object({
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
  weekEnd: DateSchema,
});
const RoleResponseSchema = Type.Object({
  roleId: Type.Union([DiscordIdSchema, Type.Null()]),
});

interface GuildParams {
  guildId: string;
}

interface UserParams extends GuildParams {
  userId: string;
}

interface ReportParams {
  reportId: string;
}

interface ThreadParams {
  threadId: string;
}

interface UserWeekParams extends UserParams {
  weekEnd: string;
}

export function createWeeklyRoutes(
  database: Database,
  weeklyTestDate: string | null = null,
): FastifyPluginAsync {
  const repository = new WeeklyRepository(database, weeklyTestDate);

  return async function weeklyRoutes(fastify): Promise<void> {
    fastify.get<{ Params: GuildParams }>(
      '/guilds/:guildId/weekly-role',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          response: {
            200: RoleResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        roleId: await repository.getRoleId(request.params.guildId),
      }),
    );

    fastify.put<{
      Params: GuildParams;
      Body: { roleId: string };
    }>(
      '/guilds/:guildId/weekly-role',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          body: Type.Object({ roleId: DiscordIdSchema }),
          response: {
            200: RoleResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        roleId: await repository.setRoleId(
          request.params.guildId,
          request.body.roleId,
        ),
      }),
    );

    fastify.delete<{ Params: GuildParams }>(
      '/guilds/:guildId/weekly-role',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          response: {
            200: RoleResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        roleId: await repository.unsetRoleId(request.params.guildId),
      }),
    );

    fastify.get<{ Params: GuildParams }>(
      '/guilds/:guildId/weekly-threads',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          response: {
            200: Type.Array(WeeklyReportThreadSchema),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.listThreads(request.params.guildId),
    );

    fastify.get<{ Params: UserParams }>(
      '/guilds/:guildId/weekly-threads/:userId',
      {
        schema: {
          tags: ['internal-weekly'],
          params: UserParamsSchema,
          response: {
            200: Type.Union([WeeklyReportThreadSchema, Type.Null()]),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getThread(
        request.params.guildId,
        request.params.userId,
      ),
    );

    fastify.put<{
      Params: UserParams;
      Body: { channelId: string; threadId: string };
    }>(
      '/guilds/:guildId/weekly-threads/:userId',
      {
        schema: {
          tags: ['internal-weekly'],
          params: UserParamsSchema,
          body: Type.Object({
            channelId: DiscordIdSchema,
            threadId: DiscordIdSchema,
          }),
          response: {
            200: WeeklyReportThreadSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.upsertThread({
        guildId: request.params.guildId,
        userId: request.params.userId,
        channelId: request.body.channelId,
        threadId: request.body.threadId,
      }),
    );

    fastify.get<{
      Params: GuildParams;
      Querystring: { userId: string; weekEnd: string };
    }>(
      '/guilds/:guildId/weekly-reports/preview',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          querystring: Type.Object({
            userId: DiscordIdSchema,
            weekEnd: DateSchema,
          }),
          response: {
            200: WeeklyReportPreviewSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getPreview(
        request.params.guildId,
        request.query.userId,
        request.query.weekEnd,
      ),
    );

    fastify.post<{
      Params: GuildParams;
      Body: CreateWeeklyReportBody;
    }>(
      '/guilds/:guildId/weekly-reports',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          body: CreateWeeklyReportBodySchema,
          response: {
            201: WeeklyReportSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const report = await repository.createReport(
          request.params.guildId,
          request.body,
        );
        return reply.code(201).send(report);
      },
    );

    fastify.post<{
      Params: GuildParams;
      Body: SyncWeeklyReportBody;
    }>(
      '/guilds/:guildId/weekly-reports/sync',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          body: SyncWeeklyReportBodySchema,
          response: {
            200: WeeklyReportSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.syncReport(
        request.params.guildId,
        request.body,
      ),
    );

    fastify.post<{
      Params: GuildParams;
      Body: ProcessWeeklyReportMissesBody;
    }>(
      '/guilds/:guildId/weekly-reports/process-misses',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          body: ProcessWeeklyReportMissesBodySchema,
          response: {
            200: ProcessWeeklyReportMissesResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        weekEnd: request.body.weekEnd,
        incrementedUserIds: await repository.processMisses(
          request.params.guildId,
          request.body,
        ),
      }),
    );

    fastify.post<{
      Params: GuildParams;
      Body: ProcessWeeklyReportRemindersBody;
    }>(
      '/guilds/:guildId/weekly-reports/process-reminders',
      {
        schema: {
          tags: ['internal-weekly'],
          params: GuildParamsSchema,
          body: ProcessWeeklyReportRemindersBodySchema,
          response: {
            200: ProcessWeeklyReportRemindersResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        weekEnd: request.body.weekEnd,
        claimedUserIds: await repository.processReminders(
          request.params.guildId,
          request.body,
        ),
      }),
    );

    fastify.get<{
      Params: UserWeekParams;
    }>(
      '/guilds/:guildId/weekly-reports/by-user/:userId/:weekEnd',
      {
        schema: {
          tags: ['internal-weekly'],
          params: UserWeekParamsSchema,
          response: {
            200: Type.Union([WeeklyReportSchema, Type.Null()]),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.findReport(
        request.params.guildId,
        request.params.userId,
        request.params.weekEnd,
      ),
    );

    fastify.get<{ Params: ThreadParams }>(
      '/weekly-reports/by-thread/:threadId/latest',
      {
        schema: {
          tags: ['internal-weekly'],
          params: ThreadParamsSchema,
          response: {
            200: Type.Union([WeeklyReportSchema, Type.Null()]),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getLatestReportByThread(
        request.params.threadId,
      ),
    );

    fastify.get<{ Params: ReportParams }>(
      '/weekly-reports/:reportId',
      {
        schema: {
          tags: ['internal-weekly'],
          params: ReportParamsSchema,
          response: {
            200: Type.Union([WeeklyReportSchema, Type.Null()]),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getReport(request.params.reportId),
    );

    fastify.patch<{
      Params: ReportParams;
      Body: UpdateWeeklyReportBody;
    }>(
      '/weekly-reports/:reportId',
      {
        schema: {
          tags: ['internal-weekly'],
          params: ReportParamsSchema,
          body: UpdateWeeklyReportBodySchema,
          response: {
            200: WeeklyReportSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.updateReport(
        request.params.reportId,
        request.body,
      ),
    );

    fastify.delete<{
      Params: ReportParams;
      Body: DeleteWeeklyReportBody;
    }>(
      '/weekly-reports/:reportId',
      {
        schema: {
          tags: ['internal-weekly'],
          params: ReportParamsSchema,
          body: DeleteWeeklyReportBodySchema,
          response: {
            200: WeeklyReportSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.deleteReport(
        request.params.reportId,
        request.body,
      ),
    );
  };
}
