import type { Message } from 'discord.js';
import type { MessageSnapshot } from '../storage/messageSnapshotStore';

export function serializeMessage(message: Message): MessageSnapshot {
  return {
    messageId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    authorId: message.author?.id ?? null,
    authorTag: message.author?.tag ?? 'Unknown user',
    content: message.content ?? '',
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
    })),
    recordedAt: new Date().toISOString(),
  };
}
