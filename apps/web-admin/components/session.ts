'use client';

export type SessionRole = 'admin' | 'staff' | 'customer';
export interface WorkspaceSettings {
  defaultDueDayOfMonth: number;
  defaultGraceDays: number;
  defaultEnrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
  defaultLockMessage: string;
  notifyOnDeviceRegistration: boolean;
  supportEmail?: string;
  supportPhone?: string;
  supportWhatsapp?: string;
  agentApkDownloadUrl?: string;
  agentApkChecksum?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: SessionRole;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  isPlatformOwner?: boolean;
  workspaceSettings?: WorkspaceSettings;
  customerId?: string;
}

const TOKEN_KEY = 'financeguard_token';
const USER_KEY = 'financeguard_user';

export function getStoredToken() {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function getStoredUser() {
  if (typeof window === 'undefined') return undefined;

  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return undefined;
  }
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getDefaultRouteForRole(role: SessionRole) {
  return role === 'customer' ? '/customer' : '/dashboard';
}
