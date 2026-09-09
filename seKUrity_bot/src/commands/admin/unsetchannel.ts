import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  CHANNEL_SETTING_CHOICES,
  ChannelSettingType,
} from '../../constants/channelTypes';
import { unsetChannel } from '../../storage/guildSettingsStore';
import type { Command } from '../../types/discord';
import { archiveAllWeeklyThreads } from '../../weekly/forumSync';
import { unsetWeeklyRoleId } from '../../weekly/weeklyStore';

const CHANNEL_TYPE_LABELS: Record<ChannelSettingType, string> = {
  [ChannelSettingType.Logs]: '로그',
  [ChannelSettingType.Scrums]: '스크럼',
  [ChannelSettingType.Approvals]: '승인',
  [ChannelSettingType.Weekly]: '주간보고',
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unsetchannel')
    .setDescription('서버 기능 채널 설정을 해제합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('해제할 채널 종류')
        .setRequired(true)
        .addChoices(...CHANNEL_SETTING_CHOICES),
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const type = interaction.options.getString('type', true) as ChannelSettingType;

    if (!Object.values(ChannelSettingType).includes(type)) {
      await interaction.reply({
        content: '아직 지원하지 않는 채널 종류입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let archivedCount = 0;

    if (type === ChannelSettingType.Weekly && interaction.guild) {
      archivedCount = await archiveAllWeeklyThreads(interaction.guild);
      await unsetWeeklyRoleId(interaction.guildId);
    }

    const removedChannelId = await unsetChannel(interaction.guildId, type);

    if (!removedChannelId) {
      await interaction.reply({
        content: `해제할 ${CHANNEL_TYPE_LABELS[type]} 채널 설정이 없습니다.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: [
        `<#${removedChannelId}> ${CHANNEL_TYPE_LABELS[type]} 채널 설정을 해제했습니다.`,
        type === ChannelSettingType.Weekly
          ? `사용자별 게시물 ${archivedCount}개를 보관했습니다.`
          : '',
      ].filter(Boolean).join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
