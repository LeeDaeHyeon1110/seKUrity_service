import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types/discord';
import {
  buildWeeklyAdminDeleteExtraRow,
} from '../../weekly/components';
import {
  getLatestWeeklyReportByThread,
  getWeeklyThread,
  getWeeklyRoleId,
  listWeeklyThreads,
} from '../../weekly/weeklyStore';
import { getAllGuildMembers } from '../../weekly/memberCache';

function chunkStatusLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current && current.length + line.length + 1 > 3_800) {
      chunks.push(current);
      current = '';
    }

    current += `${current ? '\n' : ''}${line}`;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('weeklyadmin')
    .setDescription('주간보고를 관리합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('사용자의 주간보고 누락 횟수를 확인합니다.')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('확인할 사용자')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status-all')
        .setDescription('모든 주간보고 대상자의 상태를 확인합니다.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('현재 게시물의 최근 주간보고에서 추가 작업을 삭제합니다.'),
    ),

  async execute(interaction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: '주간보고 관리에는 `서버 관리` 권한이 필요합니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'status') {
      const user = interaction.options.getUser('user', true);
      const mapping = await getWeeklyThread(interaction.guildId, user.id);
      await interaction.reply({
        content: mapping
          ? [
            `<@${user.id}>님의 주간보고 관리 상태입니다.`,
            `누락 횟수: **${mapping.missedReportCount}회**`,
            `주간보고 게시물: <#${mapping.threadId}>`,
          ].join('\n')
          : `<@${user.id}>님의 주간보고 게시물과 누락 기록이 없습니다.`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'status-all') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const roleId = await getWeeklyRoleId(interaction.guildId);

      if (!roleId) {
        await interaction.editReply({
          content: '주간보고 대상 역할이 설정되어 있지 않습니다.',
          components: [],
        });
        return;
      }

      const [members, mappings] = await Promise.all([
        getAllGuildMembers(interaction.guild),
        listWeeklyThreads(interaction.guildId),
      ]);
      const mappingByUserId = new Map(
        mappings.map((mapping) => [mapping.userId, mapping]),
      );
      const targets = members
        .filter((member) =>
          !member.user.bot
          && member.roles.cache.has(roleId),
        )
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName, 'ko'));

      if (targets.size === 0) {
        await interaction.editReply({
          content: '현재 주간보고 대상 역할을 가진 사용자가 없습니다.',
          components: [],
        });
        return;
      }

      const lines = targets.map((member) => {
        const mapping = mappingByUserId.get(member.id);
        const post = mapping ? `<#${mapping.threadId}>` : '게시물 없음';
        return `- <@${member.id}>: **${mapping?.missedReportCount ?? 0}회** · ${post}`;
      });
      const embeds = chunkStatusLines(lines).map((description, index, chunks) =>
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(chunks.length === 1
            ? '주간보고 미제출 횟수 목록'
            : `주간보고 미제출 횟수 목록 (${index + 1}/${chunks.length})`)
          .setDescription(description)
          .setFooter({ text: `대상자 ${targets.size}명` }));

      await interaction.editReply({
        embeds: [embeds[0]!],
        components: [],
        allowedMentions: { parse: [] },
      });

      for (const embed of embeds.slice(1)) {
        await interaction.followUp({
          embeds: [embed],
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: '관리할 주간보고 게시물 안에서 명령어를 실행해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    const report = await getLatestWeeklyReportByThread(interaction.channel.id);

    if (!report || report.guildId !== interaction.guildId) {
      await interaction.editReply({
        content: '현재 게시물에서 관리할 주간보고를 찾을 수 없습니다.',
        components: [],
      });
      return;
    }

    if (report.extraItems.length === 0) {
      await interaction.editReply({
        content: '작성자가 추가로 작성한 작업이 없습니다.',
        components: [],
      });
      return;
    }

    await interaction.editReply({
      content: `<@${report.userId}>님의 ${report.weekEnd} 주간보고에서 삭제할 추가 작업을 선택해 주세요.`,
      components: [buildWeeklyAdminDeleteExtraRow(report)],
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
