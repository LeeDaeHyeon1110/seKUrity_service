import { Events } from 'discord.js';
import type { GuildMember } from 'discord.js';
import { archiveWeeklyMemberPost } from '../weekly/forumSync';
import { deactivateWebMember } from '../web/memberSync';

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

    try {
      await deactivateWebMember(member);
    } catch (error) {
      console.error(
        `[web-members] Failed to deactivate departed member ${member.id}:`,
        error,
      );
    }
  },
};
