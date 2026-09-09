import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  eq,
} from 'drizzle-orm';
import type {
  ApproveScrumRequestBody,
  CreateScrumRequestBody,
  RejectScrumRequestBody,
  Scrum,
  ScrumRequest,
} from '../../contracts';
import type { Database } from '../../db/database';
import {
  guildApproverRoles,
  scrumCurrentTodos,
  scrumMembers,
  scrumRequests,
  scrumRequestTodos,
  scrums,
} from '../../db/schema';
import { ApiError } from '../../errors';
import {
  assertProjectDocuments,
  mapPlanningDocument,
  mapProjectScoreDocument,
  planningDocumentColumns,
  projectScoreDocumentColumns,
} from '../planningDocuments';

type ScrumRequestRow = typeof scrumRequests.$inferSelect;

function assertValidDate(date: string, fieldName: string): void {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new ApiError(
      400,
      'INVALID_DATE',
      `${fieldName} must be a valid ISO calendar date.`,
    );
  }
}

function mapRequest(
  row: ScrumRequestRow,
  currentTodos: string[],
): ScrumRequest {
  return {
    id: row.id,
    guildId: row.guildId,
    approvalChannelId: row.approvalChannelId,
    approvalThreadId: row.approvalThreadId,
    creatorId: row.creatorId,
    projectName: row.projectName,
    overview: row.overview,
    category: row.category as ScrumRequest['category'],
    planningDocument: mapPlanningDocument(row),
    projectScoreDocument: mapProjectScoreDocument(row),
    currentTodos,
    status: row.status as ScrumRequest['status'],
    scrumId: row.scrumId,
    reviewedBy: row.reviewedBy,
    rejectionReason: row.rejectionReason,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ApprovalRepository {
  constructor(private readonly database: Database) {}

  async listApproverRoleIds(guildId: string): Promise<string[]> {
    const rows = await this.database
      .select({ roleId: guildApproverRoles.roleId })
      .from(guildApproverRoles)
      .where(eq(guildApproverRoles.guildId, guildId))
      .orderBy(asc(guildApproverRoles.roleId));

    return rows.map((row) => row.roleId);
  }

  async addApproverRole(guildId: string, roleId: string): Promise<void> {
    await this.database
      .insert(guildApproverRoles)
      .values({ guildId, roleId })
      .onConflictDoNothing();
  }

  async removeApproverRole(guildId: string, roleId: string): Promise<boolean> {
    const removed = await this.database
      .delete(guildApproverRoles)
      .where(and(
        eq(guildApproverRoles.guildId, guildId),
        eq(guildApproverRoles.roleId, roleId),
      ))
      .returning({ roleId: guildApproverRoles.roleId });

    return removed.length > 0;
  }

  private async hydrate(row: ScrumRequestRow): Promise<ScrumRequest> {
    const todos = await this.database
      .select({ content: scrumRequestTodos.content })
      .from(scrumRequestTodos)
      .where(eq(scrumRequestTodos.requestId, row.id))
      .orderBy(asc(scrumRequestTodos.position));

    return mapRequest(
      row,
      todos.map((todo) => todo.content),
    );
  }

  async createRequest(input: CreateScrumRequestBody): Promise<ScrumRequest> {
    assertProjectDocuments(
      input.category,
      input.planningDocument,
      input.projectScoreDocument,
    );
    const id = randomUUID();
    const now = new Date();

    await this.database.transaction(async (transaction) => {
      await transaction.insert(scrumRequests).values({
        id,
        guildId: input.guildId,
        approvalChannelId: input.approvalChannelId,
        approvalThreadId: input.approvalThreadId,
        creatorId: input.creatorId,
        projectName: input.projectName,
        overview: input.overview,
        category: input.category,
        ...planningDocumentColumns(input.planningDocument),
        ...projectScoreDocumentColumns(input.projectScoreDocument),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(scrumRequestTodos).values(
        input.currentTodos.map((content, position) => ({
          id: randomUUID(),
          requestId: id,
          content,
          position,
        })),
      );
    });

    return {
      id,
      ...input,
      status: 'pending',
      scrumId: null,
      reviewedBy: null,
      rejectionReason: null,
      reviewedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getByApprovalThread(
    approvalThreadId: string,
  ): Promise<ScrumRequest | null> {
    const [row] = await this.database
      .select()
      .from(scrumRequests)
      .where(eq(scrumRequests.approvalThreadId, approvalThreadId))
      .limit(1);

    return row ? this.hydrate(row) : null;
  }

  async approveByApprovalThread(
    approvalThreadId: string,
    input: ApproveScrumRequestBody,
  ): Promise<{ request: ScrumRequest; scrum: Scrum }> {
    assertValidDate(input.nextScrumDate, 'nextScrumDate');
    const reviewedAt = new Date();

    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(scrumRequests)
        .where(eq(scrumRequests.approvalThreadId, approvalThreadId))
        .for('update')
        .limit(1);

      if (!request) {
        throw new ApiError(
          404,
          'SCRUM_REQUEST_NOT_FOUND',
          'Scrum approval request not found.',
        );
      }

      if (request.status !== 'pending') {
        throw new ApiError(
          409,
          'SCRUM_REQUEST_ALREADY_REVIEWED',
          'This scrum request has already been reviewed.',
        );
      }

      const todos = await transaction
        .select({ content: scrumRequestTodos.content })
        .from(scrumRequestTodos)
        .where(eq(scrumRequestTodos.requestId, request.id))
        .orderBy(asc(scrumRequestTodos.position));
      const currentTodos = todos.map((todo) => todo.content);
      const planningDocument = mapPlanningDocument(request);
      const projectScoreDocument = mapProjectScoreDocument(request);

      assertProjectDocuments(
        request.category as Scrum['category'],
        planningDocument,
        projectScoreDocument,
      );

      const scrumId = randomUUID();

      await transaction.insert(scrums).values({
        id: scrumId,
        guildId: request.guildId,
        scrumChannelId: input.scrumChannelId,
        threadId: input.threadId,
        creatorId: request.creatorId,
        projectName: request.projectName,
        overview: request.overview,
        category: request.category,
        ...planningDocumentColumns(planningDocument),
        ...projectScoreDocumentColumns(projectScoreDocument),
        status: 'active',
        nextScrumDate: input.nextScrumDate,
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
      });
      await transaction.insert(scrumMembers).values({
        scrumId,
        userId: request.creatorId,
      });
      await transaction.insert(scrumCurrentTodos).values(
        currentTodos.map((content, position) => ({
          id: randomUUID(),
          scrumId,
          content,
          position,
        })),
      );
      await transaction
        .update(scrumRequests)
        .set({
          status: 'approved',
          scrumId,
          reviewedBy: input.reviewerId,
          reviewedAt,
          updatedAt: reviewedAt,
        })
        .where(eq(scrumRequests.id, request.id));

      return {
        request: {
          ...mapRequest(
            request,
            currentTodos,
          ),
          status: 'approved',
          scrumId,
          reviewedBy: input.reviewerId,
          reviewedAt: reviewedAt.toISOString(),
          updatedAt: reviewedAt.toISOString(),
        },
        scrum: {
          id: scrumId,
          guildId: request.guildId,
          scrumChannelId: input.scrumChannelId,
          threadId: input.threadId,
          creatorId: request.creatorId,
          ownerIds: [request.creatorId],
          projectName: request.projectName,
          overview: request.overview,
          category: request.category as Scrum['category'],
          planningDocument,
          projectScoreDocument,
          status: 'active',
          currentTodos,
          nextScrumDate: input.nextScrumDate,
          completedBy: null,
          completionSummary: null,
          completionResults: null,
          completedAt: null,
          abandonedBy: null,
          abandonmentReason: null,
          abandonedAt: null,
          createdAt: reviewedAt.toISOString(),
          updatedAt: reviewedAt.toISOString(),
        },
      };
    });
  }

  async rejectByApprovalThread(
    approvalThreadId: string,
    input: RejectScrumRequestBody,
  ): Promise<ScrumRequest> {
    const reason = input.reason.trim();

    if (!reason) {
      throw new ApiError(
        400,
        'REJECTION_REASON_REQUIRED',
        'A rejection reason is required.',
      );
    }

    const reviewedAt = new Date();

    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(scrumRequests)
        .where(eq(scrumRequests.approvalThreadId, approvalThreadId))
        .for('update')
        .limit(1);

      if (!request) {
        throw new ApiError(
          404,
          'SCRUM_REQUEST_NOT_FOUND',
          'Scrum approval request not found.',
        );
      }

      if (request.status !== 'pending') {
        throw new ApiError(
          409,
          'SCRUM_REQUEST_ALREADY_REVIEWED',
          'This scrum request has already been reviewed.',
        );
      }

      const todos = await transaction
        .select({ content: scrumRequestTodos.content })
        .from(scrumRequestTodos)
        .where(eq(scrumRequestTodos.requestId, request.id))
        .orderBy(asc(scrumRequestTodos.position));

      await transaction
        .update(scrumRequests)
        .set({
          status: 'rejected',
          reviewedBy: input.reviewerId,
          rejectionReason: reason,
          reviewedAt,
          updatedAt: reviewedAt,
        })
        .where(eq(scrumRequests.id, request.id));

      return {
        ...mapRequest(
          request,
          todos.map((todo) => todo.content),
        ),
        status: 'rejected',
        reviewedBy: input.reviewerId,
        rejectionReason: reason,
        reviewedAt: reviewedAt.toISOString(),
        updatedAt: reviewedAt.toISOString(),
      };
    });
  }
}
