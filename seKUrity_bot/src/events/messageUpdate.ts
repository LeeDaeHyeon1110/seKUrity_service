import { Events } from 'discord.js';
import type { Guild, GuildTextBasedChannel, Message, PartialMessage } from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { buildEditLogEmbed, hasMeaningfulChange } from '../messages/formatEditLog';
import { serializeMessage } from '../messages/serializeMessage';
import { getChannel } from '../storage/guildSettingsStore';
import {
  getMessageSnapshot,
  saveMessageSnapshot,
} from '../storage/messageSnapshotStore';

async function fetchIfPartial(message: Message | PartialMessage): Promise<Message | null> {
  if (!message.partial) {
    return message;
  }

  try {
    return await message.fetch();
  } catch (error) {
    console.warn(`[messageUpdate] Failed to fetch partial message ${message.id}:`, error);
    return null;
  }
}

async function fetchLogChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel | null> {
  try {
    const channel = await guild.channels.fetch(channelId);

    if (!channel?.isTextBased()) {
      return null;
    }

    return channel as GuildTextBasedChannel;
  } catch (error) {
    console.warn(`[messageUpdate] Failed to fetch log channel ${channelId}:`, error);
    return null;
  }
}

export default {
  name: Events.MessageUpdate,

  async execute(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
    const message = await fetchIfPartial(newMessage);

    if (!message || !message.inGuild() || message.author.bot) {
      return;
    }

    const after = serializeMessage(message);
    const before = getMessageSnapshot(message.id)
      ?? (!oldMessage.partial ? serializeMessage(oldMessage) : null);

    saveMessageSnapshot(after);

    if (!hasMeaningfulChange(before, after)) {
      return;
    }

    let logChannelId: string | null;

    try {
      logChannelId = await getChannel(
        message.guildId,
        ChannelSettingType.Logs,
      );
    } catch (error) {
      console.error('[messageUpdate] Failed to load the log channel setting:', error);
      return;
    }

    if (!logChannelId) {
      return;
    }

    const logChannel = await fetchLogChannel(message.guild, logChannelId);

    if (!logChannel?.isTextBased()) {
      return;
    }

    await logChannel.send({
      embeds: [buildEditLogEmbed(before, after, message.url)],
      allowedMentions: {
        parse: [],
      },
    });
  },
};
