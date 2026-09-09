import {
  ChannelType,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type {
  ForumChannel,
  ForumThreadChannel,
  Guild,
  GuildForumTagData,
  GuildMember,
} from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import { truncateText } from '../scrums/text';
import {
  buildWeeklyStartRow,
} from './components';
import { buildWeeklyStarterContent } from './formatters';
import { getAllGuildMembers } from './memberCache';
import {
  getWeeklyRoleId,
  getWeeklyThread,
  listWeeklyThreads,
  upsertWeeklyThread,
} from './weeklyStore';

const MAX_FORUM_TAGS = 20;
const WEEKLY_TAG_NAME = '주간보고';
const memberPostLocks = new Map<string, Promise<ForumThreadChannel>>();

export async function ensureWeeklyTagId(
  channel: ForumChannel,
): Promise<string> {
  const existing = channel.availableTags.find(
    (tag) => tag.name === WEEKLY_TAG_NAME,
  );

  if (existing) {
    return existing.id;
  }

  if (channel.availableTags.length >= MAX_FORUM_TAGS) {
    throw new Error('주간보고 태그를 추가할 포럼 태그 공간이 없습니다.');
  }

  const existingTags: GuildForumTagData[] = channel.availableTags.map(
    (tag) => ({
      id: tag.id,
      name: tag.name,
      moderated: tag.moderated,
      emoji: tag.emoji,
    }),
  );
  const updated = await channel.setAvailableTags(
    [
      ...existingTags,
      {
        name: WEEKLY_TAG_NAME,
        moderated: false,
      },
    ],
    'Ensure weekly report forum tag.',
  );
  const tag = updated.availableTags.find(
    (candidate) => candidate.name === WEEKLY_TAG_NAME,
  );

  if (!tag) {
    throw new Error('주간보고 포럼 태그를 찾을 수 없습니다.');
  }

  return tag.id;
}

async function fetchWeeklyForum(
  guild: Guild,
): Promise<ForumChannel | null> {
  const channelId = await getChannel(
    guild.id,
    ChannelSettingType.Weekly,
  );

  if (!channelId) {
    return null;
  }

  const channel = await guild.channels.fetch(channelId);
  return channel?.type === ChannelType.GuildForum
    ? channel
    : null;
}

async function refreshThread(
  thread: ForumThreadChannel,
  member: GuildMember,
  tagId: string,
): Promise<void> {
  if (thread.archived) {
    await thread.setArchived(false, 'Restore weekly report post.');
  }

  if (thread.locked) {
    await thread.setLocked(false, 'Restore weekly report post.');
  }

  await thread.setAppliedTags([tagId], 'Refresh weekly report tag.');
  await thread.setName(
    truncateText(`[${member.displayName}] 주간보고`, 100),
    'Refresh weekly report post name.',
  );
  const starter = await thread.fetchStarterMessage();

  if (!starter) {
    throw new Error('Weekly report starter message not found.');
  }

  await starter.edit({
    content: buildWeeklyStarterContent(member.id),
    embeds: [],
    components: [buildWeeklyStartRow(member.id)],
    allowedMentions: {
      users: [member.id],
    },
  });
}

async function archiveMappedThread(
  guild: Guild,
  threadId: string,
): Promise<void> {
  try {
    const channel = await guild.channels.fetch(threadId);

    if (!channel?.isThread()) {
      return;
    }

    await channel.edit({
      archived: true,
      locked: true,
      reason: 'Weekly report target role removed.',
    });
  } catch (error) {
    console.warn(
      `[weekly] Failed to archive weekly thread ${threadId}:`,
      error,
    );
  }
}

async function ensureWeeklyMemberPostInternal(
  guild: Guild,
  member: GuildMember,
): Promise<ForumThreadChannel> {
  if (member.user.bot) {
    throw new Error('Bots do not receive weekly report posts.');
  }

  const [forum, roleId, mapping] = await Promise.all([
    fetchWeeklyForum(guild),
    getWeeklyRoleId(guild.id),
    getWeeklyThread(guild.id, member.id),
  ]);

  if (!forum || !roleId) {
    throw new Error('주간보고 포럼 또는 대상 역할이 설정되지 않았습니다.');
  }

  if (!member.roles.cache.has(roleId)) {
    throw new Error('주간보고 대상 역할이 없습니다.');
  }

  const tagId = await ensureWeeklyTagId(forum);

  if (mapping?.channelId === forum.id) {
    try {
      const channel = await guild.channels.fetch(mapping.threadId);

      if (
        channel?.type === ChannelType.PublicThread
        && channel.parentId === forum.id
      ) {
        await refreshThread(channel, member, tagId);
        return channel;
      }
    } catch (error) {
      console.warn(
        `[weekly] Failed to refresh mapped thread ${mapping.threadId}:`,
        error,
      );
    }
  } else if (mapping) {
    await archiveMappedThread(guild, mapping.threadId);
  }

  const thread = await forum.threads.create({
    name: truncateText(`[${member.displayName}] 주간보고`, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    appliedTags: [tagId],
    message: {
      content: buildWeeklyStarterContent(member.id),
      components: [buildWeeklyStartRow(member.id)],
      allowedMentions: {
        users: [member.id],
      },
    },
    reason: `Create weekly report post for ${member.user.tag}`,
  });

  await upsertWeeklyThread({
    guildId: guild.id,
    userId: member.id,
    channelId: forum.id,
    threadId: thread.id,
  });
  return thread;
}

export async function ensureWeeklyMemberPost(
  guild: Guild,
  member: GuildMember,
): Promise<ForumThreadChannel> {
  const key = `${guild.id}:${member.id}`;
  const existing = memberPostLocks.get(key);

  if (existing) {
    return existing;
  }

  const pending = ensureWeeklyMemberPostInternal(guild, member)
    .finally(() => {
      memberPostLocks.delete(key);
    });
  memberPostLocks.set(key, pending);
  return pending;
}

export async function syncWeeklyForum(guild: Guild): Promise<{
  active: number;
  archived: number;
  userIds: string[];
}> {
  const [forum, roleId] = await Promise.all([
    fetchWeeklyForum(guild),
    getWeeklyRoleId(guild.id),
  ]);

  if (!forum || !roleId) {
    return { active: 0, archived: 0, userIds: [] };
  }

  await ensureWeeklyTagId(forum);
  const members = await getAllGuildMembers(guild);
  const targets = members.filter((member) =>
    !member.user.bot
    && member.roles.cache.has(roleId),
  );
  const targetIds = new Set(targets.keys());

  for (const member of targets.values()) {
    await ensureWeeklyMemberPost(guild, member);
  }

  const mappings = await listWeeklyThreads(guild.id);
  let archived = 0;

  for (const mapping of mappings) {
    if (targetIds.has(mapping.userId)) {
      continue;
    }

    await archiveMappedThread(guild, mapping.threadId);
    archived += 1;
  }

  return {
    active: targets.size,
    archived,
    userIds: [...targetIds],
  };
}

export async function archiveAllWeeklyThreads(guild: Guild): Promise<number> {
  const mappings = await listWeeklyThreads(guild.id);

  for (const mapping of mappings) {
    await archiveMappedThread(guild, mapping.threadId);
  }

  return mappings.length;
}

export async function syncWeeklyMemberRoleChange(
  oldMember: GuildMember,
  newMember: GuildMember,
): Promise<void> {
  const roleId = await getWeeklyRoleId(newMember.guild.id);

  if (!roleId) {
    return;
  }

  const hadRole = oldMember.roles.cache.has(roleId);
  const hasRole = newMember.roles.cache.has(roleId);

  if (hadRole === hasRole || newMember.user.bot) {
    return;
  }

  if (hasRole) {
    await ensureWeeklyMemberPost(newMember.guild, newMember);
    return;
  }

  const mapping = await getWeeklyThread(newMember.guild.id, newMember.id);

  if (mapping) {
    await archiveMappedThread(newMember.guild, mapping.threadId);
  }
}

export async function syncWeeklyMemberJoin(
  member: GuildMember,
): Promise<void> {
  if (member.user.bot) {
    return;
  }

  const roleId = await getWeeklyRoleId(member.guild.id);

  if (roleId && member.roles.cache.has(roleId)) {
    await ensureWeeklyMemberPost(member.guild, member);
  }
}

export async function archiveWeeklyMemberPost(
  guild: Guild,
  userId: string,
): Promise<void> {
  const mapping = await getWeeklyThread(guild.id, userId);

  if (mapping) {
    await archiveMappedThread(guild, mapping.threadId);
  }
}
