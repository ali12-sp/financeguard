'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';
import Sidebar from './sidebar';
import {
  clearSession,
  getDefaultRouteForRole,
  getStoredToken,
  getStoredUser,
  setSession,
  type SessionRole,
  type SessionUser
} from './session';

interface LayoutShellProps {
  children: ReactNode;
  allowedRoles?: SessionRole[];
}

const DEFAULT_ALLOWED_ROLES: SessionRole[] = ['admin', 'staff'];

export default function LayoutShell({
  children,
  allowedRoles = DEFAULT_ALLOWED_ROLES
}: LayoutShellProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const allowedRolesKey = allowedRoles.join('|');

  useEffect(() => {
    const currentUser = getStoredUser();

    if (!currentUser) {
      setUser(null);
      setReady(false);
      router.replace('/login');
      return;
    }

    if (!allowedRoles.includes(currentUser.role)) {
      setUser(null);
      setReady(false);
      router.replace(getDefaultRouteForRole(currentUser.role));
      return;
    }

    setUser(currentUser);
    setReady(true);

    const token = getStoredToken();
    if (!token) {
      return;
    }

    apiFetch<{ user: SessionUser }>('/auth/me', token)
      .then(({ user: refreshedUser }) => {
        setSession(token, refreshedUser);
        setUser(refreshedUser);
      })
      .catch(() => {
        clearSession();
        setUser(null);
        setReady(false);
        router.replace('/login');
      });
  }, [allowedRolesKey, router]);

  function handleLogout() {
    clearSession();
    router.replace('/login');
  }

  if (!ready || !user) {
    return (
      <div className="layout-shell-loading">
        <div className="loading-card">
          <h1>FinanceGuard</h1>
          <p className="inline-note">Preparing your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <Sidebar user={user} onLogout={handleLogout} />
      <main className="main">
        <div className="topbar">
          <div>
            <div className="eyebrow">{user.role === 'customer' ? 'Customer Portal' : 'Admin Console'}</div>
            <div className="topbar-title">{user.name}</div>
            <div className="topbar-copy">
              {user.tenantName ? `${user.tenantName} | ` : ''}{user.phone || user.email}
            </div>
          </div>
          <div className="topbar-actions">
            {user.isPlatformOwner ? (
              <span className="badge info">PLATFORM OWNER</span>
            ) : null}
            <span className={`badge ${user.role === 'customer' ? 'reminder' : 'active'}`}>{user.role.toUpperCase()}</span>
            <button type="button" className="ghost-button" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
