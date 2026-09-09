import type { ScrumCategory } from './categories';

export interface ScrumAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface ScrumTodoResult {
  title: string;
  comment: string;
  attachments: ScrumAttachment[];
  links: string[];
}

export interface ScrumExtraResult {
  title: string;
  comment: string;
  attachments: ScrumAttachment[];
  links: string[];
}

export interface Scrum {
  id: string;
  guildId: string;
  scrumChannelId: string;
  threadId: string;
  creatorId: string;
  ownerIds: string[];
  projectName: string;
  overview: string;
  category: ScrumCategory;
  planningDocument: ScrumAttachment | null;
  projectScoreDocument: ScrumAttachment | null;
  status: 'active' | 'closed' | 'abandoned';
  currentTodos: string[];
  nextScrumDate: string;
  completedBy: string | null;
  completionSummary: string | null;
  completionResults: ScrumTodoResult[] | null;
  completedAt: string | null;
  abandonedBy: string | null;
  abandonmentReason: string | null;
  abandonedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScrumEntry {
  id: string;
  scrumId: string;
  authorId: string;
  scrumDate: string;
  nextScrumDate: string;
  completedItems: ScrumTodoResult[];
  extraItems: ScrumExtraResult[];
  nextTodos: string[];
  discordMessageIds: string[];
  createdAt: string;
}

export interface ScrumRequest {
  id: string;
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
  status: 'pending' | 'approved' | 'rejected';
  scrumId: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
