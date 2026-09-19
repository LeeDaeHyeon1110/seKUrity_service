import {
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { buildScrumSelectRow } from '../../scrums/components';
import {
  formatScrumDate,
  getCurrentWeeklyCycleEndKstDateString,
  getNextWeeklyScrumDateString,
} from '../../scrums/dateUtils';
import type { Command } from '../../types/discord';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('scrum')
    .setDescription('이번 주차에 예정된 스크럼을 작성합니다.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: '서버 안에서만 사용할 수 있는 명령어입니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel;
    const {
      getActiveScrumByThread,
      getActiveScrumsForUser,
      hasScrumEntryForDate,
    } = require('../../scrums/scrumStore') as typeof import('../../scrums/scrumStore');
    const {
      startScrumSessionFromInteraction,
    } = require('../../scrums/interactionHandler') as typeof import('../../scrums/interactionHandler');

    if (channel?.isThread()) {
      const scrum = await getActiveScrumByThread(channel.id);

      if (scrum?.ownerIds.includes(interaction.user.id)) {
        await startScrumSessionFromInteraction(interaction, scrum);
        return;
      }
    }

    const scrumDate = getCurrentWeeklyCycleEndKstDateString();
    const scrums = await getActiveScrumsForUser(
      interaction.guildId,
      interaction.user.id,
    );
    const scrumStates = await Promise.all(
      scrums.map(async (scrum) => ({
        scrum,
        submitted: await hasScrumEntryForDate(scrum.id, scrumDate),
      })),
    );
    const scheduledStates = scrumStates.filter(
      ({ scrum }) => scrum.nextScrumDate <= scrumDate,
    );
    const activeScrums = scheduledStates
      .filter((state) => !state.submitted)
      .map((state) => state.scrum);

    if (activeScrums.length === 0) {
      const hasSubmittedScrum = scrumStates.some((state) => state.submitted);

      await interaction.reply({
        content: hasSubmittedScrum
          ? [
            '이번 주 스크럼이 이미 작성돼있습니다.',
            `다음 주 스크럼은 ${formatScrumDate(getNextWeeklyScrumDateString(scrumDate))} 주차부터 작성할 수 있습니다.`,
          ].join('\n')
          : '이번 주차에 작성할 수 있는 스크럼이 없습니다.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: '작성할 스크럼을 먼저 선택해 주세요.',
      components: [buildScrumSelectRow(activeScrums)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
