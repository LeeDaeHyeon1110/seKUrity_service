import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ChannelSettingType } from '../../constants/channelTypes';
import { reconcileDeletedConfiguredChannels } from '../../storage/configuredChannelCleanup';
import { getChannel } from '../../storage/guildSettingsStore';
import type { Command } from '../../types/discord';
import { syncWeeklyForum } from '../../weekly/forumSync';
import { syncCurrentWeeklyReportsForScrumLifecycle } from '../../weekly/syncService';
import { getWeeklyRoleId } from '../../weekly/weeklyStore';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('syncweekly')
    .setDescription('삭제되거나 누락된 주간보고 게시물을 다시 동기화합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

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
        content: '주간보고 동기화에는 `서버 관리` 권한이 필요합니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const removedTypes = await reconcileDeletedConfiguredChannels(
      interaction.guild,
    );

    if (removedTypes.includes(ChannelSettingType.Weekly)) {
      await interaction.editReply({
        content: '삭제된 주간보고 포럼 설정을 DB에서 정리했습니다. `/setchannel type: weekly`로 새 포럼과 대상 역할을 지정해 주세요.',
        components: [],
      });
      return;
    }

    const [channelId, roleId] = await Promise.all([
      getChannel(interaction.guildId, ChannelSettingType.Weekly),
      getWeeklyRoleId(interaction.guildId),
    ]);

    if (!channelId || !roleId) {
      await interaction.editReply({
        content: '`/setchannel type: weekly`로 주간보고 포럼과 대상 역할을 먼저 설정해 주세요.',
        components: [],
      });
      return;
    }

    const result = await syncWeeklyForum(interaction.guild);
    const reports = await syncCurrentWeeklyReportsForScrumLifecycle({
      client: interaction.client,
      guild: interaction.guild,
      userIds: result.userIds,
      createIfMissing: true,
    });

    await interaction.editReply({
      content: [
        `주간보고 게시물 ${result.active}개를 동기화했습니다.`,
        reports > 0
          ? `현재 주차 보고서 ${reports}개를 생성하거나 복구된 게시물에 다시 연결했습니다.`
          : '',
        result.archived > 0
          ? `대상 역할에서 제외된 게시물 ${result.archived}개를 보관했습니다.`
          : '',
      ].filter(Boolean).join('\n'),
      components: [],
    });
  },
};

export default command;
