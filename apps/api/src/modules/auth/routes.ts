import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db, persistDb } from '../../db/mock-db.js';
import { requireAuth, type AuthRequest } from '../../middleware/auth.js';
import { hashPassword, verifyPassword } from '../../services/passwords.js';
import { asyncHandler } from '../../services/async-handler.js';

const router = Router();

router.post('/login', (req, res) => {
  const schema = z.object({
    workspace: z.string().min(2).optional(),
    identifier: z.string().min(3).optional(),
    email: z.string().email().optional(),
    password: z.string().min(3)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const identifier = (parsed.data.identifier ?? parsed.data.email ?? '').trim().toLowerCase();
  if (db.tenants.length === 0) {
    return res.status(503).json({ message: 'Workspace setup has not been completed yet.' });
  }

  const workspaceSlug = parsed.data.workspace?.trim().toLowerCase();
  const tenant = workspaceSlug
    ? db.tenants.find((item) => item.slug === workspaceSlug && item.status === 'ACTIVE') ?? null
    : db.tenants.length === 1
      ? db.tenants[0].status === 'ACTIVE'
        ? db.tenants[0]
        : null
      : null;

  if (!tenant) {
    return res.status(404).json({ message: 'Workspace not found' });
  }

  const user = db.users.find((item) => {
    if (item.tenantId !== tenant.id) {
      return false;
    }

    const emailMatches = item.email.toLowerCase() === identifier;
    const phoneMatches = item.phone?.trim() === parsed.data.identifier?.trim();
    return (emailMatches || phoneMatches) && verifyPassword(parsed.data.password, item.password);
  });

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customerId,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      isPlatformOwner: user.isPlatformOwner === true,
      workspaceSettings: tenant.settings
    },
    env.jwtSecret,
    { expiresIn: '7d' },
  );

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      isPlatformOwner: user.isPlatformOwner === true,
      workspaceSettings: tenant.settings,
      customerId: user.customerId
    }
  });
});

router.get('/me', requireAuth, (req, res) => {
  const authUser = (req as AuthRequest).user;
  const user = db.users.find((item) => item.id === authUser?.id && item.tenantId === authUser?.tenantId);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: authUser?.tenantName,
      tenantSlug: authUser?.tenantSlug,
      isPlatformOwner: user.isPlatformOwner === true,
      workspaceSettings: db.tenants.find((item) => item.id === user.tenantId)?.settings,
      customerId: user.customerId
    }
  });
});

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(3),
    newPassword: z.string().min(6).max(128)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const authUser = (req as AuthRequest).user;
  const user = db.users.find((item) => item.id === authUser?.id && item.tenantId === authUser?.tenantId);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  if (!verifyPassword(parsed.data.currentPassword, user.password)) {
    return res.status(401).json({ message: 'Current password is incorrect' });
  }

  user.password = hashPassword(parsed.data.newPassword);
  await persistDb();

  return res.json({ ok: true });
}));

export default router;
