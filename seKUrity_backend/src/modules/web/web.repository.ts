import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
} from 'drizzle-orm';
import type { Database } from '../../db/database';
import {
  webGuildMemberships,
  webOauthStates,
  webSessions,
  webUsers,
} from '../../db/schema';
import { ApiError } from '../../errors';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1_000;

export interface SyncedDiscordMember {
  discordUserId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  guildNickname: string | null;
  roleIds: string[];
  isGuildMember: boolean;
}

export interface WebPrincipal {
  sessionId: string;
  userId: string;
  discordUserId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  guildNickname: string | null;
  isActiveMember: boolean;
  isBoardMember: boolean;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WebRepository {
  constructor(
    private readonly database: Database,
    private readonly sessionPepper: string,
    private readonly guildId: string,
    private readonly activeRoleId: string,
    private readonly boardRoleId: string,
  ) {}

  private hash(value: string): string {
    return createHmac('sha256', this.sessionPepper).update(value).digest('hex');
  }

  createOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  createCsrfToken(sessionToken: string): string {
    return createHmac('sha256', this.sessionPepper)
      .update(`csrf:${sessionToken}`)
      .digest('base64url');
  }

  verifyCsrfToken(sessionToken: string, csrfToken: string): boolean {
    return constantTimeEqual(this.createCsrfToken(sessionToken), csrfToken);
  }

  async createOauthState(returnTo: string): Promise<string> {
    const state = this.createOpaqueToken();
    await this.database
      .delete(webOauthStates)
      .where(lte(webOauthStates.expiresAt, new Date()));
    await this.database.insert(webOauthStates).values({
      stateHash: this.hash(state),
      returnTo,
      expiresAt: new Date(Date.now() + OAUTH_STATE_LIFETIME_MS),
    });
    return state;
  }

  async consumeOauthState(state: string): Promise<string | null> {
    const [row] = await this.database
      .delete(webOauthStates)
      .where(and(
        eq(webOauthStates.stateHash, this.hash(state)),
        gt(webOauthStates.expiresAt, new Date()),
      ))
      .returning({ returnTo: webOauthStates.returnTo });
    return row?.returnTo ?? null;
  }

  private async upsertUser(
    transaction: Transaction,
    member: Pick<SyncedDiscordMember, 'discordUserId' | 'username' | 'globalName' | 'avatarHash'>,
    lastLoginAt?: Date,
  ): Promise<string> {
    const [user] = await transaction
      .insert(webUsers)
      .values({
        id: randomUUID(),
        ...member,
        lastLoginAt,
      })
      .onConflictDoUpdate({
        target: webUsers.discordUserId,
        set: {
          username: member.username,
          globalName: member.globalName,
          avatarHash: member.avatarHash,
          updatedAt: new Date(),
          ...(lastLoginAt ? { lastLoginAt } : {}),
        },
      })
      .returning({ id: webUsers.id });
    if (!user) throw new ApiError(500, 'USER_UPSERT_FAILED', 'Could not persist the user.');
    return user.id;
  }

  private async upsertMembership(
    transaction: Transaction,
    userId: string,
    member: Pick<SyncedDiscordMember, 'guildNickname' | 'roleIds' | 'isGuildMember'>,
  ): Promise<{ active: boolean; board: boolean }> {
    const active = member.isGuildMember && member.roleIds.includes(this.activeRoleId);
    const board = active && member.roleIds.includes(this.boardRoleId);
    await transaction
      .insert(webGuildMemberships)
      .values({
        userId,
        guildId: this.guildId,
        guildNickname: member.guildNickname,
        roleIds: member.roleIds,
        isGuildMember: member.isGuildMember,
        isActiveMember: active,
        isBoardMember: board,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [webGuildMemberships.userId, webGuildMemberships.guildId],
        set: {
          guildNickname: member.guildNickname,
          roleIds: member.roleIds,
          isGuildMember: member.isGuildMember,
          isActiveMember: active,
          isBoardMember: board,
          syncedAt: new Date(),
        },
      });
    return { active, board };
  }

  async loginWithDiscord(member: SyncedDiscordMember): Promise<{ token: string; expiresAt: Date }> {
    return this.database.transaction(async (transaction) => {
      const userId = await this.upsertUser(transaction, member, new Date());
      await this.upsertMembership(transaction, userId, member);
      return this.createSessionForUser(transaction, userId);
    });
  }

  private async createSessionForUser(
    transaction: Transaction,
    userId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = new Date();
    await transaction.delete(webSessions).where(and(
      eq(webSessions.userId, userId),
      or(
        lte(webSessions.expiresAt, now),
        isNotNull(webSessions.revokedAt),
      ),
    ));
    const token = this.createOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await transaction.insert(webSessions).values({
      id: randomUUID(),
      userId,
      tokenHash: this.hash(token),
      expiresAt,
    });
    return { token, expiresAt };
  }

  async getPrincipal(token: string): Promise<WebPrincipal | null> {
    const [row] = await this.database
      .select({
        sessionId: webSessions.id,
        userId: webUsers.id,
        discordUserId: webUsers.discordUserId,
        username: webUsers.username,
        globalName: webUsers.globalName,
        avatarHash: webUsers.avatarHash,
        guildNickname: webGuildMemberships.guildNickname,
        isActiveMember: webGuildMemberships.isActiveMember,
        isBoardMember: webGuildMemberships.isBoardMember,
      })
      .from(webSessions)
      .innerJoin(webUsers, eq(webUsers.id, webSessions.userId))
      .leftJoin(webGuildMemberships, and(
        eq(webGuildMemberships.userId, webUsers.id),
        eq(webGuildMemberships.guildId, this.guildId),
      ))
      .where(and(
        eq(webSessions.tokenHash, this.hash(token)),
        isNull(webSessions.revokedAt),
        gt(webSessions.expiresAt, new Date()),
      ))
      .limit(1);

    if (!row) return null;
    await this.database.update(webSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(webSessions.id, row.sessionId));
    return {
      ...row,
      guildNickname: row.guildNickname ?? null,
      isActiveMember: row.isActiveMember ?? false,
      isBoardMember: row.isBoardMember ?? false,
    };
  }

  async logout(token: string): Promise<void> {
    await this.database.update(webSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(webSessions.tokenHash, this.hash(token)), isNull(webSessions.revokedAt)));
  }

  async logoutAll(userId: string): Promise<void> {
    await this.database.update(webSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(webSessions.userId, userId), isNull(webSessions.revokedAt)));
  }

  async rotateSession(sessionId: string, userId: string): Promise<{ token: string; expiresAt: Date }> {
    return this.database.transaction(async (transaction) => {
      const revoked = await transaction.update(webSessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(webSessions.id, sessionId),
          eq(webSessions.userId, userId),
          isNull(webSessions.revokedAt),
          gt(webSessions.expiresAt, new Date()),
        ))
        .returning({ id: webSessions.id });
      if (revoked.length === 0) {
        throw new ApiError(401, 'SESSION_EXPIRED', 'The session has expired.');
      }
      return this.createSessionForUser(transaction, userId);
    });
  }

  async syncMembers(members: SyncedDiscordMember[], fullReconciliation: boolean): Promise<{
    synced: number;
    deactivated: number;
    sessionsRevoked: number;
  }> {
    return this.database.transaction(async (transaction) => {
      let deactivated = 0;
      let sessionsRevoked = 0;
      const seenUserIds: string[] = [];

      for (const member of members) {
        const userId = await this.upsertUser(transaction, member);
        seenUserIds.push(userId);
        const [previous] = await transaction
          .select({
            isGuildMember: webGuildMemberships.isGuildMember,
            isActiveMember: webGuildMemberships.isActiveMember,
          })
          .from(webGuildMemberships)
          .where(and(
            eq(webGuildMemberships.userId, userId),
            eq(webGuildMemberships.guildId, this.guildId),
          ))
          .limit(1);
        const membership = await this.upsertMembership(transaction, userId, member);
        const lostAccess = Boolean(
          (previous?.isActiveMember && !membership.active)
          || (previous?.isGuildMember && !member.isGuildMember),
        );
        if (lostAccess) {
          deactivated += 1;
          const revoked = await transaction.update(webSessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(webSessions.userId, userId), isNull(webSessions.revokedAt)))
            .returning({ id: webSessions.id });
          sessionsRevoked += revoked.length;
        }
      }

      if (fullReconciliation) {
        const missing = await transaction.select({ userId: webGuildMemberships.userId })
          .from(webGuildMemberships)
          .where(and(
            eq(webGuildMemberships.guildId, this.guildId),
            eq(webGuildMemberships.isGuildMember, true),
            ...(seenUserIds.length > 0 ? [notInArray(webGuildMemberships.userId, seenUserIds)] : []),
          ));
        if (missing.length > 0) {
          const ids = missing.map((row) => row.userId);
          await transaction.update(webGuildMemberships).set({
            roleIds: [],
            isGuildMember: false,
            isActiveMember: false,
            isBoardMember: false,
            syncedAt: new Date(),
          }).where(and(
            eq(webGuildMemberships.guildId, this.guildId),
            inArray(webGuildMemberships.userId, ids),
          ));
          const revoked = await transaction.update(webSessions)
            .set({ revokedAt: new Date() })
            .where(and(inArray(webSessions.userId, ids), isNull(webSessions.revokedAt)))
            .returning({ id: webSessions.id });
          deactivated += ids.length;
          sessionsRevoked += revoked.length;
        }
      }

      return { synced: members.length, deactivated, sessionsRevoked };
    });
  }
}
