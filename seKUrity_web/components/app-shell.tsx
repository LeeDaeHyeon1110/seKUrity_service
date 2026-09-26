'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { apiPaths } from '@/lib/api';
import { useAuth } from './auth-provider';

function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="seKUrity 홈">
      se<span>KU</span>rity
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, status, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const isActiveMember = user?.membership === 'active';

  const toggleTheme = () => {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem('sekurity-theme', nextTheme);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="site-shell">
      <header className="site-header app-header">
        <Wordmark />

        <nav className="main-nav" aria-label="주요 메뉴">
          <Link href="/#top">소개</Link>
          <Link href="/#studies">스터디</Link>
          <Link href="/#achievements">성과</Link>
          <Link href="/#contact">연락처</Link>
          {isActiveMember && (
            <Link
              className={pathname.startsWith('/members') ? 'is-current' : ''}
              href="/members"
              aria-current={pathname.startsWith('/members') ? 'page' : undefined}
            >부원 소개</Link>
          )}
          {isActiveMember && user?.isBoardMember && (
            <>
              <Link
                className={pathname === '/admin/scores' ? 'is-current' : ''}
                href="/admin/scores"
                aria-current={pathname === '/admin/scores' ? 'page' : undefined}
              >점수 관리</Link>
              <Link
                className={pathname === '/admin/attendance' ? 'is-current' : ''}
                href="/admin/attendance"
                aria-current={pathname === '/admin/attendance' ? 'page' : undefined}
              >출석 관리</Link>
            </>
          )}
        </nav>

        <div className="header-actions">
          {status === 'loading' ? (
            <span className="header-status" aria-label="로그인 상태 확인 중">확인 중</span>
          ) : user ? (
            <>
              <div className="header-account">
                <span className="header-account-name">{user.name}</span>
                <span className={`membership-badge ${user.membership}`}>
                  {user.isBoardMember ? '회장단' : user.membership === 'active' ? '활동 부원' : '게스트'}
                </span>
              </div>
              <Link
                className="header-account-link"
                href="/dashboard"
                aria-current={pathname === '/dashboard' ? 'page' : undefined}
              >
                내 정보
              </Link>
              <button
                className="header-logout"
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? '처리 중' : '로그아웃'}
              </button>
            </>
          ) : (
            <a className="header-login" href={apiPaths.auth.discord}>Discord 로그인</a>
          )}
        </div>
      </header>

      {children}

      <button
        className={`theme-toggle${pathname === '/members/me/edit' ? ' above-sticky-actions' : ''}`}
        type="button"
        onClick={toggleTheme}
        aria-label="화면 테마 전환"
        title="화면 테마 전환"
      >
        <span className="theme-icon-light" aria-hidden="true">☀</span>
        <span className="theme-icon-dark" aria-hidden="true">☾</span>
      </button>
    </div>
  );
}
