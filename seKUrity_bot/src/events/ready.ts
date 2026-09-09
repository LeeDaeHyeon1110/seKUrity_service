import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { reconcileDeletedConfiguredChannels } from '../storage/configuredChannelCleanup';
import { syncWeeklyForum } from '../weekly/forumSync';
import { startWeeklyMissScheduler } from '../weekly/missScheduler';
import { startWeeklyReminderScheduler } from '../weekly/reminderScheduler';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client: Client<true>): Promise<void> {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
      try {
        const removedTypes = await reconcileDeletedConfiguredChannels(guild);

        if (removedTypes.length > 0) {
          console.log(
            `[channels] Removed stale ${removedTypes.join(', ')} settings in guild ${guild.id}.`,
          );
        }

        await syncWeeklyForum(guild);
      } catch (error) {
        console.error(
          `[weekly] Failed to sync weekly forum for guild ${guild.id}:`,
          error,
        );
      }
    }

    startWeeklyMissScheduler(client);
    startWeeklyReminderScheduler(client);
  },
};
