import { randomUUID } from 'node:crypto';
import {
  ChannelType,
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import type {
  Attachment,
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  Interaction,
  Message,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BackendApiError } from '../api/backendClient';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import {
  buildEntryDetailRows,
} from '../scrums/components';
import {
  buildScrumItemDetailContent,
} from '../scrums/formatters';
import type { ScrumAttachment } from '../scrums/types';
import {
  buildWeeklyDecisionRow,
  buildWeeklyAdminDeleteExtraModal,
  buildWeeklyDeleteModal,
  buildWeeklyExtraEditModal,
  buildWeeklyExtraEditSelectRow,
  buildWeeklyExtraModal,
  buildWeeklyReportExtraModal,
  buildWeeklyReportRow,
  parseWeeklyCustomId,
  WeeklyCustomId,
  WeeklyInputId,
} from './components';
import {
  getCurrentWeeklyPeriodKst,
  isWeeklyReportOpen,
} from './dateUtils';
import {
  buildWeeklyExtraDeletionDmEmbed,
  buildWeeklyReportEmbed,
  formatWeeklySessionPreview,
} from './formatters';
import { ensureWeeklyMemberPost } from './forumSync';
import {
  createWeeklySession,
  deleteWeeklySession,
  getWeeklySession,
} from './sessionStore';
import type {
  WeeklyExtraResult,
} from './types';
import {
  deleteWeeklyReportMessages,
  hasWeeklyCompletedWork,
  refreshWeeklyReportSummary,
} from './syncService';
import {
  createWeeklyReport,
  deleteWeeklyReport,
  getWeeklyReport,
  getWeeklyReportPreview,
  getWeeklyRoleId,
  updateWeeklyReport,
} from './weeklyStore';

const MAX_EXTRA_ITEMS = 10;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

type WeeklyLaunchInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction;

function serializeAttachment(attachment: Attachment): ScrumAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

function getUploadedAttachments(
  interaction: ModalSubmitInteraction,
): ScrumAttachment[] {
  const attachments = interaction.fields.getUploadedFiles(
    WeeklyInputId.ExtraFiles,
    false,
  );
  return attachments
    ? [...attachments.values()].map(serializeAttachment)
    : [];
}

function parseEvidenceLink(value: string): {
  links: string[];
  error: string | null;
} {
  const trimmed = value.trim();

  if (!trimmed) {
    return { links: [], error: null };
  }

  if (trimmed.includes('\n')) {
    return {
      links: [],
      error: '증빙 링크는 1개만 입력할 수 있습니다.',
    };
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol.');
    }

    return { links: [url.toString()], error: null };
  } catch {
    return {
      links: [],
      error: '증빙 링크는 `http://` 또는 `https://`로 시작해야 합니다.',
    };
  }
}

function isDiscordAttachmentUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'cdn.discordapp.com'
      || hostname === 'media.discordapp.net';
  } catch {
    return false;
  }
}

async function postExtraDetails(
  thread: GuildTextBasedChannel,
  results: WeeklyExtraResult[],
  startIndex = 0,
): Promise<{
  messageIds: string[];
  detailLinks: Array<{ label: string; url: string }>;
  failedUploads: number;
}> {
  const messageIds: string[] = [];
  const detailLinks: Array<{ label: string; url: string }> = [];
  let failedUploads = 0;

  for (const [index, result] of results.entries()) {
    const detail = await thread.send({
      content: buildScrumItemDetailContent({
        title: result.title,
        comment: result.comment,
        links: result.links,
        incomplete: false,
      }),
      allowedMentions: { parse: [] },
    });
    messageIds.push(detail.id);
    detailLinks.push({
      label: `추가 완료 작업 ${startIndex + index + 1}`,
      url: detail.url,
    });

    const validAttachments = result.attachments.filter((attachment) =>
      attachment.size <= MAX_UPLOAD_BYTES
      && isDiscordAttachmentUrl(attachment.url),
    );
    const replacements = new Map<string, ScrumAttachment>();

    for (let offset = 0; offset < validAttachments.length; offset += 10) {
      const batch = validAttachments.slice(offset, offset + 10);

      try {
        const message = await thread.send({
          files: batch.map((attachment) => ({
            attachment: attachment.url,
            name: attachment.name,
          })),
          allowedMentions: { parse: [] },
        });
        messageIds.push(message.id);
        const persisted = [...message.attachments.values()];

        batch.forEach((attachment, attachmentIndex) => {
          const uploaded = persisted[attachmentIndex];

          if (uploaded) {
            replacements.set(attachment.id, serializeAttachment(uploaded));
          }
        });
      } catch (error) {
        console.warn(
          `[weekly] Failed to persist attachments for extra item ${index + 1}:`,
          error,
        );
      }
    }

    failedUploads += result.attachments.filter(
      (attachment) => !replacements.has(attachment.id),
    ).length;
    result.attachments = result.attachments.map(
      (attachment) => replacements.get(attachment.id) ?? attachment,
    );
  }

  return {
    messageIds,
    detailLinks,
    failedUploads,
  };
}

async function replaceWeeklyReportPublication(
  interaction: ModalSubmitInteraction,
  report: Awaited<ReturnType<typeof updateWeeklyReport>>,
  actorType?: 'administrator',
): Promise<{
  failedDeletes: number;
  failedUploads: number;
}> {
  const channel = await interaction.client.channels.fetch(report.threadId);

  if (!channel || channel.type !== ChannelType.PublicThread) {
    throw new Error('Weekly report thread not found.');
  }

  const oldMessageIds = [...report.discordMessageIds];
  const previousMessages = new Map<string, Message>();
  const refreshedAttachments = new Map<string, ScrumAttachment>();

  for (const messageId of oldMessageIds) {
    try {
      const message = await channel.messages.fetch(messageId);
      previousMessages.set(messageId, message);

      for (const attachment of message.attachments.values()) {
        refreshedAttachments.set(
          attachment.id,
          serializeAttachment(attachment),
        );
      }
    } catch {
      // The deletion pass below reports unavailable previous messages.
    }
  }

  for (const item of report.extraItems) {
    item.attachments = item.attachments.map((attachment) =>
      refreshedAttachments.get(attachment.id) ?? attachment,
    );
  }

  const createdMessageIds: string[] = [];
  let details: Awaited<ReturnType<typeof postExtraDetails>>;

  try {
    details = await postExtraDetails(channel, report.extraItems);
    createdMessageIds.push(...details.messageIds);
    const summary = await channel.send({
      embeds: [buildWeeklyReportEmbed(report)],
      components: [
        ...buildEntryDetailRows(details.detailLinks),
        buildWeeklyReportRow(report),
      ],
      allowedMentions: {
        users: [report.userId],
      },
    });
    createdMessageIds.push(summary.id);

    await updateWeeklyReport({
      reportId: report.id,
      extraItems: report.extraItems,
      discordMessageIds: createdMessageIds,
      actorType,
    });
  } catch (error) {
    for (const messageId of createdMessageIds) {
      try {
        const message = await channel.messages.fetch(messageId);
        await message.delete();
      } catch {
        // Best-effort cleanup while preserving the previous publication.
      }
    }
    throw error;
  }

  const preservedMessageIds = details.failedUploads > 0
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
        ?? await channel.messages.fetch(messageId);
      await message.delete();
    } catch (error) {
      failedDeletes += 1;
      console.warn(
        `[weekly] Failed to replace report message ${messageId}:`,
        error,
      );
    }
  }

  if (preservedMessageIds.length > 0) {
    await updateWeeklyReport({
      reportId: report.id,
      extraItems: report.extraItems,
      discordMessageIds: [...preservedMessageIds, ...createdMessageIds],
      actorType,
    });
  }

  return {
    failedDeletes,
    failedUploads: details.failedUploads,
  };
}

async function handleAdminDeleteExtraSelect(
  interaction: StringSelectMenuInteraction,
  reportId: string,
): Promise<void> {
  if (
    !interaction.guildId
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '주간보고 관리에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const index = Number(interaction.values[0]);
  const report = await getWeeklyReport(reportId);
  const item = Number.isInteger(index) && index >= 0
    ? report?.extraItems[index]
    : null;

  if (!report || report.guildId !== interaction.guildId || !item) {
    await interaction.reply({
      content: '이미 삭제되었거나 찾을 수 없는 추가 완료 작업입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildWeeklyAdminDeleteExtraModal({
    reportId: report.id,
    index,
    title: item.title,
  }));
}

async function handleAdminDeleteExtraModal(
  interaction: ModalSubmitInteraction,
  reportId: string,
  index: number,
): Promise<void> {
  if (
    !interaction.guild
    || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '주간보고 관리에는 `서버 관리` 권한이 필요합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(WeeklyInputId.AdminDeleteReason)
    .trim();

  if (!reason) {
    await interaction.reply({
      content: '삭제 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const report = await getWeeklyReport(reportId);
  const removed = report?.extraItems[index];

  if (!report || report.guildId !== interaction.guildId || !removed) {
    await interaction.reply({
      content: '이미 삭제되었거나 찾을 수 없는 추가 완료 작업입니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const extraItems = report.extraItems.filter((_, itemIndex) =>
    itemIndex !== index,
  );
  let updated = await updateWeeklyReport({
    reportId: report.id,
    extraItems,
    discordMessageIds: report.discordMessageIds,
    actorType: 'administrator',
  });
  const reportDeleted = !hasWeeklyCompletedWork(updated);
  let failedDeletes = 0;
  let failedUploads = 0;
  let publicationFailed = false;

  if (reportDeleted) {
    updated = await deleteWeeklyReport({
      reportId: updated.id,
      deletedBy: interaction.user.id,
      actorType: 'administrator',
      reason: `추가 완료 작업 삭제 후 빈 주간보고: ${reason}`.slice(0, 1000),
    });
    failedDeletes = await deleteWeeklyReportMessages(
      interaction.client,
      updated,
    );
  } else {
    try {
      const publication = await replaceWeeklyReportPublication(
        interaction,
        updated,
        'administrator',
      );
      failedDeletes = publication.failedDeletes;
      failedUploads = publication.failedUploads;
    } catch (error) {
      publicationFailed = true;
      console.error(
        `[weekly] Failed to republish admin-edited report ${report.id}:`,
        error,
      );
    }
  }

  let dmSent = true;

  try {
    const author = await interaction.client.users.fetch(report.userId);
    await author.send({
      embeds: [buildWeeklyExtraDeletionDmEmbed({
        guildName: interaction.guild.name,
        weekEnd: report.weekEnd,
        taskTitle: removed.title,
        reason,
        reportDeleted,
      })],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    dmSent = false;
    console.warn(
      `[weekly] Failed to DM edited report author ${report.userId}:`,
      error,
    );
  }

  await interaction.editReply({
    content: [
      `**[ ${escapeMarkdown(removed.title.replace(/\s+/g, ' ').trim())} ]** 추가 완료 작업을 삭제했습니다.`,
      reportDeleted
        ? '남은 완료 작업이 없어 주간보고도 삭제했습니다.'
        : '',
      dmSent ? '' : '작성자의 DM이 닫혀 삭제 사유를 전송하지 못했습니다.',
      publicationFailed
        ? 'DB 수정은 완료했지만 Discord 주간보고를 다시 작성하지 못했습니다.'
        : '',
      failedDeletes > 0
        ? `기존 Discord 메시지 ${failedDeletes}개는 삭제하지 못했습니다.`
        : '',
      failedUploads > 0
        ? `증빙 파일 ${failedUploads}개는 게시물에 영구 보관하지 못했습니다.`
        : '',
    ].filter(Boolean).join('\n'),
    components: [],
    allowedMentions: { parse: [] },
  });
}

async function editSessionReply(
  interaction: ModalSubmitInteraction,
  content: string,
  sessionId: string,
  completedCount: number,
  canAddMore: boolean,
): Promise<void> {
  const response = {
    content,
    components: [
      buildWeeklyDecisionRow(
        sessionId,
        completedCount,
        canAddMore,
      ),
    ],
    allowedMentions: { parse: [] },
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

export async function startWeeklyReportFromInteraction(
  interaction: WeeklyLaunchInteraction,
  expectedUserId = interaction.user.id,
): Promise<void> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: '서버 안에서만 주간보고를 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (expectedUserId !== interaction.user.id) {
    await interaction.reply({
      content: '본인의 주간보고 게시물에서만 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const period = getCurrentWeeklyPeriodKst();

  const [weeklyChannelId, roleId, member] = await Promise.all([
    getChannel(interaction.guildId, ChannelSettingType.Weekly),
    getWeeklyRoleId(interaction.guildId),
    interaction.guild.members.fetch(interaction.user.id),
  ]);

  if (!weeklyChannelId || !roleId) {
    await interaction.reply({
      content: '관리자가 주간보고 포럼과 대상 역할을 먼저 설정해야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!member.roles.cache.has(roleId)) {
    await interaction.reply({
      content: '주간보고 대상 역할을 가진 사용자만 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const thread = await ensureWeeklyMemberPost(
    interaction.guild,
    member,
  );
  const preview = await getWeeklyReportPreview({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    weekEnd: period.weekEnd,
  });

  if (preview.existingReportId) {
    await interaction.editReply({
      content: '이번 주 주간보고는 이미 생성되어 있습니다. 보고서 아래의 `추가로 한 작업 작성` 버튼을 이용해 주세요.',
      components: [],
    });
    return;
  }

  const session = createWeeklySession({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    threadId: thread.id,
    preview,
  });
  const completedCount = preview.completedItems.length;

  await interaction.editReply({
    content: formatWeeklySessionPreview(preview, 0),
    components: [
      buildWeeklyDecisionRow(
        session.id,
        completedCount,
        true,
      ),
    ],
    allowedMentions: { parse: [] },
  });
}

async function handleAddExtraButton(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  const session = getWeeklySession(sessionId);

  if (
    !session
    || session.guildId !== interaction.guildId
    || session.userId !== interaction.user.id
  ) {
    await interaction.reply({
      content: '주간보고 작성 세션이 만료되었습니다. `/weekly`로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.preview.weekEnd !== getCurrentWeeklyPeriodKst().weekEnd) {
    deleteWeeklySession(session.id);
    await interaction.reply({
      content: '주차가 마감되어 주간보고 작성을 계속할 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.extraItems.length >= MAX_EXTRA_ITEMS) {
    await interaction.reply({
      content: `추가 완료 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 작성할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(
    buildWeeklyExtraModal(session.id, session.extraItems.length),
  );
}

async function handleExtraModal(
  interaction: ModalSubmitInteraction,
  sessionId: string,
  index: number,
): Promise<void> {
  const session = getWeeklySession(sessionId);

  if (
    !session
    || session.guildId !== interaction.guildId
    || session.userId !== interaction.user.id
    || session.extraItems.length !== index
  ) {
    await interaction.reply({
      content: '주간보고 작성 단계가 만료되었습니다. `/weekly`로 다시 시작해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (session.preview.weekEnd !== getCurrentWeeklyPeriodKst().weekEnd) {
    deleteWeeklySession(session.id);
    await interaction.reply({
      content: '주차가 마감되어 주간보고 작성을 계속할 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraTitle)
    .trim();
  const comment = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraComment)
    .trim();
  const attachments = getUploadedAttachments(interaction);
  const parsedLink = parseEvidenceLink(
    interaction.fields.getTextInputValue(WeeklyInputId.ExtraLinks),
  );

  if (!title || parsedLink.error) {
    await editSessionReply(
      interaction,
      parsedLink.error ?? '추가 완료 작업 내용을 작성해 주세요.',
      session.id,
      session.preview.completedItems.length + session.extraItems.length,
      true,
    );
    return;
  }

  if (
    attachments.length === 0
    && parsedLink.links.length === 0
    && !comment
  ) {
    await editSessionReply(
      interaction,
      '증빙 파일 또는 링크를 등록하거나, 메모를 작성해 주세요.',
      session.id,
      session.preview.completedItems.length + session.extraItems.length,
      true,
    );
    return;
  }

  session.extraItems.push({
    title,
    comment,
    attachments,
    links: parsedLink.links,
  });
  const completedCount = session.preview.completedItems.length
    + session.extraItems.length;

  await editSessionReply(
    interaction,
    formatWeeklySessionPreview(
      session.preview,
      session.extraItems.length,
    ),
    session.id,
    completedCount,
    session.extraItems.length < MAX_EXTRA_ITEMS,
  );
}

async function handleSubmitButton(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  const session = getWeeklySession(sessionId);
  const period = getCurrentWeeklyPeriodKst();

  if (
    !session
    || session.guildId !== interaction.guildId
    || session.userId !== interaction.user.id
    || session.preview.weekEnd !== period.weekEnd
  ) {
    if (session) {
      deleteWeeklySession(session.id);
    }
    await interaction.reply({
      content: '주간보고 작성 세션이 만료되었거나 해당 주차가 마감되었습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    session.preview.completedItems.length
    + session.extraItems.length === 0
  ) {
    await interaction.reply({
      content: '제출하려면 완료한 작업을 최소 1개 포함해야 합니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const reportId = randomUUID();
  let report = await createWeeklyReport({
    id: reportId,
    guildId: session.guildId,
    userId: session.userId,
    threadId: session.threadId,
    weekEnd: session.preview.weekEnd,
    extraItems: session.extraItems,
  });
  const postedMessageIds: string[] = [];
  let failedUploads = 0;

  try {
    const channel = await interaction.client.channels.fetch(
      session.threadId,
    );

    if (
      !channel
      || channel.type !== ChannelType.PublicThread
    ) {
      throw new Error('Weekly report thread not found.');
    }

    const details = await postExtraDetails(
      channel,
      report.extraItems,
    );
    postedMessageIds.push(...details.messageIds);
    failedUploads = details.failedUploads;
    const summary = await channel.send({
      embeds: [buildWeeklyReportEmbed(report)],
      components: [
        ...buildEntryDetailRows(details.detailLinks),
        buildWeeklyReportRow(report),
      ],
      allowedMentions: {
        users: [report.userId],
      },
    });
    postedMessageIds.push(summary.id);
    report = await updateWeeklyReport({
      reportId: report.id,
      extraItems: report.extraItems,
      discordMessageIds: postedMessageIds,
    });
  } catch (error) {
    console.error(
      `[weekly] Failed to publish weekly report ${reportId}:`,
      error,
    );

    try {
      await deleteWeeklyReport({
        reportId,
        deletedBy: interaction.client.user.id,
        actorType: 'system',
        reason: 'Discord 게시물 생성 실패로 자동 롤백',
      });
    } catch (rollbackError) {
      console.error(
        `[weekly] Failed to roll back report ${reportId}:`,
        rollbackError,
      );
    }

    try {
      const channel = await interaction.client.channels.fetch(
        session.threadId,
      );

      if (channel?.isTextBased()) {
        for (const messageId of postedMessageIds) {
          const message = await channel.messages.fetch(messageId);
          await message.delete();
        }
      }
    } catch (cleanupError) {
      console.warn(
        `[weekly] Failed to remove partial report messages ${reportId}:`,
        cleanupError,
      );
    }

    deleteWeeklySession(session.id);
    await interaction.editReply({
      content: '주간보고 게시물을 생성하지 못해 저장을 취소했습니다.',
      components: [],
    });
    return;
  }

  deleteWeeklySession(session.id);
  await interaction.editReply({
    content: [
      `<#${session.threadId}>에 ${report.weekEnd} 주간보고를 작성했습니다.`,
      failedUploads > 0
        ? `증빙 파일 ${failedUploads}개는 게시물에 영구 보관하지 못했습니다.`
        : '',
    ].filter(Boolean).join('\n'),
    components: [],
  });
}

async function handleAddToReportButton(
  interaction: ButtonInteraction,
  reportId: string,
): Promise<void> {
  const period = getCurrentWeeklyPeriodKst();
  const report = await getWeeklyReport(reportId);

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
    || report.weekEnd !== period.weekEnd
  ) {
    await interaction.reply({
      content: '본인의 이번 주 주간보고에서만 추가 작업을 작성할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (report.extraItems.length >= MAX_EXTRA_ITEMS) {
    await interaction.reply({
      content: `추가로 한 작업은 최대 ${MAX_EXTRA_ITEMS}개까지 작성할 수 있습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(
    buildWeeklyReportExtraModal(report.id, report.extraItems.length),
  );
}

async function handleAddToReportModal(
  interaction: ModalSubmitInteraction,
  reportId: string,
  index: number,
): Promise<void> {
  const period = getCurrentWeeklyPeriodKst();
  const report = await getWeeklyReport(reportId);

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
    || report.weekEnd !== period.weekEnd
    || report.extraItems.length !== index
  ) {
    await interaction.reply({
      content: '주간보고 상태가 변경되었거나 작성 가능한 시간이 지났습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraTitle)
    .trim();
  const comment = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraComment)
    .trim();
  const attachments = getUploadedAttachments(interaction);
  const parsedLink = parseEvidenceLink(
    interaction.fields.getTextInputValue(WeeklyInputId.ExtraLinks),
  );

  if (!title || parsedLink.error) {
    await interaction.reply({
      content: parsedLink.error ?? '추가로 한 작업의 내용을 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    attachments.length === 0
    && parsedLink.links.length === 0
    && !comment
  ) {
    await interaction.reply({
      content: '증빙 파일 또는 링크를 등록하거나, 메모를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const extraItem: WeeklyExtraResult = {
    title,
    comment,
    attachments,
    links: parsedLink.links,
  };
  const channel = await interaction.client.channels.fetch(report.threadId);

  if (
    !channel
    || channel.type !== ChannelType.PublicThread
  ) {
    await interaction.editReply({
      content: '주간보고 게시물을 찾을 수 없습니다.',
      components: [],
    });
    return;
  }

  let details: Awaited<ReturnType<typeof postExtraDetails>> | null = null;
  let stored = false;

  try {
    details = await postExtraDetails(
      channel,
      [extraItem],
      report.extraItems.length,
    );
    const summaryId = report.discordMessageIds.at(-1);
    const detailMessageIds = summaryId
      ? report.discordMessageIds.slice(0, -1)
      : report.discordMessageIds;
    const updated = await updateWeeklyReport({
      reportId: report.id,
      extraItems: [...report.extraItems, extraItem],
      discordMessageIds: [
        ...detailMessageIds,
        ...details.messageIds,
        ...(summaryId ? [summaryId] : []),
      ],
    });
    stored = true;
    await refreshWeeklyReportSummary(
      interaction.client,
      updated,
      details.detailLinks,
    );

    await interaction.editReply({
      content: [
        `**[ ${escapeMarkdown(title.replace(/\s+/g, ' ').trim())} ]** 작업을 주간보고에 추가했습니다.`,
        details.failedUploads > 0
          ? `증빙 파일 ${details.failedUploads}개는 게시물에 영구 보관하지 못했습니다.`
          : '',
      ].filter(Boolean).join('\n'),
      components: [],
    });
  } catch (error) {
    console.error(
      `[weekly] Failed to append extra item to report ${report.id}:`,
      error,
    );

    if (details && !stored) {
      for (const messageId of details.messageIds) {
        try {
          const message = await channel.messages.fetch(messageId);
          await message.delete();
        } catch {
          // Best-effort cleanup after a failed DB or summary update.
        }
      }
    }

    await interaction.editReply({
      content: stored
        ? '추가로 한 작업은 저장했지만 주간보고 요약 메시지를 갱신하지 못했습니다.'
        : '추가로 한 작업을 주간보고에 반영하지 못했습니다.',
      components: [],
    });
  }
}

async function handleEditExtraButton(
  interaction: ButtonInteraction,
  reportId: string,
): Promise<void> {
  const report = await getWeeklyReport(reportId);

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
    || !isWeeklyReportOpen(report.weekEnd)
  ) {
    await interaction.reply({
      content: '본인의 마감 전 주간보고만 수정할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (report.extraItems.length === 0) {
    await interaction.reply({
      content: '수정할 추가 완료 작업이 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: '수정할 추가 완료 작업을 선택해 주세요.',
    components: [buildWeeklyExtraEditSelectRow(report)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEditExtraSelect(
  interaction: StringSelectMenuInteraction,
  reportId: string,
): Promise<void> {
  const index = Number(interaction.values[0]);
  const report = await getWeeklyReport(reportId);
  const item = Number.isInteger(index) && index >= 0
    ? report?.extraItems[index]
    : null;

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
    || !isWeeklyReportOpen(report.weekEnd)
    || !item
  ) {
    await interaction.reply({
      content: '주간보고 상태가 변경되었거나 수정 가능한 시간이 지났습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildWeeklyExtraEditModal({
    reportId,
    index,
    item,
  }));
}

async function handleEditExtraModal(
  interaction: ModalSubmitInteraction,
  reportId: string,
  index: number,
): Promise<void> {
  const report = await getWeeklyReport(reportId);
  const currentItem = report?.extraItems[index];

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
    || !isWeeklyReportOpen(report.weekEnd)
    || !currentItem
  ) {
    await interaction.reply({
      content: '주간보고 상태가 변경되었거나 수정 가능한 시간이 지났습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraTitle)
    .trim();
  const comment = interaction.fields
    .getTextInputValue(WeeklyInputId.ExtraComment)
    .trim();
  const uploaded = getUploadedAttachments(interaction);
  let attachments = uploaded;

  if (currentItem.attachments.length > 0) {
    const [attachmentDisposition] = interaction.fields.getStringSelectValues(
      WeeklyInputId.ExtraAttachmentDisposition,
    );
    attachments = uploaded.length > 0
      ? uploaded
      : attachmentDisposition === 'keep'
        ? currentItem.attachments
        : [];
  }

  const parsedLink = parseEvidenceLink(
    interaction.fields.getTextInputValue(WeeklyInputId.ExtraLinks),
  );

  if (!title || parsedLink.error) {
    await interaction.reply({
      content: parsedLink.error ?? '추가 완료 작업 내용을 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    attachments.length === 0
    && parsedLink.links.length === 0
    && !comment
  ) {
    await interaction.reply({
      content: '증빙 파일 또는 링크를 등록하거나, 메모를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const extraItems = [...report.extraItems];
  extraItems[index] = {
    title,
    comment,
    attachments,
    links: parsedLink.links,
  };

  try {
    const updated = await updateWeeklyReport({
      reportId: report.id,
      extraItems,
      discordMessageIds: report.discordMessageIds,
    });
    const publication = await replaceWeeklyReportPublication(
      interaction,
      updated,
    );

    await interaction.editReply({
      content: [
        `**[ ${escapeMarkdown(title.replace(/\s+/g, ' ').trim())} ]** 추가 완료 작업을 수정했습니다.`,
        publication.failedDeletes > 0
          ? `기존 Discord 메시지 ${publication.failedDeletes}개는 삭제하지 못했습니다.`
          : '',
        publication.failedUploads > 0
          ? `증빙 파일 ${publication.failedUploads}개는 게시물에 영구 보관하지 못했습니다.`
          : '',
      ].filter(Boolean).join('\n'),
      components: [],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      `[weekly] Failed to edit extra item ${index} in report ${report.id}:`,
      error,
    );
    await interaction.editReply({
      content: '추가 완료 작업을 수정하지 못했습니다.',
      components: [],
    });
  }
}

async function handleDeleteButton(
  interaction: ButtonInteraction,
  reportId: string,
): Promise<void> {
  const report = await getWeeklyReport(reportId);

  if (
    !report
    || report.guildId !== interaction.guildId
    || report.userId !== interaction.user.id
  ) {
    await interaction.reply({
      content: '본인이 작성한 주간보고만 삭제할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isWeeklyReportOpen(report.weekEnd)) {
    await interaction.reply({
      content: '마감된 주차의 주간보고는 삭제할 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildWeeklyDeleteModal(reportId));
}

async function handleDeleteModal(
  interaction: ModalSubmitInteraction,
  reportId: string,
): Promise<void> {
  const existing = await getWeeklyReport(reportId);

  if (
    !interaction.guild
    || !existing
    || existing.guildId !== interaction.guildId
    || existing.userId !== interaction.user.id
  ) {
    await interaction.reply({
      content: '본인이 작성한 주간보고만 삭제할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isWeeklyReportOpen(existing.weekEnd)) {
    await interaction.reply({
      content: '마감된 주차의 주간보고는 삭제할 수 없습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = interaction.fields
    .getTextInputValue(WeeklyInputId.DeleteReason)
    .trim();

  if (!reason) {
    await interaction.reply({
      content: '삭제 사유를 작성해 주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  let report;

  try {
    report = await deleteWeeklyReport({
      reportId,
      deletedBy: interaction.user.id,
      actorType: 'owner',
      reason,
    });
  } catch (error) {
    if (
      error instanceof BackendApiError
      && error.status === 404
    ) {
      await interaction.editReply({
        content: '이미 삭제되었거나 찾을 수 없는 주간보고입니다.',
        components: [],
      });
      return;
    }

    if (
      error instanceof BackendApiError
      && error.code === 'WEEKLY_REPORT_DELETE_CLOSED'
    ) {
      await interaction.editReply({
        content: '주간보고 삭제 가능 시간이 지났습니다.',
        components: [],
      });
      return;
    }

    throw error;
  }

  const failedDeletes = await deleteWeeklyReportMessages(
    interaction.client,
    report,
  );

  await interaction.editReply({
    content: [
      `${report.weekEnd} 주간보고를 삭제했습니다.`,
      failedDeletes > 0
        ? `Discord 메시지 ${failedDeletes}개는 삭제하지 못했습니다.`
        : '',
    ].filter(Boolean).join('\n'),
    components: [],
  });
}

export async function handleWeeklyInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (
    interaction.isStringSelectMenu()
    && interaction.customId.startsWith('weekly:')
  ) {
    const parsed = parseWeeklyCustomId(interaction.customId);

    if (!parsed) {
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.AdminDeleteExtra) {
      await handleAdminDeleteExtraSelect(interaction, parsed.value);
    }

    if (parsed.prefix === WeeklyCustomId.EditExtraSelect) {
      await handleEditExtraSelect(interaction, parsed.value);
    }

    return true;
  }

  if (
    interaction.isButton()
    && interaction.customId.startsWith('weekly:')
  ) {
    const parsed = parseWeeklyCustomId(interaction.customId);

    if (!parsed) {
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.Start) {
      await startWeeklyReportFromInteraction(interaction, parsed.value);
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.AddExtra) {
      await handleAddExtraButton(interaction, parsed.value);
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.AddToReport) {
      await handleAddToReportButton(interaction, parsed.value);
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.EditExtra) {
      await handleEditExtraButton(interaction, parsed.value);
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.Submit) {
      await handleSubmitButton(interaction, parsed.value);
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.Delete) {
      await handleDeleteButton(interaction, parsed.value);
      return true;
    }

    return true;
  }

  if (
    interaction.isModalSubmit()
    && interaction.customId.startsWith('weekly:')
  ) {
    const parsed = parseWeeklyCustomId(interaction.customId);

    if (!parsed) {
      return true;
    }

    if (
      parsed.prefix === WeeklyCustomId.ExtraModal
      && parsed.index !== null
    ) {
      await handleExtraModal(
        interaction,
        parsed.value,
        parsed.index,
      );
      return true;
    }

    if (
      parsed.prefix === WeeklyCustomId.AddToReportModal
      && parsed.index !== null
    ) {
      await handleAddToReportModal(
        interaction,
        parsed.value,
        parsed.index,
      );
      return true;
    }


    if (
      parsed.prefix === WeeklyCustomId.EditExtraModal
      && parsed.index !== null
    ) {
      await handleEditExtraModal(
        interaction,
        parsed.value,
        parsed.index,
      );
      return true;
    }

    if (parsed.prefix === WeeklyCustomId.DeleteModal) {
      await handleDeleteModal(interaction, parsed.value);
      return true;
    }

    if (
      parsed.prefix === WeeklyCustomId.AdminDeleteExtraModal
      && parsed.index !== null
    ) {
      await handleAdminDeleteExtraModal(
        interaction,
        parsed.value,
        parsed.index,
      );
      return true;
    }

    return true;
  }

  return false;
}
