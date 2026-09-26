import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import type { GuildTextBasedChannel, Message, MessageEditOptions } from 'discord.js';
import { ScrumCategory } from '../src/scrums/categories';
import { buildScrumTodoEmbed } from '../src/scrums/formatters';
import { refreshScrumStartMessage } from '../src/scrums/startMessageSync';
import type { Scrum } from '../src/scrums/types';

async function main(): Promise<void> {
  const scrum: Scrum = {
    id: '00000000-0000-4000-8000-000000000001', guildId: '1',
    scrumChannelId: '2', threadId: '3', creatorId: '4', ownerIds: ['4'],
    projectName: 'Scrum', overview: 'Overview', category: ScrumCategory.Study,
    planningDocument: null, projectScoreDocument: null, status: 'active',
    currentTodos: ['Deleted next task'], nextScrumDate: '2026-10-04',
    completedBy: null, completionSummary: null, completionResults: null,
    completedAt: null, abandonedBy: null, abandonmentReason: null, abandonedAt: null,
    createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z',
  };
  const updates: MessageEditOptions[] = [];
  const message = {
    id: '10', author: { id: '20' }, embeds: [buildScrumTodoEmbed(scrum).toJSON()],
    edit: async (options: MessageEditOptions) => updates.push(options),
  } as unknown as Message;
  const thread = {
    client: { user: { id: '20' } },
    messages: { fetch: async () => new Collection([['10', message]]) },
  } as unknown as GuildTextBasedChannel;
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.BACKEND_API_TOKEN;
  process.env.BACKEND_API_TOKEN = 'test-only-token';
  try {
    globalThis.fetch = async (url) => {
      assert(String(url).endsWith('/scrums/by-thread/3/entries/first'));
      return Response.json({
        scrum,
        entry: {
          scrumDate: '2026-09-27',
          completedItems: [{ title: 'Original initial task' }],
          nextTodos: ['Deleted next task'],
        },
      });
    };
    assert(await refreshScrumStartMessage(thread, scrum));
    const stored = JSON.stringify(updates.at(-1));
    assert(stored.includes('Original initial task'));
    assert(!stored.includes('Deleted next task'));
    assert(stored.includes('2026-09-29'));
    assert(!stored.includes('첫 진행할 작업 수정'));
    await refreshScrumStartMessage(thread, scrum);
    assert.equal(JSON.stringify(updates.at(-1)), stored);

    globalThis.fetch = async () => Response.json({ code: 'SCRUM_ENTRY_NOT_FOUND' }, { status: 404 });
    assert(await refreshScrumStartMessage(thread, {
      ...scrum, currentTodos: ['Original initial task'], nextScrumDate: '2026-09-27',
    }));
    const restored = JSON.stringify(updates.at(-1));
    assert(restored.includes('Original initial task'));
    assert(!restored.includes('Deleted next task'));
    assert(restored.includes('첫 진행할 작업 수정'));

    const previousUpdateCount = updates.length;
    globalThis.fetch = async () => Response.json({ code: 'UNAVAILABLE' }, { status: 503 });
    await assert.rejects(refreshScrumStartMessage(thread, scrum), { code: 'UNAVAILABLE' });
    assert.equal(updates.length, previousUpdateCount);

    console.log('Validated start-message repair, restored edit button, and error preservation.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.BACKEND_API_TOKEN;
    else process.env.BACKEND_API_TOKEN = oldToken;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
