import { randomUUID } from 'node:crypto';
import type {
  WeeklyExtraResult,
  WeeklyReportPreview,
} from './types';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface WeeklySession {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  preview: WeeklyReportPreview;
  extraItems: WeeklyExtraResult[];
  createdAt: number;
}

const sessions = new Map<string, WeeklySession>();

export function createWeeklySession(input: Omit<
  WeeklySession,
  'id' | 'extraItems' | 'createdAt'
>): WeeklySession {
  for (const [id, session] of sessions) {
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }

  const session: WeeklySession = {
    id: randomUUID(),
    extraItems: [],
    createdAt: Date.now(),
    ...input,
  };
  sessions.set(session.id, session);
  return session;
}

export function getWeeklySession(sessionId: string): WeeklySession | null {
  const session = sessions.get(sessionId);

  if (
    !session
    || Date.now() - session.createdAt > SESSION_TTL_MS
  ) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function deleteWeeklySession(sessionId: string): void {
  sessions.delete(sessionId);
}
