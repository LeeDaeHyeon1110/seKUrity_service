export type Membership = 'guest' | 'active';
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type AttendanceSessionStatus = 'open' | 'closed' | 'cancelled';

export interface CurrentUser {
  id: string;
  discordId: string;
  name: string;
  avatarUrl: string | null;
  membership: Membership;
  isBoardMember: boolean;
  csrfToken: string;
}

export interface ScoreEvent {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  createdByName?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface DashboardSummary {
  score: number;
  lateCount: number;
  absentCount: number;
  missedWeeklyReportCount: number;
  recentScoreEvents: ScoreEvent[];
  weeklyReportMisses: WeeklyReportMiss[];
}

export interface WeeklyReportMiss {
  id?: string;
  weekStart?: string | null;
  weekEnd: string;
}

export interface MemberLink {
  label?: string;
  url: string;
}

export interface MemberProfile {
  userId: string;
  name: string;
  introduction: string;
  specialties: string[];
  links: MemberLink[];
  photoUrl: string | null;
  updatedAt?: string | null;
}

export interface AdminMember {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  score: number;
  scoreEvents: ScoreEvent[];
}

export interface AttendanceRecord {
  userId: string;
  name: string;
  status: AttendanceStatus | null;
  note?: string | null;
  updatedAt?: string | null;
}

export interface AttendanceSession {
  id: string;
  date: string;
  status: AttendanceSessionStatus;
  records: AttendanceRecord[];
  cancelledReason?: string | null;
  closedAt?: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Backend paths live in one place so the browser UI can track API contract
 * changes without scattering string literals through pages.
 */
export const apiPaths = {
  auth: {
    discord: '/api/v1/auth/discord?returnTo=%2Fdashboard',
    logout: '/api/v1/auth/logout',
    logoutAll: '/api/v1/auth/logout-all',
    refresh: '/api/v1/auth/refresh',
  },
  me: '/api/v1/me',
  summary: '/api/v1/me/summary',
  scores: '/api/v1/me/scores',
  attendance: '/api/v1/me/attendance',
  profile: '/api/v1/me/profile',
  profilePhoto: '/api/v1/me/profile/photo',
  members: '/api/v1/members',
  memberPhoto: (userId: string) => `/api/v1/members/${encodeURIComponent(userId)}/photo`,
  admin: {
    members: '/api/v1/admin/members',
    addScore: (userId: string) =>
      `/api/v1/admin/members/${encodeURIComponent(userId)}/scores`,
    voidScore: (eventId: string) =>
      `/api/v1/admin/score-events/${encodeURIComponent(eventId)}/void`,
    attendanceSessions: '/api/v1/admin/attendance-sessions',
    attendanceSession: (sessionId: string) =>
      `/api/v1/admin/attendance-sessions/${encodeURIComponent(sessionId)}`,
    attendanceRecord: (sessionId: string, userId: string) =>
      `/api/v1/admin/attendance-sessions/${encodeURIComponent(sessionId)}/records/${encodeURIComponent(userId)}`,
  },
} as const;

interface ErrorPayload {
  message?: string;
  error?: string;
  code?: string;
}

const apiErrorMessages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: '로그인이 필요합니다.',
  SESSION_EXPIRED: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
  ACTIVE_MEMBER_REQUIRED: '활동 부원만 이용할 수 있는 기능입니다.',
  ACTIVE_MEMBER_NOT_FOUND: '현재 활동 부원으로 확인되지 않습니다.',
  BOARD_MEMBER_REQUIRED: '회장단만 이용할 수 있는 기능입니다.',
  INVALID_ORIGIN: '보안을 위해 페이지를 새로고침한 후 다시 시도해 주세요.',
  CSRF_CHECK_FAILED: '보안 확인에 실패했습니다. 페이지를 새로고침한 후 다시 시도해 주세요.',
  DISCORD_AUTHORIZATION_DENIED: 'Discord 로그인이 취소되었습니다.',
  DISCORD_API_ERROR: 'Discord 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  INVALID_OAUTH_STATE: '로그인 요청이 올바르지 않거나 만료되었습니다. 다시 로그인해 주세요.',
  EXPIRED_OAUTH_STATE: '로그인 요청이 만료되었습니다. 다시 로그인해 주세요.',
  INVALID_SPECIALTY: '주력 분야는 빈 값으로 입력할 수 없습니다.',
  DUPLICATE_SPECIALTY: '같은 주력 분야를 중복해서 입력할 수 없습니다.',
  INVALID_PROFILE_LINK: '올바른 링크 주소를 입력해 주세요.',
  INVALID_PROFILE_LINK_PROTOCOL: '링크는 http:// 또는 https://로 시작해야 합니다.',
  PROFILE_PHOTO_REQUIRED: '업로드할 소개 사진을 선택해 주세요.',
  PROFILE_PHOTO_TOO_LARGE: '소개 사진은 5MB 이하여야 합니다.',
  UNSUPPORTED_PROFILE_PHOTO: '소개 사진은 JPEG, PNG, WebP 형식만 사용할 수 있습니다.',
  INVALID_PROFILE_PHOTO: '올바른 JPEG, PNG, WebP 이미지를 선택해 주세요.',
  PROFILE_PHOTO_NOT_FOUND: '소개 사진을 찾을 수 없습니다.',
  SCORE_REASON_REQUIRED: '점수를 추가한 사유를 입력해 주세요.',
  VOID_REASON_REQUIRED: '점수 기록을 무효화하는 사유를 입력해 주세요.',
  SCORE_EVENT_NOT_FOUND: '점수 기록을 찾을 수 없습니다.',
  SCORE_EVENT_ALREADY_VOIDED: '이미 무효 처리된 점수 기록입니다.',
  ATTENDANCE_DATE_NOT_TUESDAY: '출석일은 화요일로 선택해 주세요.',
  ATTENDANCE_SESSION_NOT_FOUND: '출석부를 찾을 수 없습니다.',
  ATTENDANCE_RECORD_NOT_FOUND: '해당 부원의 출석 기록을 찾을 수 없습니다.',
  ATTENDANCE_SESSION_CANCELLED: '전체 휴회로 처리된 출석부는 수정할 수 없습니다.',
  ATTENDANCE_SESSION_NOT_OPEN: '진행 중인 출석부만 마감하거나 휴회 처리할 수 있습니다.',
  ATTENDANCE_CHANGE_REASON_REQUIRED: '기존 출석 상태를 바꿀 때는 변경 사유를 입력해 주세요.',
  CANCELLATION_REASON_REQUIRED: '전체 휴회 사유를 입력해 주세요.',
  VALIDATION_ERROR: '입력값을 다시 확인해 주세요.',
  BAD_REQUEST: '요청 내용을 다시 확인해 주세요.',
  CONFLICT: '이미 같은 항목이 등록되어 있습니다.',
  INTERNAL_ERROR: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | object | null;
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;

  const prefix = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  if (!entry) return null;

  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'data' in value &&
      Object.keys(value).length <= 2,
  );
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? 'GET').toUpperCase();
  let body = options.body as BodyInit | null | undefined;

  if (
    options.body &&
    typeof options.body === 'object' &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof URLSearchParams)
  ) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  headers.set('accept', 'application/json');

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has('x-csrf-token')) {
    const csrfToken = readCookie('sekurity_csrf');
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    body,
    cache: options.cache ?? 'no-store',
    headers,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : response.status === 204
      ? null
      : await response.text();

  if (!response.ok) {
    const error = (payload ?? {}) as ErrorPayload;
    const fallback =
      response.status === 401
        ? '로그인이 필요합니다.'
        : response.status === 403
          ? '이 기능을 이용할 권한이 없습니다.'
          : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

    const message = error.code
      ? apiErrorMessages[error.code] ?? fallback
      : error.message ?? error.error ?? fallback;

    throw new ApiError(message, response.status, error.code);
  }

  return (isEnvelope<T>(payload) ? payload.data : payload) as T;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}
