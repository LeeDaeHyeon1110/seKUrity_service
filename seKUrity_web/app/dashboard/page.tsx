'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { AccessGate, LoadingPanel, PageHeading, StatusPanel } from '@/components/page-ui';
import {
  apiPaths,
  apiRequest,
  formatDateTime,
  getErrorMessage,
  type DashboardSummary,
} from '@/lib/api';

export default function DashboardPage() {
  return (
    <main className="app-main">
      <AccessGate>
        <DashboardContent />
      </AccessGate>
    </main>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!user || user.membership !== 'active') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setSummary(await apiRequest<DashboardSummary>(apiPaths.summary));
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    queueMicrotask(() => void loadSummary());
  }, [loadSummary]);

  if (!user) return null;

  return (
    <>
      <PageHeading
        className="member-page-heading"
        title={`${user.name}님, 반갑습니다.`}
        description={
          user.membership === 'active'
            ? '현재 점수와 출석, 주간보고 현황을 한곳에서 확인할 수 있습니다.'
            : 'Discord 로그인은 완료되었지만 현재 활동 부원 역할이 확인되지 않았습니다.'
        }
        actions={
          user.membership === 'active' ? (
            <>
              <a className="outline-button" href="/members">부원 소개 보기</a>
              <a className="primary-button" href="/members/me/edit">내 소개 수정</a>
            </>
          ) : undefined
        }
      />

      {user.membership !== 'active' ? (
        <section className="guest-card">
          <div className="guest-card-copy">
            <span className="membership-badge guest">게스트</span>
            <h2>활동 부원 권한을 확인해 주세요</h2>
            <p>
              seKUrity Discord 길드에 가입하고 활동 부원 역할을 받으면 점수, 출석,
              주간보고와 부원 소개 기능을 사용할 수 있습니다. 역할 변경은 잠시 후
              자동으로 반영되며, 필요하면 페이지를 새로고침해 다시 확인해 주세요.
            </p>
          </div>
          <div className="guest-grid" aria-hidden="true" />
        </section>
      ) : loading ? (
        <LoadingPanel label="개인 활동 현황을 불러오는 중입니다." />
      ) : error ? (
        <StatusPanel
          title="활동 현황을 불러오지 못했습니다"
          message={error}
          tone="danger"
          action={<button className="outline-button" type="button" onClick={() => void loadSummary()}>다시 시도</button>}
        />
      ) : summary ? (
        <>
          <section className="summary-grid" aria-label="개인 활동 요약">
            <article className="summary-card summary-score">
              <span>점수</span>
              <strong>{summary.score.toLocaleString()}</strong>
              <p>활동을 통해 쌓은 전체 점수입니다.</p>
            </article>
            <article className="summary-card">
              <span>지각</span>
              <strong>{summary.lateCount.toLocaleString()}회</strong>
              <p>출석부에 기록된 지각 횟수입니다.</p>
            </article>
            <article className="summary-card">
              <span>결석</span>
              <strong>{summary.absentCount.toLocaleString()}회</strong>
              <p>취소된 출석일은 포함하지 않습니다.</p>
            </article>
            <article className="summary-card">
              <span>주간보고 미제출</span>
              <strong>{summary.missedWeeklyReportCount.toLocaleString()}회</strong>
              <p>현재까지 누적된 미제출 횟수입니다.</p>
            </article>
          </section>

          <section className="app-section activity-history" aria-labelledby="score-history-title">
            <div className="section-heading-row">
              <div>
                <h2 id="score-history-title">점수 적립 기록</h2>
              </div>
            </div>
            {(summary.recentScoreEvents ?? []).length === 0 ? (
              <div className="empty-inline">아직 등록된 점수 기록이 없습니다.</div>
            ) : (
              <div className="history-list">
                {(summary.recentScoreEvents ?? []).map((event) => (
                  <article className={`history-row${event.voidedAt ? ' is-voided' : ''}`} key={event.id}>
                    <div>
                      <strong>{event.reason}</strong>
                      <span>{formatDateTime(event.createdAt)}</span>
                    </div>
                    <span className="score-amount">+{event.amount.toLocaleString()}</span>
                    {event.voidedAt && <em>무효 처리</em>}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="app-section weekly-history" aria-labelledby="weekly-history-title">
            <div className="section-heading-row">
              <div>
                <h2 id="weekly-history-title">주간보고 미제출 기록</h2>
              </div>
              <strong className="section-total">누적 {summary.missedWeeklyReportCount.toLocaleString()}회</strong>
            </div>
            {(summary.weeklyReportMisses ?? []).length === 0 ? (
              <div className="empty-inline">주간보고 미제출 기록이 없습니다.</div>
            ) : (
              <div className="week-miss-grid">
                {(summary.weeklyReportMisses ?? []).map((miss, index) => (
                  <article key={miss.id ?? `${miss.weekEnd}-${index}`}>
                    <span>마감 주차</span>
                    <strong>{new Intl.DateTimeFormat('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    }).format(new Date(`${miss.weekEnd.slice(0, 10)}T12:00:00`))}</strong>
                    {miss.weekStart && <small>{miss.weekStart.slice(0, 10)} ~ {miss.weekEnd.slice(0, 10)}</small>}
                  </article>
                ))}
              </div>
            )}
          </section>

          {user.isBoardMember && (
            <section className="admin-shortcuts" aria-labelledby="admin-shortcuts-title">
              <div>
                <p className="app-eyebrow">회장단 메뉴</p>
                <h2 id="admin-shortcuts-title">운영 관리</h2>
              </div>
              <a href="/admin/scores">점수 관리 <span aria-hidden="true">→</span></a>
              <a href="/admin/attendance">출석 관리 <span aria-hidden="true">→</span></a>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
