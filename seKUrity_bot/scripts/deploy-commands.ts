import 'dotenv/config';

import { Routes } from 'discord.js';
import {
  createDiscordRest,
  loadCommandPayloads,
  reportScriptError,
  requireEnv,
} from './command-utils';

async function main(): Promise<void> {
  const clientId = requireEnv('DISCORD_CLIENT_ID');
  const guildId = requireEnv('DISCORD_GUILD_ID');
  const commands = loadCommandPayloads();
  const rest = createDiscordRest();

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });
  console.log(`Registered ${commands.length} guild command(s) for ${guildId}.`);
}

void main().catch(reportScriptError);
