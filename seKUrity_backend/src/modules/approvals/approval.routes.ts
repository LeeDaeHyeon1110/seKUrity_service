import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';
import {
  ApproveScrumRequestBodySchema,
  CreateScrumRequestBodySchema,
  ErrorResponseSchema,
  RejectScrumRequestBodySchema,
  ScrumRequestSchema,
  ScrumSchema,
} from '../../contracts';
import type {
  ApproveScrumRequestBody,
  CreateScrumRequestBody,
  RejectScrumRequestBody,
} from '../../contracts';
import type { Database } from '../../db/database';
import { ApprovalRepository } from './approval.repository';

interface GuildParams {
  guildId: string;
}

interface ApproverRoleParams extends GuildParams {
  roleId: string;
}

interface ApprovalThreadParams {
  threadId: string;
}

const DiscordIdSchema = Type.String({
  minLength: 1,
  maxLength: 32,
  pattern: '^[0-9]+$',
});
const GuildParamsSchema = Type.Object({
  guildId: DiscordIdSchema,
});
const ApproverRoleParamsSchema = Type.Object({
  guildId: DiscordIdSchema,
  roleId: DiscordIdSchema,
});
const ApprovalThreadParamsSchema = Type.Object({
  threadId: DiscordIdSchema,
});
const ApproverRolesResponseSchema = Type.Object({
  roleIds: Type.Array(DiscordIdSchema),
});
const NullableScrumRequestResponseSchema = Type.Object({
  request: Type.Union([ScrumRequestSchema, Type.Null()]),
});

export function createApprovalRoutes(database: Database): FastifyPluginAsync {
  const repository = new ApprovalRepository(database);

  return async function approvalRoutes(fastify): Promise<void> {
    fastify.get<{ Params: GuildParams }>(
      '/guilds/:guildId/approver-roles',
      {
        schema: {
          tags: ['internal-approvals'],
          params: GuildParamsSchema,
          response: {
            200: ApproverRolesResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        roleIds: await repository.listApproverRoleIds(request.params.guildId),
      }),
    );

    fastify.put<{ Params: ApproverRoleParams }>(
      '/guilds/:guildId/approver-roles/:roleId',
      {
        schema: {
          tags: ['internal-approvals'],
          params: ApproverRoleParamsSchema,
          response: {
            200: ApproverRolesResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => {
        await repository.addApproverRole(
          request.params.guildId,
          request.params.roleId,
        );
        return {
          roleIds: await repository.listApproverRoleIds(
            request.params.guildId,
          ),
        };
      },
    );

    fastify.delete<{ Params: ApproverRoleParams }>(
      '/guilds/:guildId/approver-roles/:roleId',
      {
        schema: {
          tags: ['internal-approvals'],
          params: ApproverRoleParamsSchema,
          response: {
            200: Type.Object({ removed: Type.Boolean() }),
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        removed: await repository.removeApproverRole(
          request.params.guildId,
          request.params.roleId,
        ),
      }),
    );

    fastify.post<{ Body: CreateScrumRequestBody }>(
      '/scrum-requests',
      {
        schema: {
          tags: ['internal-approvals'],
          body: CreateScrumRequestBodySchema,
          response: {
            201: Type.Object({ request: ScrumRequestSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await repository.createRequest(request.body);
        return reply.code(201).send({ request: created });
      },
    );

    fastify.get<{ Params: ApprovalThreadParams }>(
      '/scrum-requests/by-approval-thread/:threadId',
      {
        schema: {
          tags: ['internal-approvals'],
          params: ApprovalThreadParamsSchema,
          response: {
            200: NullableScrumRequestResponseSchema,
            401: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        request: await repository.getByApprovalThread(
          request.params.threadId,
        ),
      }),
    );

    fastify.post<{
      Params: ApprovalThreadParams;
      Body: ApproveScrumRequestBody;
    }>(
      '/scrum-requests/by-approval-thread/:threadId/approve',
      {
        schema: {
          tags: ['internal-approvals'],
          params: ApprovalThreadParamsSchema,
          body: ApproveScrumRequestBodySchema,
          response: {
            200: Type.Object({
              request: ScrumRequestSchema,
              scrum: ScrumSchema,
            }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => repository.approveByApprovalThread(
        request.params.threadId,
        request.body,
      ),
    );

    fastify.post<{
      Params: ApprovalThreadParams;
      Body: RejectScrumRequestBody;
    }>(
      '/scrum-requests/by-approval-thread/:threadId/reject',
      {
        schema: {
          tags: ['internal-approvals'],
          params: ApprovalThreadParamsSchema,
          body: RejectScrumRequestBodySchema,
          response: {
            200: Type.Object({ request: ScrumRequestSchema }),
            400: ErrorResponseSchema,
            401: ErrorResponseSchema,
            404: ErrorResponseSchema,
            409: ErrorResponseSchema,
          },
        },
      },
      async (request) => ({
        request: await repository.rejectByApprovalThread(
          request.params.threadId,
          request.body,
        ),
      }),
    );
  };
}
