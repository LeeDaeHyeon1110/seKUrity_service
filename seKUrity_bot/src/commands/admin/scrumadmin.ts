import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { BackendApiError } from '../../api/backendClient';
import {
  buildAdminEditScrumModal,
  buildAdminMarkIncompleteTaskRow,
} from '../../scrums/components';
import {
  getActiveScrumByThread,
  getLatestScrumEntryByThread,
} from '../../scrums/scrumStore';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('scrumadmin')
    .setDescription('사용자의 스크럼을 관리합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('현재 게시물의 스크럼 제목과 개요를 수정합니다.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('mark-incomplete')
        .setDescription('작업을 미완료 처리하거나 추가 완료 작업을 삭제합니다.')
        .addStringOption((option) =>
          option
            .setName('date')
            .setDescription('대상 스크럼 주차 (YYYY-MM-DD, 생략 시 최근 기록)')
            .setMinLength(10)
            .setMaxLength(10),
        ),
    ),

  async execute(interaction) {
    if (
      !interaction.guildId
      || !interaction.channel?.isThread()
    ) {
      await interaction.reply({
        content: '관리할 스크럼 게시물 안에서 명령어를 실행해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: '스크럼 관리에는 `서버 관리` 권한이 필요합니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === 'edit') {
      const scrum = await getActiveScrumByThread(interaction.channel.id);

      if (!scrum) {
        await interaction.reply({
          content: '현재 게시물에 연결된 활성 스크럼을 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.showModal(buildAdminEditScrumModal(scrum));
      return;
    }

    const scrumDate = interaction.options.getString('date')?.trim();

    if (scrumDate && !/^\d{4}-\d{2}-\d{2}$/.test(scrumDate)) {
      await interaction.reply({
        content: '`date`는 `YYYY-MM-DD` 형식으로 입력해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const { entry } = await getLatestScrumEntryByThread(
        interaction.channel.id,
        scrumDate,
      );

      const eligibleCount = entry.completedItems.filter((item) =>
        item.attachments.length > 0 || item.links.length > 0,
      ).length + entry.extraItems.length;

      if (eligibleCount === 0) {
        await interaction.reply({
          content: '해당 스크럼 기록에는 관리할 완료 작업이 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `${entry.scrumDate} 주차에서 미완료 처리하거나 삭제할 작업을 선택해 주세요.`,
        components: [buildAdminMarkIncompleteTaskRow(entry)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 404) {
        await interaction.reply({
          content: scrumDate
            ? `${scrumDate} 주차의 스크럼 기록을 찾을 수 없습니다.`
            : '제출된 스크럼 기록을 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      throw error;
    }
  },
};

export default command;
