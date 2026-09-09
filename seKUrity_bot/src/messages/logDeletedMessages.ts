import type {
  Guild,
  GuildTextBasedChannel,
  Message,
  PartialMessage,
} from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { getChannel } from '../storage/guildSettingsStore';
import {
  takeMessageSnapshots,
  type MessageSnapshot,
} from '../storage/messageSnapshotStore';
import { buildDeleteLogEmbed } from './formatEditLog';
import { serializeMessage } from './serializeMessage';

type DeletedMessage = Message<true> | PartialMessage<true>;

async function fetchLogChannel(
  guild: Guild,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  try {
    const channel = await guild.channels.fetch(channelId);
    return channel?.isTextBased()
      ? channel as GuildTextBasedChannel
      : null;
  } catch (error) {
    console.warn(`[messageDelete] Failed to fetch log channel ${channelId}:`, error);
    return null;
  }
}

function deletedSnapshot(
  message: DeletedMessage,
  stored: MessageSnapshot | undefined,
): MessageSnapshot | null {
  if (stored) {
    return stored;
  }

  if (!message.partial) {
    return serializeMessage(message);
  }

  return null;
}

export async function logDeletedMessages(
  guild: Guild,
  messages: Iterable<DeletedMessage>,
): Promise<void> {
  const deleted = [...messages];

  if (deleted.length === 0) {
    return;
  }

  const stored = takeMessageSnapshots(deleted.map((message) => message.id));
  const entries = deleted
    .filter((message) => message.partial || !message.author.bot)
    .map((message) => ({
      message,
      snapshot: deletedSnapshot(message, stored.get(message.id)),
    }));

  if (entries.length === 0) {
    return;
  }

  let logChannelId: string | null;

  try {
    logChannelId = await getChannel(guild.id, ChannelSettingType.Logs);
  } catch (error) {
    console.error('[messageDelete] Failed to load the log channel setting:', error);
    return;
  }

  if (!logChannelId) {
    return;
  }

  const logChannel = await fetchLogChannel(guild, logChannelId);

  if (!logChannel) {
    return;
  }

  for (let index = 0; index < entries.length; index += 10) {
    const batch = entries.slice(index, index + 10);

    try {
      await logChannel.send({
        embeds: batch.map(({ message, snapshot }) =>
          buildDeleteLogEmbed({
            snapshot,
            channelId: message.channelId,
            messageId: message.id,
          })),
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      console.error('[messageDelete] Failed to send deletion log:', error);
    }
  }
}
