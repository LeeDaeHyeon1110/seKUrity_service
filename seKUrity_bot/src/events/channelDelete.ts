import { Events } from 'discord.js';
import type { GuildBasedChannel } from 'discord.js';
import { removeConfiguredChannelById } from '../storage/configuredChannelCleanup';

export default {
  name: Events.ChannelDelete,

  async execute(channel: GuildBasedChannel): Promise<void> {
    try {
      const removedTypes = await removeConfiguredChannelById(
        channel.guild.id,
        channel.id,
      );

      if (removedTypes.length > 0) {
        console.log(
          `[channels] Removed deleted channel ${channel.id} from ${removedTypes.join(', ')} settings in guild ${channel.guild.id}.`,
        );
      }
    } catch (error) {
      console.error(
        `[channels] Failed to clear deleted channel ${channel.id}:`,
        error,
      );
    }
  },
};
