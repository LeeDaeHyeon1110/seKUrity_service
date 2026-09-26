import type { Client, Guild, GuildMember } from 'discord.js';
import { backendRequest } from '../api/backendClient';

const MAX_RECONCILIATION_MEMBERS = 1_000;
const MAX_ROLE_IDS = 100;
const guildSyncTails = new Map<string, Promise<void>>();

interface WebMemberSnapshot {
  discordUserId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  guildNickname: string | null;
  roleIds: string[];
  isGuildMember: boolean;
}

interface WebMemberSyncResponse {
  synced: number;
  deactivated: number;
  sessionsRevoked: number;
}

function configuredGuildId(): string | null {
  return process.env.WEB_AUTH_GUILD_ID?.trim() || null;
}

function enqueueGuildSync<T>(
  guildId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = guildSyncTails.get(guildId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  guildSyncTails.set(guildId, tail);
  void tail.finally(() => {
    if (guildSyncTails.get(guildId) === tail) {
      guildSyncTails.delete(guildId);
    }
  });
  return result;
}

export function isWebAuthGuild(guildId: string): boolean {
  return configuredGuildId() === guildId;
}

function roleIdsFor(member: GuildMember): string[] {
  const roleIds = [...member.roles.cache.keys()].filter(
    (roleId) => roleId !== member.guild.id,
  );

  if (roleIds.length > MAX_ROLE_IDS) {
    throw new Error(
      `Member ${member.id} has ${roleIds.length} roles; the backend accepts at most ${MAX_ROLE_IDS}.`,
    );
  }

  return roleIds;
}

function snapshotFor(
  member: GuildMember,
  isGuildMember: boolean,
): WebMemberSnapshot {
  return {
    discordUserId: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    avatarHash: member.user.avatar,
    guildNickname: isGuildMember ? member.nickname : null,
    roleIds: isGuildMember ? roleIdsFor(member) : [],
    isGuildMember,
  };
}

async function sendSnapshots(
  guildId: string,
  members: WebMemberSnapshot[],
  fullReconciliation = false,
): Promise<WebMemberSyncResponse> {
  return await backendRequest<WebMemberSyncResponse>(
    `/internal/v1/guilds/${guildId}/web-members/sync`,
    {
      method: 'POST',
      body: JSON.stringify({
        members,
        ...(fullReconciliation ? { fullReconciliation: true } : {}),
      }),
      signal: AbortSignal.timeout(fullReconciliation ? 30_000 : 5_000),
    },
  );
}

export async function syncWebMember(member: GuildMember): Promise<void> {
  if (!isWebAuthGuild(member.guild.id) || member.user.bot) {
    return;
  }

  const snapshot = snapshotFor(member, true);
  await enqueueGuildSync(member.guild.id, async () => {
    await sendSnapshots(member.guild.id, [snapshot]);
  });
}

export async function deactivateWebMember(member: GuildMember): Promise<void> {
  if (!isWebAuthGuild(member.guild.id) || member.user.bot) {
    return;
  }

  const snapshot = snapshotFor(member, false);
  await enqueueGuildSync(member.guild.id, async () => {
    await sendSnapshots(member.guild.id, [snapshot]);
  });
}

export async function reconcileWebMembers(guild: Guild): Promise<WebMemberSyncResponse> {
  if (!isWebAuthGuild(guild.id)) {
    return { synced: 0, deactivated: 0, sessionsRevoked: 0 };
  }

  return enqueueGuildSync(guild.id, async () => {
    const fetchedMembers = await guild.members.fetch();
    const members = [...fetchedMembers.values()]
      .filter((member) => !member.user.bot)
      .map((member) => snapshotFor(member, true));

    if (members.length > MAX_RECONCILIATION_MEMBERS) {
      throw new Error(
        `Guild ${guild.id} has ${members.length} non-bot members; full reconciliation supports at most ${MAX_RECONCILIATION_MEMBERS}.`,
      );
    }

    return sendSnapshots(guild.id, members, true);
  });
}

export async function reconcileConfiguredWebGuild(
  client: Client<true>,
): Promise<void> {
  const guildId = configuredGuildId();

  if (!guildId) {
    console.warn('[web-members] WEB_AUTH_GUILD_ID is not set; member synchronization is disabled.');
    return;
  }

  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    console.error(
      `[web-members] The bot is not connected to configured guild ${guildId}; full reconciliation was skipped.`,
    );
    return;
  }

  const result = await reconcileWebMembers(guild);
  console.log(
    `[web-members] Reconciled ${result.synced} member(s) in guild ${guild.id}; `
      + `${result.deactivated} deactivated, ${result.sessionsRevoked} session(s) revoked.`,
  );
}
