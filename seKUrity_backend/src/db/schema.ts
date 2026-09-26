import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  date,
  foreignKey,
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
import type { ScrumResult, WeeklyScrumResult } from '../contracts';

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
    scrumCategory: text('scrum_category').$type<NonNullable<
      WeeklyScrumResult['scrumCategory']
    >>(),
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
    check(
      'weekly_report_items_scrum_category_check',
      sql`${table.scrumCategory} IS NULL OR (${table.kind} = 'completed' AND ${table.scrumCategory} IN ('project', 'study', 'personal_study', 'personal'))`,
    ),
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

/**
 * Browser identities intentionally use an application UUID as their primary
 * key. Discord snowflakes remain unique external identifiers, which lets us
 * add another identity provider later without rewriting domain foreign keys.
 */
export const webUsers = pgTable(
  'web_users',
  {
    id: uuid('id').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    username: text('username').notNull(),
    globalName: text('global_name'),
    avatarHash: text('avatar_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('web_users_discord_user_id_unique').on(table.discordUserId),
  ],
);

export const webGuildMemberships = pgTable(
  'web_guild_memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    guildNickname: text('guild_nickname'),
    roleIds: jsonb('role_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    isGuildMember: boolean('is_guild_member').notNull().default(false),
    isActiveMember: boolean('is_active_member').notNull().default(false),
    isBoardMember: boolean('is_board_member').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index('web_guild_memberships_guild_active_idx').on(
      table.guildId,
      table.isActiveMember,
    ),
  ],
);

export const webSessions = pgTable(
  'web_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('web_sessions_token_hash_unique').on(table.tokenHash),
    index('web_sessions_user_active_idx').on(table.userId, table.expiresAt),
  ],
);

export const webOauthStates = pgTable(
  'web_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    returnTo: text('return_to').notNull().default('/'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('web_oauth_states_expires_idx').on(table.expiresAt),
  ],
);

export interface WebProfileLink {
  label?: string;
  url: string;
}

export const webMemberProfiles = pgTable(
  'web_member_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => webUsers.id, { onDelete: 'cascade' }),
    introduction: text('introduction').notNull().default(''),
    specialties: jsonb('specialties').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    links: jsonb('links').$type<WebProfileLink[]>().notNull().default(sql`'[]'::jsonb`),
    photoStorageKey: text('photo_storage_key'),
    photoContentType: text('photo_content_type'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const webScoreEvents = pgTable(
  'web_score_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
    reason: text('reason').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    voidedBy: uuid('voided_by')
      .references(() => webUsers.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('web_score_events_user_created_idx').on(table.userId, table.createdAt),
    check('web_score_events_amount_positive_check', sql`${table.amount} > 0`),
    check(
      'web_score_events_void_state_check',
      sql`(${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL AND ${table.voidedBy} IS NULL)
          OR (${table.voidedAt} IS NOT NULL AND ${table.voidReason} IS NOT NULL AND ${table.voidedBy} IS NOT NULL)`,
    ),
  ],
);

export const webAttendanceSessions = pgTable(
  'web_attendance_sessions',
  {
    id: uuid('id').primaryKey(),
    attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('open'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid('closed_by').references(() => webUsers.id, { onDelete: 'restrict' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => webUsers.id, { onDelete: 'restrict' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
  },
  (table) => [
    uniqueIndex('web_attendance_sessions_date_unique').on(table.attendanceDate),
    check('web_attendance_sessions_status_check', sql`${table.status} IN ('open', 'closed', 'cancelled')`),
  ],
);

export const webAttendanceRecords = pgTable(
  'web_attendance_records',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => webAttendanceSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'restrict' }),
    nameSnapshot: text('name_snapshot').notNull(),
    status: text('status'),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => webUsers.id, { onDelete: 'restrict' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId] }),
    index('web_attendance_records_user_idx').on(table.userId, table.sessionId),
    check(
      'web_attendance_records_status_check',
      sql`${table.status} IS NULL OR ${table.status} IN ('present', 'late', 'absent', 'excused')`,
    ),
  ],
);

export const webAttendanceRecordAudits = pgTable(
  'web_attendance_record_audits',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id').notNull(),
    previousStatus: text('previous_status'),
    newStatus: text('new_status').notNull(),
    note: text('note'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => webUsers.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('web_attendance_record_audits_record_idx').on(
      table.sessionId,
      table.userId,
      table.createdAt,
    ),
    check(
      'web_attendance_record_audits_status_check',
      sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('present', 'late', 'absent', 'excused')`,
    ),
    check(
      'web_attendance_record_audits_new_status_check',
      sql`${table.newStatus} IN ('present', 'late', 'absent', 'excused')`,
    ),
    foreignKey({
      columns: [table.sessionId, table.userId],
      foreignColumns: [webAttendanceRecords.sessionId, webAttendanceRecords.userId],
    }).onDelete('cascade'),
  ],
);
