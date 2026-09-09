import { EmbedBuilder } from 'discord.js';
import type { MessageSnapshot } from '../storage/messageSnapshotStore';

const MAX_FIELD_LENGTH = 1024;

function truncate(value: string, maxLength = MAX_FIELD_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function renderSnapshot(snapshot: MessageSnapshot | null, emptyText: string): string {
  if (!snapshot) {
    return emptyText;
  }

  const parts: string[] = [];
  const content = snapshot.content?.trim();

  if (content) {
    parts.push(content);
  }

  if (snapshot.attachments.length > 0) {
    const attachments = snapshot.attachments
      .map((attachment) => `${attachment.name ?? 'attachment'}: ${attachment.url}`)
      .join('\n');
    parts.push(`Attachments:\n${attachments}`);
  }

  return truncate(parts.join('\n\n') || '(내용 없음)');
}

export function hasMeaningfulChange(
  before: MessageSnapshot | null,
  after: MessageSnapshot,
): boolean {
  if (!before) {
    return true;
  }

  if (before.content !== after.content) {
    return true;
  }

  if (before.attachments.length !== after.attachments.length) {
    return true;
  }

  return before.attachments.some((attachment, index) => {
    const nextAttachment = after.attachments[index];
    return attachment.name !== nextAttachment.name
      || attachment.url !== nextAttachment.url;
  });
}

export function buildEditLogEmbed(
  before: MessageSnapshot | null,
  after: MessageSnapshot,
  messageUrl: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x00b050)
    .setTitle('메시지 수정 기록')
    .setURL(messageUrl)
    .addFields(
      {
        name: '작성자',
        value: after.authorId ? `<@${after.authorId}> (${after.authorId})` : after.authorTag,
        inline: false,
      },
      {
        name: '채널',
        value: `<#${after.channelId}>`,
        inline: true,
      },
      {
        name: '메시지 ID',
        value: `\`${after.messageId}\``,
        inline: true,
      },
      {
        name: '수정 전',
        value: renderSnapshot(before, '(이전 내용 없음: 봇이 기록을 시작하기 전 메시지일 수 있습니다.)'),
        inline: false,
      },
      {
        name: '수정 후',
        value: renderSnapshot(after, '(내용 없음)'),
        inline: false,
      },
    )
    .setTimestamp();
}

export function buildDeleteLogEmbed(input: {
  snapshot: MessageSnapshot | null;
  channelId: string;
  messageId: string;
}): EmbedBuilder {
  const author = input.snapshot?.authorId
    ? `<@${input.snapshot.authorId}> (${input.snapshot.authorId})`
    : input.snapshot?.authorTag ?? '(작성자 정보 없음)';

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('메시지 삭제 기록')
    .addFields(
      {
        name: '작성자',
        value: author,
      },
      {
        name: '채널',
        value: `<#${input.channelId}>`,
        inline: true,
      },
      {
        name: '메시지 ID',
        value: `\`${input.messageId}\``,
        inline: true,
      },
      {
        name: '삭제된 내용',
        value: renderSnapshot(
          input.snapshot,
          '(저장된 내용 없음: 봇이 기록을 시작하기 전 메시지일 수 있습니다.)',
        ),
      },
    )
    .setTimestamp();
}
