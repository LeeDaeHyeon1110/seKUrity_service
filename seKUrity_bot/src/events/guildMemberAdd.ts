import { Events } from 'discord.js';
import type { GuildMember } from 'discord.js';
import { syncWeeklyMemberJoin } from '../weekly/forumSync';

export default {
  name: Events.GuildMemberAdd,

  async execute(member: GuildMember): Promise<void> {
    try {
      await syncWeeklyMemberJoin(member);
    } catch (error) {
      console.error(
        `[weekly] Failed to create weekly post for new member ${member.id}:`,
        error,
      );
    }
  },
};
