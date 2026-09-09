import { Events } from 'discord.js';
import type { Message, PartialMessage } from 'discord.js';
import { logDeletedMessages } from '../messages/logDeletedMessages';

export default {
  name: Events.MessageDelete,

  async execute(message: Message<true> | PartialMessage<true>): Promise<void> {
    await logDeletedMessages(message.guild, [message]);
  },
};
