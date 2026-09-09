import swagger from '@fastify/swagger';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from './config';
import type { Database } from './db/database';
import { ApiError } from './errors';
import { createApprovalRoutes } from './modules/approvals/approval.routes';
import { createChannelRoutes } from './modules/channels/channel.routes';
import { createScrumRoutes } from './modules/scrums/scrum.routes';
import { createWeeklyRoutes } from './modules/weekly/weekly.routes';
import { createInternalAuthHook } from './plugins/internalAuth';

export interface BuildAppOptions {
  config: AppConfig;
  database: Database;
  pool: Pool;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: options.config.nodeEnv === 'test'
      ? false
      : {
        level: options.config.nodeEnv === 'production' ? 'info' : 'debug',
        redact: ['req.headers.authorization'],
      },
    requestIdHeader: 'x-request-id',
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'seKUrity Backend API',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          internalBearer: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
      });
      return;
    }

    const fastifyError = error as {
      code?: string;
      message?: string;
      statusCode?: number;
      validation?: unknown;
    };

    if (fastifyError.validation) {
      void reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: fastifyError.message ?? 'Request validation failed.',
      });
      return;
    }

    if (fastifyError.code === '23505') {
      void reply.code(409).send({
        code: 'CONFLICT',
        message: 'A resource with the same unique key already exists.',
      });
      return;
    }

    if (
      fastifyError.statusCode
      && fastifyError.statusCode >= 400
      && fastifyError.statusCode < 500
    ) {
      void reply.code(fastifyError.statusCode).send({
        code: 'BAD_REQUEST',
        message: fastifyError.message ?? 'The request could not be processed.',
      });
      return;
    }

    request.log.error({ err: error }, 'Unhandled request error');
    void reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  app.get('/health', {
    schema: {
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
          required: ['status'],
        },
      },
    },
  }, async () => {
    await options.database.execute(sql`select 1`);
    return { status: 'ok' };
  });

  await app.register(async (internal) => {
    internal.addHook(
      'onRequest',
      createInternalAuthHook(options.config.internalApiToken),
    );
    internal.addHook('onRoute', (routeOptions) => {
      routeOptions.schema ??= {};
      routeOptions.schema.security = [{ internalBearer: [] }];
    });
    await internal.register(createChannelRoutes(options.database));
    await internal.register(createApprovalRoutes(options.database));
    await internal.register(createScrumRoutes(
      options.database,
      options.config.weeklyTestDate,
    ));
    await internal.register(createWeeklyRoutes(
      options.database,
      options.config.weeklyTestDate,
    ));
  }, {
    prefix: '/internal/v1',
  });

  app.get('/openapi.json', {
    onRequest: createInternalAuthHook(options.config.internalApiToken),
    schema: {
      hide: true,
    },
  }, async () => app.swagger());

  app.addHook('onClose', async () => {
    await options.pool.end();
  });

  return app;
}
