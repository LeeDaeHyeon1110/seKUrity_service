import {
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types/discord';
import { getWeeklyThread } from '../../weekly/weeklyStore';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('weeklystatus')
    .setDescription('내 주간보고 누락 횟수를 확인합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const mapping = await getWeeklyThread(
      interaction.guildId,
      interaction.user.id,
    );

    await interaction.reply({
      content: [
        `<@${interaction.user.id}>님의 주간보고 상태입니다.`,
        `누락 횟수: **${mapping?.missedReportCount ?? 0}회**`,
        mapping
          ? `주간보고 게시물: <#${mapping.threadId}>`
          : '주간보고 게시물: 아직 생성되지 않음',
      ].join('\n'),
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
