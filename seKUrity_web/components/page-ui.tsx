'use client';

import { apiPaths } from '@/lib/api';
import { useAuth } from './auth-provider';

export function PageHeading({
  className,
  eyebrow,
  title,
  description,
  actions,
}: {
  className?: string;
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className={`app-page-heading${className ? ` ${className}` : ''}`}>
      <div>
        {eyebrow && <p className="app-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  );
}

export function StatusPanel({
  title,
  message,
  tone = 'neutral',
  action,
}: {
  title: string;
  message: string;
  tone?: 'neutral' | 'danger' | 'success';
  action?: React.ReactNode;
}) {
  return (
    <section className={`status-panel status-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="status-mark" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {action && <div className="status-action">{action}</div>}
      </div>
    </section>
  );
}

export function LoadingPanel({ label = '정보를 불러오는 중입니다.' }: { label?: string }) {
  return (
    <div className="loading-panel" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function AccessGate({
  children,
  activeMember = false,
  boardMember = false,
}: {
  children: React.ReactNode;
  activeMember?: boolean;
  boardMember?: boolean;
}) {
  const { user, status, error, refresh } = useAuth();

  if (status === 'loading') return <LoadingPanel label="로그인 상태를 확인하는 중입니다." />;

  if (status === 'error') {
    return (
      <StatusPanel
        title="로그인 상태를 확인할 수 없습니다"
        message={error ?? '잠시 후 다시 시도해 주세요.'}
        tone="danger"
        action={<button className="outline-button" type="button" onClick={() => void refresh()}>다시 시도</button>}
      />
    );
  }

  if (!user) {
    return (
      <StatusPanel
        title="로그인이 필요합니다"
        message="Discord 계정으로 로그인한 뒤 이용할 수 있습니다."
        action={<a className="primary-button" href={apiPaths.auth.discord}>Discord로 로그인</a>}
      />
    );
  }

  if (boardMember && !user.isBoardMember) {
    return (
      <StatusPanel
        title="회장단 전용 기능입니다"
        message="현재 계정에는 점수와 출석을 관리할 권한이 없습니다."
        tone="danger"
        action={<a className="outline-button" href="/dashboard">내 현황으로 돌아가기</a>}
      />
    );
  }

  if (activeMember && user.membership !== 'active') {
    return (
      <StatusPanel
        title="활동 부원 전용 공간입니다"
        message="seKUrity Discord 길드의 활동 부원 역할이 확인된 계정만 이용할 수 있습니다."
        action={<a className="outline-button" href="/dashboard">내 현황으로 돌아가기</a>}
      />
    );
  }

  return <>{children}</>;
}
