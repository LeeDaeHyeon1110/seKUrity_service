import { ChannelFlags, ThreadAutoArchiveDuration } from 'discord.js';
import type { ForumChannel, ForumThreadChannel } from 'discord.js';
import { buildNewScrumLaunchRow } from './components';
import { ensureAndGetScrumGuideTagId } from './forumTags';

export const SCRUM_GUIDE_POST_NAME = '스크럼 작성 방법';

export const SCRUM_GUIDE_CONTENT = [
  '## 스크럼 작성 방법',
  '',
  '`/newscrum` 및 아래의 버튼을 통해 스크럼 구분, 제목, 개요 등을 작성한 후 요청을 보내면, 운영진 심사 후 스크럼을 열 수 있습니다.',
  '',
  '`/scrum`을 통해 어느 날이든 이번 주차 스크럼을 작성할 수 있습니다. 주차는 월요일 00:00에 마감됩니다.',
  '',
  '작성하신 스크럼은 매주마다 주간보고에 올라가게 됩니다.',
  '',
  '각 작업에는 첨부 파일 또는 링크가 필요합니다. 완료하지 못한 작업은 첨부 파일과 링크 없이 메모에 사유를 적어 주세요.',
].join('\n');

async function findGuidePost(
  channel: ForumChannel,
): Promise<ForumThreadChannel | null> {
  const isGuidePost = (thread: {
    parentId: string | null;
    ownerId: string;
    name: string;
  }): boolean =>
    thread.parentId === channel.id
    && thread.ownerId === channel.client.user.id
    && thread.name === SCRUM_GUIDE_POST_NAME;
  const active = await channel.threads.fetchActive();
  const activeGuide = active.threads.find(isGuidePost);

  if (activeGuide) {
    return activeGuide as ForumThreadChannel;
  }

  const archived = await channel.threads.fetchArchived({
    type: 'public',
    limit: 100,
  });

  return (
    archived.threads.find(isGuidePost) as ForumThreadChannel | undefined
  ) ?? null;
}

async function refreshGuidePost(
  thread: ForumThreadChannel,
  guideTagId: string,
): Promise<ForumThreadChannel> {
  if (thread.archived) {
    await thread.setArchived(false, 'Refresh scrum guide post.');
  }

  if (thread.locked) {
    await thread.setLocked(false, 'Refresh scrum guide post.');
  }

  await thread.setAppliedTags([guideTagId], 'Refresh scrum guide tag.');

  const starterMessage = await thread.fetchStarterMessage();

  if (!starterMessage) {
    throw new Error('The scrum guide starter message was not found.');
  }

  await starterMessage.edit({
    content: SCRUM_GUIDE_CONTENT,
    components: [buildNewScrumLaunchRow()],
    allowedMentions: {
      parse: [],
    },
  });

  if (!thread.flags.has(ChannelFlags.Pinned)) {
    await thread.pin('Keep the scrum guide at the top of the forum.');
  }

  return thread;
}

export async function ensureScrumGuidePost(
  channel: ForumChannel,
): Promise<ForumThreadChannel> {
  const guideTagId = await ensureAndGetScrumGuideTagId(channel);
  const existingGuide = await findGuidePost(channel);

  if (existingGuide) {
    return refreshGuidePost(existingGuide, guideTagId);
  }

  const guide = await channel.threads.create({
    name: SCRUM_GUIDE_POST_NAME,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    appliedTags: [guideTagId],
    message: {
      content: SCRUM_GUIDE_CONTENT,
      components: [buildNewScrumLaunchRow()],
      allowedMentions: {
        parse: [],
      },
    },
    reason: 'Create the scrum usage guide.',
  });

  await guide.pin('Keep the scrum guide at the top of the forum.');
  return guide;
}
