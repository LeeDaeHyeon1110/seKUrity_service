import type {
  Collection,
  Guild,
  GuildMember,
  Snowflake,
} from 'discord.js';

type GuildMembers = Collection<Snowflake, GuildMember>;

const loadedGuilds = new Set<string>();
const memberFetches = new Map<string, Promise<GuildMembers>>();

function getOpcodeEightRetryMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const data = (error as {
    data?: {
      opcode?: number;
      retry_after?: number;
    };
  }).data;

  if (
    data?.opcode !== 8
    || typeof data.retry_after !== 'number'
    || !Number.isFinite(data.retry_after)
    || data.retry_after < 0
  ) {
    return null;
  }

  return Math.ceil(data.retry_after * 1_000) + 250;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

async function fetchAllMembers(guild: Guild): Promise<GuildMembers> {
  try {
    return await guild.members.fetch();
  } catch (error) {
    const retryMs = getOpcodeEightRetryMs(error);

    if (retryMs === null) {
      throw error;
    }

    console.warn(
      `[weekly] Guild member request for ${guild.id} was rate limited; retrying in ${retryMs}ms.`,
    );
    await delay(retryMs);
    return guild.members.fetch();
  }
}

export function getAllGuildMembers(guild: Guild): Promise<GuildMembers> {
  if (
    loadedGuilds.has(guild.id)
    || guild.members.cache.size >= guild.memberCount
  ) {
    loadedGuilds.add(guild.id);
    return Promise.resolve(guild.members.cache);
  }

  const existing = memberFetches.get(guild.id);

  if (existing) {
    return existing;
  }

  const pending = fetchAllMembers(guild)
    .then(() => {
      loadedGuilds.add(guild.id);
      return guild.members.cache;
    })
    .finally(() => {
      memberFetches.delete(guild.id);
    });
  memberFetches.set(guild.id, pending);
  return pending;
}
