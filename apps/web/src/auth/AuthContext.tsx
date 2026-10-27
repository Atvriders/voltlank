// Auth context: loads the current user from the session cookie and exposes
// login/logout. Also drives the theme attribute.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { UserPublic } from '@voltlink/shared';

interface AuthState {
  user: UserPublic | null;
  loading: boolean;
  login: (email: string, password: string, totp?: string) => Promise<{ totpRequired?: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<UserPublic>('/api/v1/auth/me');
      setUser(me);
      applyTheme(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('voltlink:unauthorized', onUnauthorized);
    return () => window.removeEventListener('voltlink:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string, totp?: string) => {
      const res = await api<{ user?: UserPublic; totpRequired?: boolean }>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password, totp },
      });
      if (res.totpRequired) return { totpRequired: true };
      if (res.user) {
        setUser(res.user);
        applyTheme(res.user);
      }
      return {};
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function applyTheme(user?: UserPublic | null): void {
  const saved = localStorage.getItem('voltlink-theme');
  const theme = saved || (user ? user.theme : null) || 'voltlank-dark';
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: string): void {
  localStorage.setItem('voltlink-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export const THEMES = [
  { id: 'voltlank-dark', name: 'VoltLink Dark' },
  { id: 'voltlank-light', name: 'VoltLink Light' },
  { id: 'fleet-ops', name: 'Fleet Operations' },
  { id: 'high-contrast', name: 'High Contrast' },
  { id: 'colorblind-safe', name: 'Colorblind Safe' },
] as const;
