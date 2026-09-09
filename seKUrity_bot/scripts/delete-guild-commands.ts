import 'dotenv/config';

import { Routes } from 'discord.js';
import {
  createDiscordRest,
  reportScriptError,
  requireEnv,
} from './command-utils';

async function main(): Promise<void> {
  const clientId = requireEnv('DISCORD_CLIENT_ID');
  const guildId = requireEnv('DISCORD_GUILD_ID');
  const rest = createDiscordRest();

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [],
  });
  console.log(`Deleted all guild commands for ${guildId}.`);
}

void main().catch(reportScriptError);
