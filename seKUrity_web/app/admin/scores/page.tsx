'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessGate, LoadingPanel, PageHeading, StatusPanel } from '@/components/page-ui';
import {
  apiPaths,
  apiRequest,
  formatDateTime,
  getErrorMessage,
  type AdminMember,
} from '@/lib/api';

interface AdminMembersResponse {
  members: AdminMember[];
}

export default function AdminScoresPage() {
  return (
    <main className="app-main">
      <AccessGate boardMember>
        <ScoreManager />
      </AccessGate>
    </main>
  );
}

function ScoreManager() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [voidEventId, setVoidEventId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<AdminMembersResponse>(apiPaths.admin.members);
      setMembers(response.members);
      setSelectedId((current) =>
        current && response.members.some((member) => member.userId === current)
          ? current
          : response.members[0]?.userId ?? null,
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadMembers());
  }, [loadMembers]);

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR');
    if (!query) return members;
    return members.filter((member) => member.name.toLocaleLowerCase('ko-KR').includes(query));
  }, [members, search]);

  const selected = members.find((member) => member.userId === selectedId) ?? null;

  const addScore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const parsedAmount = Number(amount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setError('점수는 1 이상의 정수로 입력해 주세요.');
      return;
    }
    if (!reason.trim()) {
      setError('점수를 추가한 사유를 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(apiPaths.admin.addScore(selected.userId), {
        method: 'POST',
        body: { amount: parsedAmount, reason: reason.trim() },
      });
      setAmount('');
      setReason('');
      setNotice(`${selected.name}님에게 ${parsedAmount.toLocaleString()}점을 추가했습니다.`);
      await loadMembers();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const voidScore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!voidEventId || !voidReason.trim()) {
      setError('점수 기록을 무효화하는 사유를 입력해 주세요.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(apiPaths.admin.voidScore(voidEventId), {
        method: 'POST',
        body: { reason: voidReason.trim() },
      });
      setVoidEventId(null);
      setVoidReason('');
      setNotice('선택한 점수 기록을 무효 처리했습니다.');
      await loadMembers();
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
        title="점수 관리"
        description="활동 부원에게 점수를 추가하고 적립 사유와 변경 이력을 관리합니다. 점수는 직접 차감할 수 없으며, 잘못된 기록은 사유와 함께 무효화됩니다."
        actions={<a className="outline-button" href="/admin/attendance">출석 관리</a>}
      />

      {loading ? (
        <LoadingPanel label="활동 부원과 점수 내역을 불러오는 중입니다." />
      ) : error && members.length === 0 ? (
        <StatusPanel
          title="점수 관리 정보를 불러오지 못했습니다"
          message={error}
          tone="danger"
          action={<button className="outline-button" type="button" onClick={() => void loadMembers()}>다시 시도</button>}
        />
      ) : members.length === 0 ? (
        <StatusPanel title="관리할 활동 부원이 없습니다" message="Discord 길드의 활동 부원 역할 동기화 상태를 확인해 주세요." />
      ) : (
        <div className="admin-split-layout">
          <aside className="member-roster" aria-label="활동 부원 목록">
            <div className="roster-heading">
              <h2>활동 부원</h2>
              <span>{members.length}명</span>
            </div>
            <label className="search-field">
              <span className="sr-only">부원 이름 검색</span>
              <input value={search} placeholder="이름 검색" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="roster-list">
              {filteredMembers.length === 0 ? (
                <p className="empty-inline">검색 결과가 없습니다.</p>
              ) : filteredMembers.map((member) => (
                <button
                  className={member.userId === selectedId ? 'is-selected' : ''}
                  type="button"
                  key={member.userId}
                  aria-pressed={member.userId === selectedId}
                  onClick={() => {
                    setSelectedId(member.userId);
                    setVoidEventId(null);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  <span>{member.name}</span>
                  <strong>{member.score.toLocaleString()}점</strong>
                </button>
              ))}
            </div>
          </aside>

          {selected && (
            <section className="admin-detail" aria-labelledby="selected-member-title">
              <div className="selected-member-heading">
                <div>
                  <p className="app-eyebrow">선택한 부원</p>
                  <h2 id="selected-member-title">{selected.name}</h2>
                </div>
                <div className="large-score">
                  <span>현재 점수</span>
                  <strong>{selected.score.toLocaleString()}</strong>
                </div>
              </div>

              <form className="score-add-form" onSubmit={(event) => void addScore(event)}>
                <h3>점수 추가</h3>
                <div className="score-form-grid">
                  <label>
                    <span className="field-label">추가할 점수</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      required
                      value={amount}
                      placeholder="예: 10"
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="field-label">추가 사유</span>
                    <input
                      required
                      value={reason}
                      maxLength={200}
                      placeholder="예: 교내 CTF 운영 참여"
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" type="submit" disabled={submitting}>점수 추가</button>
                </div>
              </form>

              {error && <div className="form-message error-message" role="alert">{error}</div>}
              {notice && <div className="form-message success-message" role="status">{notice}</div>}

              <div className="score-history">
                <div className="section-heading-row compact-heading">
                  <h3>점수 기록</h3>
                  <span>{(selected.scoreEvents ?? []).length}건</span>
                </div>
                {(selected.scoreEvents ?? []).length === 0 ? (
                  <div className="empty-inline">등록된 점수 기록이 없습니다.</div>
                ) : (
                  <div className="history-list">
                    {(selected.scoreEvents ?? []).map((scoreEvent) => (
                      <article className={`history-row score-admin-row${scoreEvent.voidedAt ? ' is-voided' : ''}`} key={scoreEvent.id}>
                        <div>
                          <strong>{scoreEvent.reason}</strong>
                          <span>
                            {formatDateTime(scoreEvent.createdAt)}
                            {scoreEvent.createdByName ? ` · ${scoreEvent.createdByName}` : ''}
                          </span>
                          {scoreEvent.voidReason && <small>무효 사유: {scoreEvent.voidReason}</small>}
                        </div>
                        <span className="score-amount">+{scoreEvent.amount.toLocaleString()}</span>
                        {scoreEvent.voidedAt ? (
                          <em>무효</em>
                        ) : (
                          <button className="text-button danger-text" type="button" onClick={() => {
                            setVoidEventId(scoreEvent.id);
                            setVoidReason('');
                          }}>무효 처리</button>
                        )}
                        {voidEventId === scoreEvent.id && (
                          <form className="void-form" onSubmit={(event) => void voidScore(event)}>
                            <label>
                              <span className="field-label">무효 사유</span>
                              <input
                                required
                                autoFocus
                                maxLength={200}
                                value={voidReason}
                                placeholder="오입력 사유를 남겨주세요."
                                onChange={(event) => setVoidReason(event.target.value)}
                              />
                            </label>
                            <button className="danger-solid-button" type="submit" disabled={submitting}>무효 확정</button>
                            <button className="outline-button" type="button" onClick={() => setVoidEventId(null)}>취소</button>
                          </form>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
