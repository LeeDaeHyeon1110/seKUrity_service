import { Events } from 'discord.js';
import type { GuildMember } from 'discord.js';
import { syncWeeklyMemberRoleChange } from '../weekly/forumSync';

export default {
  name: Events.GuildMemberUpdate,

  async execute(
    oldMember: GuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    try {
      await syncWeeklyMemberRoleChange(oldMember, newMember);
    } catch (error) {
      console.error(
        `[weekly] Failed to sync role change for ${newMember.id}:`,
        error,
      );
    }
  },
};
