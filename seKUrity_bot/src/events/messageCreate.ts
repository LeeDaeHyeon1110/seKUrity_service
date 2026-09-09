import { Events } from 'discord.js';
import type { Message } from 'discord.js';
import { serializeMessage } from '../messages/serializeMessage';
import { saveMessageSnapshot } from '../storage/messageSnapshotStore';

export default {
  name: Events.MessageCreate,

  execute(message: Message): void {
    if (!message.inGuild() || message.author.bot) {
      return;
    }

    saveMessageSnapshot(serializeMessage(message));
  },
};
