import type { Client, Guild } from 'discord.js';
import { getConfiguredWeeklyTestDate } from '../config/weeklyTestDate';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import { getCurrentWeeklyPeriodKst } from './dateUtils';
import {
  getWeeklyRoleId,
  listWeeklyThreads,
  processWeeklyReportMisses,
} from './weeklyStore';
import { getAllGuildMembers } from './memberCache';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const processedThroughByGuild = new Map<string, string>();

export function getLatestClosedSundayKst(date = new Date()): string {
  const activeWeekEnd = getCurrentWeeklyPeriodKst(date).weekEnd;
  const parsed = new Date(`${activeWeekEnd}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 7);
  return parsed.toISOString().slice(0, 10);
}

async function processGuildMisses(
  guild: Guild,
  latestWeekEnd: string,
): Promise<void> {
  const [weeklyChannelId, roleId, mappings] = await Promise.all([
    getChannel(guild.id, ChannelSettingType.Weekly),
    getWeeklyRoleId(guild.id),
    listWeeklyThreads(guild.id),
  ]);

  if (!weeklyChannelId || !roleId || mappings.length === 0) {
    return;
  }

  if (processedThroughByGuild.get(guild.id) === latestWeekEnd) {
    return;
  }

  const members = await getAllGuildMembers(guild);
  const userIds = members
    .filter((member) =>
      !member.user.bot
      && member.roles.cache.has(roleId),
    )
    .map((member) => member.id);

  if (userIds.length === 0) {
    return;
  }

  const incremented = await processWeeklyReportMisses({
    guildId: guild.id,
    weekEnd: latestWeekEnd,
    userIds,
  });

  if (incremented.length > 0) {
    console.log(
      `[weekly] Counted ${incremented.length} missing report(s) for ${guild.id} on ${latestWeekEnd}.`,
    );
  }

  processedThroughByGuild.set(guild.id, latestWeekEnd);
}

async function processAllGuildMisses(client: Client): Promise<void> {
  const weekEnd = getLatestClosedSundayKst();

  for (const guild of client.guilds.cache.values()) {
    try {
      await processGuildMisses(guild, weekEnd);
    } catch (error) {
      console.error(
        `[weekly] Failed to process missing reports for guild ${guild.id}:`,
        error,
      );
    }
  }
}

export function startWeeklyMissScheduler(client: Client): void {
  if (getConfiguredWeeklyTestDate()) {
    console.log('[weekly] Missing report scheduler is disabled in test-date mode.');
    return;
  }

  void processAllGuildMisses(client);
  const timer = setInterval(() => {
    void processAllGuildMisses(client);
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
