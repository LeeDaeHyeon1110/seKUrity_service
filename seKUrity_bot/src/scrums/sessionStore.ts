import { randomUUID } from 'node:crypto';
import type { ScrumCategory } from './categories';
import type {
  Scrum,
  ScrumAttachment,
  ScrumEntry,
  ScrumExtraResult,
  ScrumTodoResult,
} from './types';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ScrumSessionPhase =
  | 'todo'
  | 'extra-decision'
  | 'carryover'
  | 'next-todos';

export interface ScrumSession {
  id: string;
  guildId: string;
  userId: string;
  scrum: Scrum;
  phase: ScrumSessionPhase;
  currentTodoIndex: number;
  currentExtraIndex: number;
  todoResults: ScrumTodoResult[];
  extraResults: ScrumExtraResult[];
  carryoverCandidates: string[];
  carryoverTodos: string[];
  scrumDate: string;
  nextScrumDate: string;
  createdAt: number;
}

export interface NewScrumDraft {
  id: string;
  guildId: string;
  userId: string;
  projectName: string;
  overview: string;
  category: ScrumCategory;
  planningDocument: ScrumAttachment | null;
  projectScoreDocument: ScrumAttachment | null;
  createdAt: number;
}

export interface ScrumCompletionDraft {
  id: string;
  guildId: string;
  userId: string;
  scrumId: string;
  threadId: string;
  currentTodos: string[];
  currentTodoIndex: number;
  todoResults: ScrumTodoResult[];
  createdAt: number;
}

export type ScrumEntryEditMode =
  | 'edit'
  | 'mark-completed'
  | 'mark-incomplete';

export interface ScrumEntryEditSession {
  id: string;
  guildId: string;
  userId: string;
  entry: ScrumEntry;
  scrum: Scrum;
  selectedKind: 'completed' | 'extra' | null;
  selectedIndex: number | null;
  editMode: ScrumEntryEditMode | null;
  createdAt: number;
}

const sessions = new Map<string, ScrumSession>();
const newScrumDrafts = new Map<string, NewScrumDraft>();
const completionDrafts = new Map<string, ScrumCompletionDraft>();
const entryEditSessions = new Map<string, ScrumEntryEditSession>();

function isExpired(createdAt: number): boolean {
  return Date.now() - createdAt > SESSION_TTL_MS;
}

function sweepExpiredSessions(): void {
  for (const [sessionId, session] of sessions) {
    if (isExpired(session.createdAt)) {
      sessions.delete(sessionId);
    }
  }

  for (const [draftId, draft] of newScrumDrafts) {
    if (isExpired(draft.createdAt)) {
      newScrumDrafts.delete(draftId);
    }
  }

  for (const [draftId, draft] of completionDrafts) {
    if (isExpired(draft.createdAt)) {
      completionDrafts.delete(draftId);
    }
  }

  for (const [sessionId, session] of entryEditSessions) {
    if (isExpired(session.createdAt)) {
      entryEditSessions.delete(sessionId);
    }
  }
}

export function createScrumSession(input: {
  guildId: string;
  userId: string;
  scrum: Scrum;
  scrumDate: string;
  nextScrumDate: string;
}): ScrumSession {
  sweepExpiredSessions();

  const session: ScrumSession = {
    id: randomUUID(),
    phase: input.scrum.currentTodos.length > 0 ? 'todo' : 'extra-decision',
    currentTodoIndex: 0,
    currentExtraIndex: 0,
    todoResults: [],
    extraResults: [],
    carryoverCandidates: [],
    carryoverTodos: [],
    createdAt: Date.now(),
    ...input,
  };

  sessions.set(session.id, session);
  return session;
}

export function getScrumSession(sessionId: string): ScrumSession | null {
  const session = sessions.get(sessionId);

  if (!session || isExpired(session.createdAt)) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function deleteScrumSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function createNewScrumDraft(input: Omit<NewScrumDraft, 'id' | 'createdAt'>): NewScrumDraft {
  sweepExpiredSessions();

  const draft: NewScrumDraft = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...input,
  };

  newScrumDrafts.set(draft.id, draft);
  return draft;
}

export function getNewScrumDraft(draftId: string): NewScrumDraft | null {
  const draft = newScrumDrafts.get(draftId);

  if (!draft || isExpired(draft.createdAt)) {
    newScrumDrafts.delete(draftId);
    return null;
  }

  return draft;
}

export function deleteNewScrumDraft(draftId: string): void {
  newScrumDrafts.delete(draftId);
}

export function createScrumCompletionDraft(
  input: Omit<
    ScrumCompletionDraft,
    'id' | 'currentTodoIndex' | 'todoResults' | 'createdAt'
  >,
): ScrumCompletionDraft {
  sweepExpiredSessions();

  const draft: ScrumCompletionDraft = {
    id: randomUUID(),
    currentTodoIndex: 0,
    todoResults: [],
    createdAt: Date.now(),
    ...input,
  };

  completionDrafts.set(draft.id, draft);
  return draft;
}

export function getScrumCompletionDraft(
  draftId: string,
): ScrumCompletionDraft | null {
  const draft = completionDrafts.get(draftId);

  if (!draft || isExpired(draft.createdAt)) {
    completionDrafts.delete(draftId);
    return null;
  }

  return draft;
}

export function deleteScrumCompletionDraft(draftId: string): void {
  completionDrafts.delete(draftId);
}

export function createScrumEntryEditSession(input: {
  guildId: string;
  userId: string;
  entry: ScrumEntry;
  scrum: Scrum;
}): ScrumEntryEditSession {
  sweepExpiredSessions();

  const session: ScrumEntryEditSession = {
    id: randomUUID(),
    selectedKind: null,
    selectedIndex: null,
    editMode: null,
    createdAt: Date.now(),
    ...input,
  };

  entryEditSessions.set(session.id, session);
  return session;
}

export function getScrumEntryEditSession(
  sessionId: string,
): ScrumEntryEditSession | null {
  const session = entryEditSessions.get(sessionId);

  if (!session || isExpired(session.createdAt)) {
    entryEditSessions.delete(sessionId);
    return null;
  }

  return session;
}

export function deleteScrumEntryEditSession(sessionId: string): void {
  entryEditSessions.delete(sessionId);
}
