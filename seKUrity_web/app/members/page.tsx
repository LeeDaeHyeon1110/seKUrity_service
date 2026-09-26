'use client';

import { useCallback, useEffect, useState } from 'react';
import { MemberCard } from '@/components/member-card';
import { AccessGate, LoadingPanel, PageHeading, StatusPanel } from '@/components/page-ui';
import { apiPaths, apiRequest, getErrorMessage, type MemberProfile } from '@/lib/api';

interface MembersResponse {
  members: MemberProfile[];
}

export default function MembersPage() {
  return (
    <main className="app-main">
      <AccessGate activeMember>
        <MembersContent />
      </AccessGate>
    </main>
  );
}

function MembersContent() {
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<MembersResponse>(apiPaths.members);
      setMembers(response.members);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadMembers());
  }, [loadMembers]);

  return (
    <>
      <PageHeading
        className="member-page-heading"
        title="부원 소개"
        description="함께 공부하고 활동하는 seKUrity 부원들의 관심 분야와 작업을 살펴보세요. 이 페이지는 활동 부원에게만 공개됩니다."
        actions={<a className="primary-button" href="/members/me/edit">내 소개 수정</a>}
      />

      {loading ? (
        <LoadingPanel label="부원 소개를 불러오는 중입니다." />
      ) : error ? (
        <StatusPanel
          title="부원 소개를 불러오지 못했습니다"
          message={error}
          tone="danger"
          action={<button className="outline-button" type="button" onClick={() => void loadMembers()}>다시 시도</button>}
        />
      ) : members.length === 0 ? (
        <StatusPanel
          title="작성된 소개가 없습니다"
          message="첫 번째로 소개 카드를 작성해 보세요."
          action={<a className="primary-button" href="/members/me/edit">내 소개 작성</a>}
        />
      ) : (
        <section className="member-grid" aria-label="활동 부원 소개 목록">
          {members.map((member) => <MemberCard key={member.userId} member={member} />)}
        </section>
      )}
    </>
  );
}
