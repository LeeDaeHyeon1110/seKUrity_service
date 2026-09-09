import 'dotenv/config';

import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { loadCommands } from './loaders/loadCommands';
import { loadEvents } from './loaders/loadEvents';
import type { BotClient } from './types/discord';
import { getConfiguredWeeklyTestDate } from './config/weeklyTestDate';

const token = process.env.DISCORD_TOKEN;
const backendToken = process.env.BACKEND_API_TOKEN;
const weeklyTestDate = getConfiguredWeeklyTestDate();

if (!token) {
  throw new Error('DISCORD_TOKEN is required.');
}

if (!backendToken) {
  throw new Error('BACKEND_API_TOKEN is required.');
}

if (weeklyTestDate) {
  console.warn(`[weekly] Test date override enabled: ${weeklyTestDate}`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
  ],
}) as BotClient;

client.commands = loadCommands();

loadEvents(client);

void client.login(token);
