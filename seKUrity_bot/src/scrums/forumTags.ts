import type { ForumChannel, GuildForumTagData } from 'discord.js';
import {
  SCRUM_CATEGORY_LABELS,
  ScrumCategory,
} from './categories';

const MAX_FORUM_TAGS = 20;
export const SCRUM_GUIDE_TAG_NAME = '안내';

export const SCRUM_CATEGORY_TAG_NAMES: Record<ScrumCategory, string> = {
  [ScrumCategory.Project]: SCRUM_CATEGORY_LABELS[ScrumCategory.Project],
  [ScrumCategory.Study]: SCRUM_CATEGORY_LABELS[ScrumCategory.Study],
  [ScrumCategory.PersonalStudy]: SCRUM_CATEGORY_LABELS[ScrumCategory.PersonalStudy],
  [ScrumCategory.Personal]: SCRUM_CATEGORY_LABELS[ScrumCategory.Personal],
};

export class ForumTagConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForumTagConfigurationError';
  }
}

export function getScrumCategoryTagId(
  channel: ForumChannel,
  category: ScrumCategory,
): string | null {
  return channel.availableTags.find(
    (tag) => tag.name === SCRUM_CATEGORY_TAG_NAMES[category],
  )?.id ?? null;
}

export async function ensureScrumCategoryTags(
  channel: ForumChannel,
): Promise<ForumChannel> {
  const existingNames = new Set(channel.availableTags.map((tag) => tag.name));
  const missingTags = Object.values(ScrumCategory)
    .filter((category) => !existingNames.has(SCRUM_CATEGORY_TAG_NAMES[category]))
    .map((category) => ({
      name: SCRUM_CATEGORY_TAG_NAMES[category],
      moderated: false,
    }));

  if (missingTags.length === 0) {
    return channel;
  }

  if (channel.availableTags.length + missingTags.length > MAX_FORUM_TAGS) {
    throw new ForumTagConfigurationError(
      `포럼 태그가 ${MAX_FORUM_TAGS}개를 초과하여 스크럼 분류 태그를 추가할 수 없습니다.`,
    );
  }

  const existingTags: GuildForumTagData[] = channel.availableTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    moderated: tag.moderated,
    emoji: tag.emoji,
  }));

  return channel.setAvailableTags(
    [...existingTags, ...missingTags],
    'Ensure scrum category forum tags.',
  );
}

export async function ensureAndGetScrumCategoryTagId(
  channel: ForumChannel,
  category: ScrumCategory,
): Promise<string> {
  const updatedChannel = await ensureScrumCategoryTags(channel);
  const tagId = getScrumCategoryTagId(updatedChannel, category);

  if (!tagId) {
    throw new ForumTagConfigurationError(
      `${SCRUM_CATEGORY_TAG_NAMES[category]} 분류 태그를 찾을 수 없습니다.`,
    );
  }

  return tagId;
}

export async function ensureAndGetScrumGuideTagId(
  channel: ForumChannel,
): Promise<string> {
  const existingTag = channel.availableTags.find(
    (tag) => tag.name === SCRUM_GUIDE_TAG_NAME,
  );

  if (existingTag) {
    return existingTag.id;
  }

  if (channel.availableTags.length >= MAX_FORUM_TAGS) {
    throw new ForumTagConfigurationError(
      `포럼 태그가 ${MAX_FORUM_TAGS}개이므로 안내 태그를 추가할 수 없습니다.`,
    );
  }

  const existingTags: GuildForumTagData[] = channel.availableTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    moderated: tag.moderated,
    emoji: tag.emoji,
  }));
  const updatedChannel = await channel.setAvailableTags(
    [
      ...existingTags,
      {
        name: SCRUM_GUIDE_TAG_NAME,
        moderated: false,
      },
    ],
    'Ensure scrum guide forum tag.',
  );
  const guideTag = updatedChannel.availableTags.find(
    (tag) => tag.name === SCRUM_GUIDE_TAG_NAME,
  );

  if (!guideTag) {
    throw new ForumTagConfigurationError(
      '스크럼 안내 태그를 찾을 수 없습니다.',
    );
  }

  return guideTag.id;
}
