import { randomUUID } from 'node:crypto';
import {
  ButtonStyle,
  ChannelType,
  ComponentType,
} from 'discord.js';
import type {
  Client,
  Guild,
  Message,
} from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { buildEntryDetailRows } from '../scrums/components';
import { getChannel } from '../storage/guildSettingsStore';
import { buildWeeklyReportRow } from './components';
import { getCurrentWeeklyPeriodKst } from './dateUtils';
import { buildWeeklyReportEmbed } from './formatters';
import { ensureWeeklyMemberPost } from './forumSync';
import type { WeeklyReport } from './types';
import {
  deleteWeeklyReport,
  findWeeklyReport,
  getWeeklyReportPreview,
  getWeeklyRoleId,
  syncWeeklyReport,
  updateWeeklyReport,
} from './weeklyStore';

interface DetailLink {
  label: string;
  url: string;
}

function extractDetailLinks(message: Message): DetailLink[] {
  const links: DetailLink[] = [];

  for (const row of message.components) {
    if (row.type !== ComponentType.ActionRow) {
      continue;
    }

    for (const component of row.components) {
      if (
        component.type !== ComponentType.Button
        || component.style !== ButtonStyle.Link
        || !component.url
      ) {
        continue;
      }

      links.push({
        label: component.label ?? `상세 ${links.length + 1}`,
        url: component.url,
      });
    }
  }

  return links;
}

function mergeDetailLinks(
  current: DetailLink[],
  additional: DetailLink[],
): DetailLink[] {
  const links = new Map<string, DetailLink>();

  for (const link of [...current, ...additional]) {
    links.set(link.url, link);
  }

  return [...links.values()].slice(0, 20);
}

export function hasWeeklyCompletedWork(
  report: Pick<WeeklyReport, 'completedItems' | 'extraItems'>,
): boolean {
  return report.completedItems.length + report.extraItems.length > 0;
}

async function deleteEmptyWeeklyReport(
  client: Client,
  report: WeeklyReport,
): Promise<void> {
  if (!client.user) {
    throw new Error('The Bot user is unavailable for weekly report cleanup.');
  }

  const deleted = await deleteWeeklyReport({
    reportId: report.id,
    deletedBy: client.user.id,
    actorType: 'system',
    reason: '완료한 작업이 없어 자동 삭제',
  });

  try {
    const failedDeletes = await deleteWeeklyReportMessages(client, deleted);

    if (failedDeletes > 0) {
      console.warn(
        `[weekly] Failed to delete ${failedDeletes} empty report message(s) for ${report.id}.`,
      );
    }
  } catch (error) {
    console.warn(
      `[weekly] Failed to remove Discord messages for empty report ${report.id}:`,
      error,
    );
  }
}

export async function refreshWeeklyReportSummary(
  client: Client,
  report: WeeklyReport,
  additionalDetailLinks: DetailLink[] = [],
): Promise<WeeklyReport> {
  const channel = await client.channels.fetch(report.threadId);

  if (
    !channel
    || channel.type !== ChannelType.PublicThread
  ) {
    throw new Error('Weekly report thread not found.');
  }

  const currentSummaryId = report.discordMessageIds.at(-1);
  let summary: Message | null = null;

  if (currentSummaryId) {
    try {
      summary = await channel.messages.fetch(currentSummaryId);
    } catch {
      summary = null;
    }
  }

  if (summary) {
    const detailLinks = mergeDetailLinks(
      extractDetailLinks(summary),
      additionalDetailLinks,
    );
    await summary.edit({
      embeds: [buildWeeklyReportEmbed(report)],
      components: [
        ...buildEntryDetailRows(detailLinks),
        buildWeeklyReportRow(report),
      ],
      allowedMentions: {
        users: [report.userId],
      },
    });
    return report;
  }

  const created = await channel.send({
    embeds: [buildWeeklyReportEmbed(report)],
    components: [
      ...buildEntryDetailRows(additionalDetailLinks),
      buildWeeklyReportRow(report),
    ],
    allowedMentions: {
      users: [report.userId],
    },
  });
  const previousMessageIds = currentSummaryId
    ? report.discordMessageIds.slice(0, -1)
    : report.discordMessageIds;

  return updateWeeklyReport({
    reportId: report.id,
    extraItems: report.extraItems,
    discordMessageIds: [...previousMessageIds, created.id],
    actorType: 'administrator',
  });
}

export async function syncWeeklyReportsForScrum(input: {
  client: Client;
  guild: Guild;
  userIds: string[];
  weekEnd: string;
  createIfMissing: boolean;
}): Promise<number> {
  const [weeklyChannelId, roleId] = await Promise.all([
    getChannel(input.guild.id, ChannelSettingType.Weekly),
    getWeeklyRoleId(input.guild.id),
  ]);

  if (!weeklyChannelId || !roleId) {
    console.warn(
      `[weekly] Skipped report synchronization for guild ${input.guild.id}: ${[
        !weeklyChannelId ? 'weekly channel' : '',
        !roleId ? 'weekly role' : '',
      ].filter(Boolean).join(' and ')} not configured.`,
    );
    return 0;
  }

  let synced = 0;

  for (const userId of new Set(input.userIds)) {
    try {
      const existing = await findWeeklyReport({
        guildId: input.guild.id,
        userId,
        weekEnd: input.weekEnd,
      });

      if (!existing && !input.createIfMissing) {
        continue;
      }

      const preview = await getWeeklyReportPreview({
        guildId: input.guild.id,
        userId,
        weekEnd: input.weekEnd,
      });

      if (
        preview.completedItems.length
        + (existing?.extraItems.length ?? 0) === 0
      ) {
        if (existing) {
          await deleteEmptyWeeklyReport(input.client, existing);
        }

        continue;
      }

      const member = await input.guild.members.fetch(userId);

      if (member.user.bot || !member.roles.cache.has(roleId)) {
        continue;
      }

      const thread = await ensureWeeklyMemberPost(input.guild, member);
      const report = await syncWeeklyReport({
        id: existing?.id ?? randomUUID(),
        guildId: input.guild.id,
        userId,
        threadId: thread.id,
        weekEnd: input.weekEnd,
      });

      if (!hasWeeklyCompletedWork(report)) {
        await deleteEmptyWeeklyReport(input.client, report);
        continue;
      }

      await refreshWeeklyReportSummary(input.client, report);
      synced += 1;
    } catch (error) {
      console.error(
        `[weekly] Failed to synchronize ${input.weekEnd} report for ${userId}:`,
        error,
      );
    }
  }

  return synced;
}

export async function syncCurrentWeeklyReportsForScrumLifecycle(input: {
  client: Client;
  guild: Guild;
  userIds: string[];
  createIfMissing: boolean;
}): Promise<number> {
  const period = getCurrentWeeklyPeriodKst();

  return syncWeeklyReportsForScrum({
    ...input,
    weekEnd: period.weekEnd,
  });
}

export async function deleteWeeklyReportMessages(
  client: Client,
  report: WeeklyReport,
): Promise<number> {
  const channel = await client.channels.fetch(report.threadId);

  if (!channel?.isTextBased()) {
    return report.discordMessageIds.length;
  }

  let failedDeletes = 0;

  for (const messageId of report.discordMessageIds) {
    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
    } catch (error) {
      failedDeletes += 1;
      console.warn(
        `[weekly] Failed to delete report message ${messageId}:`,
        error,
      );
    }
  }

  return failedDeletes;
}
