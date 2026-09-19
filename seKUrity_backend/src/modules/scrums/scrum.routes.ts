import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import {
  AbandonScrumBodySchema,
  CompleteScrumBodySchema,
  CreateScrumBodySchema,
  DeleteScrumBodySchema,
  DeleteScrumEntryBodySchema,
  ErrorResponseSchema,
  SaveScrumEntryBodySchema,
  ScrumEntrySchema,
  ScrumSchema,
  UpdateScrumCompletionResultsBodySchema,
  UpdateScrumEntryBodySchema,
  UpdateScrumEntryResultsBodySchema,
  UpdateScrumInitialTodosBodySchema,
  UpdateScrumMetadataBodySchema,
} from '../../contracts';
import type {
  AbandonScrumBody,
  CompleteScrumBody,
  CreateScrumBody,
  DeleteScrumBody,
  DeleteScrumEntryBody,
  SaveScrumEntryBody,
  UpdateScrumCompletionResultsBody,
  UpdateScrumEntryBody,
  UpdateScrumEntryResultsBody,
  UpdateScrumInitialTodosBody,
  UpdateScrumMetadataBody,
} from '../../contracts';
import type { Database } from '../../db/database';
import { ScrumRepository } from './scrum.repository';

interface ThreadParams {
  threadId: string;
}

interface GuildParams {
  guildId: string;
}

interface GuildScrumParams extends GuildParams {
  scrumId: string;
}

interface ScrumParams {
  scrumId: string;
}

interface ScrumEntryParams extends ScrumParams {
  scrumDate: string;
}

interface EntryParams {
  entryId: string;
}

interface UserQuery {
  userId: string;
}

interface EntryDateQuery {
  scrumDate?: string;
}

const DiscordIdSchema = Type.String({
  pattern: '^[0-9]+$',
  maxLength: 32,
});
const UuidSchema = Type.String({ format: 'uuid' });
const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const NullableScrumResponseSchema = Type.Object({
  scrum: Type.Union([ScrumSchema, Type.Null()]),
});

export function createScrumRoutes(
  database: Database,
  weeklyTestDate: string | null = null,
): FastifyPluginAsync {
  const repository = new ScrumRepository(database, weeklyTestDate);

  return async function scrumRoutes(fastify): Promise<void> {
    fastify.post<{ Body: CreateScrumBody }>(
      '/scrums',
      {
        schema: {
          tags: ['internal-scrums'],
          body: CreateScrumBodySchema,
          response: {
            201: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const scrum = await repository.create(request.body);
        return reply.code(201).send({ scrum });
      },
    );

    fastify.patch<{
      Params: ThreadParams;
      Body: UpdateScrumCompletionResultsBody;
    }>(
      '/scrums/by-thread/:threadId/completion-results',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: UpdateScrumCompletionResultsBodySchema,
          response: {
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        await repository.updateCompletionResults(
          request.params.threadId,
          request.body,
        );
        return reply.code(204).send();
      },
    );

    fastify.get<{ Params: ThreadParams }>(
      '/scrums/by-thread/:threadId',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          response: {
            200: NullableScrumResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.getActiveByThread(request.params.threadId),
      }),
    );

    fastify.patch<{
      Params: ThreadParams;
      Body: UpdateScrumMetadataBody;
    }>(
      '/scrums/by-thread/:threadId/metadata',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: UpdateScrumMetadataBodySchema,
          response: {
            200: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.updateMetadataByThread(
          request.params.threadId,
          request.body,
        ),
      }),
    );

    fastify.patch<{
      Params: ThreadParams;
      Body: UpdateScrumInitialTodosBody;
    }>(
      '/scrums/by-thread/:threadId/initial-todos',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: UpdateScrumInitialTodosBodySchema,
          response: {
            200: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.updateInitialTodosByThread(
          request.params.threadId,
          request.body,
        ),
      }),
    );

    fastify.get<{
      Params: ThreadParams;
      Querystring: EntryDateQuery;
    }>(
      '/scrums/by-thread/:threadId/entries/latest',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          querystring: Type.Object({
            scrumDate: Type.Optional(DateSchema),
          }),
          response: {
            200: Type.Object({
              entry: ScrumEntrySchema,
              scrum: ScrumSchema,
            }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getLatestEntryByThread(
        request.params.threadId,
        request.query.scrumDate,
      ),
    );

    fastify.delete<{
      Params: ThreadParams;
      Body: DeleteScrumBody;
    }>(
      '/scrums/by-thread/:threadId',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: DeleteScrumBodySchema,
          response: {
            200: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.deleteByThread(
          request.params.threadId,
          request.body,
        ),
      }),
    );

    fastify.post<{
      Params: ThreadParams;
      Body: CompleteScrumBody;
    }>(
      '/scrums/by-thread/:threadId/complete',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: CompleteScrumBodySchema,
          response: {
            200: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => {
        request.log.info(
          {
            scrumThreadId: request.params.threadId,
            completedBy: request.body.completedBy,
          },
          'Completing scrum',
        );

        return {
          scrum: await repository.completeByThread(
            request.params.threadId,
            request.body,
          ),
        };
      },
    );

    fastify.post<{
      Params: ThreadParams;
      Body: AbandonScrumBody;
    }>(
      '/scrums/by-thread/:threadId/abandon',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ threadId: DiscordIdSchema }),
          body: AbandonScrumBodySchema,
          response: {
            200: Type.Object({ scrum: ScrumSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.abandonByThread(
          request.params.threadId,
          request.body,
        ),
      }),
    );

    fastify.get<{
      Params: GuildParams;
      Querystring: UserQuery;
    }>(
      '/guilds/:guildId/scrums/active',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ guildId: DiscordIdSchema }),
          querystring: Type.Object({ userId: DiscordIdSchema }),
          response: {
            200: Type.Object({
              scrums: Type.Array(ScrumSchema),
            }),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrums: await repository.getActiveForUser(
          request.params.guildId,
          request.query.userId,
        ),
      }),
    );

    fastify.get<{ Params: GuildParams }>(
      '/guilds/:guildId/scrums/initial-todos-editable',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ guildId: DiscordIdSchema }),
          response: {
            200: Type.Object({
              scrums: Type.Array(ScrumSchema),
            }),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrums: await repository.getInitialTodosEditableForGuild(
          request.params.guildId,
        ),
      }),
    );

    fastify.get<{
      Params: GuildScrumParams;
      Querystring: UserQuery;
    }>(
      '/guilds/:guildId/scrums/:scrumId/active',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({
            guildId: DiscordIdSchema,
            scrumId: UuidSchema,
          }),
          querystring: Type.Object({ userId: DiscordIdSchema }),
          response: {
            200: NullableScrumResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        scrum: await repository.getActiveForUserById(
          request.params.scrumId,
          request.params.guildId,
          request.query.userId,
        ),
      }),
    );

    fastify.get<{ Params: ScrumEntryParams }>(
      '/scrums/:scrumId/entries/:scrumDate/exists',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({
            scrumId: UuidSchema,
            scrumDate: DateSchema,
          }),
          response: {
            200: Type.Object({ exists: Type.Boolean() }),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        exists: await repository.hasEntryForDate(
          request.params.scrumId,
          request.params.scrumDate,
        ),
      }),
    );

    fastify.post<{
      Params: ScrumParams;
      Body: SaveScrumEntryBody;
    }>(
      '/scrums/:scrumId/entries',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ scrumId: UuidSchema }),
          body: SaveScrumEntryBodySchema,
          response: {
            201: Type.Object({ entry: ScrumEntrySchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const entry = await repository.saveEntry(
          request.params.scrumId,
          request.body,
        );
        return reply.code(201).send({ entry });
      },
    );

    fastify.patch<{
      Params: EntryParams;
      Body: UpdateScrumEntryResultsBody;
    }>(
      '/scrum-entries/:entryId/results',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ entryId: UuidSchema }),
          body: UpdateScrumEntryResultsBodySchema,
          response: {
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        await repository.updateEntryResults(
          request.params.entryId,
          request.body,
        );
        return reply.code(204).send();
      },
    );

    fastify.get<{ Params: EntryParams }>(
      '/scrum-entries/:entryId',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ entryId: UuidSchema }),
          response: {
            200: Type.Object({
              entry: ScrumEntrySchema,
              scrum: ScrumSchema,
            }),
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.getEntryWithScrum(
        request.params.entryId,
      ),
    );

    fastify.patch<{
      Params: EntryParams;
      Body: UpdateScrumEntryBody;
    }>(
      '/scrum-entries/:entryId',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ entryId: UuidSchema }),
          body: UpdateScrumEntryBodySchema,
          response: {
            200: Type.Object({
              entry: ScrumEntrySchema,
              scrum: ScrumSchema,
            }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.updateEntry(
        request.params.entryId,
        request.body,
      ),
    );

    fastify.delete<{
      Params: EntryParams;
      Body: DeleteScrumEntryBody;
    }>(
      '/scrum-entries/:entryId',
      {
        schema: {
          tags: ['internal-scrums'],
          params: Type.Object({ entryId: UuidSchema }),
          body: DeleteScrumEntryBodySchema,
          response: {
            200: Type.Object({
              entry: ScrumEntrySchema,
              scrum: ScrumSchema,
            }),
            401: ErrorResponseSchema,
            403: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.deleteLatestEntry(
        request.params.entryId,
        request.body,
      ),
    );
  };
}
