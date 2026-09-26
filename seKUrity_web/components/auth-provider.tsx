'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  apiPaths,
  apiRequest,
  type CurrentUser,
} from '@/lib/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  user: CurrentUser | null;
  status: AuthStatus;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const authGenerationRef = useRef(0);
  const hasSessionRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    const authGeneration = authGenerationRef.current;
    setError(null);
    try {
      const nextUser = await apiRequest<CurrentUser>(apiPaths.me);
      if (authGeneration !== authGenerationRef.current) return;
      hasSessionRef.current = true;
      setUser(nextUser);
      setStatus('authenticated');
    } catch (cause) {
      if (authGeneration !== authGenerationRef.current) return;
      setUser(null);
      if (cause instanceof ApiError && cause.status === 401) {
        hasSessionRef.current = false;
        setStatus('anonymous');
        return;
      }
      setStatus('error');
      setError(cause instanceof Error ? cause.message : '로그인 상태를 확인하지 못했습니다.');
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let lastAutomaticRefreshAt = Date.now();
    const refreshIfStale = () => {
      if (!hasSessionRef.current || document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastAutomaticRefreshAt < 30_000) return;
      lastAutomaticRefreshAt = now;
      void refresh();
    };
    const handleVisibilityChange = () => refreshIfStale();

    queueMicrotask(() => void refresh());
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(refreshIfStale, 60_000);

    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiRequest<void>(apiPaths.auth.logout, { method: 'POST' });
    authGenerationRef.current += 1;
    hasSessionRef.current = false;
    setUser(null);
    setStatus('anonymous');
    router.push('/');
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ user, status, error, refresh, logout }),
    [user, status, error, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
