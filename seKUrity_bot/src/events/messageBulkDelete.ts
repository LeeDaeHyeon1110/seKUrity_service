import { Events } from 'discord.js';
import type {
  GuildTextBasedChannel,
  Message,
  PartialMessage,
  ReadonlyCollection,
  Snowflake,
} from 'discord.js';
import { logDeletedMessages } from '../messages/logDeletedMessages';

export default {
  name: Events.MessageBulkDelete,

  async execute(
    messages: ReadonlyCollection<
      Snowflake,
      Message<true> | PartialMessage<true>
    >,
    channel: GuildTextBasedChannel,
  ): Promise<void> {
    await logDeletedMessages(channel.guild, messages.values());
  },
};
