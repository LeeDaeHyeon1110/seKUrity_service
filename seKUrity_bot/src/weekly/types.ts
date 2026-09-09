import type {
  ScrumAttachment,
  ScrumTodoResult,
} from '../scrums/types';

export interface WeeklyReportThread {
  guildId: string;
  userId: string;
  channelId: string;
  threadId: string;
  missedReportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyPendingScrum {
  scrumId: string;
  projectName: string;
  todos: string[];
}

export interface WeeklyReportPreview {
  weekStart: string;
  weekEnd: string;
  completedItems: ScrumTodoResult[];
  nextTodos: string[];
  pendingScrums: WeeklyPendingScrum[];
  existingReportId: string | null;
}

export interface WeeklyReport {
  id: string;
  guildId: string;
  userId: string;
  threadId: string;
  weekStart: string;
  weekEnd: string;
  completedItems: ScrumTodoResult[];
  extraItems: ScrumTodoResult[];
  nextTodos: string[];
  pendingTodos: string[];
  discordMessageIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyExtraResult {
  title: string;
  comment: string;
  attachments: ScrumAttachment[];
  links: string[];
}
