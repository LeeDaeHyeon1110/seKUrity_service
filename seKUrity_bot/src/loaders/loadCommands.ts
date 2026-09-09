import fs from 'node:fs';
import path from 'node:path';
import { Collection } from 'discord.js';
import type { Command } from '../types/discord';

const SUPPORTED_COMMAND_EXTENSIONS = new Set(['.js', '.ts']);

export function getSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...getSourceFiles(entryPath));
      continue;
    }

    const extension = path.extname(entry.name);

    if (
      entry.isFile()
      && SUPPORTED_COMMAND_EXTENSIONS.has(extension)
      && !entry.name.endsWith('.d.ts')
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

export function loadCommands(): Collection<string, Command> {
  const commands = new Collection<string, Command>();
  const commandsPath = path.join(__dirname, '..', 'commands');

  for (const filePath of getSourceFiles(commandsPath)) {
    const imported = require(filePath) as { default?: Command } & Partial<Command>;
    const command = imported.default ?? imported;

    if (!command.data || !command.execute) {
      console.warn(`[commands] Skipped ${filePath}: missing data or execute.`);
      continue;
    }

    commands.set(command.data.name, command as Command);
  }

  return commands;
}
