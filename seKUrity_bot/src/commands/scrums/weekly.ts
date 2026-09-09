import {
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('이번 주 주간보고를 작성합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    const {
      startWeeklyReportFromInteraction,
    } = require('../../weekly/interactionHandler') as typeof import('../../weekly/interactionHandler');

    await startWeeklyReportFromInteraction(interaction);
  },
};

export default command;
