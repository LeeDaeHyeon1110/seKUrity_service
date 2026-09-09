import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getApproverRoleIds } from '../../scrums/approvalStore';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('listapprovers')
    .setDescription('스크럼 승인 역할 목록을 확인합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const roleIds = await getApproverRoleIds(interaction.guildId);
    const content = roleIds.length > 0
      ? [
        '**스크럼 승인 역할**',
        ...roleIds.map((roleId) => `- <@&${roleId}>`),
        '',
        '`Administrator` 권한 보유자는 역할 설정과 관계없이 승인할 수 있습니다.',
      ].join('\n')
      : [
        '설정된 스크럼 승인 역할이 없습니다.',
        '`Administrator` 권한 보유자는 계속 승인할 수 있습니다.',
      ].join('\n');

    await interaction.reply({
      content,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
