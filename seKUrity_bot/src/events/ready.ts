import { Events } from 'discord.js';
import type { Client } from 'discord.js';
import { syncConfiguredScrumGuidePost } from '../scrums/forumGuide';
import { syncScrumPostMessages } from '../scrums/startMessageSync';
import { reconcileDeletedConfiguredChannels } from '../storage/configuredChannelCleanup';
import { syncWeeklyForum } from '../weekly/forumSync';
import { startWeeklyMissScheduler } from '../weekly/missScheduler';
import { startWeeklyReminderScheduler } from '../weekly/reminderScheduler';
import { syncCurrentWeeklyReportsForScrumLifecycle } from '../weekly/syncService';
import { reconcileConfiguredWebGuild } from '../web/memberSync';

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
      } catch (error) {
        console.error(
          `[channels] Failed to reconcile configured channels for guild ${guild.id}:`,
          error,
        );
      }

      try {
        const guide = await syncConfiguredScrumGuidePost(guild);

        if (guide) {
          console.log(
            `[scrum] Synchronized guide post ${guide.id} in guild ${guild.id}.`,
          );
        }
      } catch (error) {
        console.error(
          `[scrum] Failed to sync guide post for guild ${guild.id}:`,
          error,
        );
      }

      try {
        const synchronized = await syncScrumPostMessages(guild);

        if (synchronized > 0) {
          console.log(
            `[scrum] Synchronized ${synchronized} active scrum post(s) in guild ${guild.id}.`,
          );
        }
      } catch (error) {
        console.error(
          `[scrum] Failed to sync active posts for guild ${guild.id}:`,
          error,
        );
      }

      try {
        const result = await syncWeeklyForum(guild);
        await syncCurrentWeeklyReportsForScrumLifecycle({
          client,
          guild,
          userIds: result.userIds,
          createIfMissing: true,
        });
      } catch (error) {
        console.error(
          `[weekly] Failed to sync weekly forum for guild ${guild.id}:`,
          error,
        );
      }
    }

    try {
      await reconcileConfiguredWebGuild(client);
    } catch (error) {
      console.error('[web-members] Failed to reconcile the configured web guild:', error);
    }

    startWeeklyMissScheduler(client);
    startWeeklyReminderScheduler(client);
  },
};
