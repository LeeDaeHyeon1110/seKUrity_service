import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { SCRUM_CATEGORY_LABELS } from './categories';
import type { Scrum, ScrumEntry, ScrumRequest } from './types';
import {
  formatScrumDate,
  getScrumDeadlineDateString,
} from './dateUtils';
import { formatList, truncateText } from './text';

export const SCRUM_START_EMBED_TITLE = '스크럼 - 시작';

function formatOwners(ownerIds: string[]): string {
  return ownerIds.map((ownerId) => `<@${ownerId}>`).join(', ');
}

interface EmbedListItem {
  title: string;
  incomplete?: boolean;
}

export function formatTaskRecordSaved(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  return `**[ ${escapeMarkdown(truncateText(normalized, 300))} ]** 에 대한 기록을 저장했습니다.`;
}

function formatEmbedList(items: EmbedListItem[], maxTitleLength = 88): string {
  if (items.length === 0) {
    return '없음';
  }

  return items
    .map((item) => {
      const normalized = item.title.replace(/\s+/g, ' ').trim();
      const title = truncateText(
        normalized,
        item.incomplete ? Math.min(maxTitleLength, 40) : maxTitleLength,
      );

      if (item.incomplete) {
        return `- ~~${title}~~ **[미완료]**`;
      }

      return `- ${title}`;
    })
    .join('\n');
}

type ScrumIntro = Pick<
  Scrum,
  | 'projectName'
  | 'ownerIds'
  | 'category'
  | 'overview'
  | 'currentTodos'
  | 'planningDocument'
  | 'projectScoreDocument'
>;

export function buildScrumIntroEmbed(scrum: ScrumIntro): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(scrum.projectName)
    .setDescription(scrum.overview)
    .addFields(
      {
        name: '작성자',
        value: formatOwners(scrum.ownerIds),
        inline: true,
      },
      {
        name: '구분',
        value: SCRUM_CATEGORY_LABELS[scrum.category],
        inline: true,
      },
      ...(scrum.planningDocument
        ? [{
          name: '기획서',
          value: '첨부된 PDF 파일',
          inline: false,
        }]
        : []),
      ...(scrum.projectScoreDocument
        ? [{
          name: 'PROJECT:SCORE 결과',
          value: '첨부된 Markdown 파일',
          inline: false,
        }]
        : []),
    );
}

export function buildScrumTodoEmbed(
  scrum: ScrumIntro & Pick<Scrum, 'nextScrumDate'>,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(SCRUM_START_EMBED_TITLE)
    .setDescription(`**다음 스크럼 마감**: ${formatScrumDate(scrum.nextScrumDate)}`)
    .addFields(
      {
        name: '다음 스크럼까지 진행할 작업',
        value: formatEmbedList(
          scrum.currentTodos.map((title) => ({ title })),
        ),
      },
    );
}

export function buildScrumAbandonedEmbed(input: {
  abandonedBy: string;
  reason: string;
  abandonedAt: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('스크럼 포기')
    .setDescription('스크럼이 포기되어 더 이상 기록을 작성할 수 없습니다.')
    .addFields(
      {
        name: '포기한 사용자',
        value: `<@${input.abandonedBy}>`,
        inline: true,
      },
      {
        name: '포기 사유',
        value: truncateText(input.reason, 1_024),
      },
    )
    .setTimestamp(new Date(input.abandonedAt));
}

type ScrumCompletion = Pick<
  Scrum,
  'completedBy' | 'completionResults' | 'completedAt'
>;

export function buildScrumCompletionSummaryEmbed(
  scrum: ScrumCompletion,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('스크럼 완료')
    .addFields({
      name: '마지막으로 완료한 작업',
      value: formatEmbedList(
        (scrum.completionResults ?? []).map((item) => ({
          title: item.title,
        })),
      ),
    });

  if (scrum.completedBy) {
    embed.setDescription(`**작성자**: <@${scrum.completedBy}>`);
  }

  if (scrum.completedAt) {
    embed.setTimestamp(new Date(scrum.completedAt));
  }

  return embed;
}

export function buildScrumExtraDeletionDmEmbed(input: {
  guildName: string;
  scrumDate: string;
  taskTitle: string;
  reason: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('스크럼 추가 완료 작업 삭제')
    .setDescription('관리자가 스크럼에서 추가 완료 작업을 삭제했습니다.')
    .addFields(
      {
        name: '서버',
        value: truncateText(input.guildName, 1_024),
        inline: true,
      },
      {
        name: '스크럼 마감',
        value: formatScrumDate(input.scrumDate),
        inline: true,
      },
      {
        name: '삭제된 작업',
        value: truncateText(input.taskTitle, 1_024),
      },
      {
        name: '삭제 사유',
        value: truncateText(input.reason, 1_024),
      },
    );
}

type ScrumRequestSummary = Pick<
  ScrumRequest,
  | 'creatorId'
  | 'projectName'
  | 'overview'
  | 'category'
  | 'currentTodos'
  | 'planningDocument'
  | 'projectScoreDocument'
>;

export interface ScrumRequestDecision {
  status: 'pending' | 'approved' | 'rejected';
  reviewerId?: string;
  scrumThreadId?: string;
  rejectionReason?: string;
}

function splitEmbedFieldValue(value: string, maxLength = 1_024): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of value.split('\n')) {
    const segments = line.length > maxLength
      ? Array.from(
        { length: Math.ceil(line.length / maxLength) },
        (_, index) => line.slice(index * maxLength, (index + 1) * maxLength),
      )
      : [line];

    for (const segment of segments) {
      const candidate = current ? `${current}\n${segment}` : segment;

      if (candidate.length > maxLength) {
        chunks.push(current);
        current = segment;
      } else {
        current = candidate;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : ['없음'];
}

export function buildScrumRequestEmbed(
  request: ScrumRequestSummary,
  decision: ScrumRequestDecision = { status: 'pending' },
): EmbedBuilder {
  const status = decision.status === 'approved'
    ? '승인됨'
    : decision.status === 'rejected'
      ? '반려됨'
      : '승인 대기';
  const color = decision.status === 'approved'
    ? 0x57f287
    : decision.status === 'rejected'
      ? 0xed4245
      : 0xfee75c;
  const todoChunks = splitEmbedFieldValue(formatList(request.currentTodos));
  const todoFields = todoChunks.map((value, index) => ({
    name: index === 0
      ? '첫 스크럼까지 진행할 작업'
      : '진행할 작업 (계속)',
    value,
  }));

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(truncateText(request.projectName, 256))
    .addFields(
      {
        name: '스크럼 개요',
        value: truncateText(request.overview, 1_024),
      },
      {
        name: '상태',
        value: status,
        inline: true,
      },
      {
        name: '신청자',
        value: `<@${request.creatorId}>`,
        inline: true,
      },
      {
        name: '분류',
        value: SCRUM_CATEGORY_LABELS[request.category],
        inline: true,
      },
      {
        name: '기획서',
        value: request.planningDocument ? '첨부된 PDF 파일' : '해당 없음',
      },
      {
        name: 'PROJECT:SCORE 결과',
        value: request.projectScoreDocument
          ? '첨부된 Markdown 파일'
          : '해당 없음',
      },
      ...(decision.reviewerId
        ? [{
          name: '처리자',
          value: `<@${decision.reviewerId}>`,
          inline: true,
        }]
        : []),
      ...(decision.scrumThreadId
        ? [{
          name: '스크럼 게시물',
          value: `<#${decision.scrumThreadId}>`,
        }]
        : []),
      ...todoFields,
      ...(decision.status === 'rejected' && decision.rejectionReason?.trim()
        ? [{
          name: '반려 사유',
          value: truncateText(decision.rejectionReason.trim(), 1_024),
        }]
        : []),
    );
}

export function buildApprovalSuccessEmbed(input: {
  projectName: string;
  category: Scrum['category'];
  guildName: string;
  postUrl: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('스크럼 승인 완료')
    .setURL(input.postUrl)
    .setDescription('승인이 완료되어 스크럼 게시물이 생성되었습니다.')
    .addFields(
      {
        name: '스크럼 제목',
        value: truncateText(input.projectName, 1_024),
      },
      {
        name: '분류',
        value: SCRUM_CATEGORY_LABELS[input.category],
        inline: true,
      },
      {
        name: '서버',
        value: truncateText(input.guildName, 1_024),
        inline: true,
      },
      {
        name: '게시물',
        value: `[스크럼 열기](${input.postUrl})`,
      },
    );
}

export function buildApprovalRejectionEmbed(input: {
  projectName: string;
  category: Scrum['category'];
  guildName: string;
  reason: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('스크럼 승인 반려')
    .setDescription('스크럼 승인 요청이 반려되었습니다.')
    .addFields(
      {
        name: '스크럼 제목',
        value: truncateText(input.projectName, 1_024),
      },
      {
        name: '분류',
        value: SCRUM_CATEGORY_LABELS[input.category],
        inline: true,
      },
      {
        name: '서버',
        value: truncateText(input.guildName, 1_024),
        inline: true,
      },
      {
        name: '반려 사유',
        value: truncateText(input.reason, 1_024),
      },
    );
}

export function buildScrumEntrySummaryEmbed(entry: ScrumEntry): EmbedBuilder {
  const completedItems: EmbedListItem[] = entry.completedItems.map((item) => ({
    title: item.title,
    incomplete: item.attachments.length === 0 && item.links.length === 0,
  }));
  const extraItems: EmbedListItem[] = entry.extraItems.map((item) => ({
    title: item.title,
  }));
  const hasIncompleteItem = completedItems.some((item) => item.incomplete);
  const completedChunks = splitEmbedFieldValue(
    formatEmbedList([...completedItems, ...extraItems], 40),
  );
  const nextTodoChunks = splitEmbedFieldValue(
    formatEmbedList(entry.nextTodos.map((title) => ({ title }))),
  );

  return new EmbedBuilder()
    .setColor(hasIncompleteItem ? 0xed4245 : 0x57f287)
    .setTitle(`스크럼 - ${getScrumDeadlineDateString(entry.scrumDate)}`)
    .setDescription(`**다음 스크럼 마감**: ${formatScrumDate(entry.nextScrumDate)}`)
    .addFields(
      ...completedChunks.map((value, index) => ({
        name: index === 0 ? '완료한 작업' : '완료한 작업 (계속)',
        value,
      })),
      ...nextTodoChunks.map((value, index) => ({
        name: index === 0
          ? '다음 스크럼까지 진행할 작업'
          : '진행할 작업 (계속)',
        value,
      })),
    )
    .setTimestamp(new Date(entry.createdAt));
}

export interface ScrumItemDetailContentInput {
  title: string;
  comment: string;
  links: string[];
  incomplete: boolean;
  failedUploads?: number;
}

export function buildScrumItemDetailContent(
  input: ScrumItemDetailContentInput,
): string {
  const normalizedTitle = input.title.replace(/\s+/g, ' ').trim();
  const title = truncateText(normalizedTitle, 300);
  const lines = [
    input.incomplete
      ? `## ~~${title}~~ **[미완료]**`
      : `## ${title}`,
  ];

  if (input.links.length > 0) {
    lines.push(input.links.map((link) => `<${link}>`).join('\n'));
  }

  if (input.failedUploads) {
    lines.push(`**첨부 파일 저장 실패**: ${input.failedUploads}개`);
  }

  const comment = input.comment.trim();

  if (comment) {
    const quotedComment = comment
      .split('\n')
      .map((line) => line ? `> ${line}` : '>')
      .join('\n');
    const remainingLength = 1_900 - lines.join('\n').length - 1;

    if (remainingLength >= 4) {
      lines.push(truncateText(quotedComment, remainingLength));
    }
  }

  return lines.join('\n');
}
