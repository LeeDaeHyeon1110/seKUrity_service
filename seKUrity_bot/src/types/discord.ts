import type {
  Awaitable,
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

export type CommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  data: CommandData;
  execute(interaction: ChatInputCommandInteraction): Awaitable<void>;
}

export interface BotClient extends Client {
  commands: Collection<string, Command>;
}

export interface BotEvent {
  name: string;
  once?: boolean;
  execute(...args: any[]): Awaitable<void>;
}
