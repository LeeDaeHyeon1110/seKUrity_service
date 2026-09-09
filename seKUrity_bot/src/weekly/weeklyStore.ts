import { backendRequest } from '../api/backendClient';
import type {
  WeeklyExtraResult,
  WeeklyReport,
  WeeklyReportPreview,
  WeeklyReportThread,
} from './types';

export async function getWeeklyRoleId(
  guildId: string,
): Promise<string | null> {
  const response = await backendRequest<{ roleId: string | null }>(
    `/internal/v1/guilds/${encodeURIComponent(guildId)}/weekly-role`,
  );
  return response.roleId;
}

export async function setWeeklyRoleId(
  guildId: string,
  roleId: string,
): Promise<void> {
  await backendRequest(
    `/internal/v1/guilds/${encodeURIComponent(guildId)}/weekly-role`,
    {
      method: 'PUT',
      body: JSON.stringify({ roleId }),
    },
  );
}

export async function unsetWeeklyRoleId(
  guildId: string,
): Promise<string | null> {
  const response = await backendRequest<{ roleId: string | null }>(
    `/internal/v1/guilds/${encodeURIComponent(guildId)}/weekly-role`,
    { method: 'DELETE' },
  );
  return response.roleId;
}

export async function getWeeklyThread(
  guildId: string,
  userId: string,
): Promise<WeeklyReportThread | null> {
  return backendRequest<WeeklyReportThread | null>(
    [
      '/internal/v1/guilds',
      encodeURIComponent(guildId),
      'weekly-threads',
      encodeURIComponent(userId),
    ].join('/'),
  );
}

export async function listWeeklyThreads(
  guildId: string,
): Promise<WeeklyReportThread[]> {
  return backendRequest<WeeklyReportThread[]>(
    `/internal/v1/guilds/${encodeURIComponent(guildId)}/weekly-threads`,
  );
}

export async function upsertWeeklyThread(input: {
  guildId: string;
  userId: string;
  channelId: string;
  threadId: string;
}): Promise<WeeklyReportThread> {
  return backendRequest<WeeklyReportThread>(
    [
      '/internal/v1/guilds',
      encodeURIComponent(input.guildId),
      'weekly-threads',
      encodeURIComponent(input.userId),
    ].join('/'),
    {
      method: 'PUT',
      body: JSON.stringify({
        channelId: input.channelId,
        threadId: input.threadId,
      }),
    },
  );
}

export async function getWeeklyReportPreview(input: {
  guildId: string;
  userId: string;
  weekEnd: string;
}): Promise<WeeklyReportPreview> {
  const query = new URLSearchParams({
    userId: input.userId,
    weekEnd: input.weekEnd,
  });
  return backendRequest<WeeklyReportPreview>(
    `/internal/v1/guilds/${encodeURIComponent(input.guildId)}/weekly-reports/preview?${query}`,
  );
}

export async function createWeeklyReport(input: {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  weekEnd: string;
  extraItems: WeeklyExtraResult[];
}): Promise<WeeklyReport> {
  return backendRequest<WeeklyReport>(
    `/internal/v1/guilds/${encodeURIComponent(input.guildId)}/weekly-reports`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        userId: input.userId,
        threadId: input.threadId,
        weekEnd: input.weekEnd,
        extraItems: input.extraItems,
      }),
    },
  );
}

export async function syncWeeklyReport(input: {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  weekEnd: string;
}): Promise<WeeklyReport> {
  return backendRequest<WeeklyReport>(
    `/internal/v1/guilds/${encodeURIComponent(input.guildId)}/weekly-reports/sync`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        userId: input.userId,
        threadId: input.threadId,
        weekEnd: input.weekEnd,
      }),
    },
  );
}

export async function getWeeklyReport(
  reportId: string,
): Promise<WeeklyReport | null> {
  return backendRequest<WeeklyReport | null>(
    `/internal/v1/weekly-reports/${encodeURIComponent(reportId)}`,
  );
}

export async function getLatestWeeklyReportByThread(
  threadId: string,
): Promise<WeeklyReport | null> {
  return backendRequest<WeeklyReport | null>(
    `/internal/v1/weekly-reports/by-thread/${encodeURIComponent(threadId)}/latest`,
  );
}

export async function findWeeklyReport(input: {
  guildId: string;
  userId: string;
  weekEnd: string;
}): Promise<WeeklyReport | null> {
  return backendRequest<WeeklyReport | null>(
    [
      '/internal/v1/guilds',
      encodeURIComponent(input.guildId),
      'weekly-reports/by-user',
      encodeURIComponent(input.userId),
      encodeURIComponent(input.weekEnd),
    ].join('/'),
  );
}

export async function processWeeklyReportMisses(input: {
  guildId: string;
  weekEnd: string;
  userIds: string[];
}): Promise<string[]> {
  const response = await backendRequest<{
    weekEnd: string;
    incrementedUserIds: string[];
  }>(
    `/internal/v1/guilds/${encodeURIComponent(input.guildId)}/weekly-reports/process-misses`,
    {
      method: 'POST',
      body: JSON.stringify({
        weekEnd: input.weekEnd,
        userIds: input.userIds,
      }),
    },
  );
  return response.incrementedUserIds;
}

export async function processWeeklyReportReminders(input: {
  guildId: string;
  weekEnd: string;
  userIds: string[];
}): Promise<string[]> {
  const response = await backendRequest<{
    weekEnd: string;
    claimedUserIds: string[];
  }>(
    `/internal/v1/guilds/${encodeURIComponent(input.guildId)}/weekly-reports/process-reminders`,
    {
      method: 'POST',
      body: JSON.stringify({
        weekEnd: input.weekEnd,
        userIds: input.userIds,
      }),
    },
  );
  return response.claimedUserIds;
}

export async function updateWeeklyReport(input: {
  reportId: string;
  extraItems: WeeklyExtraResult[];
  discordMessageIds: string[];
  actorType?: 'administrator';
}): Promise<WeeklyReport> {
  return backendRequest<WeeklyReport>(
    `/internal/v1/weekly-reports/${encodeURIComponent(input.reportId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        extraItems: input.extraItems,
        discordMessageIds: input.discordMessageIds,
        actorType: input.actorType,
      }),
    },
  );
}

export async function deleteWeeklyReport(input: {
  reportId: string;
  deletedBy: string;
  actorType: 'owner' | 'administrator' | 'system';
  reason: string;
}): Promise<WeeklyReport> {
  return backendRequest<WeeklyReport>(
    `/internal/v1/weekly-reports/${encodeURIComponent(input.reportId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        deletedBy: input.deletedBy,
        actorType: input.actorType,
        reason: input.reason,
      }),
    },
  );
}
