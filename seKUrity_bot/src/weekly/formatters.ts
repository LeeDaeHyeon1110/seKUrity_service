import { EmbedBuilder } from 'discord.js';
import type {
  WeeklyReport,
  WeeklyReportPreview,
} from './types';

function formatItems(
  items: Array<{ title: string }>,
): string {
  if (items.length === 0) {
    return '없음';
  }

  const lines: string[] = [];

  for (const [index, item] of items.entries()) {
    const title = item.title.replace(/\s+/g, ' ').trim();
    const line = `- ${title}`;
    const remaining = items.length - index;
    const suffix = remaining > 1 ? `\n- 외 ${remaining - 1}개` : '';

    if ([...lines, line].join('\n').length + suffix.length > 1_024) {
      lines.push(`- 외 ${remaining}개`);
      break;
    }

    lines.push(line);
  }

  return lines.join('\n').slice(0, 1_024);
}

export function buildWeeklyStarterContent(userId: string): string {
  return [
    '## 주간보고',
    '',
    `<@${userId}>님의 주간보고 게시물입니다.`,
    '- 이번 주에 작성하신 스크럼 내용이 주간보고에 자동적으로 동기화됩니다.',
    '- 만약 스크럼이 없거나 작성하지 않았을 경우에는 `/weekly` 명령어 또는 아래 버튼을 통해 꼭 이번 주에 따로 한 작업을 주간보고에 올려 주시길 바랍니다.',
    '- 만약 보안과 관련 없는 내용만 포함되어 있을 경우, 주간보고가 강제로 삭제될 수 있다는 점 참고 부탁드립니다.',
    '- 주간보고의 마감은 매주 화요일 19시입니다.',
  ].join('\n');
}

export function buildWeeklyReportEmbed(
  report: WeeklyReport,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`주간보고 - ${report.weekEnd}`)
    .setDescription(`${report.weekStart} ~ ${report.weekEnd}`)
    .addFields({
      name: '완료한 작업',
      value: formatItems([
        ...report.extraItems.map((item) => ({
          title: `[추가] ${item.title}`,
        })),
        ...report.completedItems,
      ]),
    })
    .setTimestamp(new Date(report.createdAt));
}

export function formatWeeklySessionPreview(
  preview: WeeklyReportPreview,
  extraCount: number,
): string {
  const lines = [
    `**주간보고 기간**: ${preview.weekStart} ~ ${preview.weekEnd}`,
    `**자동 집계된 완료 작업**: ${preview.completedItems.length}개`,
    `**추가 완료 작업**: ${extraCount}개`,
  ];

  if (preview.pendingScrums.length > 0) {
    lines.push(
      '',
      '**주의: 아직 이번 주 스크럼을 작성하지 않은 활동이 있습니다.**',
      ...preview.pendingScrums.map((scrum) =>
        `- ${scrum.projectName}: ${scrum.todos.length}개 작업이 아직 기록되지 않았습니다.`,
      ),
    );
  }

  if (preview.completedItems.length + extraCount === 0) {
    lines.push(
      '',
      '제출하려면 추가 완료 작업을 최소 1개 작성해야 합니다.',
    );
  }

  return lines.join('\n');
}

export function buildWeeklyDeletionDmEmbed(input: {
  guildName: string;
  weekEnd: string;
  reason: string;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('주간보고 삭제')
    .setDescription('관리자가 주간보고를 삭제했습니다.')
    .addFields(
      {
        name: '서버',
        value: input.guildName,
        inline: true,
      },
      {
        name: '주간보고 날짜',
        value: input.weekEnd,
        inline: true,
      },
      {
        name: '삭제 사유',
        value: input.reason.slice(0, 1_024),
      },
    );
}

export function buildWeeklyExtraDeletionDmEmbed(input: {
  guildName: string;
  weekEnd: string;
  taskTitle: string;
  reason: string;
  reportDeleted: boolean;
}): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('주간보고 추가 작업 삭제')
    .setDescription(input.reportDeleted
      ? '관리자가 추가 작업을 삭제했으며 남은 완료 작업이 없어 주간보고도 삭제했습니다.'
      : '관리자가 주간보고에서 추가 완료 작업을 삭제했습니다.')
    .addFields(
      {
        name: '서버',
        value: input.guildName.slice(0, 1_024),
        inline: true,
      },
      {
        name: '주간보고 날짜',
        value: input.weekEnd,
        inline: true,
      },
      {
        name: '삭제된 작업',
        value: input.taskTitle.slice(0, 1_024),
      },
      {
        name: '삭제 사유',
        value: input.reason.slice(0, 1_024),
      },
    );
}
