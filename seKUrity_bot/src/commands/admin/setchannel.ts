import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { ForumChannel, GuildTextBasedChannel } from 'discord.js';
import {
  CHANNEL_SETTING_CHOICES,
  ChannelSettingType,
} from '../../constants/channelTypes';
import {
  APPROVAL_CHANNEL_REQUIRED_PERMISSIONS,
  SCRUM_CHANNEL_REQUIRED_PERMISSIONS,
  WEEKLY_CHANNEL_REQUIRED_PERMISSIONS,
} from '../../scrums/permissions';
import {
  ensureScrumCategoryTags,
  ForumTagConfigurationError,
} from '../../scrums/forumTags';
import { ensureScrumGuidePost } from '../../scrums/forumGuide';
import { syncEditableScrumStartMessages } from '../../scrums/startMessageSync';
import { setChannel } from '../../storage/guildSettingsStore';
import type { Command } from '../../types/discord';
import {
  ensureWeeklyTagId,
  syncWeeklyForum,
} from '../../weekly/forumSync';
import { syncCurrentWeeklyReportsForScrumLifecycle } from '../../weekly/syncService';
import { setWeeklyRoleId } from '../../weekly/weeklyStore';

const LOGGABLE_CHANNEL_TYPES = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

const CHANNEL_TYPE_LABELS: Record<ChannelSettingType, string> = {
  [ChannelSettingType.Logs]: '로그',
  [ChannelSettingType.Scrums]: '스크럼',
  [ChannelSettingType.Approvals]: '승인',
  [ChannelSettingType.Weekly]: '주간보고',
};

function canUseAsLogChannel(
  channel: unknown,
): channel is GuildTextBasedChannel {
  if (!channel || typeof channel !== 'object') {
    return false;
  }

  const candidate = channel as {
    isTextBased?: () => boolean;
    type?: ChannelType;
  };

  return Boolean(
    candidate.isTextBased?.()
    && candidate.type !== undefined
    && LOGGABLE_CHANNEL_TYPES.has(candidate.type),
  );
}

function isScrumForumChannel(channel: unknown): channel is ForumChannel {
  return Boolean(
    channel
    && typeof channel === 'object'
    && (channel as { type?: ChannelType }).type === ChannelType.GuildForum,
  );
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('서버 기능 채널을 설정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('설정할 채널 종류')
        .setRequired(true)
        .addChoices(...CHANNEL_SETTING_CHOICES),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('비워두면 현재 채널을 사용합니다.')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildForum,
        ),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('weekly 설정 시 주간보고 대상 역할')
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
    const selectedChannel = interaction.options.getChannel('channel');
    const selectedRole = interaction.options.getRole('role');
    const targetChannel = selectedChannel ?? interaction.channel;

    if (!Object.values(ChannelSettingType).includes(type)) {
      await interaction.reply({
        content: '아직 지원하지 않는 채널 종류입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (type === ChannelSettingType.Weekly && !selectedRole) {
      await interaction.reply({
        content: '주간보고 채널을 설정할 때는 대상 `role`을 함께 지정해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (type === ChannelSettingType.Logs) {
      if (!canUseAsLogChannel(targetChannel)) {
        await interaction.reply({
          content: '로그 채널은 일반 텍스트 채널 또는 공지 채널만 지정할 수 있습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const permissions = targetChannel.permissionsFor(interaction.client.user);
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ];

      if (!permissions?.has(requiredPermissions)) {
        await interaction.reply({
          content: '로그 채널을 사용하려면 봇에 필요한 채널 권한이 부족합니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } else {
      if (!isScrumForumChannel(targetChannel)) {
        await interaction.reply({
          content: `${CHANNEL_TYPE_LABELS[type]} 채널은 포럼 채널만 지정할 수 있습니다.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const permissions = targetChannel.permissionsFor(interaction.client.user);
      const requiredPermissions = type === ChannelSettingType.Scrums
        ? SCRUM_CHANNEL_REQUIRED_PERMISSIONS
        : type === ChannelSettingType.Approvals
          ? APPROVAL_CHANNEL_REQUIRED_PERMISSIONS
          : WEEKLY_CHANNEL_REQUIRED_PERMISSIONS;

      if (!permissions?.has([...requiredPermissions])) {
        await interaction.reply({
          content: `${CHANNEL_TYPE_LABELS[type]} 포럼을 사용하려면 봇에 필요한 채널 권한이 부족합니다.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    let preparedForum = isScrumForumChannel(targetChannel)
      ? targetChannel
      : null;

    if (
      preparedForum
      && (
        type === ChannelSettingType.Scrums
        || type === ChannelSettingType.Approvals
      )
    ) {
      try {
        preparedForum = await ensureScrumCategoryTags(preparedForum);
      } catch (error) {
        console.error(
          `[channels] Failed to prepare scrum tags in forum ${targetChannel.id}:`,
          error,
        );
        await interaction.editReply({
          content: error instanceof ForumTagConfigurationError
            ? error.message
            : '포럼에 스크럼 분류 태그를 설정하지 못했습니다. 봇의 채널 관리 권한을 확인해 주세요.',
        });
        return;
      }
    }

    if (preparedForum && type === ChannelSettingType.Weekly) {
      try {
        await ensureWeeklyTagId(preparedForum);
      } catch (error) {
        console.error(
          `[channels] Failed to prepare weekly tag in forum ${targetChannel.id}:`,
          error,
        );
        await interaction.editReply({
          content: error instanceof Error
            ? error.message
            : '포럼에 주간보고 태그를 설정하지 못했습니다.',
        });
        return;
      }
    }

    await setChannel(interaction.guildId, type, targetChannel.id);

    let guideResult = '';

    if (
      type === ChannelSettingType.Scrums
      && preparedForum
    ) {
      try {
        const guidePost = await ensureScrumGuidePost(preparedForum);
        guideResult = `\n스크럼 작성 방법 게시물: <#${guidePost.id}>`;
      } catch (error) {
        console.error(
          `[channels] Failed to create scrum guide in forum ${targetChannel.id}:`,
          error,
        );
        guideResult = '\n스크럼 작성 방법 게시물은 생성하지 못했습니다. 포럼 태그와 스레드 관리 권한을 확인해 주세요.';
      }

      if (interaction.guild) {
        try {
          const synchronized = await syncEditableScrumStartMessages(
            interaction.guild,
          );

          if (synchronized > 0) {
            guideResult += `\n수정 가능한 기존 시작 메시지 ${synchronized}개를 동기화했습니다.`;
          }
        } catch (error) {
          console.error(
            `[channels] Failed to sync scrum start messages in forum ${targetChannel.id}:`,
            error,
          );
          guideResult += '\n설정은 저장했지만 기존 스크럼 시작 메시지는 동기화하지 못했습니다.';
        }
      }
    }

    if (
      type === ChannelSettingType.Weekly
      && selectedRole
      && interaction.guild
    ) {
      await setWeeklyRoleId(interaction.guildId, selectedRole.id);

      try {
        const result = await syncWeeklyForum(interaction.guild);
        const reports = await syncCurrentWeeklyReportsForScrumLifecycle({
          client: interaction.client,
          guild: interaction.guild,
          userIds: result.userIds,
          createIfMissing: true,
        });
        guideResult = [
          `\n대상 역할: <@&${selectedRole.id}>`,
          `사용자 게시물 ${result.active}개를 동기화했습니다.`,
          reports > 0
            ? `현재 주차 보고서 ${reports}개를 동기화했습니다.`
            : '',
          result.archived > 0
            ? `역할 대상이 아닌 게시물 ${result.archived}개를 보관했습니다.`
            : '',
        ].filter(Boolean).join('\n');
      } catch (error) {
        console.error(
          `[channels] Failed to sync weekly forum ${targetChannel.id}:`,
          error,
        );
        guideResult = [
          `\n대상 역할: <@&${selectedRole.id}>`,
          '설정은 저장했지만 사용자별 게시물 동기화에 실패했습니다. Guild Members 인텐트와 포럼 권한을 확인해 주세요.',
        ].join('\n');
      }
    }

    await interaction.editReply({
      content: `<#${targetChannel.id}> 채널을 ${CHANNEL_TYPE_LABELS[type]} 채널로 지정했습니다.${guideResult}`,
    });
  },
};

export default command;
