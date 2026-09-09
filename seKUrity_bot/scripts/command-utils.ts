import { REST } from 'discord.js';
import { loadCommands } from '../src/loaders/loadCommands';

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function createDiscordRest(): REST {
  return new REST().setToken(requireEnv('DISCORD_TOKEN'));
}

export function loadCommandPayloads(): ReturnType<
  ReturnType<typeof loadCommands>['map']
> {
  return loadCommands().map((command) => command.data.toJSON());
}

export function reportScriptError(error: unknown): void {
  console.error(error);
  process.exitCode = 1;
}
