import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { buildDefaultWorkspaceSettings, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import { hashPassword } from '../../services/passwords.js';
import { generateTenantSlug } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';

const router = Router();

router.get('/status', (_req, res) => {
  const initialized = db.tenants.length > 0 && db.users.some((item) => item.role === 'admin');
  const defaultTenant = db.tenants.length === 1 ? db.tenants[0] : null;

  res.json({
    initialized,
    tenantCount: db.tenants.length,
    defaultWorkspace: defaultTenant?.slug ?? null,
    defaultWorkspaceName: defaultTenant?.name ?? null
  });
});

router.post('/initialize', asyncHandler(async (req, res) => {
  const schema = z.object({
    organizationName: z.string().min(2).max(120),
    organizationSlug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
    adminName: z.string().min(2).max(120),
    adminEmail: z.string().email(),
    adminPhone: z.string().min(8).max(30).optional(),
    adminPassword: z.string().min(8).max(128)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  if (db.tenants.length > 0 || db.users.some((item) => item.role === 'admin')) {
    return res.status(409).json({ message: 'Workspace setup has already been completed.' });
  }

  const existingSlugs = db.tenants.map((item) => item.slug);
  const tenantSlug = parsed.data.organizationSlug
    ? generateTenantSlug(parsed.data.organizationSlug, existingSlugs)
    : generateTenantSlug(parsed.data.organizationName, existingSlugs);
  const tenantId = nextNumericId('t', db.tenants);

  db.tenants.push({
    id: tenantId,
    name: parsed.data.organizationName.trim(),
    slug: tenantSlug,
    status: 'ACTIVE',
    contactEmail: parsed.data.adminEmail.trim().toLowerCase(),
    contactPhone: parsed.data.adminPhone?.trim(),
    settings: buildDefaultWorkspaceSettings({
      supportEmail: parsed.data.adminEmail.trim().toLowerCase(),
      supportPhone: parsed.data.adminPhone?.trim()
    }),
    createdAt: new Date().toISOString()
  });

  const adminUser = {
    id: nextNumericId('u', db.users),
    tenantId,
    name: parsed.data.adminName.trim(),
    email: parsed.data.adminEmail.trim().toLowerCase(),
    phone: parsed.data.adminPhone?.trim(),
    password: hashPassword(parsed.data.adminPassword),
    role: 'admin' as const,
    isPlatformOwner: true
  };

  db.users.push(adminUser);
  await persistDb();

  const token = jwt.sign(
    {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      tenantId,
      tenantName: parsed.data.organizationName.trim(),
      tenantSlug,
      isPlatformOwner: true,
      mustChangePassword: false,
      workspaceSettings: buildDefaultWorkspaceSettings({
        supportEmail: parsed.data.adminEmail.trim().toLowerCase(),
        supportPhone: parsed.data.adminPhone?.trim()
      })
    },
    env.jwtSecret,
    { expiresIn: '7d' }
  );

  return res.status(201).json({
    token,
    user: {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      phone: adminUser.phone,
      role: adminUser.role,
      tenantId,
      tenantName: parsed.data.organizationName.trim(),
      tenantSlug,
      isPlatformOwner: true,
      mustChangePassword: false,
      workspaceSettings: buildDefaultWorkspaceSettings({
        supportEmail: parsed.data.adminEmail.trim().toLowerCase(),
        supportPhone: parsed.data.adminPhone?.trim()
      })
    },
    workspace: {
      id: tenantId,
      name: parsed.data.organizationName.trim(),
      slug: tenantSlug
    }
  });
}));

export default router;
