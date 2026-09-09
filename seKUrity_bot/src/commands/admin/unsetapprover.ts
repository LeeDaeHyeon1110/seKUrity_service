import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { removeApproverRole } from '../../scrums/approvalStore';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unsetapprover')
    .setDescription('역할의 스크럼 승인 권한을 해제합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('승인 권한을 해제할 역할')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole('role', true);
    const removed = await removeApproverRole(interaction.guildId, role.id);

    await interaction.reply({
      content: removed
        ? `<@&${role.id}> 역할의 스크럼 승인 권한을 해제했습니다.`
        : `<@&${role.id}> 역할에는 설정된 승인 권한이 없습니다.`,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
