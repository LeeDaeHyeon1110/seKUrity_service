import { Events, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { handleScrumInteraction } from '../scrums/interactionHandler';
import { handleWeeklyInteraction } from '../weekly/interactionHandler';
import type { BotClient } from '../types/discord';

async function reportInteractionError(
  interaction: Interaction,
  content: string,
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  try {
    if (interaction.deferred) {
      await interaction.editReply({
        content,
        components: [],
      });
      return;
    }

    if (interaction.replied) {
      await interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  } catch (responseError) {
    console.error('[interactions] Failed to report an interaction error:', responseError);
  }
}

export default {
  name: Events.InteractionCreate,

  async execute(interaction: Interaction): Promise<void> {
    try {
      if (await handleScrumInteraction(interaction)) {
        return;
      }
      if (await handleWeeklyInteraction(interaction)) {
        return;
      }
    } catch (error) {
      console.error(error);
      await reportInteractionError(
        interaction,
        '상호작용 처리 중 오류가 발생했습니다.',
      );
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const client = interaction.client as BotClient;
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`[interactions] No command matching ${interaction.commandName}.`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);

      await reportInteractionError(interaction, '명령어 실행 중 오류가 발생했습니다.');
    }
  },
};
