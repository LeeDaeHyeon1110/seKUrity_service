import {
  DiscordAPIError,
  RESTJSONErrorCodes,
} from 'discord.js';
import type { Guild } from 'discord.js';
import { ChannelSettingType } from '../constants/channelTypes';
import { unsetWeeklyRoleId } from '../weekly/weeklyStore';
import {
  getChannel,
  unsetChannel,
} from './guildSettingsStore';

const CHANNEL_SETTING_TYPES = Object.values(ChannelSettingType);

export async function removeConfiguredChannelById(
  guildId: string,
  channelId: string,
): Promise<ChannelSettingType[]> {
  const settings = await Promise.all(
    CHANNEL_SETTING_TYPES.map(async (type) => ({
      type,
      channelId: await getChannel(guildId, type),
    })),
  );
  const matchedTypes = settings
    .filter((setting) => setting.channelId === channelId)
    .map((setting) => setting.type);

  for (const type of matchedTypes) {
    await unsetChannel(guildId, type);

    if (type === ChannelSettingType.Weekly) {
      await unsetWeeklyRoleId(guildId);
    }
  }

  return matchedTypes;
}

function isUnknownChannel(error: unknown): boolean {
  return error instanceof DiscordAPIError
    && error.code === RESTJSONErrorCodes.UnknownChannel;
}

export async function reconcileDeletedConfiguredChannels(
  guild: Guild,
): Promise<ChannelSettingType[]> {
  const removedTypes: ChannelSettingType[] = [];

  for (const type of CHANNEL_SETTING_TYPES) {
    const channelId = await getChannel(guild.id, type);

    if (!channelId) {
      continue;
    }

    try {
      const channel = await guild.channels.fetch(channelId);

      if (channel) {
        continue;
      }
    } catch (error) {
      if (!isUnknownChannel(error)) {
        console.warn(
          `[channels] Could not verify configured ${type} channel ${channelId}:`,
          error,
        );
        continue;
      }
    }

    removedTypes.push(
      ...await removeConfiguredChannelById(guild.id, channelId),
    );
  }

  return [...new Set(removedTypes)];
}
