'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessGate, LoadingPanel, PageHeading, StatusPanel } from '@/components/page-ui';
import {
  apiPaths,
  apiRequest,
  formatDate,
  getErrorMessage,
  type AttendanceRecord,
  type AttendanceSession,
  type AttendanceStatus,
} from '@/lib/api';

interface AttendanceSessionsResponse {
  sessions: AttendanceSession[];
}

interface RecordDraft {
  status: AttendanceStatus | '';
  note: string;
}

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  excused: '공결',
};

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextTuesday() {
  const date = new Date();
  const daysUntilTuesday = (2 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + daysUntilTuesday);
  return dateInputValue(date);
}

function isTuesday(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.getDay() === 2;
}

function toDrafts(records: AttendanceRecord[]) {
  return Object.fromEntries(
    records.map((record) => [record.userId, { status: record.status ?? '', note: record.note ?? '' }]),
  ) as Record<string, RecordDraft>;
}

export default function AdminAttendancePage() {
  return (
    <main className="app-main">
      <AccessGate boardMember>
        <AttendanceManager />
      </AccessGate>
    </main>
  );
}

function AttendanceManager() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RecordDraft>>({});
  const [newDate, setNewDate] = useState(nextTuesday);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSessions = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<AttendanceSessionsResponse>(apiPaths.admin.attendanceSessions);
      setSessions(response.sessions);
      const target = response.sessions.find((session) => session.id === preferredId) ?? response.sessions[0] ?? null;
      setSelectedId(target?.id ?? null);
      setDrafts(target ? toDrafts(target.records ?? []) : {});
      setShowCancelForm(false);
      setCancelReason('');
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadSessions());
  }, [loadSessions]);

  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  const selectSession = (session: AttendanceSession) => {
    setSelectedId(session.id);
    setDrafts(toDrafts(session.records ?? []));
    setShowCancelForm(false);
    setCancelReason('');
    setError(null);
    setNotice(null);
  };

  const counts = useMemo(() => {
    if (!selected) return null;
    const records = selected.records ?? [];
    return {
      present: records.filter((record) => record.status === 'present').length,
      late: records.filter((record) => record.status === 'late').length,
      absent: records.filter((record) => record.status === 'absent').length,
      excused: records.filter((record) => record.status === 'excused').length,
      unchecked: records.filter((record) => !record.status).length,
    };
  }, [selected]);

  const createSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isTuesday(newDate)) {
      setError('출석일은 화요일로 선택해 주세요.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiRequest<AttendanceSession>(apiPaths.admin.attendanceSessions, {
        method: 'POST',
        body: { date: newDate },
      });
      setNotice(`${formatDate(newDate)} 출석부를 만들었습니다.`);
      await loadSessions(created.id);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const updateDraft = (userId: string, update: Partial<RecordDraft>) => {
    setDrafts((current) => ({
      ...current,
      [userId]: { ...(current[userId] ?? { status: '', note: '' }), ...update },
    }));
  };

  const saveRecord = async (record: AttendanceRecord) => {
    if (!selected) return;
    const draft = drafts[record.userId];
    if (!draft?.status) {
      setError(`${record.name}님의 출석 상태를 선택해 주세요.`);
      return;
    }
    if (record.status && record.status !== draft.status && !draft.note.trim()) {
      setError('기존 출석 상태를 바꿀 때는 변경 사유를 메모에 입력해 주세요.');
      return;
    }

    setSavingUserId(record.userId);
    setError(null);
    setNotice(null);
    try {
      const saved = await apiRequest<AttendanceRecord>(
        apiPaths.admin.attendanceRecord(selected.id, record.userId),
        {
          method: 'PATCH',
          body: { status: draft.status, note: draft.note.trim() || undefined },
        },
      );
      setSessions((current) => current.map((session) => (
        session.id === selected.id
          ? {
              ...session,
              records: session.records.map((item) => (
                item.userId === saved.userId ? saved : item
              )),
            }
          : session
      )));
      setDrafts((current) => ({
        ...current,
        [saved.userId]: { status: saved.status ?? '', note: saved.note ?? '' },
      }));
      setNotice(`${record.name}님의 출석 상태를 저장했습니다.`);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSavingUserId(null);
    }
  };

  const closeSession = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(apiPaths.admin.attendanceSession(selected.id), {
        method: 'PATCH',
        body: { action: 'close' },
      });
      setNotice('출석부를 마감했습니다. 미입력 부원은 결석으로 처리되었습니다.');
      await loadSessions(selected.id);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !cancelReason.trim()) {
      setError('전체 휴회 사유를 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(apiPaths.admin.attendanceSession(selected.id), {
        method: 'PATCH',
        body: { action: 'cancel', reason: cancelReason.trim() },
      });
      setNotice('해당 날짜를 전체 휴회로 처리했습니다. 출석 집계에서 제외됩니다.');
      setShowCancelForm(false);
      setCancelReason('');
      await loadSessions(selected.id);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="회장단 메뉴"
        title="출석 관리"
        description="매주 화요일 출석을 기록합니다. 출석부 마감 시 미입력 부원은 결석 처리되며, 전체 휴회일은 집계에서 제외됩니다."
        actions={<a className="outline-button" href="/admin/scores">점수 관리</a>}
      />

      <form className="create-attendance-form" onSubmit={(event) => void createSession(event)}>
        <div>
          <h2>화요일 출석부 만들기</h2>
          <p>같은 날짜의 출석부는 한 번만 만들 수 있습니다.</p>
        </div>
        <label>
          <span className="field-label">출석일</span>
          <input type="date" required value={newDate} onChange={(event) => setNewDate(event.target.value)} />
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>출석부 만들기</button>
      </form>

      {loading ? (
        <LoadingPanel label="출석부를 불러오는 중입니다." />
      ) : error && sessions.length === 0 ? (
        <StatusPanel
          title="출석부를 불러오지 못했습니다"
          message={error}
          tone="danger"
          action={<button className="outline-button" type="button" onClick={() => void loadSessions()}>다시 시도</button>}
        />
      ) : sessions.length === 0 ? (
        <StatusPanel title="아직 출석부가 없습니다" message="위에서 첫 번째 화요일 출석부를 만들어 주세요." />
      ) : (
        <div className="attendance-layout">
          <aside className="session-list" aria-label="출석일 목록">
            <div className="roster-heading">
              <h2>출석일</h2>
              <span>{sessions.length}개</span>
            </div>
            {sessions.map((session) => (
              <button
                className={session.id === selectedId ? 'is-selected' : ''}
                type="button"
                key={session.id}
                aria-pressed={session.id === selectedId}
                onClick={() => selectSession(session)}
              >
                <strong>{formatDate(session.date)}</strong>
                <span className={`session-status ${session.status}`}>
                  {session.status === 'open' ? '진행 중' : session.status === 'closed' ? '마감' : '휴회'}
                </span>
              </button>
            ))}
          </aside>

          {selected && (
            <section className="attendance-detail" aria-labelledby="attendance-date-title">
              <div className="attendance-detail-heading">
                <div>
                  <p className="app-eyebrow">선택한 출석일</p>
                  <h2 id="attendance-date-title">{formatDate(selected.date)}</h2>
                </div>
                <span className={`session-status large ${selected.status}`}>
                  {selected.status === 'open' ? '진행 중' : selected.status === 'closed' ? '마감됨' : '전체 휴회'}
                </span>
              </div>

              {counts && selected.status !== 'cancelled' && (
                <div className="attendance-counts" aria-label="출석 현황 요약">
                  <span>출석 <strong>{counts.present}</strong></span>
                  <span>지각 <strong>{counts.late}</strong></span>
                  <span>결석 <strong>{counts.absent}</strong></span>
                  <span>공결 <strong>{counts.excused}</strong></span>
                  <span>미입력 <strong>{counts.unchecked}</strong></span>
                </div>
              )}

              {selected.status === 'cancelled' ? (
                <StatusPanel
                  title="전체 휴회로 처리된 날입니다"
                  message={selected.cancelledReason ? `사유: ${selected.cancelledReason}` : '이 출석부는 모든 집계에서 제외됩니다.'}
                />
              ) : (
                <div className="attendance-table-wrap">
                  <table className="attendance-table">
                    <thead>
                      <tr>
                        <th scope="col">부원</th>
                        <th scope="col">상태</th>
                        <th scope="col">메모 및 변경 사유</th>
                        <th scope="col"><span className="sr-only">저장</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.records ?? []).map((record) => {
                        const draft = drafts[record.userId] ?? { status: '', note: '' };
                        const changed = draft.status !== (record.status ?? '') || draft.note !== (record.note ?? '');
                        return (
                          <tr key={record.userId}>
                            <th scope="row">{record.name}</th>
                            <td>
                              <select
                                aria-label={`${record.name} 출석 상태`}
                                value={draft.status}
                                onChange={(event) => updateDraft(record.userId, { status: event.target.value as AttendanceStatus | '' })}
                              >
                                <option value="">미입력</option>
                                {Object.entries(attendanceLabels).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`${record.name} 출석 메모`}
                                value={draft.note}
                                maxLength={200}
                                placeholder={record.status && record.status !== draft.status ? '상태 변경 사유 필수' : '선택 사항'}
                                onChange={(event) => updateDraft(record.userId, { note: event.target.value })}
                              />
                            </td>
                            <td>
                              <button
                                className="outline-button compact-button"
                                type="button"
                                disabled={!changed || savingUserId === record.userId}
                                onClick={() => void saveRecord(record)}
                              >
                                {savingUserId === record.userId ? '저장 중' : '저장'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {error && <div className="form-message error-message" role="alert">{error}</div>}
              {notice && <div className="form-message success-message" role="status">{notice}</div>}

              {selected.status === 'open' && (
                <div className="attendance-actions">
                  <div>
                    <button className="primary-button" type="button" disabled={submitting} onClick={() => void closeSession()}>출석부 마감</button>
                    <p>마감하면 미입력 부원 {counts?.unchecked ?? 0}명이 결석 처리됩니다.</p>
                  </div>
                  <button className="outline-button danger-outline" type="button" onClick={() => setShowCancelForm(true)}>전체 휴회 처리</button>
                </div>
              )}

              {showCancelForm && selected.status === 'open' && (
                <form className="cancel-session-form" onSubmit={(event) => void cancelSession(event)}>
                  <label>
                    <span className="field-label">전체 휴회 사유</span>
                    <input required autoFocus value={cancelReason} maxLength={200} placeholder="예: 시험 기간으로 정기 모임 휴회" onChange={(event) => setCancelReason(event.target.value)} />
                  </label>
                  <button className="danger-solid-button" type="submit" disabled={submitting}>휴회 확정</button>
                  <button className="outline-button" type="button" onClick={() => setShowCancelForm(false)}>취소</button>
                </form>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
