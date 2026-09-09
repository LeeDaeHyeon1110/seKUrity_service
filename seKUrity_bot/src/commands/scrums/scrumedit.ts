import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { startScrumEntryEditFromInteraction } from '../../scrums/interactionHandler';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('scrumedit')
    .setDescription('현재 주차에 작성한 가장 최근 스크럼을 수정합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: '수정할 스크럼 게시물 안에서 명령어를 실행해 주세요.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await startScrumEntryEditFromInteraction(interaction);
  },
};

export default command;
