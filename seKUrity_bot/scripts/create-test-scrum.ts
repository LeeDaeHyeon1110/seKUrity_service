import 'dotenv/config';

import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { ChannelSettingType } from '../src/constants/channelTypes';
import { ScrumCategory } from '../src/scrums/categories';
import {
  buildScrumCompletionRow,
  buildScrumStartRow,
} from '../src/scrums/components';
import {
  getCurrentWeeklyCycleEndKstDateString,
  getScrumDeadlineDateString,
} from '../src/scrums/dateUtils';
import {
  buildScrumIntroEmbed,
  buildScrumTodoEmbed,
} from '../src/scrums/formatters';
import { ensureAndGetScrumCategoryTagId } from '../src/scrums/forumTags';
import { SCRUM_CHANNEL_REQUIRED_PERMISSIONS } from '../src/scrums/permissions';
import { createScrum } from '../src/scrums/scrumStore';
import { formatScrumThreadName } from '../src/scrums/text';
import type { Scrum } from '../src/scrums/types';
import { getChannel } from '../src/storage/guildSettingsStore';

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function waitUntilReady(client: Client, token: string): Promise<void> {
  const ready = new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });

  await client.login(token);
  await ready;
}

async function main(): Promise<void> {
  const token = requireEnv('DISCORD_TOKEN');
  const guildId = requireEnv('DISCORD_GUILD_ID');
  requireEnv('BACKEND_API_TOKEN');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  try {
    await waitUntilReady(client, token);

    const guild = await client.guilds.fetch(guildId);
    const testUserId = process.argv[2]
      ?? process.env.DISCORD_TEST_USER_ID
      ?? guild.ownerId;
    const testMember = await guild.members.fetch(testUserId);

    if (testMember.user.bot) {
      throw new Error('The test scrum owner must be a non-bot guild member.');
    }

    const scrumChannelId = await getChannel(
      guildId,
      ChannelSettingType.Scrums,
    );

    if (!scrumChannelId) {
      throw new Error('Configure a scrum forum with /setchannel type: scrums first.');
    }

    const scrumChannel = await guild.channels.fetch(scrumChannelId);

    if (scrumChannel?.type !== ChannelType.GuildForum) {
      throw new Error('The configured scrum channel is not a forum channel.');
    }

    const botMember = await guild.members.fetchMe();

    if (!scrumChannel.permissionsFor(botMember).has([
      ...SCRUM_CHANNEL_REQUIRED_PERMISSIONS,
    ])) {
      throw new Error('The bot is missing required permissions in the scrum forum.');
    }

    const nextScrumDate = getCurrentWeeklyCycleEndKstDateString();
    const projectName = `스크럼 테스트 ${getScrumDeadlineDateString(nextScrumDate)}`;
    const category = ScrumCategory.Study;
    const ownerIds = [testUserId];
    const overview = '스크럼 작성 흐름과 링크, 첨부파일, 미완료 표시를 확인하기 위한 테스트 프로젝트입니다.';
    const currentTodos = [
      'HTTP 링크를 증빙으로 등록하고 메모 작성하기',
      '파일을 증빙으로 첨부하고 메모 작성하기',
      '증빙 없이 제출해 미완료 표시 확인하기',
    ];
    const categoryTagId = await ensureAndGetScrumCategoryTagId(
      scrumChannel,
      category,
    );
    const introEmbed = buildScrumIntroEmbed({
      projectName,
      ownerIds,
      category,
      planningDocument: null,
      projectScoreDocument: null,
      overview,
      currentTodos,
    });
    const todoEmbed = buildScrumTodoEmbed({
      projectName,
      ownerIds,
      category,
      planningDocument: null,
      projectScoreDocument: null,
      overview,
      currentTodos,
      nextScrumDate,
    });
    const post = await scrumChannel.threads.create({
      name: formatScrumThreadName(
        testMember.displayName,
        `${projectName}-${Date.now()}`,
      ),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      appliedTags: [categoryTagId],
      message: {
        embeds: [introEmbed],
        components: [buildScrumCompletionRow()],
        allowedMentions: {
          users: ownerIds,
        },
      },
      reason: `Test scrum created for ${testMember.user.tag}`,
    });
    await post.send({
      embeds: [todoEmbed],
      components: [buildScrumStartRow()],
    });

    try {
      await post.members.add(testUserId);
    } catch (error) {
      console.warn(`Failed to add ${testUserId} to forum post ${post.id}:`, error);
    }

    let scrum: Scrum;

    try {
      scrum = await createScrum({
        guildId,
        scrumChannelId,
        threadId: post.id,
        creatorId: testUserId,
        ownerIds,
        projectName,
        overview,
        category,
        planningDocument: null,
        projectScoreDocument: null,
        currentTodos,
        nextScrumDate,
      });
    } catch (error) {
      try {
        await post.delete('Backend failed to persist the test scrum.');
      } catch (deleteError) {
        throw new AggregateError(
          [error, deleteError],
          `Backend storage failed and the orphaned forum post could not be removed: ${post.url}`,
        );
      }

      throw new Error(
        'Backend storage failed. The test forum post was removed.',
        { cause: error },
      );
    }

    try {
      const starterMessage = await post.fetchStarterMessage();

      if (starterMessage) {
        await starterMessage.edit({
          embeds: [buildScrumIntroEmbed(scrum)],
          components: [buildScrumCompletionRow()],
        });
        await starterMessage.pin();
      }
    } catch (error) {
      console.warn(`Failed to update or pin starter message for ${post.id}:`, error);
    }

    console.log([
      'Created a test scrum.',
      `Scrum ID: ${scrum.id}`,
      `Forum post: ${post.url}`,
      `Test user: ${testMember.user.tag} (${testUserId})`,
      `next_scrum_date: ${nextScrumDate}`,
      'The test user can now run /scrum.',
    ].join('\n'));
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
