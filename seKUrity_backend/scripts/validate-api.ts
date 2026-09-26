import assert from 'node:assert/strict';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Pool } from 'pg';
import { buildApp } from '../src/app';
import {
  resolveWeeklyTestDate,
  type AppConfig,
} from '../src/config';
import {
  CompleteScrumBodySchema,
  CreateScrumRequestBodySchema,
  CreateWeeklyReportBodySchema,
  DeleteScrumBodySchema,
  DeleteWeeklyReportBodySchema,
  ProcessWeeklyReportMissesBodySchema,
  ProcessWeeklyReportRemindersBodySchema,
  SyncWeeklyReportBodySchema,
  UpdateScrumEntryBodySchema,
  UpdateScrumEntryResultsBodySchema,
  UpdateScrumInitialTodosBodySchema,
  UpdateScrumMetadataBodySchema,
  UpdateWeeklyReportBodySchema,
  WeeklyReportThreadSchema,
} from '../src/contracts';
import type { Database } from '../src/db/database';
import { ApiError } from '../src/errors';
import {
  assertPlanningDocument,
  assertProjectDocuments,
} from '../src/modules/planningDocuments';
import { ScrumRepository } from '../src/modules/scrums/scrum.repository';
import {
  assertWeeklyReportSubmissionDate,
  WeeklyRepository,
} from '../src/modules/weekly/weekly.repository';
import {
  getWeeklyCycleEnd,
  getWeeklyReportCycleEnd,
  isWeeklyReportDeadlineClosed,
  isWeeklyReportReminderWindow,
} from '../src/modules/weeklyCycle';

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set(
    'uuid',
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value),
  );
}

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set(
    'date-time',
    (value) => !Number.isNaN(Date.parse(value)),
  );
}

async function main(): Promise<void> {
  const token = 'integration-test-token';
  const config: AppConfig = {
    databaseUrl: 'postgresql://unused',
    host: '127.0.0.1',
    internalApiToken: token,
    nodeEnv: 'test',
    port: 3000,
    weeklyTestDate: null,
    discordClientId: 'test-client-id',
    discordClientSecret: 'test-client-secret',
    discordRedirectUri: 'http://localhost:3000/api/v1/auth/discord/callback',
    siteUrl: 'http://localhost:3000',
    sessionSecret: 'test-session-secret-at-least-32-characters',
    sessionTokenPepper: 'test-session-pepper-at-least-32-characters',
    webAuthGuildId: '1507335622719967292',
    webActiveMemberRoleId: '1507362589619912734',
    webBoardMemberRoleId: '1507362663339135047',
    uploadDir: '/tmp/sekurity-test-uploads',
    uploadMaxBytes: 5 * 1024 * 1024,
  };
  const database = {
    execute: async () => [],
  } as unknown as Database;
  const pool = {
    end: async () => undefined,
  } as unknown as Pool;
  const app = await buildApp({
    config,
    database,
    pool,
  });
  const scrumRepository = new ScrumRepository(database);
  const weeklyRepository = new WeeklyRepository(database);

  try {
    const health = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok' });

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/internal/v1/guilds/123/channels/logs',
    });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().code, 'UNAUTHORIZED');

    const invalidCreate = await app.inject({
      method: 'POST',
      url: '/internal/v1/scrums',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {},
    });
    assert.equal(invalidCreate.statusCode, 400);
    assert.equal(invalidCreate.json().code, 'VALIDATION_ERROR');

    const invalidCompletion = await app.inject({
      method: 'POST',
      url: '/internal/v1/scrums/by-thread/123/complete',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {},
    });
    assert.equal(invalidCompletion.statusCode, 400);
    assert.equal(invalidCompletion.json().code, 'VALIDATION_ERROR');

    const emptyJsonBody = await app.inject({
      method: 'PUT',
      url: '/internal/v1/guilds/123/approver-roles/456',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    assert.equal(emptyJsonBody.statusCode, 400);
    assert.equal(emptyJsonBody.json().code, 'BAD_REQUEST');

    const validRequestBody = {
      guildId: '123',
      approvalChannelId: '456',
      approvalThreadId: '789',
      creatorId: '111',
      projectName: 'API validation',
      overview: 'Approval request schema validation.',
      category: 'project',
      planningDocument: {
        id: '222',
        name: 'planning-document.pdf',
        url: 'https://cdn.discordapp.com/attachments/1/2/planning-document.pdf',
        contentType: 'application/pdf',
        size: 1_024,
      },
      projectScoreDocument: {
        id: '333',
        name: 'project-score-result.md',
        url: 'https://cdn.discordapp.com/attachments/1/3/project-score-result.md',
        contentType: 'text/markdown',
        size: 1_024,
      },
      currentTodos: ['first task'],
    };
    assert(Value.Check(CreateScrumRequestBodySchema, validRequestBody));
    assert(Value.Check(CreateScrumRequestBodySchema, {
      ...validRequestBody,
      category: 'personal_study',
      projectScoreDocument: null,
    }));
    assert(
      !Object.hasOwn(
        CreateScrumRequestBodySchema.properties,
        'durationWeeks',
      ),
    );
    assert.throws(
      () => assertPlanningDocument('project', null),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'PLANNING_DOCUMENT_REQUIRED',
    );
    assert.doesNotThrow(
      () => assertPlanningDocument(
        'project',
        validRequestBody.planningDocument,
      ),
    );
    assert.doesNotThrow(
      () => assertProjectDocuments(
        'project',
        validRequestBody.planningDocument,
        validRequestBody.projectScoreDocument,
      ),
    );
    assert.throws(
      () => assertProjectDocuments(
        'project',
        validRequestBody.planningDocument,
        null,
      ),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'PROJECT_SCORE_DOCUMENT_REQUIRED',
    );
    assert.throws(
      () => assertProjectDocuments('personal_study', null, null),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'PLANNING_DOCUMENT_REQUIRED',
    );
    assert.doesNotThrow(
      () => assertProjectDocuments(
        'personal_study',
        validRequestBody.planningDocument,
        null,
      ),
    );
    assert(Value.Check(ProcessWeeklyReportRemindersBodySchema, {
      weekEnd: '2026-08-02',
      userIds: ['111', '222'],
    }));
    assert(Value.Check(CompleteScrumBodySchema, {
      completedBy: '111',
      completedItems: [{
        title: 'first task',
        comment: '',
        attachments: [],
        links: ['https://example.com/evidence'],
      }],
    }));
    assert(Value.Check(DeleteScrumBodySchema, {
      deletedBy: '111',
      reason: 'The creator requested permanent deletion.',
    }));
    assert(Value.Check(UpdateScrumMetadataBodySchema, {
      updatedBy: '111',
      projectName: 'Updated scrum title',
      overview: 'Updated scrum overview',
    }));
    assert(Value.Check(UpdateScrumInitialTodosBodySchema, {
      updatedBy: '111',
      currentTodos: ['updated first task'],
    }));
    assert(!Value.Check(UpdateScrumInitialTodosBodySchema, {
      updatedBy: '111',
      currentTodos: [],
    }));
    assert(Value.Check(UpdateScrumEntryBodySchema, {
      actorId: '111',
      actorType: 'member',
      completedItems: [],
      extraItems: [],
      nextTodos: ['next task'],
    }));
    assert(!Value.Check(UpdateScrumEntryBodySchema, {
      actorId: '111',
      actorType: 'unknown',
      completedItems: [],
      extraItems: [],
      nextTodos: ['next task'],
    }));
    assert(!Value.Check(UpdateScrumEntryBodySchema, {
      actorId: '111',
      actorType: 'member',
      completedItems: [],
      extraItems: [],
      nextTodos: [],
    }));
    assert(!Value.Check(DeleteScrumBodySchema, {
      deletedBy: 'not-a-discord-id',
      reason: '',
    }));
    assert(!Value.Check(CompleteScrumBodySchema, {
      completedBy: '111',
      completedItems: [{
        title: 'first task',
        comment: '',
        attachments: [
          {
            id: '222',
            name: 'first.txt',
            url: 'https://cdn.discordapp.com/attachments/1/2/first.txt',
            contentType: 'text/plain',
            size: 100,
          },
          {
            id: '333',
            name: 'second.txt',
            url: 'https://cdn.discordapp.com/attachments/1/2/second.txt',
            contentType: 'text/plain',
            size: 100,
          },
        ],
        links: [],
      }],
    }));
    assert(!Value.Check(CompleteScrumBodySchema, {
      completedBy: '111',
      completedItems: [],
    }));
    assert(Value.Check(UpdateScrumEntryResultsBodySchema, {
      completedItems: [{
        title: 'first task',
        comment: 'not completed',
        attachments: [],
        links: [],
      }],
      extraItems: [],
      discordMessageIds: ['123'],
    }));
    assert(Object.hasOwn(CreateWeeklyReportBodySchema.properties, 'weekEnd'));
    assert(Value.Check(SyncWeeklyReportBodySchema, {
      id: '00000000-0000-4000-8000-000000000001',
      userId: '111',
      threadId: '222',
      weekEnd: '2026-08-02',
    }));
    assert(Value.Check(ProcessWeeklyReportMissesBodySchema, {
      weekEnd: '2026-08-02',
      userIds: ['111', '222'],
    }));
    assert(Value.Check(WeeklyReportThreadSchema, {
      guildId: '123',
      userId: '111',
      channelId: '222',
      threadId: '333',
      missedReportCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
    assert.equal(
      resolveWeeklyTestDate('test', '2026-08-02'),
      '2026-08-02',
    );
    assert.throws(
      () => resolveWeeklyTestDate('production', '2026-08-02'),
      /NODE_ENV=test/,
    );
    assert.equal(
      resolveWeeklyTestDate('test', '2026-08-03'),
      '2026-08-03',
    );
    assert(Value.Check(DeleteWeeklyReportBodySchema, {
      deletedBy: '111',
      actorType: 'owner',
      reason: 'retry',
    }));
    assert(Value.Check(UpdateWeeklyReportBodySchema, {
      extraItems: [{
        title: 'weekly extra task',
        comment: 'weekly extra note',
        attachments: [validRequestBody.planningDocument],
        links: ['https://example.com/weekly-evidence'],
      }],
      discordMessageIds: [],
      actorType: 'administrator',
    }));
    assert(!Value.Check(UpdateWeeklyReportBodySchema, {
      extraItems: [{
        title: 'weekly extra task',
        comment: '',
        attachments: [
          validRequestBody.planningDocument,
          validRequestBody.projectScoreDocument,
        ],
        links: [],
      }],
      discordMessageIds: [],
    }));
    assert(!Value.Check(UpdateWeeklyReportBodySchema, {
      extraItems: [],
      discordMessageIds: [],
      actorType: 'owner',
    }));
    assert.doesNotThrow(
      () => assertWeeklyReportSubmissionDate(
        '2026-08-02',
        new Date('2026-07-31T03:00:00.000Z'),
      ),
    );
    assert.equal(getWeeklyCycleEnd('2026-08-02'), '2026-08-02');
    assert.equal(getWeeklyCycleEnd('2026-08-03'), '2026-08-02');
    assert.equal(
      getWeeklyCycleEnd(new Date('2026-08-04T09:59:59.000Z')),
      '2026-08-02',
    );
    assert.equal(
      getWeeklyCycleEnd(new Date('2026-08-04T10:00:00.000Z')),
      '2026-08-09',
    );
    assert.equal(
      getWeeklyReportCycleEnd(new Date('2026-08-04T09:59:59.000Z')),
      '2026-08-02',
    );
    assert.equal(
      getWeeklyReportCycleEnd(new Date('2026-08-04T10:00:00.000Z')),
      '2026-08-09',
    );
    assert(!isWeeklyReportDeadlineClosed(
      '2026-08-02',
      new Date('2026-08-04T09:59:59.000Z'),
    ));
    assert(isWeeklyReportDeadlineClosed(
      '2026-08-02',
      new Date('2026-08-04T10:00:00.000Z'),
    ));
    assert(isWeeklyReportReminderWindow(
      '2026-08-02',
      new Date('2026-08-04T03:00:00.000Z'),
    ));
    assert(!isWeeklyReportReminderWindow(
      '2026-08-02',
      new Date('2026-08-04T10:00:00.000Z'),
    ));
    assert.throws(
      () => assertWeeklyReportSubmissionDate(
        '2026-08-02',
        new Date('2026-08-04T10:00:00.000Z'),
      ),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'WEEKLY_REPORT_DATE_CLOSED',
    );
    assert.doesNotThrow(
      () => assertWeeklyReportSubmissionDate(
        '2026-08-09',
        new Date('2026-08-04T10:00:00.000Z'),
      ),
    );
    const invalidWeeklyReport = await app.inject({
      method: 'POST',
      url: '/internal/v1/guilds/123/weekly-reports',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {},
    });
    assert.equal(invalidWeeklyReport.statusCode, 400);
    assert.equal(invalidWeeklyReport.json().code, 'VALIDATION_ERROR');
    await assert.rejects(
      scrumRepository.completeByThread(
        '123',
        {
          completedBy: '111',
          completedItems: [{
            title: 'first task',
            comment: 'A comment alone is not completion evidence.',
            attachments: [],
            links: [],
          }],
        },
      ),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'COMPLETION_EVIDENCE_REQUIRED',
    );
    await assert.rejects(
      weeklyRepository.updateReport(
        '00000000-0000-4000-8000-000000000001',
        {
          extraItems: [{
            title: 'missing result details',
            comment: '',
            attachments: [],
            links: [],
          }],
          discordMessageIds: [],
        },
      ),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'EVIDENCE_OR_COMMENT_REQUIRED',
    );
    assert(
      !Object.hasOwn(
        CreateScrumRequestBodySchema.properties,
        'weeklyDeliverableFormats',
      ),
    );
    await assert.rejects(
      scrumRepository.saveEntry(
        '00000000-0000-4000-8000-000000000000',
        {
          authorId: '111',
          scrumDate: '2026-07-28',
          nextScrumDate: '2026-08-04',
          completedItems: [{
            title: 'missing result details',
            comment: '',
            attachments: [],
            links: [],
          }],
          extraItems: [],
          nextTodos: ['next task'],
        },
      ),
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'EVIDENCE_OR_COMMENT_REQUIRED',
    );

    const hiddenOpenApi = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    assert.equal(hiddenOpenApi.statusCode, 401);

    const openApi = await app.inject({
      method: 'GET',
      url: '/openapi.json',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(openApi.statusCode, 200);
    assert(openApi.json().paths['/internal/v1/scrums']);
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/scrums/active-all'
      ],
    );
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/scrums/initial-todos-editable'
      ],
    );
    assert(openApi.json().paths['/internal/v1/scrums/by-thread/{threadId}/complete']);
    assert(openApi.json().paths['/internal/v1/scrums/by-thread/{threadId}/abandon']);
    assert(
      openApi.json().paths[
        '/internal/v1/scrums/by-thread/{threadId}/initial-todos'
      ],
    );
    assert(
      openApi.json().paths[
        '/internal/v1/scrums/by-thread/{threadId}/completion-results'
      ],
    );
    assert(openApi.json().paths['/internal/v1/scrum-requests']);
    assert(openApi.json().paths['/internal/v1/guilds/{guildId}/approver-roles']);
    assert(openApi.json().paths['/internal/v1/guilds/{guildId}/weekly-role']);
    assert(openApi.json().paths['/internal/v1/guilds/{guildId}/weekly-threads']);
    assert(openApi.json().paths['/internal/v1/guilds/{guildId}/weekly-reports']);
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/weekly-reports/sync'
      ],
    );
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/weekly-reports/process-misses'
      ],
    );
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/weekly-reports/process-reminders'
      ],
    );
    assert(
      openApi.json().paths[
        '/internal/v1/guilds/{guildId}/weekly-reports/by-user/{userId}/{weekEnd}'
      ],
    );
    assert(openApi.json().paths['/internal/v1/weekly-reports/{reportId}']);

    const webAuthenticationRequired = await app.inject({
      method: 'GET',
      url: '/api/v1/me/summary',
    });
    assert.equal(webAuthenticationRequired.statusCode, 401);
    assert.equal(webAuthenticationRequired.json().code, 'AUTHENTICATION_REQUIRED');

    const webPaths = openApi.json().paths;
    assert(webPaths['/api/v1/auth/discord']);
    assert(webPaths['/api/v1/auth/discord/callback']);
    assert(webPaths['/api/v1/me']);
    assert(webPaths['/api/v1/me/summary']);
    assert(webPaths['/api/v1/me/scores']);
    assert(webPaths['/api/v1/me/attendance']);
    assert(webPaths['/api/v1/me/profile']?.get);
    assert(webPaths['/api/v1/me/profile']?.put);
    assert(webPaths['/api/v1/me/profile/photo']?.post);
    assert(webPaths['/api/v1/members']?.get);
    assert(webPaths['/api/v1/members/{userId}/photo']?.get);
    assert(webPaths['/api/v1/admin/members']?.get);
    assert(webPaths['/api/v1/admin/members/{userId}/scores']?.post);
    assert(webPaths['/api/v1/admin/score-events/{eventId}/void']?.post);
    assert(webPaths['/api/v1/admin/attendance-sessions']?.get);
    assert(webPaths['/api/v1/admin/attendance-sessions']?.post);
    assert(webPaths['/api/v1/admin/attendance-sessions/{sessionId}']?.patch);
    assert(
      webPaths[
        '/api/v1/admin/attendance-sessions/{sessionId}/records/{userId}'
      ]?.patch,
    );
    assert(
      webPaths['/internal/v1/guilds/{guildId}/web-members/sync']?.post,
    );

    console.log('Validated health, internal and browser authentication, domain schemas, and OpenAPI route generation.');
  } finally {
    await app.close();
  }
}

void main();
