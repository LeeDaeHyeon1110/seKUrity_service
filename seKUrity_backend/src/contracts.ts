import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const DiscordIdSchema = Type.String({
  minLength: 1,
  maxLength: 32,
  pattern: '^[0-9]+$',
});
const UuidSchema = Type.String({ format: 'uuid' });
const DateSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});
const TimestampSchema = Type.String({ format: 'date-time' });
const HttpUrlSchema = Type.String({
  minLength: 8,
  maxLength: 1_000,
  pattern: '^https?://',
});
const MAX_SCRUM_TODOS = 20;

export const ChannelSettingTypeSchema = Type.Union([
  Type.Literal('logs'),
  Type.Literal('scrums'),
  Type.Literal('approve'),
  Type.Literal('weekly'),
]);

export const ScrumCategorySchema = Type.Union([
  Type.Literal('project'),
  Type.Literal('study'),
  Type.Literal('personal_study'),
  Type.Literal('personal'),
]);

export const ScrumAttachmentSchema = Type.Object({
  id: DiscordIdSchema,
  name: Type.String({ minLength: 1, maxLength: 255 }),
  url: HttpUrlSchema,
  contentType: Type.Union([Type.String({ maxLength: 255 }), Type.Null()]),
  size: Type.Integer({ minimum: 0 }),
});

export const ScrumResultSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 1_000 }),
  comment: Type.String({ maxLength: 1_000 }),
  attachments: Type.Array(ScrumAttachmentSchema, { maxItems: 10 }),
  links: Type.Array(HttpUrlSchema, { maxItems: 1 }),
});

const ScrumSubmissionResultSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 1_000 }),
  comment: Type.String({ maxLength: 1_000 }),
  attachments: Type.Array(ScrumAttachmentSchema, { maxItems: 1 }),
  links: Type.Array(HttpUrlSchema, { maxItems: 1 }),
});

const DiscordMessageIdsSchema = Type.Array(DiscordIdSchema, {
  maxItems: 100,
});

export const ScrumSchema = Type.Object({
  id: UuidSchema,
  guildId: DiscordIdSchema,
  scrumChannelId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  creatorId: DiscordIdSchema,
  ownerIds: Type.Array(DiscordIdSchema, { minItems: 1, maxItems: 11 }),
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  overview: Type.String({ minLength: 1, maxLength: 1_000 }),
  category: ScrumCategorySchema,
  planningDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  projectScoreDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('closed'),
    Type.Literal('abandoned'),
  ]),
  currentTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
  nextScrumDate: DateSchema,
  completedBy: Type.Union([DiscordIdSchema, Type.Null()]),
  completionSummary: Type.Union([
    Type.String({ minLength: 1, maxLength: 1_000 }),
    Type.Null(),
  ]),
  completionResults: Type.Union([
    Type.Array(ScrumResultSchema, {
      minItems: 1,
      maxItems: MAX_SCRUM_TODOS,
    }),
    Type.Null(),
  ]),
  completedAt: Type.Union([TimestampSchema, Type.Null()]),
  abandonedBy: Type.Union([DiscordIdSchema, Type.Null()]),
  abandonmentReason: Type.Union([
    Type.String({ minLength: 1, maxLength: 1_000 }),
    Type.Null(),
  ]),
  abandonedAt: Type.Union([TimestampSchema, Type.Null()]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ScrumEntrySchema = Type.Object({
  id: UuidSchema,
  scrumId: UuidSchema,
  authorId: DiscordIdSchema,
  scrumDate: DateSchema,
  nextScrumDate: DateSchema,
  completedItems: Type.Array(ScrumResultSchema, {
    maxItems: MAX_SCRUM_TODOS,
  }),
  extraItems: Type.Array(ScrumResultSchema, { maxItems: 5 }),
  nextTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
  discordMessageIds: DiscordMessageIdsSchema,
  createdAt: TimestampSchema,
});

export const CreateScrumBodySchema = Type.Object({
  guildId: DiscordIdSchema,
  scrumChannelId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  creatorId: DiscordIdSchema,
  ownerIds: Type.Array(DiscordIdSchema, { minItems: 1, maxItems: 11 }),
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  overview: Type.String({ minLength: 1, maxLength: 1_000 }),
  category: ScrumCategorySchema,
  planningDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  projectScoreDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  currentTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
  nextScrumDate: DateSchema,
});

export const ScrumRequestStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
]);

export const ScrumRequestSchema = Type.Object({
  id: UuidSchema,
  guildId: DiscordIdSchema,
  approvalChannelId: DiscordIdSchema,
  approvalThreadId: DiscordIdSchema,
  creatorId: DiscordIdSchema,
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  overview: Type.String({ minLength: 1, maxLength: 1_000 }),
  category: ScrumCategorySchema,
  planningDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  projectScoreDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  currentTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
  status: ScrumRequestStatusSchema,
  scrumId: Type.Union([UuidSchema, Type.Null()]),
  reviewedBy: Type.Union([DiscordIdSchema, Type.Null()]),
  rejectionReason: Type.Union([
    Type.String({ minLength: 1, maxLength: 1_000 }),
    Type.Null(),
  ]),
  reviewedAt: Type.Union([TimestampSchema, Type.Null()]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CreateScrumRequestBodySchema = Type.Object({
  guildId: DiscordIdSchema,
  approvalChannelId: DiscordIdSchema,
  approvalThreadId: DiscordIdSchema,
  creatorId: DiscordIdSchema,
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  overview: Type.String({ minLength: 1, maxLength: 1_000 }),
  category: ScrumCategorySchema,
  planningDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  projectScoreDocument: Type.Union([ScrumAttachmentSchema, Type.Null()]),
  currentTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
});

export const ApproveScrumRequestBodySchema = Type.Object({
  reviewerId: DiscordIdSchema,
  scrumChannelId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  nextScrumDate: DateSchema,
});

export const CompleteScrumBodySchema = Type.Object({
  completedBy: DiscordIdSchema,
  completedItems: Type.Array(
    ScrumSubmissionResultSchema,
    { minItems: 1, maxItems: MAX_SCRUM_TODOS },
  ),
});

export const AbandonScrumBodySchema = Type.Object({
  abandonedBy: DiscordIdSchema,
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
});

export const DeleteScrumBodySchema = Type.Object({
  deletedBy: DiscordIdSchema,
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
});

export const UpdateScrumCompletionResultsBodySchema = Type.Object({
  completedItems: Type.Array(
    ScrumSubmissionResultSchema,
    { minItems: 1, maxItems: MAX_SCRUM_TODOS },
  ),
});

export const UpdateScrumMetadataBodySchema = Type.Object({
  updatedBy: DiscordIdSchema,
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  overview: Type.String({ minLength: 1, maxLength: 1_000 }),
});

export const RejectScrumRequestBodySchema = Type.Object({
  reviewerId: DiscordIdSchema,
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
});

export const SaveScrumEntryBodySchema = Type.Object({
  authorId: DiscordIdSchema,
  scrumDate: DateSchema,
  nextScrumDate: DateSchema,
  completedItems: Type.Array(ScrumSubmissionResultSchema, {
    maxItems: MAX_SCRUM_TODOS,
  }),
  extraItems: Type.Array(ScrumSubmissionResultSchema, { maxItems: 5 }),
  nextTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
});

export const UpdateScrumEntryResultsBodySchema = Type.Object({
  completedItems: Type.Array(ScrumSubmissionResultSchema, {
    maxItems: MAX_SCRUM_TODOS,
  }),
  extraItems: Type.Array(ScrumSubmissionResultSchema, { maxItems: 5 }),
  discordMessageIds: DiscordMessageIdsSchema,
});

export const UpdateScrumEntryBodySchema = Type.Object({
  actorId: DiscordIdSchema,
  actorType: Type.Union([
    Type.Literal('member'),
    Type.Literal('administrator'),
  ]),
  completedItems: Type.Array(ScrumSubmissionResultSchema, {
    maxItems: MAX_SCRUM_TODOS,
  }),
  extraItems: Type.Array(ScrumSubmissionResultSchema, { maxItems: 5 }),
  nextTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
});

export const DeleteScrumEntryBodySchema = Type.Object({
  authorId: DiscordIdSchema,
});

export const WeeklyReportThreadSchema = Type.Object({
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  missedReportCount: Type.Integer({ minimum: 0 }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const WeeklyPendingScrumSchema = Type.Object({
  scrumId: UuidSchema,
  projectName: Type.String({ minLength: 1, maxLength: 80 }),
  todos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    minItems: 1,
    maxItems: MAX_SCRUM_TODOS,
  }),
});

export const WeeklyReportPreviewSchema = Type.Object({
  weekStart: DateSchema,
  weekEnd: DateSchema,
  completedItems: Type.Array(ScrumResultSchema, { maxItems: 250 }),
  nextTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    maxItems: 250,
  }),
  pendingScrums: Type.Array(WeeklyPendingScrumSchema, { maxItems: 50 }),
  existingReportId: Type.Union([UuidSchema, Type.Null()]),
});

export const WeeklyReportSchema = Type.Object({
  id: UuidSchema,
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  weekStart: DateSchema,
  weekEnd: DateSchema,
  completedItems: Type.Array(ScrumResultSchema, { maxItems: 250 }),
  extraItems: Type.Array(ScrumResultSchema, { maxItems: 10 }),
  nextTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    maxItems: 250,
  }),
  pendingTodos: Type.Array(Type.String({ minLength: 1, maxLength: 1_500 }), {
    maxItems: 500,
  }),
  discordMessageIds: DiscordMessageIdsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CreateWeeklyReportBodySchema = Type.Object({
  id: UuidSchema,
  userId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  weekEnd: DateSchema,
  extraItems: Type.Array(ScrumSubmissionResultSchema, { maxItems: 10 }),
});

export const SyncWeeklyReportBodySchema = Type.Object({
  id: UuidSchema,
  userId: DiscordIdSchema,
  threadId: DiscordIdSchema,
  weekEnd: DateSchema,
});

export const UpdateWeeklyReportBodySchema = Type.Object({
  extraItems: Type.Array(ScrumSubmissionResultSchema, { maxItems: 10 }),
  discordMessageIds: DiscordMessageIdsSchema,
  actorType: Type.Optional(Type.Literal('administrator')),
});

export const DeleteWeeklyReportBodySchema = Type.Object({
  deletedBy: DiscordIdSchema,
  actorType: Type.Union([
    Type.Literal('owner'),
    Type.Literal('administrator'),
    Type.Literal('system'),
  ]),
  reason: Type.String({ minLength: 1, maxLength: 1_000 }),
});

export const ProcessWeeklyReportMissesBodySchema = Type.Object({
  weekEnd: DateSchema,
  userIds: Type.Array(DiscordIdSchema, {
    maxItems: 1_000,
    uniqueItems: true,
  }),
});

export const ProcessWeeklyReportMissesResponseSchema = Type.Object({
  weekEnd: DateSchema,
  incrementedUserIds: Type.Array(DiscordIdSchema, { maxItems: 1_000 }),
});

export const ProcessWeeklyReportRemindersBodySchema = Type.Object({
  weekEnd: DateSchema,
  userIds: Type.Array(DiscordIdSchema, {
    maxItems: 1_000,
    uniqueItems: true,
  }),
});

export const ProcessWeeklyReportRemindersResponseSchema = Type.Object({
  weekEnd: DateSchema,
  claimedUserIds: Type.Array(DiscordIdSchema, { maxItems: 1_000 }),
});

export const ErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
});

export type ChannelSettingType = Static<typeof ChannelSettingTypeSchema>;
export type ScrumCategory = Static<typeof ScrumCategorySchema>;
export type CreateScrumBody = Static<typeof CreateScrumBodySchema>;
export type CreateScrumRequestBody = Static<typeof CreateScrumRequestBodySchema>;
export type ApproveScrumRequestBody = Static<typeof ApproveScrumRequestBodySchema>;
export type CompleteScrumBody = Static<typeof CompleteScrumBodySchema>;
export type AbandonScrumBody = Static<typeof AbandonScrumBodySchema>;
export type DeleteScrumBody = Static<typeof DeleteScrumBodySchema>;
export type UpdateScrumCompletionResultsBody = Static<
  typeof UpdateScrumCompletionResultsBodySchema
>;
export type UpdateScrumMetadataBody = Static<
  typeof UpdateScrumMetadataBodySchema
>;
export type RejectScrumRequestBody = Static<typeof RejectScrumRequestBodySchema>;
export type SaveScrumEntryBody = Static<typeof SaveScrumEntryBodySchema>;
export type DeleteScrumEntryBody = Static<typeof DeleteScrumEntryBodySchema>;
export type Scrum = Static<typeof ScrumSchema>;
export type ScrumRequest = Static<typeof ScrumRequestSchema>;
export type ScrumAttachment = Static<typeof ScrumAttachmentSchema>;
export type ScrumEntry = Static<typeof ScrumEntrySchema>;
export type ScrumResult = Static<typeof ScrumResultSchema>;
export type UpdateScrumEntryResultsBody = Static<
  typeof UpdateScrumEntryResultsBodySchema
>;
export type UpdateScrumEntryBody = Static<
  typeof UpdateScrumEntryBodySchema
>;
export type WeeklyReportThread = Static<typeof WeeklyReportThreadSchema>;
export type WeeklyPendingScrum = Static<typeof WeeklyPendingScrumSchema>;
export type WeeklyReportPreview = Static<typeof WeeklyReportPreviewSchema>;
export type WeeklyReport = Static<typeof WeeklyReportSchema>;
export type CreateWeeklyReportBody = Static<
  typeof CreateWeeklyReportBodySchema
>;
export type SyncWeeklyReportBody = Static<
  typeof SyncWeeklyReportBodySchema
>;
export type UpdateWeeklyReportBody = Static<
  typeof UpdateWeeklyReportBodySchema
>;
export type DeleteWeeklyReportBody = Static<
  typeof DeleteWeeklyReportBodySchema
>;
export type ProcessWeeklyReportMissesBody = Static<
  typeof ProcessWeeklyReportMissesBodySchema
>;
export type ProcessWeeklyReportRemindersBody = Static<
  typeof ProcessWeeklyReportRemindersBodySchema
>;
