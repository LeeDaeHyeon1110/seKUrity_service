import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { addApproverRole } from '../../scrums/approvalStore';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setapprover')
    .setDescription('스크럼 승인 권한을 역할에 부여합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('승인 권한을 부여할 역할')
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

    if (role.id === interaction.guildId) {
      await interaction.reply({
        content: '`@everyone` 역할에는 승인 권한을 부여할 수 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if ('managed' in role && role.managed) {
      await interaction.reply({
        content: 'Discord가 관리하는 역할에는 승인 권한을 부여할 수 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await addApproverRole(interaction.guildId, role.id);
    await interaction.reply({
      content: `<@&${role.id}> 역할에 스크럼 승인 권한을 부여했습니다.`,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
