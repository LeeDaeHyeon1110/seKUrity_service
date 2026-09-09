import {
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('newscrum')
    .setDescription('새 스크럼 포럼 게시물을 생성합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    const {
      startNewScrumFromInteraction,
    } = require('../../scrums/interactionHandler') as typeof import('../../scrums/interactionHandler');

    await startNewScrumFromInteraction(interaction);
  },
};

export default command;
