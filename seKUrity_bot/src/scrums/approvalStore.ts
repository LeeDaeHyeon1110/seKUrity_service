import { backendRequest } from '../api/backendClient';
import type { ScrumCategory } from './categories';
import type {
  Scrum,
  ScrumAttachment,
  ScrumRequest,
} from './types';

function approverRolesPath(guildId: string): string {
  return [
    '/internal/v1/guilds',
    encodeURIComponent(guildId),
    'approver-roles',
  ].join('/');
}

function requestByThreadPath(approvalThreadId: string): string {
  return [
    '/internal/v1/scrum-requests/by-approval-thread',
    encodeURIComponent(approvalThreadId),
  ].join('/');
}

export async function getApproverRoleIds(guildId: string): Promise<string[]> {
  const response = await backendRequest<{ roleIds: string[] }>(
    approverRolesPath(guildId),
  );
  return response.roleIds;
}

export async function addApproverRole(
  guildId: string,
  roleId: string,
): Promise<string[]> {
  const response = await backendRequest<{ roleIds: string[] }>(
    `${approverRolesPath(guildId)}/${encodeURIComponent(roleId)}`,
    { method: 'PUT' },
  );
  return response.roleIds;
}

export async function removeApproverRole(
  guildId: string,
  roleId: string,
): Promise<boolean> {
  const response = await backendRequest<{ removed: boolean }>(
    `${approverRolesPath(guildId)}/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  );
  return response.removed;
}

export async function createScrumRequest(input: {
  guildId: string;
  approvalChannelId: string;
  approvalThreadId: string;
  creatorId: string;
  projectName: string;
  overview: string;
  category: ScrumCategory;
  planningDocument: ScrumAttachment | null;
  projectScoreDocument: ScrumAttachment | null;
  currentTodos: string[];
}): Promise<ScrumRequest> {
  const response = await backendRequest<{ request: ScrumRequest }>(
    '/internal/v1/scrum-requests',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.request;
}

export async function getScrumRequestByApprovalThread(
  approvalThreadId: string,
): Promise<ScrumRequest | null> {
  const response = await backendRequest<{ request: ScrumRequest | null }>(
    requestByThreadPath(approvalThreadId),
  );
  return response.request;
}

export async function approveScrumRequest(input: {
  approvalThreadId: string;
  reviewerId: string;
  scrumChannelId: string;
  threadId: string;
  nextScrumDate: string;
}): Promise<{ request: ScrumRequest; scrum: Scrum }> {
  return backendRequest<{ request: ScrumRequest; scrum: Scrum }>(
    `${requestByThreadPath(input.approvalThreadId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({
        reviewerId: input.reviewerId,
        scrumChannelId: input.scrumChannelId,
        threadId: input.threadId,
        nextScrumDate: input.nextScrumDate,
      }),
    },
  );
}

export async function rejectScrumRequest(input: {
  approvalThreadId: string;
  reviewerId: string;
  reason: string;
}): Promise<ScrumRequest> {
  const response = await backendRequest<{ request: ScrumRequest }>(
    `${requestByThreadPath(input.approvalThreadId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({
        reviewerId: input.reviewerId,
        reason: input.reason,
      }),
    },
  );
  return response.request;
}
