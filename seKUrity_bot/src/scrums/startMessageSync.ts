import { ChannelType, EmbedBuilder } from 'discord.js';
import type {
  ForumThreadChannel,
  Guild,
  GuildTextBasedChannel,
  Message,
} from 'discord.js';
import { BackendApiError } from '../api/backendClient';
import {
  buildScrumStartRow,
  buildScrumWriteRow,
} from './components';
import {
  formatScrumDate,
  getNextWeeklyScrumDateString,
  getScrumCycleDateString,
  getScrumDeadlineDateString,
} from './dateUtils';
import {
  buildScrumTodoEmbed,
  SCRUM_START_EMBED_TITLE,
} from './formatters';
import {
  getActiveScrumsForGuild,
  getFirstScrumEntryByThread,
} from './scrumStore';
import type { Scrum } from './types';

const SCRUM_ENTRY_TITLE_PATTERN = /^스크럼 - (\d{4}-\d{2}-\d{2})$/;

async function fetchThreadMessages(
  thread: GuildTextBasedChannel,
): Promise<Message[]> {
  const allMessages: Message[] = [];
  let before: string | undefined;

  while (true) {
    const messages = await thread.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    allMessages.push(...messages.values());

    if (messages.size < 100) {
      return allMessages;
    }

    const oldest = [...messages.values()].reduce((current, message) =>
      BigInt(message.id) < BigInt(current.id) ? message : current,
    );

    if (oldest.id === before) {
      return allMessages;
    }

    before = oldest.id;
  }
}

function findScrumStartMessage(
  messages: Message[],
  botUserId: string,
): Message | null {
  return messages.find((message) =>
    message.author.id === botUserId
    && message.embeds.some(
      (embed) => embed.title === SCRUM_START_EMBED_TITLE,
    ),
  ) ?? null;
}

async function syncEntryDateEmbeds(
  messages: Message[],
  botUserId: string,
): Promise<void> {
  for (const message of messages) {
    if (message.author.id !== botUserId || message.embeds.length === 0) {
      continue;
    }

    let changed = false;
    const embeds = message.embeds.map((embed) => {
      const match = embed.title
        ? SCRUM_ENTRY_TITLE_PATTERN.exec(embed.title)
        : null;

      if (!match?.[1]) {
        return EmbedBuilder.from(embed);
      }

      let cycleDate: string;

      try {
        cycleDate = getScrumCycleDateString(match[1]);
      } catch {
        return EmbedBuilder.from(embed);
      }

      const title = `스크럼 - ${getScrumDeadlineDateString(cycleDate)}`;
      const description = `**다음 스크럼 마감**: ${formatScrumDate(
        getNextWeeklyScrumDateString(cycleDate),
      )}`;

      if (embed.title === title && embed.description === description) {
        return EmbedBuilder.from(embed);
      }

      changed = true;
      return EmbedBuilder.from(embed)
        .setTitle(title)
        .setDescription(description);
    });

    if (changed) {
      await message.edit({ embeds });
    }
  }
}

async function updateScrumStartMessage(
  thread: GuildTextBasedChannel,
  messages: Message[],
  scrum: Scrum,
): Promise<boolean> {
  const message = findScrumStartMessage(
    messages,
    thread.client.user.id,
  );

  if (!message) {
    return false;
  }

  const initial = await getScrumStartState(scrum);
  await message.edit({
    embeds: [buildScrumTodoEmbed(initial.scrum)],
    components: [initial.editable ? buildScrumStartRow() : buildScrumWriteRow()],
    allowedMentions: { parse: [] },
  });
  return true;
}

async function getScrumStartState(scrum: Scrum): Promise<{
  scrum: Scrum;
  editable: boolean;
}> {
  try {
    const first = await getFirstScrumEntryByThread(scrum.threadId);
    return {
      scrum: {
        ...first.scrum,
        currentTodos: first.entry.completedItems.map((item) => item.title),
        nextScrumDate: first.entry.scrumDate,
      },
      editable: false,
    };
  } catch (error) {
    if (error instanceof BackendApiError && error.code === 'SCRUM_ENTRY_NOT_FOUND') {
      return { scrum, editable: true };
    }
    throw error;
  }
}

export async function refreshScrumStartMessage(
  thread: GuildTextBasedChannel,
  scrum: Scrum,
): Promise<boolean> {
  return updateScrumStartMessage(
    thread,
    await fetchThreadMessages(thread),
    scrum,
  );
}

async function refreshScrumPost(
  guild: Guild,
  scrum: Scrum,
): Promise<boolean> {
  const channel = await guild.channels.fetch(scrum.threadId);

  if (
    channel?.type !== ChannelType.PublicThread
    || channel.parentId !== scrum.scrumChannelId
  ) {
    return false;
  }

  const thread = channel as ForumThreadChannel;

  if (thread.archived) {
    await thread.setArchived(false, 'Synchronize active scrum post.');
  }

  const messages = await fetchThreadMessages(thread);
  const updated = await updateScrumStartMessage(
    thread,
    messages,
    scrum,
  );

  if (!updated) {
    const initial = await getScrumStartState(scrum);
    await thread.send({
      embeds: [buildScrumTodoEmbed(initial.scrum)],
      components: [initial.editable ? buildScrumStartRow() : buildScrumWriteRow()],
      allowedMentions: { parse: [] },
    });
  }

  await syncEntryDateEmbeds(messages, thread.client.user.id);
  return true;
}

export async function syncScrumPostMessages(
  guild: Guild,
): Promise<number> {
  const scrums = await getActiveScrumsForGuild(guild.id);
  let synchronized = 0;

  for (const scrum of scrums) {
    try {
      if (await refreshScrumPost(
        guild,
        scrum,
      )) {
        synchronized += 1;
      }
    } catch (error) {
      console.warn(
        `[scrum] Failed to synchronize post ${scrum.threadId}:`,
        error,
      );
    }
  }

  return synchronized;
}
