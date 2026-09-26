import { Events } from 'discord.js';
import type { Client, User } from 'discord.js';
import { isWebAuthGuild, syncWebMember } from '../web/memberSync';

export default {
  name: Events.UserUpdate,

  async execute(
    _oldUser: User,
    newUser: User,
    client: Client,
  ): Promise<void> {
    if (newUser.bot) {
      return;
    }

    const guild = client.guilds.cache.find((candidate) =>
      isWebAuthGuild(candidate.id));
    const member = guild?.members.cache.get(newUser.id);

    if (!member) {
      return;
    }

    try {
      await syncWebMember(member);
    } catch (error) {
      console.error(
        `[web-members] Failed to sync Discord profile change for ${newUser.id}:`,
        error,
      );
    }
  },
};
