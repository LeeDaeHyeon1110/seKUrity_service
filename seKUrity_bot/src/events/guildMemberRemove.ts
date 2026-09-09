import { Events } from 'discord.js';
import type { GuildMember } from 'discord.js';
import { archiveWeeklyMemberPost } from '../weekly/forumSync';

export default {
  name: Events.GuildMemberRemove,

  async execute(member: GuildMember): Promise<void> {
    try {
      await archiveWeeklyMemberPost(member.guild, member.id);
    } catch (error) {
      console.error(
        `[weekly] Failed to archive weekly post for departed member ${member.id}:`,
        error,
      );
    }
  },
};
