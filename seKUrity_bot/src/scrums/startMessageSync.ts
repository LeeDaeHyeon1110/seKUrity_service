import { ChannelType, EmbedBuilder } from 'discord.js';
import type {
  ForumThreadChannel,
  Guild,
  GuildTextBasedChannel,
  Message,
} from 'discord.js';
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
  getInitialTodosEditableScrums,
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
  editable: boolean,
): Promise<boolean> {
  const message = findScrumStartMessage(
    messages,
    thread.client.user.id,
  );

  if (!message) {
    return false;
  }

  await message.edit({
    embeds: [buildScrumTodoEmbed(scrum)],
    components: [editable ? buildScrumStartRow() : buildScrumWriteRow()],
    allowedMentions: { parse: [] },
  });
  return true;
}

export async function refreshScrumStartMessage(
  thread: GuildTextBasedChannel,
  scrum: Scrum,
  editable: boolean,
): Promise<boolean> {
  return updateScrumStartMessage(
    thread,
    await fetchThreadMessages(thread),
    scrum,
    editable,
  );
}

async function refreshScrumPost(
  guild: Guild,
  scrum: Scrum,
  editable: boolean,
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
    editable,
  );

  if (!updated && editable) {
    await thread.send({
      embeds: [buildScrumTodoEmbed(scrum)],
      components: [buildScrumStartRow()],
      allowedMentions: { parse: [] },
    });
  }

  await syncEntryDateEmbeds(messages, thread.client.user.id);
  return true;
}

export async function syncScrumPostMessages(
  guild: Guild,
): Promise<number> {
  const [scrums, editableScrums] = await Promise.all([
    getActiveScrumsForGuild(guild.id),
    getInitialTodosEditableScrums(guild.id),
  ]);
  const editableIds = new Set(editableScrums.map((scrum) => scrum.id));
  let synchronized = 0;

  for (const scrum of scrums) {
    try {
      if (await refreshScrumPost(
        guild,
        scrum,
        editableIds.has(scrum.id),
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
