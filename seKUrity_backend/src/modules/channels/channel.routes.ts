import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import {
  ChannelSettingTypeSchema,
  ErrorResponseSchema,
} from '../../contracts';
import type { ChannelSettingType } from '../../contracts';
import type { Database } from '../../db/database';
import { ChannelRepository } from './channel.repository';

interface ChannelParams {
  guildId: string;
  type: ChannelSettingType;
}

interface SetChannelBody {
  channelId: string;
}

const ChannelParamsSchema = Type.Object({
  guildId: Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
  type: ChannelSettingTypeSchema,
});
const ChannelResponseSchema = Type.Object({
  channelId: Type.Union([
    Type.String({ pattern: '^[0-9]+$', maxLength: 32 }),
    Type.Null(),
  ]),
});

export function createChannelRoutes(database: Database): FastifyPluginAsync {
  const repository = new ChannelRepository(database);

  return async function channelRoutes(fastify): Promise<void> {
    fastify.get<{ Params: ChannelParams }>(
      '/guilds/:guildId/channels/:type',
      {
        schema: {
          tags: ['internal-channels'],
          params: ChannelParamsSchema,
          response: {
            200: ChannelResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        channelId: await repository.get(
          request.params.guildId,
          request.params.type,
        ),
      }),
    );

    fastify.put<{
      Params: ChannelParams;
      Body: SetChannelBody;
    }>(
      '/guilds/:guildId/channels/:type',
      {
        schema: {
          tags: ['internal-channels'],
          params: ChannelParamsSchema,
          body: Type.Object({
            channelId: Type.String({
              pattern: '^[0-9]+$',
              maxLength: 32,
            }),
          }),
          response: {
            200: ChannelResponseSchema,
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        channelId: await repository.set(
          request.params.guildId,
          request.params.type,
          request.body.channelId,
        ),
      }),
    );

    fastify.delete<{ Params: ChannelParams }>(
      '/guilds/:guildId/channels/:type',
      {
        schema: {
          tags: ['internal-channels'],
          params: ChannelParamsSchema,
          response: {
            200: ChannelResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        channelId: await repository.unset(
          request.params.guildId,
          request.params.type,
        ),
      }),
    );
  };
}
