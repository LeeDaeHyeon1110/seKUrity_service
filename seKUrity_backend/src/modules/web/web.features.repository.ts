import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../../db/database';
import {
  webAttendanceRecordAudits,
  webAttendanceRecords,
  webAttendanceSessions,
  webGuildMemberships,
  webMemberProfiles,
  webScoreEvents,
  webUsers,
  weeklyReportMisses,
  weeklyReportThreads,
  type WebProfileLink,
} from '../../db/schema';
import { ApiError } from '../../errors';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type AttendanceSessionStatus = 'open' | 'closed' | 'cancelled';

export interface MemberProfileInput {
  introduction: string;
  specialties: string[];
  links: WebProfileLink[];
}

interface ScoreEventView {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
  createdByName: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
}

interface AttendanceRecordView {
  userId: string;
  name: string;
  status: AttendanceStatus | null;
  note: string | null;
  updatedAt: Date | null;
}

interface AttendanceSessionView {
  id: string;
  date: string;
  status: AttendanceSessionStatus;
  records: AttendanceRecordView[];
  cancelledReason: string | null;
  closedAt: Date | null;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function memberName(row: {
  guildNickname: string | null;
  globalName: string | null;
  username: string;
}): string {
  return row.guildNickname ?? row.globalName ?? row.username;
}

function profilePhotoUrl(userId: string, storageKey: string): string {
  return `/api/v1/members/${userId}/photo?v=${encodeURIComponent(storageKey)}`;
}

function isAttendanceStatus(value: string | null): value is AttendanceStatus {
  return value === 'present'
    || value === 'late'
    || value === 'absent'
    || value === 'excused';
}

function isAttendanceSessionStatus(value: string): value is AttendanceSessionStatus {
  return value === 'open' || value === 'closed' || value === 'cancelled';
}

export class WebFeaturesRepository {
  constructor(
    private readonly database: Database,
    private readonly guildId: string,
  ) {}

  private async activeMembers(transaction: Database | Transaction = this.database) {
    return transaction
      .select({
        userId: webUsers.id,
        discordUserId: webUsers.discordUserId,
        username: webUsers.username,
        globalName: webUsers.globalName,
        avatarHash: webUsers.avatarHash,
        guildNickname: webGuildMemberships.guildNickname,
      })
      .from(webGuildMemberships)
      .innerJoin(webUsers, eq(webUsers.id, webGuildMemberships.userId))
      .where(and(
        eq(webGuildMemberships.guildId, this.guildId),
        eq(webGuildMemberships.isActiveMember, true),
      ));
  }

  private async assertActiveMember(userId: string, transaction: Database | Transaction = this.database) {
    const [member] = await transaction
      .select({ userId: webGuildMemberships.userId })
      .from(webGuildMemberships)
      .where(and(
        eq(webGuildMemberships.userId, userId),
        eq(webGuildMemberships.guildId, this.guildId),
        eq(webGuildMemberships.isActiveMember, true),
      ))
      .limit(1);
    if (!member) {
      throw new ApiError(404, 'ACTIVE_MEMBER_NOT_FOUND', 'The active member was not found.');
    }
  }

  private async scoreEventsForUsers(userIds: string[]): Promise<Map<string, ScoreEventView[]>> {
    const result = new Map<string, ScoreEventView[]>();
    if (userIds.length === 0) return result;

    const [events, users, memberships] = await Promise.all([
      this.database
        .select()
        .from(webScoreEvents)
        .where(inArray(webScoreEvents.userId, userIds))
        .orderBy(desc(webScoreEvents.createdAt)),
      this.database
        .select({
          id: webUsers.id,
          username: webUsers.username,
          globalName: webUsers.globalName,
        })
        .from(webUsers),
      this.database
        .select({
          userId: webGuildMemberships.userId,
          guildNickname: webGuildMemberships.guildNickname,
        })
        .from(webGuildMemberships)
        .where(eq(webGuildMemberships.guildId, this.guildId)),
    ]);
    const nicknameByUserId = new Map(memberships.map((row) => [row.userId, row.guildNickname]));
    const nameByUserId = new Map(users.map((row) => [
      row.id,
      nicknameByUserId.get(row.id) ?? row.globalName ?? row.username,
    ]));

    for (const event of events) {
      const list = result.get(event.userId) ?? [];
      list.push({
        id: event.id,
        amount: event.amount,
        reason: event.reason,
        createdAt: event.createdAt,
        createdByName: nameByUserId.get(event.grantedBy) ?? null,
        voidedAt: event.voidedAt,
        voidReason: event.voidReason,
      });
      result.set(event.userId, list);
    }
    return result;
  }

  async getScores(userId: string) {
    const events = (await this.scoreEventsForUsers([userId])).get(userId) ?? [];
    return {
      score: events.reduce((total, event) => total + (event.voidedAt ? 0 : event.amount), 0),
      scoreEvents: events,
    };
  }

  async getAttendance(userId: string) {
    const rows = await this.database
      .select({
        sessionId: webAttendanceSessions.id,
        date: webAttendanceSessions.attendanceDate,
        sessionStatus: webAttendanceSessions.status,
        status: webAttendanceRecords.status,
        note: webAttendanceRecords.note,
        updatedAt: webAttendanceRecords.updatedAt,
      })
      .from(webAttendanceRecords)
      .innerJoin(
        webAttendanceSessions,
        eq(webAttendanceSessions.id, webAttendanceRecords.sessionId),
      )
      .where(and(
        eq(webAttendanceRecords.userId, userId),
        ne(webAttendanceSessions.status, 'cancelled'),
      ))
      .orderBy(desc(webAttendanceSessions.attendanceDate));

    const records = rows.flatMap((row) => {
      if (!isAttendanceStatus(row.status) || !isAttendanceSessionStatus(row.sessionStatus)) return [];
      return [{
        sessionId: row.sessionId,
        date: row.date,
        sessionStatus: row.sessionStatus,
        status: row.status,
        note: row.note,
        updatedAt: row.updatedAt,
      }];
    });
    return {
      lateCount: records.filter((record) => record.status === 'late').length,
      absentCount: records.filter((record) => record.status === 'absent').length,
      records,
    };
  }

  async getSummary(userId: string, discordUserId: string) {
    const [scores, attendance, weeklyThread, misses] = await Promise.all([
      this.getScores(userId),
      this.getAttendance(userId),
      this.database
        .select({ missedReportCount: weeklyReportThreads.missedReportCount })
        .from(weeklyReportThreads)
        .where(and(
          eq(weeklyReportThreads.guildId, this.guildId),
          eq(weeklyReportThreads.userId, discordUserId),
        ))
        .limit(1),
      this.database
        .select({ weekEnd: weeklyReportMisses.weekEnd })
        .from(weeklyReportMisses)
        .where(and(
          eq(weeklyReportMisses.guildId, this.guildId),
          eq(weeklyReportMisses.userId, discordUserId),
        ))
        .orderBy(desc(weeklyReportMisses.weekEnd)),
    ]);

    return {
      score: scores.score,
      lateCount: attendance.lateCount,
      absentCount: attendance.absentCount,
      missedWeeklyReportCount: weeklyThread[0]?.missedReportCount ?? 0,
      recentScoreEvents: scores.scoreEvents.slice(0, 10),
      weeklyReportMisses: misses,
    };
  }

  async getProfile(userId: string) {
    const [row] = await this.database
      .select({
        userId: webUsers.id,
        username: webUsers.username,
        globalName: webUsers.globalName,
        guildNickname: webGuildMemberships.guildNickname,
        introduction: webMemberProfiles.introduction,
        specialties: webMemberProfiles.specialties,
        links: webMemberProfiles.links,
        photoStorageKey: webMemberProfiles.photoStorageKey,
        updatedAt: webMemberProfiles.updatedAt,
      })
      .from(webUsers)
      .innerJoin(webGuildMemberships, and(
        eq(webGuildMemberships.userId, webUsers.id),
        eq(webGuildMemberships.guildId, this.guildId),
        eq(webGuildMemberships.isActiveMember, true),
      ))
      .leftJoin(webMemberProfiles, eq(webMemberProfiles.userId, webUsers.id))
      .where(eq(webUsers.id, userId))
      .limit(1);
    if (!row) throw new ApiError(404, 'ACTIVE_MEMBER_NOT_FOUND', 'The active member was not found.');
    return {
      userId: row.userId,
      name: memberName(row),
      introduction: row.introduction ?? '',
      specialties: row.specialties ?? [],
      links: row.links ?? [],
      photoUrl: row.photoStorageKey ? profilePhotoUrl(row.userId, row.photoStorageKey) : null,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async updateProfile(userId: string, input: MemberProfileInput) {
    await this.assertActiveMember(userId);
    await this.database
      .insert(webMemberProfiles)
      .values({ userId, ...input, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: webMemberProfiles.userId,
        set: { ...input, updatedAt: new Date() },
      });
    return this.getProfile(userId);
  }

  async updateProfilePhoto(userId: string, storageKey: string): Promise<string | null> {
    await this.assertActiveMember(userId);
    const [previous] = await this.database
      .select({ storageKey: webMemberProfiles.photoStorageKey })
      .from(webMemberProfiles)
      .where(eq(webMemberProfiles.userId, userId))
      .limit(1);
    await this.database
      .insert(webMemberProfiles)
      .values({
        userId,
        photoStorageKey: storageKey,
        photoContentType: 'image/webp',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: webMemberProfiles.userId,
        set: {
          photoStorageKey: storageKey,
          photoContentType: 'image/webp',
          updatedAt: new Date(),
        },
      });
    return previous?.storageKey ?? null;
  }

  async getProfilePhotoStorageKey(userId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ storageKey: webMemberProfiles.photoStorageKey })
      .from(webMemberProfiles)
      .innerJoin(webGuildMemberships, and(
        eq(webGuildMemberships.userId, webMemberProfiles.userId),
        eq(webGuildMemberships.guildId, this.guildId),
        eq(webGuildMemberships.isActiveMember, true),
      ))
      .where(eq(webMemberProfiles.userId, userId))
      .limit(1);
    return row?.storageKey ?? null;
  }

  async listProfiles() {
    const members = await this.activeMembers();
    if (members.length === 0) return [];
    const profiles = await this.database
      .select()
      .from(webMemberProfiles)
      .where(inArray(webMemberProfiles.userId, members.map((member) => member.userId)));
    const profileByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
    return members
      .map((member) => {
        const profile = profileByUserId.get(member.userId);
        return {
          userId: member.userId,
          name: memberName(member),
          introduction: profile?.introduction ?? '',
          specialties: profile?.specialties ?? [],
          links: profile?.links ?? [],
          photoUrl: profile?.photoStorageKey
            ? profilePhotoUrl(member.userId, profile.photoStorageKey)
            : null,
          updatedAt: profile?.updatedAt ?? null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR'));
  }

  async listAdminMembers() {
    const members = await this.activeMembers();
    const eventMap = await this.scoreEventsForUsers(members.map((member) => member.userId));
    return members
      .map((member) => {
        const scoreEvents = eventMap.get(member.userId) ?? [];
        return {
          userId: member.userId,
          name: memberName(member),
          avatarUrl: member.avatarHash
            ? `https://cdn.discordapp.com/avatars/${member.discordUserId}/${member.avatarHash}.webp?size=128`
            : null,
          score: scoreEvents.reduce(
            (total, event) => total + (event.voidedAt ? 0 : event.amount),
            0,
          ),
          scoreEvents,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR'));
  }

  async addScore(userId: string, amount: number, reason: string, actorId: string) {
    await this.assertActiveMember(userId);
    const [event] = await this.database
      .insert(webScoreEvents)
      .values({
        id: randomUUID(),
        userId,
        amount,
        reason,
        grantedBy: actorId,
      })
      .returning();
    if (!event) throw new ApiError(500, 'SCORE_EVENT_CREATE_FAILED', 'Could not create the score event.');
    return (await this.scoreEventsForUsers([userId])).get(userId)?.find((row) => row.id === event.id);
  }

  async voidScore(eventId: string, reason: string, actorId: string) {
    const [event] = await this.database
      .update(webScoreEvents)
      .set({ voidedAt: new Date(), voidReason: reason, voidedBy: actorId })
      .where(and(eq(webScoreEvents.id, eventId), isNull(webScoreEvents.voidedAt)))
      .returning({ userId: webScoreEvents.userId });
    if (!event) {
      const [existing] = await this.database
        .select({ id: webScoreEvents.id, voidedAt: webScoreEvents.voidedAt })
        .from(webScoreEvents)
        .where(eq(webScoreEvents.id, eventId))
        .limit(1);
      if (!existing) throw new ApiError(404, 'SCORE_EVENT_NOT_FOUND', 'The score event was not found.');
      throw new ApiError(409, 'SCORE_EVENT_ALREADY_VOIDED', 'The score event is already voided.');
    }
    return (await this.scoreEventsForUsers([event.userId])).get(event.userId)?.find((row) => row.id === eventId);
  }

  private async sessionViews(
    sessionIds?: string[],
    transaction: Database | Transaction = this.database,
  ): Promise<AttendanceSessionView[]> {
    const sessions = await transaction
      .select()
      .from(webAttendanceSessions)
      .where(sessionIds && sessionIds.length > 0
        ? inArray(webAttendanceSessions.id, sessionIds)
        : undefined)
      .orderBy(desc(webAttendanceSessions.attendanceDate));
    if (sessions.length === 0) return [];
    const records = await transaction
      .select()
      .from(webAttendanceRecords)
      .where(inArray(webAttendanceRecords.sessionId, sessions.map((session) => session.id)))
      .orderBy(asc(webAttendanceRecords.nameSnapshot));
    return sessions.flatMap((session) => {
      if (!isAttendanceSessionStatus(session.status)) return [];
      return [{
        id: session.id,
        date: session.attendanceDate,
        status: session.status,
        records: records.flatMap((record) => {
          if (record.sessionId !== session.id) return [];
          if (record.status !== null && !isAttendanceStatus(record.status)) return [];
          return [{
            userId: record.userId,
            name: record.nameSnapshot,
            status: record.status,
            note: record.note,
            updatedAt: record.updatedAt,
          }];
        }),
        cancelledReason: session.cancelledReason,
        closedAt: session.closedAt,
      }];
    });
  }

  async listAttendanceSessions() {
    return this.sessionViews();
  }

  async createAttendanceSession(attendanceDate: string, actorId: string) {
    return this.database.transaction(async (transaction) => {
      const members = await this.activeMembers(transaction);
      const sessionId = randomUUID();
      await transaction.insert(webAttendanceSessions).values({
        id: sessionId,
        attendanceDate,
        createdBy: actorId,
      });
      if (members.length > 0) {
        await transaction.insert(webAttendanceRecords).values(members.map((member) => ({
          sessionId,
          userId: member.userId,
          nameSnapshot: memberName(member),
        })));
      }
      const sessions = await this.sessionViews([sessionId], transaction);
      return sessions[0];
    });
  }

  async updateAttendanceRecord(
    sessionId: string,
    userId: string,
    status: AttendanceStatus,
    note: string | null,
    actorId: string,
  ) {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ status: webAttendanceSessions.status })
        .from(webAttendanceSessions)
        .where(eq(webAttendanceSessions.id, sessionId))
        .limit(1);
      if (!session) throw new ApiError(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'The attendance session was not found.');
      if (session.status === 'cancelled') {
        throw new ApiError(409, 'ATTENDANCE_SESSION_CANCELLED', 'A cancelled attendance session cannot be changed.');
      }

      const [record] = await transaction
        .select()
        .from(webAttendanceRecords)
        .where(and(
          eq(webAttendanceRecords.sessionId, sessionId),
          eq(webAttendanceRecords.userId, userId),
        ))
        .limit(1);
      if (!record) throw new ApiError(404, 'ATTENDANCE_RECORD_NOT_FOUND', 'The attendance record was not found.');
      if (record.status !== null && record.status !== status && !note) {
        throw new ApiError(400, 'ATTENDANCE_CHANGE_REASON_REQUIRED', 'A note is required when changing an attendance status.');
      }
      if (record.status === status && record.note === note) {
        return {
          userId: record.userId,
          name: record.nameSnapshot,
          status,
          note,
          updatedAt: record.updatedAt,
        };
      }

      const updatedAt = new Date();
      await transaction
        .update(webAttendanceRecords)
        .set({ status, note, updatedBy: actorId, updatedAt })
        .where(and(
          eq(webAttendanceRecords.sessionId, sessionId),
          eq(webAttendanceRecords.userId, userId),
        ));
      await transaction.insert(webAttendanceRecordAudits).values({
        id: randomUUID(),
        sessionId,
        userId,
        previousStatus: record.status,
        newStatus: status,
        note,
        actorId,
      });
      return {
        userId: record.userId,
        name: record.nameSnapshot,
        status,
        note,
        updatedAt,
      };
    });
  }

  async closeAttendanceSession(sessionId: string, actorId: string) {
    return this.database.transaction(async (transaction) => {
      const closedAt = new Date();
      const [session] = await transaction
        .update(webAttendanceSessions)
        .set({ status: 'closed', closedBy: actorId, closedAt })
        .where(and(
          eq(webAttendanceSessions.id, sessionId),
          eq(webAttendanceSessions.status, 'open'),
        ))
        .returning({ id: webAttendanceSessions.id });
      if (!session) await this.throwAttendanceTransitionError(transaction, sessionId);

      const changed = await transaction
        .update(webAttendanceRecords)
        .set({
          status: 'absent',
          note: '출석부 마감 시 자동 결석 처리',
          updatedBy: actorId,
          updatedAt: closedAt,
        })
        .where(and(
          eq(webAttendanceRecords.sessionId, sessionId),
          isNull(webAttendanceRecords.status),
        ))
        .returning({ userId: webAttendanceRecords.userId });
      if (changed.length > 0) {
        await transaction.insert(webAttendanceRecordAudits).values(changed.map((record) => ({
          id: randomUUID(),
          sessionId,
          userId: record.userId,
          previousStatus: null,
          newStatus: 'absent',
          note: '출석부 마감 시 자동 결석 처리',
          actorId,
        })));
      }
      const sessions = await this.sessionViews([sessionId], transaction);
      return sessions[0];
    });
  }

  async cancelAttendanceSession(sessionId: string, reason: string, actorId: string) {
    return this.database.transaction(async (transaction) => {
      const [session] = await transaction
        .update(webAttendanceSessions)
        .set({
          status: 'cancelled',
          cancelledBy: actorId,
          cancelledAt: new Date(),
          cancelledReason: reason,
        })
        .where(and(
          eq(webAttendanceSessions.id, sessionId),
          eq(webAttendanceSessions.status, 'open'),
        ))
        .returning({ id: webAttendanceSessions.id });
      if (!session) await this.throwAttendanceTransitionError(transaction, sessionId);
      const sessions = await this.sessionViews([sessionId], transaction);
      return sessions[0];
    });
  }

  private async throwAttendanceTransitionError(
    transaction: Transaction,
    sessionId: string,
  ): Promise<never> {
    const [existing] = await transaction
      .select({ status: webAttendanceSessions.status })
      .from(webAttendanceSessions)
      .where(eq(webAttendanceSessions.id, sessionId))
      .limit(1);
    if (!existing) throw new ApiError(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'The attendance session was not found.');
    throw new ApiError(409, 'ATTENDANCE_SESSION_NOT_OPEN', 'Only an open attendance session can be closed or cancelled.');
  }
}
