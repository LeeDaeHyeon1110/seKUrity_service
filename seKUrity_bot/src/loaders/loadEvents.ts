import path from 'node:path';
import type { BotClient, BotEvent } from '../types/discord';
import { getSourceFiles } from './loadCommands';

export function loadEvents(client: BotClient): void {
  const eventsPath = path.join(__dirname, '..', 'events');

  for (const filePath of getSourceFiles(eventsPath)) {
    const imported = require(filePath) as { default?: BotEvent } & Partial<BotEvent>;
    const candidate = imported.default ?? imported;

    if (!candidate.name || typeof candidate.execute !== 'function') {
      console.warn(`[events] Skipped ${filePath}: missing name or execute.`);
      continue;
    }

    const event = candidate as BotEvent;
    const listener = (...args: unknown[]) => event.execute(...args, client);

    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
  }
}
