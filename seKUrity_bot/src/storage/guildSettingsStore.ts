import { ChannelSettingType } from '../constants/channelTypes';
import { backendRequest } from '../api/backendClient';

const CACHE_TTL_MS = 30_000;

interface ChannelCacheEntry {
  channelId: string | null;
  expiresAt: number;
}

const channelCache = new Map<string, ChannelCacheEntry>();

function cacheKey(guildId: string, type: ChannelSettingType): string {
  return `${guildId}:${type}`;
}

function channelPath(guildId: string, type: ChannelSettingType): string {
  return [
    '/internal/v1/guilds',
    encodeURIComponent(guildId),
    'channels',
    encodeURIComponent(type),
  ].join('/');
}

function updateCache(
  guildId: string,
  type: ChannelSettingType,
  channelId: string | null,
): void {
  channelCache.set(cacheKey(guildId, type), {
    channelId,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function setChannel(
  guildId: string,
  type: ChannelSettingType,
  channelId: string,
): Promise<void> {
  await backendRequest<{ channelId: string }>(channelPath(guildId, type), {
    method: 'PUT',
    body: JSON.stringify({ channelId }),
  });
  updateCache(guildId, type, channelId);
}

export async function getChannel(
  guildId: string,
  type: ChannelSettingType,
): Promise<string | null> {
  const key = cacheKey(guildId, type);
  const cached = channelCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.channelId;
  }

  const response = await backendRequest<{ channelId: string | null }>(
    channelPath(guildId, type),
  );
  updateCache(guildId, type, response.channelId);
  return response.channelId;
}

export async function unsetChannel(
  guildId: string,
  type: ChannelSettingType,
): Promise<string | null> {
  const response = await backendRequest<{ channelId: string | null }>(
    channelPath(guildId, type),
    { method: 'DELETE' },
  );
  updateCache(guildId, type, null);
  return response.channelId;
}
