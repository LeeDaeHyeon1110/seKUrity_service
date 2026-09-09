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
  const commands = loadCommandPayloads();
  const rest = createDiscordRest();

  await rest.put(Routes.applicationCommands(clientId), {
    body: commands,
  });
  console.log(`Registered ${commands.length} global command(s).`);
}

void main().catch(reportScriptError);
