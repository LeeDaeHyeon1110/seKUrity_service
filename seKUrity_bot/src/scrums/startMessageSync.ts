import { ChannelType } from 'discord.js';
import type {
  ForumThreadChannel,
  Guild,
  GuildTextBasedChannel,
  Message,
} from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import {
  buildScrumStartRow,
  buildScrumWriteRow,
} from './components';
import {
  buildScrumTodoEmbed,
  SCRUM_START_EMBED_TITLE,
} from './formatters';
import { getInitialTodosEditableScrums } from './scrumStore';

async function findScrumStartMessage(
  thread: GuildTextBasedChannel,
): Promise<Message | null> {
  let before: string | undefined;

  while (true) {
    const messages = await thread.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    const startMessage = messages.find((message) =>
      message.author.id === thread.client.user.id
      && message.embeds.some(
        (embed) => embed.title === SCRUM_START_EMBED_TITLE,
      ),
    );

    if (startMessage) {
      return startMessage;
    }

    if (messages.size < 100) {
      return null;
    }

    const oldest = [...messages.values()].reduce((current, message) =>
      BigInt(message.id) < BigInt(current.id) ? message : current,
    );

    if (oldest.id === before) {
      return null;
    }

    before = oldest.id;
  }
}

export async function setScrumStartEditingEnabled(
  thread: GuildTextBasedChannel,
  enabled: boolean,
): Promise<boolean> {
  const message = await findScrumStartMessage(thread);

  if (!message) {
    return false;
  }

  await message.edit({
    components: [
      enabled ? buildScrumStartRow() : buildScrumWriteRow(),
    ],
  });
  return true;
}

async function refreshEditableScrumStart(
  guild: Guild,
  forumId: string,
  scrum: Awaited<ReturnType<typeof getInitialTodosEditableScrums>>[number],
): Promise<boolean> {
  if (scrum.scrumChannelId !== forumId) {
    return false;
  }

  const channel = await guild.channels.fetch(scrum.threadId);

  if (
    channel?.type !== ChannelType.PublicThread
    || channel.parentId !== forumId
  ) {
    return false;
  }

  const thread = channel as ForumThreadChannel;

  if (thread.archived) {
    await thread.setArchived(false, 'Restore editable scrum start post.');
  }

  if (await setScrumStartEditingEnabled(thread, true)) {
    return true;
  }

  await thread.send({
    embeds: [buildScrumTodoEmbed(scrum)],
    components: [buildScrumStartRow()],
    allowedMentions: { parse: [] },
  });
  return true;
}

export async function syncEditableScrumStartMessages(
  guild: Guild,
): Promise<number> {
  const forumId = await getChannel(guild.id, ChannelSettingType.Scrums);

  if (!forumId) {
    return 0;
  }

  const scrums = await getInitialTodosEditableScrums(guild.id);
  let synchronized = 0;

  for (const scrum of scrums) {
    try {
      if (await refreshEditableScrumStart(guild, forumId, scrum)) {
        synchronized += 1;
      }
    } catch (error) {
      console.warn(
        `[scrum] Failed to refresh start message for ${scrum.threadId}:`,
        error,
      );
    }
  }

  return synchronized;
}
