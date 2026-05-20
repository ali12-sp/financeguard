const TOKEN_KEY = 'financeguard_token';
const USER_KEY = 'financeguard_user';

declare global {
  interface Window {
    __FINANCEGUARD_API_URL__?: string;
  }
}

export function getApiUrl() {
  if (typeof window !== 'undefined' && window.__FINANCEGUARD_API_URL__) {
    return window.__FINANCEGUARD_API_URL__;
  }

  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
}

function buildErrorMessage(error: any, status: number) {
  if (!error) {
    return `Request failed: ${status}`;
  }

  const issueLines = Array.isArray(error.issues)
    ? error.issues
        .map((issue: { path?: string; message?: string }) =>
          issue?.path ? `${issue.path}: ${issue.message}` : issue?.message
        )
        .filter(Boolean)
    : [];

  if (issueLines.length > 0) {
    return issueLines.join(' | ');
  }

  const fieldErrors = error?.errors?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const fieldLines = Object.entries(fieldErrors)
      .flatMap(([field, messages]) =>
        Array.isArray(messages)
          ? messages.filter(Boolean).map((message) => `${field}: ${message}`)
          : []
      );

    if (fieldLines.length > 0) {
      return fieldLines.join(' | ');
    }
  }

  return error?.message || `Request failed: ${status}`;
}

export function getStoredToken() {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function getStoredUser() {
  if (typeof window === 'undefined') return undefined;

  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as {
      id: string;
      name: string;
      email: string;
      role: string;
      tenantId: string;
      tenantName?: string;
      tenantSlug?: string;
      isPlatformOwner?: boolean;
      mustChangePassword?: boolean;
      workspaceSettings?: {
        defaultDueDayOfMonth: number;
        defaultGraceDays: number;
        defaultEnrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
        defaultLockMessage: string;
        notifyOnDeviceRegistration: boolean;
        supportEmail?: string;
        supportPhone?: string;
        supportWhatsapp?: string;
      };
    };
  } catch {
    return undefined;
  }
}

export function storeSession(payload: {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    tenantId: string;
    tenantName?: string;
      tenantSlug?: string;
      isPlatformOwner?: boolean;
      mustChangePassword?: boolean;
      workspaceSettings?: {
      defaultDueDayOfMonth: number;
      defaultGraceDays: number;
      defaultEnrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
      defaultLockMessage: string;
      notifyOnDeviceRegistration: boolean;
      supportEmail?: string;
      supportPhone?: string;
      supportWhatsapp?: string;
    };
  };
}) {
  localStorage.setItem(TOKEN_KEY, payload.token);
  localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function apiFetch<T>(path: string, token = getStoredToken(), init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers,
    cache: 'no-store'
  });

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(buildErrorMessage(error, res.status));
  }

  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit) {
  return apiFetch<T>(path, getStoredToken(), {
    ...init,
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiPatch<T>(path: string, body?: unknown, init?: RequestInit) {
  return apiFetch<T>(path, getStoredToken(), {
    ...init,
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiDownload(path: string, filename: string) {
  const headers = new Headers();
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${getApiUrl()}${path}`, {
    headers,
    cache: 'no-store'
  });

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(buildErrorMessage(error, res.status));
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
