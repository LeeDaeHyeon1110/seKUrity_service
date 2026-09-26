import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import type { Client, Guild } from 'discord.js';
import { getConfiguredWeeklyTestDate } from '../config/weeklyTestDate';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import {
  getCurrentWeeklyPeriodKst,
  getWeeklyReportDeadlineDate,
} from './dateUtils';
import { getAllGuildMembers } from './memberCache';
import {
  getWeeklyRoleId,
  listWeeklyThreads,
  processWeeklyReportReminders,
} from './weeklyStore';

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const TUESDAY = 2;
const DEADLINE_HOUR = 19;

export function getDueWeeklyReminderWeekEnd(
  date = new Date(),
): string | null {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);

  if (
    kst.getUTCDay() !== TUESDAY
    || kst.getUTCHours() < 12
    || kst.getUTCHours() >= DEADLINE_HOUR
  ) {
    return null;
  }

  return getCurrentWeeklyPeriodKst(date).weekEnd;
}

async function processGuildReminders(
  guild: Guild,
  weekEnd: string,
): Promise<void> {
  const [weeklyChannelId, roleId, mappings] = await Promise.all([
    getChannel(guild.id, ChannelSettingType.Weekly),
    getWeeklyRoleId(guild.id),
    listWeeklyThreads(guild.id),
  ]);

  if (!weeklyChannelId || !roleId) {
    return;
  }

  const members = await getAllGuildMembers(guild);
  const targets = members.filter((member) =>
    !member.user.bot
    && member.roles.cache.has(roleId),
  );

  if (targets.size === 0) {
    return;
  }

  const claimedUserIds = await processWeeklyReportReminders({
    guildId: guild.id,
    weekEnd,
    userIds: [...targets.keys()],
  });
  const threadByUserId = new Map(
    mappings.map((mapping) => [mapping.userId, mapping.threadId]),
  );
  let sent = 0;

  for (const userId of claimedUserIds) {
    const member = targets.get(userId);

    if (!member) {
      continue;
    }

    const threadId = threadByUserId.get(userId);
    const reportUrl = threadId
      ? `https://discord.com/channels/${guild.id}/${threadId}`
      : null;

    try {
      await member.send({
        embeds: [new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle('주간보고 작성 리마인드')
          .setDescription([
            '이번 주 주간보고에 제출로 인정되는 스크럼 완료 작업이 아직 없습니다.',
            '프로젝트·스터디·개인 스터디 중 하나의 완료 작업이 최소 1개 필요합니다.',
            '개인 활동이나 주간보고에 직접 추가한 작업만 있는 경우에도 누락으로 집계됩니다.',
            '오늘 19시 전까지 `/scrum`으로 인정 대상 작업을 기록해 주세요. 마감까지 기준을 충족하지 못하면 누락 횟수가 1회 증가합니다.',
            '이미 스크럼을 작성했는데 반영되지 않았다면 관리자에게 `/syncweekly`를 요청해 주세요.',
          ].join('\n'))
          .addFields(
            {
              name: '서버',
              value: guild.name.slice(0, 1_024),
              inline: true,
            },
            {
              name: '마감일',
              value: `${getWeeklyReportDeadlineDate(weekEnd)} (화요일) 19:00`,
              inline: true,
            },
            ...(reportUrl
              ? [{ name: '주간보고 게시물', value: `[게시물 열기](${reportUrl})` }]
              : []),
          )],
        allowedMentions: { parse: [] },
      });
      sent += 1;
    } catch (error) {
      console.warn(
        `[weekly] Failed to send reminder DM to ${userId} in ${guild.id}:`,
        error,
      );
    }
  }

  if (claimedUserIds.length > 0) {
    console.log(
      `[weekly] Sent ${sent}/${claimedUserIds.length} reminder DM(s) for ${guild.id} on ${weekEnd}.`,
    );
  }
}

async function processDueReminders(client: Client): Promise<void> {
  const weekEnd = getDueWeeklyReminderWeekEnd();

  if (!weekEnd) {
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      await processGuildReminders(guild, weekEnd);
    } catch (error) {
      console.error(
        `[weekly] Failed to process reminder DMs for guild ${guild.id}:`,
        error,
      );
    }
  }
}

export function startWeeklyReminderScheduler(client: Client): void {
  if (getConfiguredWeeklyTestDate()) {
    console.log('[weekly] Reminder scheduler is disabled in test-date mode.');
    return;
  }

  void processDueReminders(client);
  cron.schedule('0 12-18 * * 2', () => processDueReminders(client), {
    timezone: 'Asia/Seoul',
    noOverlap: true,
    name: 'weekly-report-reminders',
  });
}
