import type { AuthRequest } from '../middleware/auth.js';

export interface TenantScopedRecord {
  tenantId: string;
}

export interface TenantScopedEntity extends TenantScopedRecord {
  id: string;
}

export function getTenantIdFromAuth(req: AuthRequest) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant context is missing from the authenticated user.');
  }

  return tenantId;
}

export function scopeToTenant<T extends TenantScopedRecord>(rows: T[], tenantId?: string) {
  return tenantId ? rows.filter((row) => row.tenantId === tenantId) : rows;
}

export function findTenantById<T extends TenantScopedEntity>(
  rows: T[],
  tenantId: string,
  id: string
) {
  return rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
}

export function generateTenantSlug(name: string, existingSlugs: string[]) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

  let candidate = base;
  let suffix = 2;
  while (existingSlugs.includes(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
