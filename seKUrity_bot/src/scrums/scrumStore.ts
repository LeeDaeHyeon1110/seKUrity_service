import {
  BackendApiError,
  backendRequest,
} from '../api/backendClient';
import type { ScrumCategory } from './categories';
import type {
  Scrum,
  ScrumEntry,
  ScrumExtraResult,
  ScrumTodoResult,
} from './types';

export async function createScrum(input: {
  guildId: string;
  scrumChannelId: string;
  threadId: string;
  creatorId: string;
  ownerIds: string[];
  projectName: string;
  overview: string;
  category: ScrumCategory;
  planningDocument: Scrum['planningDocument'];
  projectScoreDocument: Scrum['projectScoreDocument'];
  currentTodos: string[];
  nextScrumDate: string;
}): Promise<Scrum> {
  const response = await backendRequest<{ scrum: Scrum }>(
    '/internal/v1/scrums',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );

  return response.scrum;
}

export async function getActiveScrumByThread(
  threadId: string,
): Promise<Scrum | null> {
  const response = await backendRequest<{ scrum: Scrum | null }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}`,
  );

  return response.scrum;
}

export async function completeScrumByThread(
  threadId: string,
  completedBy: string,
  completedItems: ScrumTodoResult[],
): Promise<Scrum> {
  const response = await backendRequest<{ scrum: Scrum }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({
        completedBy,
        completedItems,
      }),
    },
  );

  return response.scrum;
}

export async function abandonScrumByThread(
  threadId: string,
  abandonedBy: string,
  reason: string,
): Promise<Scrum> {
  const response = await backendRequest<{ scrum: Scrum }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}/abandon`,
    {
      method: 'POST',
      body: JSON.stringify({
        abandonedBy,
        reason,
      }),
    },
  );

  return response.scrum;
}

export async function deleteScrumByThread(
  threadId: string,
  deletedBy: string,
  reason: string,
): Promise<Scrum> {
  const response = await backendRequest<{ scrum: Scrum }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        deletedBy,
        reason,
      }),
    },
  );

  return response.scrum;
}

export async function updateScrumCompletionResults(
  threadId: string,
  completedItems: ScrumTodoResult[],
): Promise<void> {
  await backendRequest<void>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}/completion-results`,
    {
      method: 'PATCH',
      body: JSON.stringify({ completedItems }),
    },
  );
}

export async function updateScrumMetadata(
  threadId: string,
  updatedBy: string,
  projectName: string,
  overview: string,
): Promise<Scrum> {
  const response = await backendRequest<{ scrum: Scrum }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}/metadata`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        updatedBy,
        projectName,
        overview,
      }),
    },
  );

  return response.scrum;
}

export async function getActiveScrumsForUser(
  guildId: string,
  userId: string,
): Promise<Scrum[]> {
  const query = new URLSearchParams({ userId });
  const response = await backendRequest<{ scrums: Scrum[] }>(
    `/internal/v1/guilds/${encodeURIComponent(guildId)}/scrums/active?${query}`,
  );

  return response.scrums;
}

export async function getActiveScrumForUser(
  scrumId: string,
  guildId: string,
  userId: string,
): Promise<Scrum | null> {
  const query = new URLSearchParams({ userId });
  const response = await backendRequest<{ scrum: Scrum | null }>(
    [
      '/internal/v1/guilds',
      encodeURIComponent(guildId),
      'scrums',
      encodeURIComponent(scrumId),
      `active?${query}`,
    ].join('/'),
  );

  return response.scrum;
}

export async function hasScrumEntryForDate(
  scrumId: string,
  scrumDate: string,
): Promise<boolean> {
  const response = await backendRequest<{ exists: boolean }>(
    [
      '/internal/v1/scrums',
      encodeURIComponent(scrumId),
      'entries',
      encodeURIComponent(scrumDate),
      'exists',
    ].join('/'),
  );

  return response.exists;
}

export async function saveScrumEntry(input: {
  scrum: Scrum;
  authorId: string;
  scrumDate: string;
  nextScrumDate: string;
  completedItems: ScrumTodoResult[];
  extraItems: ScrumExtraResult[];
  nextTodos: string[];
}): Promise<ScrumEntry | null> {
  const body = {
    authorId: input.authorId,
    scrumDate: input.scrumDate,
    nextScrumDate: input.nextScrumDate,
    completedItems: input.completedItems,
    extraItems: input.extraItems,
    nextTodos: input.nextTodos,
  };

  try {
    const response = await backendRequest<{ entry: ScrumEntry }>(
      `/internal/v1/scrums/${encodeURIComponent(input.scrum.id)}/entries`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    return response.entry;
  } catch (error) {
    if (
      error instanceof BackendApiError
      && error.status === 409
      && error.code === 'SCRUM_ENTRY_EXISTS'
    ) {
      return null;
    }

    throw error;
  }
}

export async function updateScrumEntryResults(
  entryId: string,
  completedItems: ScrumTodoResult[],
  extraItems: ScrumExtraResult[],
  discordMessageIds: string[],
): Promise<void> {
  await backendRequest<void>(
    `/internal/v1/scrum-entries/${encodeURIComponent(entryId)}/results`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        completedItems,
        extraItems,
        discordMessageIds,
      }),
    },
  );
}

export async function getScrumEntry(
  entryId: string,
): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
  return backendRequest<{ entry: ScrumEntry; scrum: Scrum }>(
    `/internal/v1/scrum-entries/${encodeURIComponent(entryId)}`,
  );
}

export async function getLatestScrumEntryByThread(
  threadId: string,
  scrumDate?: string,
): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
  const query = scrumDate
    ? `?${new URLSearchParams({ scrumDate })}`
    : '';

  return backendRequest<{ entry: ScrumEntry; scrum: Scrum }>(
    `/internal/v1/scrums/by-thread/${encodeURIComponent(threadId)}/entries/latest${query}`,
  );
}

export async function updateScrumEntry(input: {
  entryId: string;
  actorId: string;
  actorType: 'member' | 'administrator';
  completedItems: ScrumTodoResult[];
  extraItems: ScrumExtraResult[];
  nextTodos: string[];
}): Promise<{ entry: ScrumEntry; scrum: Scrum }> {
  return backendRequest<{ entry: ScrumEntry; scrum: Scrum }>(
    `/internal/v1/scrum-entries/${encodeURIComponent(input.entryId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        actorId: input.actorId,
        actorType: input.actorType,
        completedItems: input.completedItems,
        extraItems: input.extraItems,
        nextTodos: input.nextTodos,
      }),
    },
  );
}

export async function deleteScrumEntry(
  entryId: string,
  authorId: string,
): Promise<{
  entry: ScrumEntry;
  scrum: Scrum;
}> {
  return backendRequest<{
    entry: ScrumEntry;
    scrum: Scrum;
  }>(
    `/internal/v1/scrum-entries/${encodeURIComponent(entryId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ authorId }),
    },
  );
}
