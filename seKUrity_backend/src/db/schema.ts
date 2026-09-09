import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ScrumResult } from '../contracts';

export const guildChannelSettings = pgTable(
  'guild_channel_settings',
  {
    guildId: text('guild_id').notNull(),
    type: text('type').notNull(),
    channelId: text('channel_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.type] }),
    check('guild_channel_settings_type_check', sql`${table.type} IN ('logs', 'scrums', 'approve', 'weekly')`),
  ],
);

export const guildWeeklySettings = pgTable(
  'guild_weekly_settings',
  {
    guildId: text('guild_id').primaryKey(),
    roleId: text('role_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const guildApproverRoles = pgTable(
  'guild_approver_roles',
  {
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.roleId] }),
  ],
);

export const scrums = pgTable(
  'scrums',
  {
    id: uuid('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    scrumChannelId: text('scrum_channel_id').notNull(),
    threadId: text('thread_id').notNull(),
    creatorId: text('creator_id').notNull(),
    projectName: text('project_name').notNull(),
    overview: text('overview').notNull(),
    category: text('category').notNull().default('project'),
    planningDocumentId: text('planning_document_id'),
    planningDocumentName: text('planning_document_name'),
    planningDocumentUrl: text('planning_document_url'),
    planningDocumentContentType: text('planning_document_content_type'),
    planningDocumentSize: integer('planning_document_size'),
    projectScoreDocumentId: text('project_score_document_id'),
    projectScoreDocumentName: text('project_score_document_name'),
    projectScoreDocumentUrl: text('project_score_document_url'),
    projectScoreDocumentContentType: text('project_score_document_content_type'),
    projectScoreDocumentSize: integer('project_score_document_size'),
    status: text('status').notNull().default('active'),
    nextScrumDate: date('next_scrum_date', { mode: 'string' }).notNull(),
    completedBy: text('completed_by'),
    completionSummary: text('completion_summary'),
    completionResults: jsonb('completion_results').$type<ScrumResult[]>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    abandonedBy: text('abandoned_by'),
    abandonmentReason: text('abandonment_reason'),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('scrums_thread_id_unique').on(table.threadId),
    index('scrums_guild_status_idx').on(table.guildId, table.status),
    index('scrums_next_date_active_idx')
      .on(table.nextScrumDate)
      .where(sql`${table.status} = 'active'`),
    check('scrums_status_check', sql`${table.status} IN ('active', 'closed', 'abandoned')`),
    check(
      'scrums_category_check',
      sql`${table.category} IN ('project', 'study', 'personal_study', 'personal')`,
    ),
    check(
      'scrums_planning_document_size_check',
      sql`${table.planningDocumentSize} IS NULL OR ${table.planningDocumentSize} >= 0`,
    ),
    check(
      'scrums_project_score_document_size_check',
      sql`${table.projectScoreDocumentSize} IS NULL OR ${table.projectScoreDocumentSize} >= 0`,
    ),
  ],
);

export const scrumMembers = pgTable(
  'scrum_members',
  {
    scrumId: uuid('scrum_id')
      .notNull()
      .references(() => scrums.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scrumId, table.userId] }),
    index('scrum_members_user_idx').on(table.userId, table.scrumId),
  ],
);

export const scrumCurrentTodos = pgTable(
  'scrum_current_todos',
  {
    id: uuid('id').primaryKey(),
    scrumId: uuid('scrum_id')
      .notNull()
      .references(() => scrums.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_current_todos_position_unique').on(
      table.scrumId,
      table.position,
    ),
    check('scrum_current_todos_position_check', sql`${table.position} >= 0`),
  ],
);

export const scrumRequests = pgTable(
  'scrum_requests',
  {
    id: uuid('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    approvalChannelId: text('approval_channel_id').notNull(),
    approvalThreadId: text('approval_thread_id').notNull(),
    creatorId: text('creator_id').notNull(),
    projectName: text('project_name').notNull(),
    overview: text('overview').notNull(),
    category: text('category').notNull(),
    planningDocumentId: text('planning_document_id'),
    planningDocumentName: text('planning_document_name'),
    planningDocumentUrl: text('planning_document_url'),
    planningDocumentContentType: text('planning_document_content_type'),
    planningDocumentSize: integer('planning_document_size'),
    projectScoreDocumentId: text('project_score_document_id'),
    projectScoreDocumentName: text('project_score_document_name'),
    projectScoreDocumentUrl: text('project_score_document_url'),
    projectScoreDocumentContentType: text('project_score_document_content_type'),
    projectScoreDocumentSize: integer('project_score_document_size'),
    status: text('status').notNull().default('pending'),
    scrumId: uuid('scrum_id')
      .references(() => scrums.id),
    reviewedBy: text('reviewed_by'),
    rejectionReason: text('rejection_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('scrum_requests_approval_thread_unique').on(table.approvalThreadId),
    index('scrum_requests_guild_status_idx').on(table.guildId, table.status),
    check(
      'scrum_requests_category_check',
      sql`${table.category} IN ('project', 'study', 'personal_study', 'personal')`,
    ),
    check(
      'scrum_requests_planning_document_size_check',
      sql`${table.planningDocumentSize} IS NULL OR ${table.planningDocumentSize} >= 0`,
    ),
    check(
      'scrum_requests_project_score_document_size_check',
      sql`${table.projectScoreDocumentSize} IS NULL OR ${table.projectScoreDocumentSize} >= 0`,
    ),
    check(
      'scrum_requests_status_check',
      sql`${table.status} IN ('pending', 'approved', 'rejected')`,
    ),
    check(
      'scrum_requests_review_state_check',
      sql`
        (
          ${table.status} = 'pending'
          AND ${table.scrumId} IS NULL
          AND ${table.reviewedBy} IS NULL
          AND ${table.rejectionReason} IS NULL
          AND ${table.reviewedAt} IS NULL
        )
        OR (
          ${table.status} = 'approved'
          AND ${table.scrumId} IS NOT NULL
          AND ${table.reviewedBy} IS NOT NULL
          AND ${table.rejectionReason} IS NULL
          AND ${table.reviewedAt} IS NOT NULL
        )
        OR (
          ${table.status} = 'rejected'
          AND ${table.scrumId} IS NULL
          AND ${table.reviewedBy} IS NOT NULL
          AND ${table.rejectionReason} IS NOT NULL
          AND ${table.reviewedAt} IS NOT NULL
        )
      `,
    ),
  ],
);

export const scrumRequestTodos = pgTable(
  'scrum_request_todos',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => scrumRequests.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_request_todos_position_unique').on(
      table.requestId,
      table.position,
    ),
    check('scrum_request_todos_position_check', sql`${table.position} >= 0`),
  ],
);

export const scrumEntries = pgTable(
  'scrum_entries',
  {
    id: uuid('id').primaryKey(),
    scrumId: uuid('scrum_id')
      .notNull()
      .references(() => scrums.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    scrumDate: date('scrum_date', { mode: 'string' }).notNull(),
    nextScrumDate: date('next_scrum_date', { mode: 'string' }).notNull(),
    discordMessageIds: jsonb('discord_message_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('scrum_entries_scrum_date_unique').on(
      table.scrumId,
      table.scrumDate,
    ),
    index('scrum_entries_scrum_created_idx').on(table.scrumId, table.createdAt),
  ],
);

export const scrumEntryItems = pgTable(
  'scrum_entry_items',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => scrumEntries.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    comment: text('comment').notNull().default(''),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_entry_items_position_unique').on(
      table.entryId,
      table.position,
    ),
    index('scrum_entry_items_entry_kind_idx').on(table.entryId, table.kind),
    check('scrum_entry_items_kind_check', sql`${table.kind} IN ('completed', 'extra')`),
    check('scrum_entry_items_position_check', sql`${table.position} >= 0`),
  ],
);

export const scrumEntryAttachments = pgTable(
  'scrum_entry_attachments',
  {
    id: text('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => scrumEntryItems.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    contentType: text('content_type'),
    size: integer('size').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_entry_attachments_position_unique').on(
      table.itemId,
      table.position,
    ),
    check('scrum_entry_attachments_size_check', sql`${table.size} >= 0`),
    check('scrum_entry_attachments_position_check', sql`${table.position} >= 0`),
  ],
);

export const scrumEntryLinks = pgTable(
  'scrum_entry_links',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => scrumEntryItems.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_entry_links_position_unique').on(
      table.itemId,
      table.position,
    ),
    check('scrum_entry_links_position_check', sql`${table.position} >= 0`),
  ],
);

export const scrumEntryNextTodos = pgTable(
  'scrum_entry_next_todos',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => scrumEntries.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('scrum_entry_next_todos_position_unique').on(
      table.entryId,
      table.position,
    ),
    check('scrum_entry_next_todos_position_check', sql`${table.position} >= 0`),
  ],
);

export const weeklyReportThreads = pgTable(
  'weekly_report_threads',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    channelId: text('channel_id').notNull(),
    threadId: text('thread_id').notNull(),
    missedReportCount: integer('missed_report_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    uniqueIndex('weekly_report_threads_thread_unique').on(table.threadId),
    index('weekly_report_threads_guild_channel_idx').on(
      table.guildId,
      table.channelId,
    ),
  ],
);

export const weeklyReportMisses = pgTable(
  'weekly_report_misses',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    weekEnd: date('week_end', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.guildId, table.userId, table.weekEnd],
    }),
    index('weekly_report_misses_guild_week_idx').on(
      table.guildId,
      table.weekEnd,
    ),
  ],
);

export const weeklyMissCountResets = pgTable(
  'weekly_miss_count_resets',
  {
    guildId: text('guild_id').primaryKey(),
    countAfter: date('count_after', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const weeklyReportReminders = pgTable(
  'weekly_report_reminders',
  {
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    weekEnd: date('week_end', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.guildId, table.userId, table.weekEnd],
    }),
    index('weekly_report_reminders_guild_week_idx').on(
      table.guildId,
      table.weekEnd,
    ),
  ],
);

export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: uuid('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    threadId: text('thread_id').notNull(),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    weekEnd: date('week_end', { mode: 'string' }).notNull(),
    discordMessageIds: jsonb('discord_message_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('weekly_reports_user_week_unique').on(
      table.guildId,
      table.userId,
      table.weekEnd,
    ),
    index('weekly_reports_thread_created_idx').on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

export const weeklyReportItems = pgTable(
  'weekly_report_items',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => weeklyReports.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    comment: text('comment').notNull().default(''),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('weekly_report_items_position_unique').on(
      table.reportId,
      table.position,
    ),
    index('weekly_report_items_report_kind_idx').on(
      table.reportId,
      table.kind,
    ),
    check(
      'weekly_report_items_kind_check',
      sql`${table.kind} IN ('completed', 'extra', 'next', 'pending')`,
    ),
    check('weekly_report_items_position_check', sql`${table.position} >= 0`),
  ],
);

export const weeklyReportAttachments = pgTable(
  'weekly_report_attachments',
  {
    id: text('id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => weeklyReportItems.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    contentType: text('content_type'),
    size: integer('size').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('weekly_report_attachments_position_unique').on(
      table.itemId,
      table.position,
    ),
    check('weekly_report_attachments_size_check', sql`${table.size} >= 0`),
    check('weekly_report_attachments_position_check', sql`${table.position} >= 0`),
  ],
);

export const weeklyReportLinks = pgTable(
  'weekly_report_links',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => weeklyReportItems.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('weekly_report_links_position_unique').on(
      table.itemId,
      table.position,
    ),
    check('weekly_report_links_position_check', sql`${table.position} >= 0`),
  ],
);

export const weeklyReportDeletions = pgTable(
  'weekly_report_deletions',
  {
    id: uuid('id').primaryKey(),
    reportId: uuid('report_id').notNull(),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    weekEnd: date('week_end', { mode: 'string' }).notNull(),
    deletedBy: text('deleted_by').notNull(),
    reason: text('reason').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('weekly_report_deletions_guild_week_idx').on(
      table.guildId,
      table.weekEnd,
    ),
  ],
);
