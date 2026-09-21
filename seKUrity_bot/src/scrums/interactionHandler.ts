import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type {
  Attachment,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ForumChannel,
  ForumThreadChannel,
  Guild,
  GuildBasedChannel,
  GuildTextBasedChannel,
  Interaction,
  InteractionReplyOptions,
  Message,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BackendApiError } from '../api/backendClient';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import {
  approveScrumRequest,
  createScrumRequest,
  getApproverRoleIds,
  getScrumRequestByApprovalThread,
  rejectScrumRequest,
} from './approvalStore';
import { isScrumCategory, ScrumCategory } from './categories';
import {
  buildApprovalDecisionRow,
  buildAbandonScrumModal,
  buildAdminMarkIncompleteModal,
  buildAdminDeleteExtraModal,
  buildCarryoverTodosModal,
  buildEntryEditActionRow,
  buildEntryExtraDeleteSelectRow,
  buildEntryExtraModal,
  buildEntryItemSelectRow,
  buildEntryItemEditModal,
  buildEntryNextTodosModal,
  buildEntryNextTodosRequiredRow,
  buildCompletionContinueRow,
  buildCompletionTodoPreview,
  buildCompletionTodoModal,
  buildContinueRow,
  buildEntryDetailRows,
  buildExtraDecisionRow,
  buildExtraDetailModal,
  buildInitialTodosEditModal,
  buildNewScrumContinueRow,
  buildNewScrumDetailsModal,
  buildNewScrumPlanningContinueRow,
  buildNewScrumPlanningModal,
  buildNewScrumTodosModal,
  buildNextTodosModal,
  buildRejectRequestModal,
  buildScrumCompletionRow,
  buildScrumEntryRows,
  buildScrumStartRow,
  buildScrumWriteRow,
  buildTodoPreview,
  buildTodoStepPreview,
  buildTodoModal,
  ScrumInputId,
} from './components';
import type { ScrumEntryDetailLink } from './components';
import { ScrumCustomId, parseSessionCustomId } from './customIds';
import {
  formatScrumDate,
  getCurrentWeeklyCycleEndKstDateString,
  getNextWeeklyScrumDateString,
} from './dateUtils';
import {
  buildApprovalRejectionEmbed,
  buildApprovalSuccessEmbed,
  buildScrumAbandonedEmbed,
  buildScrumCompletionSummaryEmbed,
  buildScrumRequestEmbed,
  buildScrumEntrySummaryEmbed,
  buildScrumExtraDeletionDmEmbed,
  buildScrumIntroEmbed,
  buildScrumItemDetailContent,
  buildScrumTodoEmbed,
  formatTaskRecordSaved,
} from './formatters';
import {
  ensureAndGetScrumCategoryTagId,
  ensureScrumCategoryTags,
  ForumTagConfigurationError,
} from './forumTags';
import {
  requiresPlanningDocument,
  validateProjectDocuments,
} from './planningDocument';
import {
  createNewScrumDraft,
  createScrumCompletionDraft,
  createScrumSession,
  createScrumEntryEditSession,
  deleteNewScrumDraft,
  deleteScrumCompletionDraft,
  deleteScrumSession,
  deleteScrumEntryEditSession,
  getNewScrumDraft,
  getScrumCompletionDraft,
  getScrumSession,
  getScrumEntryEditSession,
  type NewScrumDraft,
  type ScrumCompletionDraft,
  type ScrumSession,
  type ScrumEntryEditMode,
  type ScrumEntryEditSession,
} from './sessionStore';
import {
  abandonScrumByThread,
  completeScrumByThread,
  deleteScrumByThread,
  deleteScrumEntry,
  getActiveScrumByThread,
  getActiveScrumForUser,
  getLatestScrumEntryByThread,
  getScrumEntry,
  hasScrumEntryForDate,
  saveScrumEntry,
  updateScrumEntry,
  updateScrumCompletionResults,
  updateScrumEntryResults,
  updateScrumInitialTodos,
  updateScrumMetadata,
} from './scrumStore';
import { refreshScrumStartMessage } from './startMessageSync';
import {
  formatApprovalThreadName,
  formatScrumThreadName,
  hasEvidenceOrComment,
  parseHttpLinks,
  parseLines,
  replaceApprovalThreadStatus,
  replaceScrumThreadStatus,
  replaceScrumThreadTitle,
  truncateText,
} from './text';
import {
  APPROVAL_CHANNEL_REQUIRED_PERMISSIONS,
  SCRUM_CHANNEL_REQUIRED_PERMISSIONS,
} from './permissions';
import {
  syncCurrentWeeklyReportsForScrumLifecycle,
  syncWeeklyReportsForScrum,
} from '../weekly/syncService';
import type {
  Scrum,
  ScrumAttachment,
  ScrumEntry,
  ScrumRequest,
} from './types';

const MAX_TODOS = 20;
const MAX_EXTRA_ITEMS = 5;
const MAX_EVIDENCE_LINKS = 1;
const MAX_EVIDENCE_UPLOAD_BYTES = 24 * 1024 * 1024;
const BACKEND_RECONCILIATION_ATTEMPTS = 3;
const BACKEND_RECONCILIATION_DELAY_MS = 300;

type ModalLaunchInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | StringSelectMenuInteraction;

type NewScrumLaunchInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction;

export async function startNewScrumFromInteraction(
  interaction: NewScrumLaunchInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: '서버 안에서만 사용할 수 있는 명령어입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [scrumChannelId, approvalChannelId] = await Promise.all([
    getChannel(interaction.guildId, ChannelSettingType.Scrums),
    getChannel(interaction.guildId, ChannelSettingType.Approvals),
  ]);

  if (!scrumChannelId || !approvalChannelId) {
    await interaction.reply({
      content: '관리자가 `/setchannel type: scrums`와 `/setchannel type: approve`로 스크럼·승인 포럼을 먼저 설정해야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [scrumChannel, approvalChannel] = await Promise.all([
    interaction.guild?.channels.fetch(scrumChannelId),
    interaction.guild?.channels.fetch(approvalChannelId),
  ]);

  if (
    scrumChannel?.type !== ChannelType.GuildForum
    || approvalChannel?.type !== ChannelType.GuildForum
  ) {
    await interaction.reply({
      content: '설정된 스크럼 또는 승인 채널이 포럼이 아닙니다. 관리자가 채널 설정을 다시 지정해야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botUser = interaction.client.user;

  if (
    !scrumChannel.permissionsFor(botUser)?.has([
      ...SCRUM_CHANNEL_REQUIRED_PERMISSIONS,
    ])
    || !approvalChannel.permissionsFor(botUser)?.has([
      ...APPROVAL_CHANNEL_REQUIRED_PERMISSIONS,
    ])
  ) {
    await interaction.reply({
      content: '스크럼 또는 승인 포럼에서 봇의 채널·스레드 관리 및 메시지 권한이 부족합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await Promise.all([
      ensureScrumCategoryTags(scrumChannel),
      ensureScrumCategoryTags(approvalChannel),
    ]);
  } catch (error) {
    console.error('[scrum] Failed to prepare scrum category tags:', error);
    await interaction.reply({
      content: error instanceof ForumTagConfigurationError
        ? error.message
        : '스크럼 분류 태그를 준비하지 못했습니다. 관리자에게 포럼 설정 확인을 요청해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildNewScrumDetailsModal());
}

async function editReplyWithoutComponents(
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction,
  content: string,
): Promise<void> {
  await interaction.editReply({
    content,
    components: [],
  });
}

function isScrumHostChannel(channel: GuildBasedChannel | null): channel is ForumChannel {
  return channel?.type === ChannelType.GuildForum;
}

function serializeAttachment(attachment: Attachment): ScrumAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

function getUploadedAttachments(interaction: ModalSubmitInteraction, customId: string): ScrumAttachment[] {
  const attachments = interaction.fields.getUploadedFiles(customId, false);

  if (!attachments) {
    return [];
  }

  return [...attachments.values()].map(serializeAttachment);
}

function getEvidenceLinks(interaction: ModalSubmitInteraction, customId: string): {
  links: string[];
  error: string | null;
} {
  const parsed = parseHttpLinks(
    interaction.fields.getTextInputValue(customId),
    MAX_EVIDENCE_LINKS,
  );

  if (parsed.exceededLimit) {
    return {
      links: [],
      error: '증빙 링크는 1개만 입력할 수 있습니다.',
    };
  }

  if (parsed.invalidValues.length > 0) {
    return {
      links: [],
      error: '증빙 링크는 `http://` 또는 `https://`로 시작하는 주소를 한 줄에 하나씩 입력해 주세요.',
    };
  }

  if (parsed.links.join('\n').length > 1_000) {
    return {
      links: [],
      error: '정규화된 증빙 링크의 전체 길이는 1,000자 이하여야 합니다.',
    };
  }

  return {
    links: parsed.links,
    error: null,
  };
}

function isDiscordAttachmentUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'cdn.discordapp.com' || hostname === 'media.discordapp.net';
  } catch {
    return false;
  }
}

function makeAttachmentBatches(attachments: ScrumAttachment[]): ScrumAttachment[][] {
  const batches: ScrumAttachment[][] = [];
  let current: ScrumAttachment[] = [];
  let currentBytes = 0;

  for (const attachment of attachments) {
    if (
      attachment.size > MAX_EVIDENCE_UPLOAD_BYTES
      || !isDiscordAttachmentUrl(attachment.url)
    ) {
      continue;
    }

    if (
      current.length >= 10
      || currentBytes + attachment.size > MAX_EVIDENCE_UPLOAD_BYTES
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(attachment);
    currentBytes += attachment.size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

async function postEntryItemDetails(
  thread: GuildTextBasedChannel,
  results: Array<{
    title: string;
    comment: string;
    attachments: ScrumAttachment[];
    links: string[];
  }>,
  startIndex: number,
  markMissingEvidenceIncomplete: boolean,
): Promise<{
  links: ScrumEntryDetailLink[];
  failedUploads: number;
  messageIds: string[];
}> {
  const links: ScrumEntryDetailLink[] = [];
  const messageIds: string[] = [];
  let failedUploads = 0;

  for (const [resultIndex, result] of results.entries()) {
    const replacements = new Map<string, ScrumAttachment>();
    const batches = makeAttachmentBatches(result.attachments);
    const isIncomplete = markMissingEvidenceIncomplete
      && result.attachments.length === 0
      && result.links.length === 0;
    const buildDetailContent = (failedForItem = 0) =>
      buildScrumItemDetailContent({
        title: result.title,
        comment: result.comment,
        links: result.links,
        incomplete: isIncomplete,
        failedUploads: failedForItem,
      });
    const detailMessage = await thread.send({
      content: buildDetailContent(),
      allowedMentions: {
        parse: [],
      },
    });
    messageIds.push(detailMessage.id);

    for (const batch of batches) {
      try {
        const message = await thread.send({
          files: batch.map((attachment) => ({
            attachment: attachment.url,
            name: attachment.name,
          })),
          allowedMentions: {
            parse: [],
          },
        });
        const persisted = [...message.attachments.values()];
        messageIds.push(message.id);

        batch.forEach((attachment, index) => {
          const uploaded = persisted[index];

          if (uploaded) {
            replacements.set(attachment.id, serializeAttachment(uploaded));
          }
        });
      } catch (error) {
        console.error(
          `[scrum] Failed to persist attachments for item ${startIndex + resultIndex + 1} in ${thread.id}:`,
          error,
        );
      }
    }

    const failedForItem = result.attachments.filter((attachment) =>
      !replacements.has(attachment.id),
    ).length;
    failedUploads += failedForItem;
    result.attachments = result.attachments.map((attachment) =>
      replacements.get(attachment.id) ?? attachment,
    );

    if (failedForItem > 0) {
      await detailMessage.edit({
        content: buildDetailContent(failedForItem),
      });
    }

    links.push({
      label: `완료한 작업 ${startIndex + resultIndex + 1}`,
      url: detailMessage.url,
    });
  }

  return {
    links,
    failedUploads,
    messageIds,
  };
}

async function publishScrumEntry(
  thread: GuildTextBasedChannel,
  entry: ScrumEntry,
  userId: string,
): Promise<{ failedUploads: number; messageIds: string[] }> {
  const completedDetails = await postEntryItemDetails(
    thread,
    entry.completedItems,
    0,
    true,
  );
  const extraDetails = await postEntryItemDetails(
    thread,
    entry.extraItems,
    entry.completedItems.length,
    false,
  );
  const detailLinks = [
    ...completedDetails.links,
    ...extraDetails.links,
  ];
  const summaryMessage = await thread.send({
    embeds: [buildScrumEntrySummaryEmbed(entry)],
    components: buildScrumEntryRows(detailLinks, entry.id),
    allowedMentions: {
      users: [userId],
    },
  });
  const messageIds = [
    ...completedDetails.messageIds,
    ...extraDetails.messageIds,
    summaryMessage.id,
  ];

  await updateScrumEntryResults(
    entry.id,
    entry.completedItems,
    entry.extraItems,
    messageIds,
  );

  return {
    failedUploads:
      completedDetails.failedUploads + extraDetails.failedUploads,
    messageIds,
  };
}

async function replacePublishedScrumEntry(
  thread: GuildTextBasedChannel,
  entry: ScrumEntry,
): Promise<{ failedDeletes: number; failedUploads: number }> {
  const oldMessageIds = [...entry.discordMessageIds];
  const previousMessages = new Map<string, Message>();
  const refreshedAttachments = new Map<string, ScrumAttachment>();

  for (const messageId of oldMessageIds) {
    try {
      const message = await thread.messages.fetch(messageId);
      previousMessages.set(messageId, message);

      for (const attachment of message.attachments.values()) {
        refreshedAttachments.set(
          attachment.id,
          serializeAttachment(attachment),
        );
      }
    } catch {
      // The later deletion pass reports unavailable previous messages.
    }
  }

  for (const result of [...entry.completedItems, ...entry.extraItems]) {
    result.attachments = result.attachments.map((attachment) =>
      refreshedAttachments.get(attachment.id) ?? attachment,
    );
  }

  const published = await publishScrumEntry(
    thread,
    entry,
    entry.authorId,
  );
  const preservedMessageIds = published.failedUploads > 0
    ? oldMessageIds.filter((messageId) =>
      (previousMessages.get(messageId)?.attachments.size ?? 0) > 0)
    : [];
  const preservedMessageIdSet = new Set(preservedMessageIds);
  let failedDeletes = 0;

  for (const messageId of oldMessageIds) {
    if (preservedMessageIdSet.has(messageId)) {
      continue;
    }

    try {
      const message = previousMessages.get(messageId)
        ?? await thread.messages.fetch(messageId);
      await message.delete();
    } catch (error) {
      failedDeletes += 1;
      console.warn(
        `[scrum] Failed to replace entry message ${messageId}:`,
        error,
      );
    }
  }

  if (preservedMessageIds.length > 0) {
    await updateScrumEntryResults(
      entry.id,
      entry.completedItems,
      entry.extraItems,
      [...preservedMessageIds, ...published.messageIds],
    );
  }

  return {
    failedDeletes,
    failedUploads: published.failedUploads,
  };
}

async function collectEntryDetailLinks(
  thread: GuildTextBasedChannel,
  entry: ScrumEntry,
): Promise<ScrumEntryDetailLink[]> {
  const links: ScrumEntryDetailLink[] = [];

  for (const messageId of entry.discordMessageIds) {
    try {
      const message = await thread.messages.fetch(messageId);

      if (!message.content.startsWith('## ')) {
        continue;
      }

      links.push({
        label: `완료한 작업 ${links.length + 1}`,
        url: message.url,
      });
    } catch {
      // Missing evidence messages are omitted from navigation.
    }
  }

  return links;
}

function getRequiredSession(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  sessionId: string,
): ScrumSession | null {
  const session = getScrumSession(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    return null;
  }

  return session;
}

async function rejectOutsideScheduledDate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: ScrumSession,
): Promise<boolean> {
  const currentScrumDate = getCurrentWeeklyCycleEndKstDateString();

  if (currentScrumDate === session.scrumDate) {
    return false;
  }

  deleteScrumSession(session.id);

  const response = {
    content: [
      `이 작성 세션의 마감은 ${formatScrumDate(session.scrumDate)}이었습니다.`,
      `현재 작성 가능한 스크럼 마감은 ${formatScrumDate(currentScrumDate)}입니다.`,
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  } satisfies InteractionReplyOptions;

  await interaction.reply(response);

  return true;
}

async function replyWithContinue(
  interaction: ModalSubmitInteraction,
  session: ScrumSession,
  content: string,
  buttonLabel: string,
): Promise<void> {
  const response = {
    content,
    components: [buildContinueRow(session.id, buttonLabel)],
    allowedMentions: {
      parse: [],
    },
  };

  if (interaction.isFromMessage()) {
    await interaction.update(response);
    return;
  }

  await interaction.reply({
    ...response,
    flags: MessageFlags.Ephemeral,
  });
}

async function replyWithExtraDecision(
  interaction: ModalSubmitInteraction,
  session: ScrumSession,
  notice?: string,
): Promise<void> {
  const canAddMore = session.currentExtraIndex < MAX_EXTRA_ITEMS;
  const needsCarryover = session.todoResults.some((result) =>
    result.attachments.length === 0
    && result.links.length === 0,
  );
  const prompt = session.extraResults.length === 0
    ? '예정된 작업에 대한 기록을 모두 저장했습니다. 추가로 완료한 작업이 있나요?'
    : canAddMore
      ? `추가 완료 작업 ${session.extraResults.length}개를 저장했습니다. 더 있나요?`
      : `추가 완료 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 저장했습니다. 다음 단계로 진행해 주세요.`;
  const content = notice
    ? `${notice}\n\n${prompt}`
    : prompt;
  const response = {
    content,
    components: [buildExtraDecisionRow(
      session.id,
      canAddMore,
      needsCarryover,
    )],
    allowedMentions: {
      parse: [],
    },
  };

  if (interaction.isFromMessage()) {
    await interaction.update(response);
    return;
  }

  await interaction.reply({
    ...response,
    flags: MessageFlags.Ephemeral,
  });
}

async function replyWithTodoRetry(
  interaction: ModalSubmitInteraction,
  session: ScrumSession,
  index: number,
  error: string,
): Promise<void> {
  await replyWithContinue(
    interaction,
    session,
    [
      error,
      '',
      buildTodoStepPreview(
        session.scrum.currentTodos,
        index,
      ),
    ].join('\n'),
    '작업 기록 다시 작성',
  );
}

async function showCurrentSessionModal(interaction: ModalLaunchInteraction, session: ScrumSession): Promise<void> {
  if (session.phase === 'todo') {
    const todo = session.scrum.currentTodos[session.currentTodoIndex];
    await interaction.showModal(buildTodoModal(
      session.id,
      session.currentTodoIndex,
      session.scrum.currentTodos.length,
      todo,
    ));
    return;
  }

  if (session.phase === 'extra-decision') {
    if (session.currentExtraIndex >= MAX_EXTRA_ITEMS) {
      if (interaction.isButton()) {
        await interaction.update({
          content: `추가 완료 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 저장할 수 있습니다. 다음 단계로 진행해 주세요.`,
          components: [buildExtraDecisionRow(
            session.id,
            false,
            session.todoResults.some((result) =>
              result.attachments.length === 0
              && result.links.length === 0,
            ),
          )],
        });
      }
      return;
    }

    await interaction.showModal(buildExtraDetailModal(
      session.id,
      session.currentExtraIndex,
    ));
    return;
  }

  await interaction.showModal(buildNextTodosModal(
    session.id,
    session.nextScrumDate,
    session.carryoverTodos,
  ));
}

export async function startScrumSessionFromInteraction(
  interaction: ModalLaunchInteraction,
  scrum: Scrum,
): Promise<void> {
  const scrumDate = getCurrentWeeklyCycleEndKstDateString();

  if (await hasScrumEntryForDate(scrum.id, scrumDate)) {
    await interaction.reply({
      content: [
        '이번 주 스크럼이 이미 작성돼있습니다.',
        `다음 스크럼 마감은 ${formatScrumDate(getNextWeeklyScrumDateString(scrumDate))}입니다.`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (scrum.nextScrumDate > scrumDate) {
    await interaction.reply({
      content: [
        `이 스크럼의 첫 마감은 ${formatScrumDate(scrum.nextScrumDate)}입니다.`,
        `현재 작성 가능한 스크럼 마감은 ${formatScrumDate(scrumDate)}입니다.`,
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = createScrumSession({
    guildId: interaction.guildId!,
    userId: interaction.user.id,
    scrum,
    scrumDate,
    nextScrumDate: getNextWeeklyScrumDateString(scrumDate),
  });

  await interaction.reply({
    content: buildTodoPreview(scrum, scrumDate),
    components: session.phase === 'todo'
      ? [buildContinueRow(session.id, '작업 기록')]
      : [buildExtraDecisionRow(session.id)],
    allowedMentions: {
      parse: [],
    },
    flags: MessageFlags.Ephemeral,
  });
}

function getRequiredNewScrumDraft(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  draftId: string,
): NewScrumDraft | null {
  const draft = getNewScrumDraft(draftId);

  if (!draft || draft.userId !== interaction.user.id || draft.guildId !== interaction.guildId) {
    return null;
  }

  return draft;
}

async function handleNewScrumDetailsModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '서버 안에서만 사용할 수 있는 기능입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [scrumChannelId, approvalChannelId] = await Promise.all([
    getChannel(interaction.guildId, ChannelSettingType.Scrums),
    getChannel(interaction.guildId, ChannelSettingType.Approvals),
  ]);

  if (!scrumChannelId || !approvalChannelId) {
    await interaction.reply({
      content: '관리자가 스크럼과 승인 포럼을 먼저 설정해야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const projectName = interaction.fields.getTextInputValue(ScrumInputId.ProjectName).trim();
  const overview = interaction.fields.getTextInputValue(ScrumInputId.Overview).trim();
  const [categoryValue] = interaction.fields.getStringSelectValues(
    ScrumInputId.Category,
  );

  if (
    !projectName
    || !overview
    || !categoryValue
    || !isScrumCategory(categoryValue)
  ) {
    await interaction.reply({
      content: '스크럼 구분, 제목, 개요를 모두 입력해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const draft = createNewScrumDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    projectName,
    overview,
    category: categoryValue,
    planningDocument: null,
    projectScoreDocument: null,
  });
  const needsPlanningDocument = requiresPlanningDocument(categoryValue);
  const documentPrompt = categoryValue === ScrumCategory.Project
    ? '프로젝트 정보를 저장했습니다. 기획서 PDF와 PROJECT:SCORE 결과 Markdown 파일을 첨부해 주세요.'
    : '개인 스터디 정보를 저장했습니다. 기획서 PDF를 첨부해 주세요.';

  await interaction.reply({
    content: needsPlanningDocument
      ? documentPrompt
      : '스크럼 정보를 저장했습니다. 첫 스크럼까지 진행할 작업을 입력해 주세요.',
    components: needsPlanningDocument
      ? [buildNewScrumPlanningContinueRow(draft.id)]
      : [buildNewScrumContinueRow(draft.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleNewScrumPlanningContinueButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (
    !parsed
    || parsed.prefix !== ScrumCustomId.NewScrumPlanningContinue
  ) {
    return;
  }

  const draft = getRequiredNewScrumDraft(interaction, parsed.sessionId);

  if (!draft || !requiresPlanningDocument(draft.category)) {
    await interaction.reply({
      content: '스크럼 작성 정보가 만료되었습니다. `/newscrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildNewScrumPlanningModal(
    draft.id,
    draft.category,
  ));
}

async function handleNewScrumPlanningModal(
  interaction: ModalSubmitInteraction,
  draft: NewScrumDraft,
): Promise<void> {
  if (!requiresPlanningDocument(draft.category)) {
    await interaction.reply({
      content: '선택한 스크럼 유형에는 제출 파일 단계가 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const planningDocuments = getUploadedAttachments(
    interaction,
    ScrumInputId.PlanningDocument,
  );
  const projectScoreDocuments = draft.category === ScrumCategory.Project
    ? getUploadedAttachments(
      interaction,
      ScrumInputId.ProjectScoreDocument,
    )
    : [];
  const planningDocumentError = validateProjectDocuments(
    draft.category,
    planningDocuments,
    projectScoreDocuments,
  );

  if (planningDocumentError) {
    await interaction.reply({
      content: planningDocumentError,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  draft.planningDocument = planningDocuments[0] ?? null;
  draft.projectScoreDocument = projectScoreDocuments[0] ?? null;

  await interaction.reply({
    content: '제출 파일을 저장했습니다. 첫 스크럼까지 진행할 작업을 입력해 주세요.',
    components: [buildNewScrumContinueRow(draft.id)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleNewScrumContinueButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (!parsed || parsed.prefix !== ScrumCustomId.NewScrumContinue) {
    return;
  }

  const draft = getRequiredNewScrumDraft(interaction, parsed.sessionId);

  if (!draft) {
    await interaction.reply({
      content: '새 스크럼 작성 정보가 만료되었습니다. `/newscrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildNewScrumTodosModal(
    draft.id,
    getCurrentWeeklyCycleEndKstDateString(),
  ));
}

async function handleNewScrumTodosModal(
  interaction: ModalSubmitInteraction,
  draft: NewScrumDraft,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '서버 안에서만 사용할 수 있는 기능입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const planningDocumentError = validateProjectDocuments(
    draft.category,
    draft.planningDocument ? [draft.planningDocument] : [],
    draft.projectScoreDocument ? [draft.projectScoreDocument] : [],
  );

  if (planningDocumentError) {
    await interaction.reply({
      content: `${planningDocumentError} \`/newscrum\`으로 다시 시작해 주세요.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsedTodos = parseLines(
    interaction.fields.getTextInputValue(ScrumInputId.Todos),
    MAX_TODOS + 1,
  );
  const currentTodos = parsedTodos.slice(0, MAX_TODOS);

  if (currentTodos.length === 0) {
    await interaction.reply({
      content: '첫 스크럼까지 진행할 작업을 최소 1개 입력해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsedTodos.length > MAX_TODOS) {
    await interaction.reply({
      content: `진행할 작업은 최대 ${MAX_TODOS}개까지 입력할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [scrumChannelId, approvalChannelId] = await Promise.all([
    getChannel(interaction.guildId, ChannelSettingType.Scrums),
    getChannel(interaction.guildId, ChannelSettingType.Approvals),
  ]);

  if (!scrumChannelId || !approvalChannelId) {
    await interaction.reply({
      content: '스크럼 또는 승인 포럼 설정이 해제되었습니다. 관리자에게 채널 설정을 요청해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const approvalChannel = await fetchScrumHostChannel(
    interaction.guild,
    approvalChannelId,
  );

  if (!approvalChannel) {
    await editReplyWithoutComponents(
      interaction,
      '설정된 승인 채널을 찾을 수 없거나 포럼 채널이 아닙니다.',
    );
    return;
  }

  const botMember = interaction.guild.members.me
    ?? await interaction.guild.members.fetchMe();
  const permissions = approvalChannel.permissionsFor(botMember);

  if (!permissions.has([...APPROVAL_CHANNEL_REQUIRED_PERMISSIONS])) {
    await editReplyWithoutComponents(
      interaction,
      '승인 포럼에서 채널 및 스레드 관리, 게시물 생성, 스레드 메시지 전송, 파일 첨부, 메시지 기록 보기 권한이 필요합니다.',
    );
    return;
  }

  let approvalTagId: string;

  try {
    approvalTagId = await ensureAndGetScrumCategoryTagId(
      approvalChannel,
      draft.category,
    );
  } catch (error) {
    console.error(
      `[scrum] Failed to prepare category tag in approval forum ${approvalChannel.id}:`,
      error,
    );
    await editReplyWithoutComponents(
      interaction,
      error instanceof ForumTagConfigurationError
        ? error.message
        : '승인 포럼의 스크럼 분류 태그를 준비하지 못했습니다.',
    );
    return;
  }

  const requesterName = interaction.guild.members.cache
    .get(interaction.user.id)?.displayName
    ?? interaction.user.displayName;
  const requestInput = {
    guildId: interaction.guildId,
    approvalChannelId,
    creatorId: interaction.user.id,
    projectName: draft.projectName,
    overview: draft.overview,
    category: draft.category,
    planningDocument: draft.planningDocument,
    projectScoreDocument: draft.projectScoreDocument,
    currentTodos,
  };
  const requestEmbed = buildScrumRequestEmbed(requestInput);
  const requestedDocuments = [
    draft.planningDocument,
    draft.projectScoreDocument,
  ].filter((document): document is ScrumAttachment => document !== null);
  let post: ForumThreadChannel | null = null;
  let persistedPlanningDocument: ScrumAttachment | null = null;
  let persistedProjectScoreDocument: ScrumAttachment | null = null;

  try {
    post = await approvalChannel.threads.create({
      name: formatApprovalThreadName(requesterName, draft.projectName),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      appliedTags: [approvalTagId],
      message: {
        embeds: [requestEmbed],
        components: [buildApprovalDecisionRow()],
        ...(requestedDocuments.length > 0
          ? {
            files: requestedDocuments.map((document) => ({
                attachment: document.url,
                name: document.name,
              })),
          }
          : {}),
        allowedMentions: {
          users: [interaction.user.id],
        },
      },
      reason: `Scrum approval requested by ${interaction.user.tag}`,
    });

    if (requestedDocuments.length > 0) {
      const starterMessage = await post.fetchStarterMessage();
      const uploadedDocuments = starterMessage
        ? [...starterMessage.attachments.values()]
        : [];

      if (uploadedDocuments.length !== requestedDocuments.length) {
        throw new Error('The approval post did not retain all submitted documents.');
      }

      let uploadedIndex = 0;

      if (draft.planningDocument) {
        persistedPlanningDocument = serializeAttachment(
          uploadedDocuments[uploadedIndex++]!,
        );
      }

      if (draft.projectScoreDocument) {
        persistedProjectScoreDocument = serializeAttachment(
          uploadedDocuments[uploadedIndex]!,
        );
      }
    }
  } catch (error) {
    console.error(`[scrum] Failed to create approval post in ${approvalChannel.id}:`, error);

    if (post) {
      try {
        await post.delete('Failed to finish the scrum approval request.');
      } catch (deleteError) {
        console.error(`[scrum] Failed to remove incomplete approval post ${post.id}:`, deleteError);
      }
    }

    await editReplyWithoutComponents(
      interaction,
      '스크럼 승인 요청 게시물을 생성하지 못했습니다.',
    );
    return;
  }

  if (!post) {
    await editReplyWithoutComponents(
      interaction,
      '스크럼 승인 요청 게시물을 생성하지 못했습니다.',
    );
    return;
  }

  try {
    await createScrumRequest({
      ...requestInput,
      planningDocument: persistedPlanningDocument,
      projectScoreDocument: persistedProjectScoreDocument,
      approvalThreadId: post.id,
    });
  } catch (error) {
    console.error(`[scrum] Failed to persist approval request ${post.id}:`, error);
    const reconciled = await reconcileCreatedRequest(post.id);

    if (reconciled.state === 'found') {
      console.warn(
        `[scrum] Recovered approval request ${post.id} after a lost API response.`,
      );
    } else if (reconciled.state === 'unavailable') {
      await editReplyWithoutComponents(interaction, [
        'Backend 응답을 확인하지 못해 승인 요청 저장 여부를 확정할 수 없습니다.',
        `<#${post.id}> 게시물은 데이터 유실을 막기 위해 유지했습니다. Backend 복구 후 다시 확인해 주세요.`,
      ].join('\n'));
      return;
    } else {
      try {
        await post.delete('Backend failed to persist the scrum approval request.');
      } catch (deleteError) {
        console.error(`[scrum] Failed to remove orphaned approval post ${post.id}:`, deleteError);
      }

      await editReplyWithoutComponents(
        interaction,
        'Backend에 승인 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
      return;
    }
  }

  try {
    await post.members.add(interaction.user.id);
  } catch (error) {
    console.warn(
      `[scrum] Failed to add requester ${interaction.user.id} to approval post ${post.id}:`,
      error,
    );
  }

  deleteNewScrumDraft(draft.id);
  await editReplyWithoutComponents(
    interaction,
    `스크럼 승인 요청을 등록했습니다.\n승인 후 스크럼 포럼 게시물이 생성됩니다.`,
  );
}

async function fetchScrumHostChannel(guild: Guild, channelId: string): Promise<ForumChannel | null> {
  const channel = await guild.channels.fetch(channelId);

  if (!isScrumHostChannel(channel)) {
    return null;
  }

  return channel;
}

async function fetchThreadChannel(interaction: ModalSubmitInteraction, scrum: Scrum): Promise<GuildTextBasedChannel | null> {
  const channel = await interaction.client.channels.fetch(scrum.threadId);

  if (!channel?.isThread()) {
    return null;
  }

  return channel;
}

async function canReviewScrumRequest(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.guildId || !interaction.guild) {
    return false;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const roleIds = await getApproverRoleIds(interaction.guildId);
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function editApprovalStarterMessage(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  approvalThreadId: string,
  request: ScrumRequest,
  decision: {
    status: 'approved' | 'rejected';
    reviewerId: string;
    scrumThreadId?: string;
    rejectionReason?: string;
  },
): Promise<boolean> {
  try {
    const channel = await interaction.client.channels.fetch(approvalThreadId);

    if (!channel?.isThread()) {
      return false;
    }

    const starterMessage = await channel.fetchStarterMessage();

    if (!starterMessage) {
      return false;
    }

    await Promise.all([
      channel.setName(
        replaceApprovalThreadStatus(channel.name, decision.status),
        `Scrum request ${decision.status}`,
      ),
      starterMessage.edit({
        content: null,
        embeds: [buildScrumRequestEmbed(request, decision)],
        components: [],
        allowedMentions: {
          parse: [],
        },
      }),
    ]);

    await channel.setArchived(
      true,
      `Scrum request ${decision.status} by ${decision.reviewerId}`,
    );

    return true;
  } catch (error) {
    console.error(
      `[scrum] Failed to update approval post ${approvalThreadId}:`,
      error,
    );
    return false;
  }
}

function isAlreadyReviewedError(error: unknown): boolean {
  return error instanceof BackendApiError
    && error.status === 409
    && error.code === 'SCRUM_REQUEST_ALREADY_REVIEWED';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type ReconciliationResult<T> =
  | { state: 'found'; value: T }
  | { state: 'missing' }
  | { state: 'unavailable' };

async function reconcileCreatedRequest(
  approvalThreadId: string,
): Promise<ReconciliationResult<ScrumRequest>> {
  let backendReached = false;

  for (let attempt = 0; attempt < BACKEND_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const request = await getScrumRequestByApprovalThread(approvalThreadId);
      backendReached = true;

      if (request) {
        return { state: 'found', value: request };
      }
    } catch (error) {
      console.warn(
        `[scrum] Failed to reconcile approval request ${approvalThreadId}:`,
        error,
      );
    }

    if (attempt + 1 < BACKEND_RECONCILIATION_ATTEMPTS) {
      await delay(BACKEND_RECONCILIATION_DELAY_MS);
    }
  }

  return backendReached
    ? { state: 'missing' }
    : { state: 'unavailable' };
}

async function reconcileApprovedRequest(
  approvalThreadId: string,
  scrumThreadId: string,
): Promise<ReconciliationResult<{
  request: ScrumRequest;
  scrum: Scrum;
}>> {
  let backendReached = false;

  for (let attempt = 0; attempt < BACKEND_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const request = await getScrumRequestByApprovalThread(approvalThreadId);
      backendReached = true;

      if (request?.status === 'approved') {
        const scrum = await getActiveScrumByThread(scrumThreadId);

        if (scrum && request.scrumId === scrum.id) {
          return {
            state: 'found',
            value: { request, scrum },
          };
        }

        return { state: 'missing' };
      }

      if (request?.status === 'rejected') {
        return { state: 'missing' };
      }
    } catch (error) {
      console.warn(
        `[scrum] Failed to reconcile approved request ${approvalThreadId}:`,
        error,
      );
    }

    if (attempt + 1 < BACKEND_RECONCILIATION_ATTEMPTS) {
      await delay(BACKEND_RECONCILIATION_DELAY_MS);
    }
  }

  return backendReached
    ? { state: 'missing' }
    : { state: 'unavailable' };
}

async function handleApproveRequestButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild || !interaction.channelId) {
    await interaction.reply({
      content: '서버의 승인 포럼 안에서만 처리할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!await canReviewScrumRequest(interaction)) {
    await interaction.reply({
      content: '스크럼 승인 역할 또는 `Administrator` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getScrumRequestByApprovalThread(
    interaction.channelId,
  );

  if (
    !request
    || request.guildId !== interaction.guildId
    || request.status !== 'pending'
  ) {
    await interaction.reply({
      content: request
        ? '이미 처리된 스크럼 승인 요청입니다.'
        : '이 게시물에 연결된 스크럼 승인 요청을 찾을 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const scrumChannelId = await getChannel(
    interaction.guildId,
    ChannelSettingType.Scrums,
  );

  if (!scrumChannelId) {
    await editReplyWithoutComponents(interaction, '스크럼 포럼 설정이 없습니다.');
    return;
  }

  const scrumChannel = await fetchScrumHostChannel(
    interaction.guild,
    scrumChannelId,
  );

  if (!scrumChannel) {
    await editReplyWithoutComponents(
      interaction,
      '설정된 스크럼 채널이 포럼이 아닙니다.',
    );
    return;
  }

  const botMember = interaction.guild.members.me
    ?? await interaction.guild.members.fetchMe();
  const permissions = scrumChannel.permissionsFor(botMember);

  if (!permissions.has([...SCRUM_CHANNEL_REQUIRED_PERMISSIONS])) {
    await editReplyWithoutComponents(
      interaction,
      '스크럼 포럼에서 게시물 생성, 메시지 전송, 파일 첨부, 링크 임베드, 메시지 기록 보기와 고정 권한이 필요합니다.',
    );
    return;
  }

  let categoryTagId: string;

  try {
    categoryTagId = await ensureAndGetScrumCategoryTagId(
      scrumChannel,
      request.category,
    );
  } catch (error) {
    console.error(
      `[scrum] Failed to prepare category tag in scrum forum ${scrumChannel.id}:`,
      error,
    );
    await editReplyWithoutComponents(
      interaction,
      error instanceof ForumTagConfigurationError
        ? error.message
        : '스크럼 포럼의 분류 태그를 준비하지 못했습니다.',
    );
    return;
  }

  const nextScrumDate = getCurrentWeeklyCycleEndKstDateString();
  const intro = {
    projectName: request.projectName,
    ownerIds: [request.creatorId],
    category: request.category,
    overview: request.overview,
    currentTodos: request.currentTodos,
    planningDocument: request.planningDocument,
    projectScoreDocument: request.projectScoreDocument,
    nextScrumDate,
  };
  const introEmbed = buildScrumIntroEmbed(intro);
  const todoEmbed = buildScrumTodoEmbed(intro);
  let requester = null;
  let requesterName = request.creatorId;

  try {
    const requesterMember = await interaction.guild.members.fetch(request.creatorId);
    requester = requesterMember.user;
    requesterName = requesterMember.displayName;
  } catch (error) {
    console.warn(
      `[scrum] Failed to fetch requester member ${request.creatorId}:`,
      error,
    );

    try {
      requester = await interaction.client.users.fetch(request.creatorId);
      requesterName = requester.displayName;
    } catch (userError) {
      console.warn(
        `[scrum] Failed to fetch requester user ${request.creatorId}:`,
        userError,
      );
    }
  }

  let post: ForumThreadChannel | null = null;
  const scrumDocuments = [
    request.planningDocument,
    request.projectScoreDocument,
  ].filter((document): document is ScrumAttachment => document !== null);

  try {
    post = await scrumChannel.threads.create({
      name: formatScrumThreadName(requesterName, request.projectName),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      appliedTags: [categoryTagId],
      message: {
        embeds: [introEmbed],
        components: [buildScrumCompletionRow()],
        ...(scrumDocuments.length > 0
          ? {
            files: scrumDocuments.map((document) => ({
                attachment: document.url,
                name: document.name,
              })),
          }
          : {}),
        allowedMentions: {
          users: [request.creatorId],
        },
      },
      reason: `Scrum approved by ${interaction.user.tag}`,
    });
    await post.send({
      embeds: [todoEmbed],
      components: [buildScrumStartRow()],
    });
  } catch (error) {
    console.error(
      `[scrum] Failed to create approved scrum post in ${scrumChannel.id}:`,
      error,
    );

    if (post) {
      try {
        await post.delete('Failed to finish the approved scrum post.');
      } catch (deleteError) {
        console.error(
          `[scrum] Failed to remove incomplete scrum post ${post.id}:`,
          deleteError,
        );
      }
    }

    await editReplyWithoutComponents(
      interaction,
      '승인된 스크럼 게시물을 생성하지 못했습니다.',
    );
    return;
  }

  if (!post) {
    await editReplyWithoutComponents(
      interaction,
      '승인된 스크럼 게시물을 생성하지 못했습니다.',
    );
    return;
  }

  let approved: { request: ScrumRequest; scrum: Scrum } | null = null;

  try {
    approved = await approveScrumRequest({
      approvalThreadId: request.approvalThreadId,
      reviewerId: interaction.user.id,
      scrumChannelId,
      threadId: post.id,
      nextScrumDate,
    });
  } catch (error) {
    const reconciled = await reconcileApprovedRequest(
      request.approvalThreadId,
      post.id,
    );

    if (reconciled.state === 'found') {
      approved = reconciled.value;
      console.warn(
        `[scrum] Recovered approval ${request.approvalThreadId} after a lost API response.`,
      );
    } else if (reconciled.state === 'unavailable') {
      await editReplyWithoutComponents(interaction, [
        'Backend 응답을 확인하지 못해 승인 상태를 확정할 수 없습니다.',
        `<#${post.id}> 게시물은 데이터 유실을 막기 위해 유지했습니다. Backend 복구 후 승인 요청 상태를 확인해 주세요.`,
      ].join('\n'));
      return;
    } else {
      try {
        await post.delete('Backend failed to approve the scrum request.');
      } catch (deleteError) {
        console.error(
          `[scrum] Failed to remove orphaned approved post ${post.id}:`,
          deleteError,
        );
      }

      if (isAlreadyReviewedError(error)) {
        await editReplyWithoutComponents(
          interaction,
          '다른 승인자가 먼저 이 요청을 처리했습니다.',
        );
        return;
      }

      throw error;
    }
  }

  if (!approved) {
    throw new Error(`Approval ${request.approvalThreadId} returned no result.`);
  }

  try {
    await syncCurrentWeeklyReportsForScrumLifecycle({
      client: interaction.client,
      guild: interaction.guild,
      userIds: approved.scrum.ownerIds,
      createIfMissing: true,
    });
  } catch (error) {
    console.error(
      `[weekly] Failed to synchronize newly approved scrum ${approved.scrum.id}:`,
      error,
    );
  }

  try {
    await post.members.add(request.creatorId);
  } catch (error) {
    console.warn(
      `[scrum] Failed to add creator ${request.creatorId} to ${post.id}:`,
      error,
    );
  }

  const introMessages: Message[] = [];

  try {
    const starterMessage = await post.fetchStarterMessage();

    if (starterMessage) {
      introMessages.unshift(starterMessage);
    }
  } catch (error) {
    console.warn(`[scrum] Failed to fetch starter message for ${post.id}:`, error);
  }

  const pinResults = await Promise.allSettled(
    introMessages.map((message) => message.pin()),
  );
  const pinFailed = introMessages.length === 0
    || pinResults.some((result) => result.status === 'rejected');
  const approvalPostUpdated = await editApprovalStarterMessage(
    interaction,
    request.approvalThreadId,
    approved.request,
    {
      status: 'approved',
      reviewerId: interaction.user.id,
      scrumThreadId: post.id,
    },
  );
  let dmSent = true;

  try {
    requester ??= await interaction.client.users.fetch(request.creatorId);
    await requester.send({
      embeds: [buildApprovalSuccessEmbed({
        projectName: approved.scrum.projectName,
        category: approved.scrum.category,
        guildName: interaction.guild.name,
        postUrl: post.url,
      })],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    dmSent = false;
    console.warn(
      `[scrum] Failed to DM approval result to ${request.creatorId}:`,
      error,
    );
  }

  await editReplyWithoutComponents(interaction, [
    `<#${post.id}> 스크럼을 승인했습니다.`,
    dmSent
      ? '신청자에게 승인 완료 임베드를 DM으로 전송했습니다.'
      : '신청자의 DM이 닫혀 있어 승인 완료 임베드를 전송하지 못했습니다.',
    pinFailed ? '스크럼 소개 메시지 일부를 고정하지 못했습니다.' : '',
    approvalPostUpdated ? '' : '승인 요청 게시물의 상태 표시는 갱신하지 못했습니다.',
  ].filter(Boolean).join('\n'));
}

async function handleAbandonScrumButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (
    !interaction.guildId
    || !interaction.channelId
    || !interaction.channel?.isThread()
  ) {
    await interaction.reply({
      content: '서버의 스크럼 게시물 안에서만 포기할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrum = await getActiveScrumByThread(interaction.channelId);

  if (!scrum || scrum.guildId !== interaction.guildId) {
    await interaction.reply({
      content: '이미 종료되었거나 이 게시물에 연결된 활성 스크럼이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!scrum.ownerIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: '스크럼 참여자만 스크럼을 포기할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildAbandonScrumModal(interaction.channelId));
}

async function handleAbandonScrumModal(
  interaction: ModalSubmitInteraction,
  threadId: string,
): Promise<void> {
  if (
    !interaction.guildId
    || interaction.channelId !== threadId
    || !interaction.channel?.isThread()
  ) {
    await interaction.reply({
      content: '스크럼 게시물 안에서 다시 시도해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(ScrumInputId.AbandonmentReason)
    .trim();
  const [disposition] = interaction.fields.getStringSelectValues(
    ScrumInputId.AbandonmentDisposition,
  );

  if (!reason) {
    await interaction.reply({
      content: '스크럼 포기 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (disposition !== 'archive' && disposition !== 'delete') {
    await interaction.reply({
      content: '스크럼 포기 후 처리 방식을 선택해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (disposition === 'delete') {
    let deleted: Scrum;

    try {
      deleted = await deleteScrumByThread(
        threadId,
        interaction.user.id,
        reason,
      );
    } catch (error) {
      if (error instanceof BackendApiError) {
        await editReplyWithoutComponents(
          interaction,
          error.status === 403
            ? '스크럼 참여자만 스크럼을 삭제할 수 있습니다.'
            : error.status === 409
              ? '이미 종료된 스크럼입니다.'
              : error.status === 404
                ? '삭제할 스크럼을 찾을 수 없습니다.'
                : '스크럼을 완전히 삭제하지 못했습니다.',
        );
        return;
      }

      throw error;
    }

    let weeklySyncFailed = false;

    if (interaction.guild) {
      try {
        await syncCurrentWeeklyReportsForScrumLifecycle({
          client: interaction.client,
          guild: interaction.guild,
          userIds: deleted.ownerIds,
          createIfMissing: false,
        });
      } catch (error) {
        weeklySyncFailed = true;
        console.error(
          `[weekly] Failed to synchronize deleted scrum ${deleted.id}:`,
          error,
        );
      }
    }

    let postDeleted = true;

    try {
      await interaction.channel.delete(
        `Scrum deleted through abandonment by ${interaction.user.tag}: ${reason}`,
      );
    } catch (error) {
      postDeleted = false;
      console.warn(
        `[scrum] Failed to delete abandoned scrum thread ${threadId}:`,
        error,
      );

      try {
        const starterMessage = await interaction.channel.fetchStarterMessage();

        if (starterMessage) {
          await starterMessage.edit({
            components: [buildScrumCompletionRow(false, true)],
          });
        }

        await interaction.channel.edit({
          name: replaceScrumThreadStatus(
            interaction.channel.name,
            'abandoned',
          ),
          archived: true,
          locked: true,
          reason: `Scrum deletion fallback for ${interaction.user.tag}`,
        });
      } catch (fallbackError) {
        console.warn(
          `[scrum] Failed to archive deleted scrum thread ${threadId}:`,
          fallbackError,
        );
      }
    }

    if (postDeleted) {
      return;
    }

    await editReplyWithoutComponents(interaction, [
      'DB 데이터는 삭제했지만 Discord 게시물을 삭제하지 못해 잠금·보관을 시도했습니다.',
      weeklySyncFailed
        ? '주간보고 자동 동기화에도 실패했습니다. `/syncweekly`로 다시 동기화해 주세요.'
        : '',
    ].filter(Boolean).join('\n'));
    return;
  }

  let abandoned: Scrum;

  try {
    abandoned = await abandonScrumByThread(
      threadId,
      interaction.user.id,
      reason,
    );
  } catch (error) {
    if (error instanceof BackendApiError) {
      await editReplyWithoutComponents(
        interaction,
        error.status === 403
          ? '스크럼 참여자만 스크럼을 포기할 수 있습니다.'
          : error.status === 409
            ? '이미 종료된 스크럼입니다.'
            : '스크럼을 포기 처리하지 못했습니다.',
      );
      return;
    }

    throw error;
  }

  if (interaction.guild) {
    try {
      await syncCurrentWeeklyReportsForScrumLifecycle({
        client: interaction.client,
        guild: interaction.guild,
        userIds: abandoned.ownerIds,
        createIfMissing: false,
      });
    } catch (error) {
      console.error(
        `[weekly] Failed to synchronize abandoned scrum ${abandoned.id}:`,
        error,
      );
    }
  }

  let postUpdated = true;

  try {
    const starterMessage = await interaction.channel.fetchStarterMessage();

    if (starterMessage) {
      await starterMessage.edit({
        components: [buildScrumCompletionRow(false, true)],
      });
    }

    await interaction.channel.send({
      embeds: [buildScrumAbandonedEmbed({
        abandonedBy: abandoned.abandonedBy ?? interaction.user.id,
        reason: abandoned.abandonmentReason ?? reason,
        abandonedAt: abandoned.abandonedAt ?? new Date().toISOString(),
      })],
      allowedMentions: {
        users: [interaction.user.id],
      },
    });
    await interaction.channel.edit({
      name: replaceScrumThreadStatus(
        interaction.channel.name,
        'abandoned',
      ),
      archived: true,
      locked: true,
      reason: `Scrum abandoned by ${interaction.user.tag}`,
    });
  } catch (error) {
    postUpdated = false;
    console.warn(
      `[scrum] Failed to archive abandoned scrum thread ${threadId}:`,
      error,
    );
  }

  await editReplyWithoutComponents(
    interaction,
    postUpdated
      ? '스크럼을 포기 처리하고 게시물을 잠금·보관했습니다.'
      : '스크럼은 포기 처리했지만 게시물 상태 일부를 갱신하지 못했습니다.',
  );
}

function parseEntryItemValue(value: string): {
  kind: 'completed' | 'extra';
  index: number;
} | null {
  const match = /^(completed|extra):(\d+)$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    kind: match[1] as 'completed' | 'extra',
    index: Number(match[2]),
  };
}

function getRequiredEntryEditSession(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction,
  sessionId: string,
): ScrumEntryEditSession | null {
  const session = getScrumEntryEditSession(sessionId);

  if (
    !session
    || session.guildId !== interaction.guildId
    || session.userId !== interaction.user.id
    || session.scrum.threadId !== interaction.channelId
  ) {
    return null;
  }

  return session;
}

async function handleEditEntryButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (
    !parsed
    || parsed.prefix !== ScrumCustomId.EditEntry
  ) {
    await interaction.reply({
      content: '스크럼 게시물에서 다시 시도해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await startScrumEntryEditFromInteraction(interaction, parsed.sessionId);
}

export async function startScrumEntryEditFromInteraction(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  entryId?: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.channel?.isThread()) {
    await interaction.reply({
      content: '스크럼 게시물에서 다시 시도해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const latest = await getLatestScrumEntryByThread(interaction.channel.id);
    const { entry, scrum } = entryId
      ? await getScrumEntry(entryId)
      : latest;
    const currentScrumDate = getCurrentWeeklyCycleEndKstDateString();

    if (entry.authorId !== interaction.user.id) {
      await editReplyWithoutComponents(
        interaction,
        '이 스크럼 기록을 작성한 사용자만 수정할 수 있습니다.',
      );
      return;
    }

    if (entry.id !== latest.entry.id) {
      await editReplyWithoutComponents(
        interaction,
        '가장 최근에 작성한 스크럼 기록만 수정할 수 있습니다.',
      );
      return;
    }

    if (entry.scrumDate !== currentScrumDate) {
      await editReplyWithoutComponents(
        interaction,
        '해당 스크럼 주차가 마감되어 더 이상 수정할 수 없습니다.',
      );
      return;
    }

    const session = createScrumEntryEditSession({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      entry,
      scrum,
    });
    const incompleteCount = entry.completedItems.filter((item) =>
      item.attachments.length === 0 && item.links.length === 0,
    ).length;

    await interaction.editReply({
      content: [
        `${formatScrumDate(entry.scrumDate)} 마감 스크럼을 수정합니다.`,
        `미완료 작업: **${incompleteCount}개**`,
        '스크럼 수정으로 어떤 작업을 하시겠습니까?',
      ].join('\n'),
      components: [buildEntryEditActionRow(session.id, entry)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (error instanceof BackendApiError && error.status === 404) {
      await editReplyWithoutComponents(
        interaction,
        '이미 삭제되었거나 찾을 수 없는 스크럼 기록입니다.',
      );
      return;
    }

    throw error;
  }
}

async function handleEntryEditActionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const session = parsed
    ? getRequiredEntryEditSession(interaction, parsed.sessionId)
    : null;
  const action = interaction.values[0];

  if (!session) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    action === 'mark-completed'
    || action === 'mark-incomplete'
    || action === 'edit-item'
  ) {
    const mode: ScrumEntryEditMode = action === 'edit-item'
      ? 'edit'
      : action;
    await interaction.update({
      content: '수정을 진행할 작업을 선택해 주세요.',
      components: [buildEntryItemSelectRow(session.id, session.entry, mode)],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (action === 'add-extra') {
    if (session.entry.extraItems.length >= MAX_EXTRA_ITEMS) {
      await interaction.reply({
        content: `추가 완료 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 저장할 수 있습니다.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildEntryExtraModal(session.id));
    return;
  }

  if (action === 'delete-extra') {
    if (session.entry.extraItems.length === 0) {
      await interaction.reply({
        content: '삭제할 추가 완료 작업이 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: '삭제할 추가 완료 작업을 선택해 주세요.',
      components: [buildEntryExtraDeleteSelectRow(
        session.id,
        session.entry,
      )],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (action === 'edit-next-todos') {
    await interaction.showModal(buildEntryNextTodosModal(
      session.id,
      session.entry,
    ));
    return;
  }

  await interaction.reply({
    content: '지원하지 않는 스크럼 수정 항목입니다.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEntryEditSelect(
  interaction: StringSelectMenuInteraction,
  mode: ScrumEntryEditMode,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const session = parsed
    ? getRequiredEntryEditSession(interaction, parsed.sessionId)
    : null;
  const target = parseEntryItemValue(interaction.values[0] ?? '');

  if (!session || !target) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const item = target.kind === 'completed'
    ? session.entry.completedItems[target.index]
    : session.entry.extraItems[target.index];

  if (!item || (mode !== 'edit' && target.kind !== 'completed')) {
    await interaction.reply({
      content: '선택한 작업을 찾을 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.selectedKind = target.kind;
  session.selectedIndex = target.index;
  session.editMode = mode;
  await interaction.showModal(buildEntryItemEditModal({
    sessionId: session.id,
    item,
    mode,
  }));
}

async function handleAddEntryExtraButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const session = parsed
    ? getRequiredEntryEditSession(interaction, parsed.sessionId)
    : null;

  if (!session) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.entry.extraItems.length >= MAX_EXTRA_ITEMS) {
    await interaction.reply({
      content: `추가 완료 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 저장할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildEntryExtraModal(session.id));
}

async function persistEditedEntry(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  session: ScrumEntryEditSession,
): Promise<void> {
  const updated = await updateScrumEntry({
    entryId: session.entry.id,
    actorId: interaction.user.id,
    actorType: 'member',
    completedItems: session.entry.completedItems,
    extraItems: session.entry.extraItems,
    nextTodos: session.entry.nextTodos,
  });
  let discordUpdateFailed = false;
  let failedUploads = 0;

  if (interaction.channel?.isThread()) {
    try {
      const result = await replacePublishedScrumEntry(
        interaction.channel,
        updated.entry,
      );
      failedUploads = result.failedUploads;
    } catch (error) {
      discordUpdateFailed = true;
      console.error(
        `[scrum] Failed to republish edited entry ${updated.entry.id}:`,
        error,
      );
    }
  } else {
    discordUpdateFailed = true;
  }

  if (interaction.guild) {
    await syncWeeklyReportsForScrum({
      client: interaction.client,
      guild: interaction.guild,
      userIds: updated.scrum.ownerIds,
      weekEnd: updated.entry.scrumDate,
      createIfMissing: true,
    });
  }

  deleteScrumEntryEditSession(session.id);
  await editReplyWithoutComponents(interaction, [
    '스크럼 작업 기록을 수정하고 주간보고를 다시 동기화했습니다.',
    discordUpdateFailed
      ? 'DB 수정은 완료했지만 Discord 기록을 다시 작성하지 못했습니다.'
      : '',
    failedUploads > 0
      ? `증빙 파일 ${failedUploads}개는 포럼 게시물에 영구 보관하지 못했습니다.`
      : '',
  ].filter(Boolean).join('\n'));
}

async function handleDeleteEntryExtraSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const session = parsed
    ? getRequiredEntryEditSession(interaction, parsed.sessionId)
    : null;
  const target = parseEntryItemValue(interaction.values[0] ?? '');

  if (!session || !target || target.kind !== 'extra') {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [removed] = session.entry.extraItems.splice(target.index, 1);

  if (!removed) {
    await interaction.reply({
      content: '이미 삭제되었거나 찾을 수 없는 추가 완료 작업입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    await persistEditedEntry(interaction, session);
  } catch (error) {
    if (error instanceof BackendApiError) {
      await editReplyWithoutComponents(
        interaction,
        error.code === 'SCRUM_ENTRY_EDIT_EXPIRED'
          ? '해당 스크럼 주차가 마감되어 더 이상 수정할 수 없습니다.'
          : error.code === 'SCRUM_ENTRY_NOT_LATEST'
            ? '가장 최근에 작성한 스크럼 기록만 수정할 수 있습니다.'
            : '추가 완료 작업을 삭제하지 못했습니다.',
      );
      return;
    }

    throw error;
  }
}

async function handleEntryItemModal(
  interaction: ModalSubmitInteraction,
  sessionId: string,
): Promise<void> {
  const session = getRequiredEntryEditSession(interaction, sessionId);

  if (
    !session
    || !session.selectedKind
    || session.selectedIndex === null
    || !session.editMode
  ) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const items = session.selectedKind === 'completed'
    ? session.entry.completedItems
    : session.entry.extraItems;
  const current = items[session.selectedIndex];

  if (!current) {
    await interaction.reply({
      content: '수정할 작업을 찾을 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const comment = interaction.fields
    .getTextInputValue(ScrumInputId.EntryComment)
    .trim();
  let attachments: ScrumAttachment[] = [];
  let links: string[] = [];

  if (session.editMode === 'mark-incomplete') {
    if (!comment) {
      await interaction.reply({
        content: '미완료로 변경하는 이유를 메모에 작성해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } else {
    const uploaded = getUploadedAttachments(
      interaction,
      ScrumInputId.EntryFiles,
    );
    const evidenceLinks = getEvidenceLinks(
      interaction,
      ScrumInputId.EntryLinks,
    );

    if (evidenceLinks.error) {
      await interaction.reply({
        content: evidenceLinks.error,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    attachments = uploaded;
    links = evidenceLinks.links;

    if (
      session.editMode === 'edit'
      && current.attachments.length > 0
    ) {
      const [attachmentDisposition] = interaction.fields
        .getStringSelectValues(ScrumInputId.EntryAttachmentDisposition);
      attachments = uploaded.length > 0
        ? uploaded
        : attachmentDisposition === 'keep'
          ? current.attachments
          : [];
    }

    if (
      session.editMode === 'mark-completed'
      && attachments.length === 0
      && links.length === 0
    ) {
      await interaction.reply({
        content: '완료 처리하려면 새 증빙 파일 또는 링크가 필요합니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (!hasEvidenceOrComment({
    attachmentCount: attachments.length,
    linkCount: links.length,
    comment,
  })) {
    await interaction.reply({
      content: '증빙 파일, 증빙 링크 또는 메모 중 하나 이상을 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  items[session.selectedIndex] = {
    ...current,
    comment,
    attachments,
    links,
  };

  const wasCarriedOver = session.editMode === 'mark-completed'
    && session.entry.nextTodos.includes(current.title);

  if (wasCarriedOver) {
    session.entry.nextTodos = session.entry.nextTodos.filter(
      (todo) => todo !== current.title,
    );

    if (session.entry.nextTodos.length === 0) {
      await interaction.deferUpdate();
      await interaction.editReply({
        content: [
          `**[ ${truncateText(current.title, 300)} ]** 작업의 이월을 취소했습니다.`,
          '다음 스크럼까지 진행할 작업을 한 개 이상 입력해 주세요.',
        ].join('\n'),
        components: [buildEntryNextTodosRequiredRow(session.id)],
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  try {
    await persistEditedEntry(interaction, session);
  } catch (error) {
    if (error instanceof BackendApiError) {
      await editReplyWithoutComponents(
        interaction,
        error.code === 'SCRUM_ENTRY_EDIT_EXPIRED'
          ? '해당 스크럼 주차가 마감되어 더 이상 수정할 수 없습니다.'
          : error.code === 'SCRUM_ENTRY_NOT_LATEST'
            ? '가장 최근에 작성한 스크럼 기록만 수정할 수 있습니다.'
            : '스크럼 작업 기록을 수정하지 못했습니다.',
      );
      return;
    }

    throw error;
  }
}

async function handleEditEntryNextTodosButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const session = parsed
    ? getRequiredEntryEditSession(interaction, parsed.sessionId)
    : null;

  if (!session) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildEntryNextTodosModal(
    session.id,
    session.entry,
  ));
}

async function handleEntryNextTodosModal(
  interaction: ModalSubmitInteraction,
  sessionId: string,
): Promise<void> {
  const session = getRequiredEntryEditSession(interaction, sessionId);

  if (!session) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsedTodos = parseLines(
    interaction.fields.getTextInputValue(ScrumInputId.EntryNextTodos),
    MAX_TODOS + 1,
  );
  const nextTodos = [...new Set(parsedTodos)];

  if (nextTodos.length === 0) {
    await interaction.reply({
      content: '다음 스크럼까지 진행할 작업을 한 개 이상 입력해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsedTodos.length > MAX_TODOS) {
    await interaction.reply({
      content: `다음 스크럼까지 진행할 작업은 최대 ${MAX_TODOS}개까지 입력할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.entry.nextTodos = nextTodos;

  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  try {
    await persistEditedEntry(interaction, session);
  } catch (error) {
    if (error instanceof BackendApiError) {
      await editReplyWithoutComponents(
        interaction,
        error.code === 'SCRUM_ENTRY_EDIT_EXPIRED'
          ? '해당 스크럼 주차가 마감되어 더 이상 수정할 수 없습니다.'
          : error.code === 'SCRUM_ENTRY_NOT_LATEST'
            ? '가장 최근에 작성한 스크럼 기록만 수정할 수 있습니다.'
            : '다음 스크럼까지 진행할 작업을 수정하지 못했습니다.',
      );
      return;
    }

    throw error;
  }
}

async function handleEntryExtraModal(
  interaction: ModalSubmitInteraction,
  sessionId: string,
): Promise<void> {
  const session = getRequiredEntryEditSession(interaction, sessionId);

  if (!session) {
    await interaction.reply({
      content: '스크럼 수정 정보가 만료되었습니다. 수정 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields
    .getTextInputValue(ScrumInputId.EntryExtraTitle)
    .trim();
  const comment = interaction.fields
    .getTextInputValue(ScrumInputId.EntryComment)
    .trim();
  const attachments = getUploadedAttachments(
    interaction,
    ScrumInputId.EntryFiles,
  );
  const evidenceLinks = getEvidenceLinks(
    interaction,
    ScrumInputId.EntryLinks,
  );

  if (evidenceLinks.error) {
    await interaction.reply({
      content: evidenceLinks.error,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasEvidenceOrComment({
    attachmentCount: attachments.length,
    linkCount: evidenceLinks.links.length,
    comment,
  })) {
    await interaction.reply({
      content: '증빙 파일, 증빙 링크 또는 메모 중 하나 이상을 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.entry.extraItems.push({
    title,
    comment,
    attachments,
    links: evidenceLinks.links,
  });

  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  await persistEditedEntry(interaction, session);
}

async function handleAdminEditScrumModal(
  interaction: ModalSubmitInteraction,
  threadId: string,
): Promise<void> {
  if (
    !interaction.guildId
    || interaction.channelId !== threadId
    || !interaction.channel?.isThread()
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '스크럼 정보 수정에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const projectName = interaction.fields
    .getTextInputValue(ScrumInputId.AdminProjectName)
    .trim();
  const overview = interaction.fields
    .getTextInputValue(ScrumInputId.AdminOverview)
    .trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const scrum = await updateScrumMetadata(
    threadId,
    interaction.user.id,
    projectName,
    overview,
  );
  let discordUpdateFailed = false;

  try {
    const starter = await interaction.channel.fetchStarterMessage();

    if (starter) {
      await starter.edit({
        embeds: [buildScrumIntroEmbed(scrum)],
      });
    }

    await interaction.channel.edit({
      name: replaceScrumThreadTitle(interaction.channel.name, projectName),
      reason: `Scrum metadata updated by ${interaction.user.tag}`,
    });
  } catch (error) {
    discordUpdateFailed = true;
    console.error(`[scrum] Failed to update thread metadata ${threadId}:`, error);
  }

  await editReplyWithoutComponents(interaction, discordUpdateFailed
    ? 'DB의 스크럼 정보는 수정했지만 Discord 게시물 일부를 갱신하지 못했습니다.'
    : '스크럼 제목과 개요를 수정했습니다.');
}

async function handleAdminMarkIncompleteTaskSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);
  const target = parseEntryItemValue(interaction.values[0] ?? '');

  if (
    !parsed
    || parsed.prefix !== ScrumCustomId.AdminMarkIncompleteTask
    || !target
    || !interaction.guild
    || !interaction.channel?.isThread()
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '작업 강제 미완료 처리에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const current = await getScrumEntry(parsed.sessionId);
  const item = target.kind === 'completed'
    ? current.entry.completedItems[target.index]
    : current.entry.extraItems[target.index];

  if (
    current.scrum.threadId !== interaction.channel.id
    || !item
  ) {
    await interaction.reply({
      content: '이미 변경되었거나 찾을 수 없는 작업입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (target.kind === 'extra') {
    await interaction.showModal(buildAdminDeleteExtraModal({
      entryId: current.entry.id,
      index: target.index,
      title: item.title,
    }));
    return;
  }

  if (item.attachments.length === 0 && item.links.length === 0) {
    await interaction.reply({
      content: '이미 미완료로 표시된 작업입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildAdminMarkIncompleteModal({
    entryId: current.entry.id,
    index: target.index,
    title: item.title,
  }));
}

async function handleAdminDeleteExtraModal(
  interaction: ModalSubmitInteraction,
  entryId: string,
  index: number | null,
): Promise<void> {
  if (
    index === null
    || !interaction.guild
    || !interaction.channel?.isThread()
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '추가 완료 작업 삭제에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(ScrumInputId.AdminExtraDeletionReason)
    .trim();

  if (!reason) {
    await interaction.reply({
      content: '삭제 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const current = await getScrumEntry(entryId);

  if (current.scrum.threadId !== interaction.channel.id) {
    await editReplyWithoutComponents(
      interaction,
      '현재 스크럼 게시물의 작업만 삭제할 수 있습니다.',
    );
    return;
  }

  const [removed] = current.entry.extraItems.splice(index, 1);

  if (!removed) {
    await editReplyWithoutComponents(
      interaction,
      '이미 삭제되었거나 찾을 수 없는 추가 완료 작업입니다.',
    );
    return;
  }

  const updated = await updateScrumEntry({
    entryId: current.entry.id,
    actorId: interaction.user.id,
    actorType: 'administrator',
    completedItems: current.entry.completedItems,
    extraItems: current.entry.extraItems,
    nextTodos: current.entry.nextTodos,
  });
  let discordUpdateFailed = false;

  try {
    await replacePublishedScrumEntry(interaction.channel, updated.entry);
  } catch (error) {
    discordUpdateFailed = true;
    console.error(
      `[scrum] Failed to republish admin-edited entry ${updated.entry.id}:`,
      error,
    );
  }

  await syncWeeklyReportsForScrum({
    client: interaction.client,
    guild: interaction.guild,
    userIds: updated.scrum.ownerIds,
    weekEnd: updated.entry.scrumDate,
    createIfMissing: false,
  });

  let dmSent = true;

  try {
    const author = await interaction.client.users.fetch(updated.entry.authorId);
    await author.send({
      embeds: [buildScrumExtraDeletionDmEmbed({
        guildName: interaction.guild.name,
        scrumDate: updated.entry.scrumDate,
        taskTitle: removed.title,
        reason,
      })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    dmSent = false;
    console.warn(
      `[scrum] Failed to DM edited entry author ${updated.entry.authorId}:`,
      error,
    );
  }

  await editReplyWithoutComponents(interaction, [
    `**[ ${truncateText(removed.title, 300)} ]** 추가 완료 작업을 삭제했습니다.`,
    `사유: ${truncateText(reason, 900)}`,
    dmSent ? '' : '작성자의 DM이 닫혀 삭제 사유를 전송하지 못했습니다.',
    discordUpdateFailed
      ? 'DB 수정은 완료했지만 Discord 기록을 다시 작성하지 못했습니다.'
      : '',
  ].filter(Boolean).join('\n'));
}

function appendAdminIncompleteReason(comment: string, reason: string): string {
  const reasonNote = `[관리자 미완료 처리 사유] ${reason}`;
  const previousComment = comment.trim();

  if (!previousComment) {
    return reasonNote;
  }

  const availableLength = Math.max(1, 1000 - reasonNote.length - 2);
  return `${truncateText(previousComment, availableLength)}\n\n${reasonNote}`;
}

async function handleAdminMarkIncompleteModal(
  interaction: ModalSubmitInteraction,
  entryId: string,
  index: number | null,
): Promise<void> {
  if (
    index === null
    || !interaction.guild
    || !interaction.channel?.isThread()
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '작업 강제 미완료 처리에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(ScrumInputId.AdminIncompleteReason)
    .trim();

  if (!reason) {
    await interaction.reply({
      content: '미완료 처리 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const current = await getScrumEntry(entryId);
  const item = current.entry.completedItems[index];

  if (
    current.scrum.threadId !== interaction.channel.id
    || !item
  ) {
    await editReplyWithoutComponents(
      interaction,
      '이미 변경되었거나 찾을 수 없는 작업입니다.',
    );
    return;
  }

  if (item.attachments.length === 0 && item.links.length === 0) {
    await editReplyWithoutComponents(
      interaction,
      '이미 미완료로 표시된 작업입니다.',
    );
    return;
  }

  current.entry.completedItems[index] = {
    ...item,
    comment: appendAdminIncompleteReason(item.comment, reason),
    attachments: [],
    links: [],
  };

  const updated = await updateScrumEntry({
    entryId: current.entry.id,
    actorId: interaction.user.id,
    actorType: 'administrator',
    completedItems: current.entry.completedItems,
    extraItems: current.entry.extraItems,
    nextTodos: current.entry.nextTodos,
  });
  let discordUpdateFailed = false;

  try {
    await replacePublishedScrumEntry(interaction.channel, updated.entry);
  } catch (error) {
    discordUpdateFailed = true;
    console.error(
      `[scrum] Failed to republish admin-marked entry ${updated.entry.id}:`,
      error,
    );
  }

  await syncWeeklyReportsForScrum({
    client: interaction.client,
    guild: interaction.guild,
    userIds: updated.scrum.ownerIds,
    weekEnd: updated.entry.scrumDate,
    createIfMissing: false,
  });
  await editReplyWithoutComponents(interaction, [
    `**[ ${truncateText(item.title, 300)} ]** 작업을 미완료로 표시했습니다.`,
    `사유: ${truncateText(reason, 900)}`,
    discordUpdateFailed
      ? 'DB 수정은 완료했지만 Discord 기록을 다시 작성하지 못했습니다.'
      : '',
  ].filter(Boolean).join('\n'));
}

async function handleEntryDetailPageButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (
    !parsed
    || parsed.prefix !== ScrumCustomId.EntryDetailPage
    || parsed.index === null
    || !interaction.channel?.isThread()
  ) {
    await interaction.reply({
      content: '상세 작업 페이지를 열 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { entry } = await getScrumEntry(parsed.sessionId);
  const links = await collectEntryDetailLinks(interaction.channel, entry);
  await interaction.update({
    components: buildScrumEntryRows(links, entry.id, parsed.index),
  });
}

async function handleDeleteEntryButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (
    !parsed
    || parsed.prefix !== ScrumCustomId.DeleteEntry
    || !interaction.guildId
    || !interaction.channel?.isThread()
  ) {
    await interaction.reply({
      content: '스크럼 게시물에서 다시 시도해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  let deleted: Awaited<ReturnType<typeof deleteScrumEntry>>;

  try {
    deleted = await deleteScrumEntry(
      parsed.sessionId,
      interaction.user.id,
    );
  } catch (error) {
    if (error instanceof BackendApiError) {
      const content = error.status === 403
        ? '이 기록을 작성한 사용자만 삭제할 수 있습니다.'
        : error.code === 'SCRUM_ENTRY_DELETE_EXPIRED'
          ? '해당 스크럼 주차가 마감되어 삭제할 수 없습니다.'
          : error.code === 'SCRUM_ENTRY_NOT_LATEST'
            ? '가장 최근 스크럼만 삭제할 수 있습니다.'
            : error.status === 404
              ? '이미 삭제되었거나 찾을 수 없는 기록입니다.'
              : '스크럼 기록을 삭제하지 못했습니다.';
      await editReplyWithoutComponents(interaction, content);
      return;
    }

    throw error;
  }

  let failedDeletes = 0;

  for (const messageId of deleted.entry.discordMessageIds) {
    try {
      const message = await interaction.channel.messages.fetch(messageId);
      await message.delete();
    } catch (error) {
      failedDeletes += 1;
      console.warn(
        `[scrum] Failed to delete message ${messageId} for entry ${deleted.entry.id}:`,
        error,
      );
    }
  }

  if (interaction.guild) {
    await syncWeeklyReportsForScrum({
      client: interaction.client,
      guild: interaction.guild,
      userIds: deleted.scrum.ownerIds,
      weekEnd: deleted.entry.scrumDate,
      createIfMissing: false,
    });
  }

  await editReplyWithoutComponents(interaction, [
    '가장 최근 스크럼을 삭제했습니다. 이번 주차에 다시 작성할 수 있습니다.',
    failedDeletes > 0
      ? `Discord 메시지 ${failedDeletes}개는 삭제하지 못했습니다.`
      : '',
  ].filter(Boolean).join('\n'));
}

async function handleCompleteScrumButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: '서버의 스크럼 게시물 안에서만 완료할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrum = await getActiveScrumByThread(interaction.channelId);

  if (!scrum || scrum.guildId !== interaction.guildId) {
    await interaction.reply({
      content: '이미 완료되었거나 이 게시물에 연결된 활성 스크럼이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const canComplete = scrum.ownerIds.includes(interaction.user.id);

  if (!canComplete) {
    await interaction.reply({
      content: '스크럼 참여자만 완료할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (scrum.currentTodos.length === 0) {
    await interaction.reply({
      content: '완료 기록을 작성할 작업이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const draft = createScrumCompletionDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    scrumId: scrum.id,
    threadId: interaction.channelId,
    currentTodos: [...scrum.currentTodos],
  });

  await interaction.reply({
    content: buildCompletionTodoPreview(scrum),
    components: [
      buildCompletionContinueRow(draft.id, '작업 기록'),
    ],
    allowedMentions: {
      parse: [],
    },
    flags: MessageFlags.Ephemeral,
  });
}

function getRequiredCompletionDraft(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  draftId: string,
): ReturnType<typeof getScrumCompletionDraft> {
  const draft = getScrumCompletionDraft(draftId);

  if (
    !draft
    || draft.guildId !== interaction.guildId
    || draft.userId !== interaction.user.id
    || draft.threadId !== interaction.channelId
  ) {
    return null;
  }

  return draft;
}

async function getActiveScrumForCompletion(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  draftId: string,
): Promise<{
  draft: NonNullable<ReturnType<typeof getScrumCompletionDraft>>;
  scrum: Scrum;
} | null> {
  const draft = getRequiredCompletionDraft(interaction, draftId);

  if (!draft || !interaction.guildId || !interaction.channelId) {
    return null;
  }

  const scrum = await getActiveScrumByThread(interaction.channelId);
  const todosMatch = scrum
    && scrum.currentTodos.length === draft.currentTodos.length
    && scrum.currentTodos.every(
      (todo, index) => todo === draft.currentTodos[index],
    );

  if (
    !scrum
    || scrum.id !== draft.scrumId
    || scrum.guildId !== interaction.guildId
    || !todosMatch
  ) {
    deleteScrumCompletionDraft(draft.id);
    return null;
  }

  const canComplete = scrum.ownerIds.includes(interaction.user.id);

  if (!canComplete) {
    deleteScrumCompletionDraft(draft.id);
    return null;
  }

  return { draft, scrum };
}

async function handleCompleteContinueButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (!parsed || parsed.prefix !== ScrumCustomId.CompleteContinue) {
    return;
  }

  const completion = await getActiveScrumForCompletion(
    interaction,
    parsed.sessionId,
  );

  if (!completion) {
    await interaction.reply({
      content: '스크럼 완료 기록 작성 정보가 만료되었거나 예정 작업이 변경되었습니다. 완료 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { draft } = completion;
  const todo = draft.currentTodos[draft.currentTodoIndex];

  if (!todo) {
    await interaction.reply({
      content: '이미 모든 작업에 대한 기록을 작성했습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildCompletionTodoModal(
    draft.id,
    draft.currentTodoIndex,
    draft.currentTodos.length,
    todo,
  ));
}

async function replyWithCompletionRetry(
  interaction: ModalSubmitInteraction,
  draft: ScrumCompletionDraft,
  error: string,
): Promise<void> {
  const index = draft.currentTodoIndex;
  const response = {
    content: [
      error,
      '',
      buildTodoStepPreview(
        draft.currentTodos,
        index,
      ),
    ].join('\n'),
    components: [buildCompletionContinueRow(draft.id)],
    allowedMentions: {
      parse: [],
    },
  };

  if (interaction.isFromMessage()) {
    await interaction.update(response);
    return;
  }

  await interaction.reply({
    ...response,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCompleteTodoModal(
  interaction: ModalSubmitInteraction,
  draftId: string,
  index: number,
): Promise<void> {
  const completion = await getActiveScrumForCompletion(interaction, draftId);

  if (!completion) {
    await interaction.reply({
      content: '스크럼 완료 기록 작성 정보가 만료되었거나 예정 작업이 변경되었습니다. 완료 버튼을 다시 눌러 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { draft } = completion;

  if (draft.currentTodoIndex !== index) {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const comment = interaction.fields
    .getTextInputValue(ScrumInputId.TodoComment)
    .trim();
  const attachments = getUploadedAttachments(
    interaction,
    ScrumInputId.TodoFiles,
  );
  const evidenceLinks = getEvidenceLinks(interaction, ScrumInputId.TodoLinks);

  if (evidenceLinks.error) {
    await replyWithCompletionRetry(interaction, draft, evidenceLinks.error);
    return;
  }

  if (attachments.length === 0 && evidenceLinks.links.length === 0) {
    await replyWithCompletionRetry(
      interaction,
      draft,
      '스크럼을 완료하려면 작업마다 증빙 파일 또는 링크가 반드시 필요합니다.',
    );
    return;
  }

  draft.todoResults.push({
    title: draft.currentTodos[index],
    comment,
    attachments,
    links: evidenceLinks.links,
  });
  draft.currentTodoIndex += 1;

  if (draft.currentTodoIndex < draft.currentTodos.length) {
    const response = {
      content: [
        formatTaskRecordSaved(draft.currentTodos[index]),
        '',
        buildTodoStepPreview(
          draft.currentTodos,
          draft.currentTodoIndex,
        ),
      ].join('\n'),
      components: [buildCompletionContinueRow(draft.id)],
      allowedMentions: {
        parse: [],
      },
    };

    if (interaction.isFromMessage()) {
      await interaction.update(response);
    } else {
      await interaction.reply({
        ...response,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  }

  let completedScrum: Scrum;

  try {
    completedScrum = await completeScrumByThread(
      draft.threadId,
      interaction.user.id,
      draft.todoResults,
    );
  } catch (error) {
    if (
      error instanceof BackendApiError
      && error.status === 409
      && error.code === 'SCRUM_ALREADY_CLOSED'
    ) {
      deleteScrumCompletionDraft(draft.id);
      await editReplyWithoutComponents(
        interaction,
        '다른 사용자가 먼저 이 스크럼을 완료했습니다.',
      );
      return;
    }

    if (
      error instanceof BackendApiError
      && error.status === 409
      && error.code === 'ALL_SCRUM_TODOS_REQUIRED'
    ) {
      deleteScrumCompletionDraft(draft.id);
      await editReplyWithoutComponents(
        interaction,
        '완료 화면을 연 뒤 예정 작업이 변경되었습니다. 완료 버튼을 다시 눌러 확인해 주세요.',
      );
      return;
    }

    throw error;
  }

  deleteScrumCompletionDraft(draft.id);
  let buttonUpdated = true;
  let completionMessageSent = true;
  let postArchived = true;
  let weeklySyncFailed = false;
  let evidenceUploadFailures = 0;

  try {
    if (!interaction.channel?.isThread()) {
      throw new Error('The scrum channel is not a thread.');
    }

    const starterMessage = await interaction.channel.fetchStarterMessage();

    if (!starterMessage) {
      throw new Error('The scrum starter message was not found.');
    }

    await starterMessage.edit({
      components: [buildScrumCompletionRow(true)],
    });
  } catch (error) {
    buttonUpdated = false;
    console.warn(
      `[scrum] Failed to disable completion button in ${interaction.channelId}:`,
      error,
    );
  }

  try {
    if (!interaction.channel?.isThread()) {
      throw new Error('The scrum channel is not a thread.');
    }

    const details = await postEntryItemDetails(
      interaction.channel,
      draft.todoResults,
      0,
      false,
    );
    evidenceUploadFailures = details.failedUploads;
    await updateScrumCompletionResults(
      draft.threadId,
      draft.todoResults,
    );

    await interaction.channel.send({
      embeds: [buildScrumCompletionSummaryEmbed(completedScrum)],
      components: details.links.length > 0
        ? buildEntryDetailRows(details.links)
        : [],
      allowedMentions: {
        users: [interaction.user.id],
      },
    });
  } catch (error) {
    completionMessageSent = false;
    console.warn(
      `[scrum] Failed to post completion message in ${interaction.channelId}:`,
      error,
    );
  }

  if (interaction.guild) {
    try {
      await syncCurrentWeeklyReportsForScrumLifecycle({
        client: interaction.client,
        guild: interaction.guild,
        userIds: completedScrum.ownerIds,
        createIfMissing: true,
      });
    } catch (error) {
      weeklySyncFailed = true;
      console.error(
        `[weekly] Failed to synchronize completed scrum ${completedScrum.id}:`,
        error,
      );
    }
  }

  try {
    if (!interaction.channel?.isThread()) {
      throw new Error('The scrum channel is not a thread.');
    }

    await interaction.channel.edit({
      name: replaceScrumThreadStatus(
        interaction.channel.name,
        'completed',
      ),
      archived: true,
      locked: true,
      reason: `Scrum completed by ${interaction.user.tag}`,
    });
  } catch (error) {
    postArchived = false;
    console.warn(
      `[scrum] Failed to archive completed scrum thread ${interaction.channelId}:`,
      error,
    );
  }

  await editReplyWithoutComponents(interaction, [
    formatTaskRecordSaved(draft.currentTodos[index]),
    '스크럼을 완료했습니다.',
    buttonUpdated ? '' : '완료 버튼 표시는 갱신하지 못했습니다.',
    completionMessageSent ? '' : '게시물에 완료 기록을 남기지 못했습니다.',
    postArchived ? '' : '완료된 게시물을 잠금·보관하지 못했습니다.',
    weeklySyncFailed
      ? '주간보고 자동 동기화에 실패했습니다. `/syncweekly`로 다시 동기화해 주세요.'
      : '',
    evidenceUploadFailures > 0
      ? `증빙 파일 ${evidenceUploadFailures}개는 포럼 게시물에 영구 보관하지 못했습니다.`
      : '',
  ].filter(Boolean).join('\n'));
}

async function handleRejectRequestButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild || !interaction.channelId) {
    await interaction.reply({
      content: '서버의 승인 포럼 안에서만 처리할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!await canReviewScrumRequest(interaction)) {
    await interaction.reply({
      content: '스크럼 승인 역할 또는 `Administrator` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = await getScrumRequestByApprovalThread(
    interaction.channelId,
  );

  if (
    !request
    || request.guildId !== interaction.guildId
    || request.status !== 'pending'
  ) {
    await interaction.reply({
      content: request
        ? '이미 처리된 스크럼 승인 요청입니다.'
        : '이 게시물에 연결된 스크럼 승인 요청을 찾을 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildRejectRequestModal(request.approvalThreadId));
}

async function handleRejectRequestModal(
  interaction: ModalSubmitInteraction,
  approvalThreadId: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '서버 안에서만 처리할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!await canReviewScrumRequest(interaction)) {
    await interaction.reply({
      content: '스크럼 승인 역할 또는 `Administrator` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(ScrumInputId.RejectionReason)
    .trim();

  if (!reason) {
    await interaction.reply({
      content: '반려 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  let rejected: ScrumRequest;

  try {
    rejected = await rejectScrumRequest({
      approvalThreadId,
      reviewerId: interaction.user.id,
      reason,
    });
  } catch (error) {
    if (isAlreadyReviewedError(error)) {
      await editReplyWithoutComponents(
        interaction,
        '다른 승인자가 먼저 이 요청을 처리했습니다.',
      );
      return;
    }

    throw error;
  }

  const approvalPostUpdated = await editApprovalStarterMessage(
    interaction,
    approvalThreadId,
    rejected,
    {
      status: 'rejected',
      reviewerId: interaction.user.id,
      rejectionReason: rejected.rejectionReason ?? reason,
    },
  );
  let dmSent = true;

  try {
    const requester = await interaction.client.users.fetch(rejected.creatorId);
    await requester.send({
      embeds: [buildApprovalRejectionEmbed({
        projectName: rejected.projectName,
        category: rejected.category,
        guildName: interaction.guild.name,
        reason,
      })],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    dmSent = false;
    console.warn(
      `[scrum] Failed to DM rejection reason to ${rejected.creatorId}:`,
      error,
    );
  }

  await editReplyWithoutComponents(interaction, [
    '스크럼 승인 요청을 반려했습니다.',
    dmSent
      ? '신청자에게 반려 임베드를 DM으로 전송했습니다.'
      : '신청자의 DM이 닫혀 있어 반려 임베드를 전송하지 못했습니다.',
    approvalPostUpdated ? '' : '승인 요청 게시물의 상태 표시는 갱신하지 못했습니다.',
  ].filter(Boolean).join('\n'));
}

async function handleScrumSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: '서버 안에서만 사용할 수 있는 기능입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrumId = interaction.values[0];
  const scrum = await getActiveScrumForUser(
    scrumId,
    interaction.guildId,
    interaction.user.id,
  );

  if (!scrum) {
    await interaction.reply({
      content: '선택한 스크럼을 찾을 수 없거나 작성 권한이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await startScrumSessionFromInteraction(interaction, scrum);
}

async function handleOpenNewScrumButton(
  interaction: ButtonInteraction,
): Promise<void> {
  await startNewScrumFromInteraction(interaction);
}

async function handleEditInitialTodosButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.channel?.isThread()) {
    await interaction.reply({
      content: '서버의 스크럼 게시물 안에서만 수정할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrum = await getActiveScrumByThread(interaction.channel.id);

  if (!scrum || scrum.guildId !== interaction.guildId) {
    await interaction.reply({
      content: '이미 완료되었거나 이 게시물에 연결된 활성 스크럼이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!scrum.ownerIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: '스크럼 참여자만 첫 진행할 작업을 수정할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await getLatestScrumEntryByThread(interaction.channel.id);
    await interaction.reply({
      content: '첫 스크럼 기록이 작성된 뒤에는 시작 작업 목록을 수정할 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  } catch (error) {
    if (!(error instanceof BackendApiError && error.status === 404)) {
      throw error;
    }
  }

  await interaction.showModal(buildInitialTodosEditModal(scrum));
}

async function handleInitialTodosModal(
  interaction: ModalSubmitInteraction,
  scrumId: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.channel?.isThread()) {
    await interaction.reply({
      content: '서버의 스크럼 게시물 안에서만 수정할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrum = await getActiveScrumByThread(interaction.channel.id);

  if (
    !scrum
    || scrum.id !== scrumId
    || scrum.guildId !== interaction.guildId
  ) {
    await interaction.reply({
      content: '이미 완료되었거나 이 게시물에 연결된 활성 스크럼이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!scrum.ownerIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: '스크럼 참여자만 첫 진행할 작업을 수정할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsedTodos = parseLines(
    interaction.fields.getTextInputValue(ScrumInputId.InitialTodos),
    MAX_TODOS + 1,
  );

  if (parsedTodos.length === 0) {
    await interaction.reply({
      content: '첫 스크럼까지 진행할 작업을 하나 이상 입력해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsedTodos.length > MAX_TODOS) {
    await interaction.reply({
      content: `진행할 작업은 최대 ${MAX_TODOS}개까지 입력할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsedTodos.some((todo) => todo.length > 1_500)) {
    await interaction.reply({
      content: '각 진행할 작업은 1,500자 이하여야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentTodos = [...new Set(parsedTodos)];
  let updated: Scrum;

  try {
    updated = await updateScrumInitialTodos(
      interaction.channel.id,
      interaction.user.id,
      currentTodos,
    );
  } catch (error) {
    if (
      error instanceof BackendApiError
      && error.code === 'SCRUM_INITIAL_TODOS_LOCKED'
    ) {
      await interaction.reply({
        content: '첫 스크럼 기록이 작성된 뒤에는 시작 작업 목록을 수정할 수 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    throw error;
  }

  if (!interaction.isFromMessage()) {
    await interaction.reply({
      content: '첫 스크럼까지 진행할 작업을 수정했습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    embeds: [buildScrumTodoEmbed(updated)],
    components: [buildScrumStartRow()],
    allowedMentions: { parse: [] },
  });
}

async function handleWriteScrumButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: '서버의 스크럼 게시물 안에서만 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const scrum = await getActiveScrumByThread(interaction.channelId);

  if (!scrum || scrum.guildId !== interaction.guildId) {
    await interaction.reply({
      content: '이미 완료되었거나 이 게시물에 연결된 활성 스크럼이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!scrum.ownerIds.includes(interaction.user.id)) {
    await interaction.reply({
      content: '스크럼 참여자만 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await startScrumSessionFromInteraction(interaction, scrum);
}

async function handleContinueButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (!parsed || parsed.prefix !== ScrumCustomId.Continue) {
    return;
  }

  const session = getRequiredSession(interaction, parsed.sessionId);

  if (!session) {
    await interaction.reply({
      content: '진행 중인 스크럼 작성 세션을 찾을 수 없습니다. `/scrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (await rejectOutsideScheduledDate(interaction, session)) {
    return;
  }

  await showCurrentSessionModal(interaction, session);
}

async function handleSkipExtraButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseSessionCustomId(interaction.customId);

  if (!parsed || parsed.prefix !== ScrumCustomId.SkipExtra) {
    return;
  }

  const session = getRequiredSession(interaction, parsed.sessionId);

  if (!session) {
    await interaction.reply({
      content: '진행 중인 스크럼 작성 세션을 찾을 수 없습니다. `/scrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (await rejectOutsideScheduledDate(interaction, session)) {
    return;
  }

  if (session.phase !== 'extra-decision') {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.carryoverCandidates = session.todoResults
    .filter((result) =>
      result.attachments.length === 0
      && result.links.length === 0,
    )
    .map((result) => result.title);

  if (session.carryoverCandidates.length > 0) {
    session.phase = 'carryover';
    await interaction.showModal(buildCarryoverTodosModal(
      session.id,
      session.carryoverCandidates,
      session.nextScrumDate,
    ));
    return;
  }

  session.phase = 'next-todos';
  await interaction.showModal(buildNextTodosModal(
    session.id,
    session.nextScrumDate,
  ));
}

async function handleCarryoverTodosModal(
  interaction: ModalSubmitInteraction,
  session: ScrumSession,
): Promise<void> {
  if (session.phase !== 'carryover') {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const indexes = interaction.fields.getStringSelectValues(
    ScrumInputId.CarryoverTodos,
  );
  const selected = indexes.map((value) => {
    const index = Number(value);
    return Number.isInteger(index)
      ? session.carryoverCandidates[index]
      : undefined;
  });

  if (selected.some((todo) => !todo)) {
    await interaction.reply({
      content: '이월할 작업 선택값이 올바르지 않습니다. `/scrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.carryoverTodos = selected as string[];
  session.phase = 'next-todos';

  await interaction.reply({
    content: session.carryoverTodos.length > 0
      ? `미완료 작업 ${session.carryoverTodos.length}개를 다음 스크럼으로 이월했습니다`
      : '미완료 작업을 이월하지 않았습니다.',
    components: [
      buildContinueRow(session.id, '다음 작업 입력'),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleTodoModal(interaction: ModalSubmitInteraction, session: ScrumSession, index: number): Promise<void> {
  if (session.phase !== 'todo' || session.currentTodoIndex !== index) {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = session.scrum.currentTodos[index];
  const comment = interaction.fields.getTextInputValue(ScrumInputId.TodoComment).trim();
  const attachments = getUploadedAttachments(interaction, ScrumInputId.TodoFiles);
  const evidenceLinks = getEvidenceLinks(interaction, ScrumInputId.TodoLinks);

  if (evidenceLinks.error) {
    await replyWithTodoRetry(interaction, session, index, evidenceLinks.error);
    return;
  }

  if (
    !hasEvidenceOrComment({
      attachmentCount: attachments.length,
      linkCount: evidenceLinks.links.length,
      comment,
    })
  ) {
    await replyWithTodoRetry(
      interaction,
      session,
      index,
      '증빙 파일 또는 링크를 등록하거나, 메모를 작성해 주세요.',
    );
    return;
  }

  session.todoResults.push({
    title,
    comment,
    attachments,
    links: evidenceLinks.links,
  });
  session.currentTodoIndex += 1;

  if (session.currentTodoIndex < session.scrum.currentTodos.length) {
    session.phase = 'todo';
    await replyWithContinue(
      interaction,
      session,
      [
        formatTaskRecordSaved(title),
        '',
        buildTodoStepPreview(
          session.scrum.currentTodos,
          session.currentTodoIndex,
        ),
      ].join('\n'),
      '작업 기록',
    );
    return;
  }

  session.phase = 'extra-decision';
  await replyWithExtraDecision(
    interaction,
    session,
    formatTaskRecordSaved(title),
  );
}

async function handleExtraDetailModal(interaction: ModalSubmitInteraction, session: ScrumSession, index: number): Promise<void> {
  if (
    session.phase !== 'extra-decision'
    || session.currentExtraIndex !== index
    || session.currentExtraIndex >= MAX_EXTRA_ITEMS
  ) {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields.getTextInputValue(ScrumInputId.ExtraTitle).trim();
  const comment = interaction.fields.getTextInputValue(ScrumInputId.ExtraComment).trim();
  const attachments = getUploadedAttachments(interaction, ScrumInputId.ExtraFiles);
  const evidenceLinks = getEvidenceLinks(interaction, ScrumInputId.ExtraLinks);

  if (!title) {
    await replyWithExtraDecision(
      interaction,
      session,
      '추가로 완료한 작업 내용을 입력해 주세요.',
    );
    return;
  }

  if (evidenceLinks.error) {
    await replyWithExtraDecision(interaction, session, evidenceLinks.error);
    return;
  }

  if (
    !hasEvidenceOrComment({
      attachmentCount: attachments.length,
      linkCount: evidenceLinks.links.length,
      comment,
    })
  ) {
    await replyWithExtraDecision(
      interaction,
      session,
      '증빙 파일 또는 링크를 등록하거나, 메모를 작성해 주세요.',
    );
    return;
  }

  session.extraResults.push({
    title,
    comment,
    attachments,
    links: evidenceLinks.links,
  });
  session.currentExtraIndex += 1;
  session.phase = 'extra-decision';
  await replyWithExtraDecision(interaction, session);
}

async function handleNextTodosModal(interaction: ModalSubmitInteraction, session: ScrumSession): Promise<void> {
  if (session.phase !== 'next-todos') {
    await interaction.reply({
      content: '이미 지난 단계입니다. 최신 단계의 버튼을 사용해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsedNextTodos = parseLines(
    interaction.fields.getTextInputValue(ScrumInputId.NextTodos),
    MAX_TODOS + 1,
  );
  const nextTodos = [...new Set([
    ...session.carryoverTodos,
    ...parsedNextTodos,
  ])].slice(0, MAX_TODOS);

  if (nextTodos.length === 0) {
    await replyWithContinue(
      interaction,
      session,
      '다음 스크럼까지 진행할 작업을 최소 1개 입력해 주세요.',
      '다음 작업 다시 입력',
    );
    return;
  }

  if (session.carryoverTodos.length + parsedNextTodos.length > MAX_TODOS) {
    await replyWithContinue(
      interaction,
      session,
      `다음 스크럼까지 진행할 작업은 최대 ${MAX_TODOS}개까지 입력할 수 있습니다.`,
      '다음 작업 다시 입력',
    );
    return;
  }

  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  }

  const entry = await saveScrumEntry({
    scrum: session.scrum,
    authorId: interaction.user.id,
    scrumDate: session.scrumDate,
    nextScrumDate: session.nextScrumDate,
    completedItems: session.todoResults,
    extraItems: session.extraResults,
    nextTodos,
  });

  if (!entry) {
    deleteScrumSession(session.id);
    await editReplyWithoutComponents(
      interaction,
      '이 스크럼은 이번 주차에 다른 참여자가 이미 작성했습니다.',
    );
    return;
  }

  const thread = await fetchThreadChannel(interaction, session.scrum);
  let threadWriteFailed = false;
  let evidenceUploadFailures = 0;

  if (thread) {
    try {
      const published = await publishScrumEntry(
        thread,
        entry,
        interaction.user.id,
      );
      evidenceUploadFailures = published.failedUploads;
    } catch (error) {
      threadWriteFailed = true;
      console.error(`[scrum] Failed to post entry ${entry.id} to thread ${thread.id}:`, error);
    }

    try {
      await refreshScrumStartMessage(
        thread,
        {
          ...session.scrum,
          currentTodos: nextTodos,
          nextScrumDate: entry.nextScrumDate,
        },
        false,
      );
    } catch (error) {
      console.warn(
        `[scrum] Failed to refresh start message in ${thread.id}:`,
        error,
      );
    }
  }

  if (interaction.guild) {
    await syncWeeklyReportsForScrum({
      client: interaction.client,
      guild: interaction.guild,
      userIds: session.scrum.ownerIds,
      weekEnd: entry.scrumDate,
      createIfMissing: true,
    });
  }

  deleteScrumSession(session.id);

  await editReplyWithoutComponents(
    interaction,
    thread && !threadWriteFailed
      ? [
        `<#${thread.id}>에 스크럼 기록을 저장했습니다. 다음 스크럼 마감은 ${formatScrumDate(entry.nextScrumDate)}입니다.`,
        evidenceUploadFailures > 0
          ? `증빙 파일 ${evidenceUploadFailures}개는 포럼 게시물에 영구 보관하지 못했습니다.`
          : '',
      ].filter(Boolean).join('\n')
      : `스크럼 기록은 DB에 저장했지만 포럼 게시물 메시지 전송에는 실패했습니다. 다음 스크럼 마감은 ${formatScrumDate(entry.nextScrumDate)}입니다.`,
  );
}

async function handleScrumModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId === ScrumCustomId.NewScrumDetails) {
    await handleNewScrumDetailsModal(interaction);
    return;
  }

  const parsed = parseSessionCustomId(interaction.customId);

  if (!parsed) {
    await interaction.reply({
      content: '지원이 끝난 스크럼 화면입니다. 명령어를 다시 실행해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.prefix === ScrumCustomId.CompleteTodo && parsed.index !== null) {
    await handleCompleteTodoModal(
      interaction,
      parsed.sessionId,
      parsed.index,
    );
    return;
  }

  if (parsed.prefix === ScrumCustomId.RejectRequestModal) {
    await handleRejectRequestModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.AbandonScrumModal) {
    await handleAbandonScrumModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.AdminEditModal) {
    await handleAdminEditScrumModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.AdminMarkIncompleteModal) {
    await handleAdminMarkIncompleteModal(
      interaction,
      parsed.sessionId,
      parsed.index,
    );
    return;
  }

  if (parsed.prefix === ScrumCustomId.AdminDeleteExtraModal) {
    await handleAdminDeleteExtraModal(
      interaction,
      parsed.sessionId,
      parsed.index,
    );
    return;
  }

  if (parsed.prefix === ScrumCustomId.EntryItemModal) {
    await handleEntryItemModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.EntryExtraModal) {
    await handleEntryExtraModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.EntryNextTodosModal) {
    await handleEntryNextTodosModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.InitialTodosModal) {
    await handleInitialTodosModal(interaction, parsed.sessionId);
    return;
  }

  if (parsed.prefix === ScrumCustomId.NewScrumPlanning) {
    const draft = getRequiredNewScrumDraft(interaction, parsed.sessionId);

    if (!draft) {
      await interaction.reply({
        content: '새 스크럼 작성 정보가 만료되었습니다. `/newscrum`으로 다시 시작해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await handleNewScrumPlanningModal(interaction, draft);
    return;
  }

  if (parsed.prefix === ScrumCustomId.NewScrumTodos) {
    const draft = getRequiredNewScrumDraft(interaction, parsed.sessionId);

    if (!draft) {
      await interaction.reply({
        content: '새 스크럼 작성 정보가 만료되었습니다. `/newscrum`으로 다시 시작해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await handleNewScrumTodosModal(interaction, draft);
    return;
  }

  const session = getRequiredSession(interaction, parsed.sessionId);

  if (!session) {
    await interaction.reply({
      content: '진행 중인 스크럼 작성 세션을 찾을 수 없습니다. `/scrum`으로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (await rejectOutsideScheduledDate(interaction, session)) {
    return;
  }

  if (parsed.prefix === ScrumCustomId.Todo && parsed.index !== null) {
    await handleTodoModal(interaction, session, parsed.index);
    return;
  }

  if (parsed.prefix === ScrumCustomId.ExtraDetail && parsed.index !== null) {
    await handleExtraDetailModal(interaction, session, parsed.index);
    return;
  }

  if (parsed.prefix === ScrumCustomId.CarryoverTodos) {
    await handleCarryoverTodosModal(interaction, session);
    return;
  }

  if (parsed.prefix === ScrumCustomId.NextTodos) {
    await handleNextTodosModal(interaction, session);
  }
}

export async function handleScrumInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isModalSubmit() && interaction.customId.startsWith('scrum:')) {
    await handleScrumModal(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === ScrumCustomId.SelectScrum) {
    await handleScrumSelect(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith(`${ScrumCustomId.EntryEditAction}:`)) {
      await handleEntryEditActionSelect(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.EditEntryItem}:`)) {
      await handleEntryEditSelect(interaction, 'edit');
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.MarkEntryCompleted}:`)) {
      await handleEntryEditSelect(interaction, 'mark-completed');
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.MarkEntryIncomplete}:`)) {
      await handleEntryEditSelect(interaction, 'mark-incomplete');
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.DeleteEntryExtra}:`)) {
      await handleDeleteEntryExtraSelect(interaction);
      return true;
    }

    if (
      interaction.customId.startsWith(
        `${ScrumCustomId.AdminMarkIncompleteTask}:`,
      )
    ) {
      await handleAdminMarkIncompleteTaskSelect(interaction);
      return true;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === ScrumCustomId.OpenNewScrum) {
      await handleOpenNewScrumButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.WriteScrum) {
      await handleWriteScrumButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.EditInitialTodos) {
      await handleEditInitialTodosButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.CompleteScrum) {
      await handleCompleteScrumButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.AbandonScrum) {
      await handleAbandonScrumButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.ApproveRequest) {
      await handleApproveRequestButton(interaction);
      return true;
    }

    if (interaction.customId === ScrumCustomId.RejectRequest) {
      await handleRejectRequestButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.EditEntry}:`)) {
      await handleEditEntryButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.AddEntryExtra}:`)) {
      await handleAddEntryExtraButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.EditEntryNextTodos}:`)) {
      await handleEditEntryNextTodosButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.EntryDetailPage}:`)) {
      await handleEntryDetailPageButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.CompleteContinue}:`)) {
      await handleCompleteContinueButton(interaction);
      return true;
    }

    if (
      interaction.customId.startsWith(
        `${ScrumCustomId.NewScrumPlanningContinue}:`,
      )
    ) {
      await handleNewScrumPlanningContinueButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.NewScrumContinue}:`)) {
      await handleNewScrumContinueButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.SkipExtra}:`)) {
      await handleSkipExtraButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.DeleteEntry}:`)) {
      await handleDeleteEntryButton(interaction);
      return true;
    }

    if (interaction.customId.startsWith(`${ScrumCustomId.Continue}:`)) {
      await handleContinueButton(interaction);
      return true;
    }
  }

  return false;
}
