import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AppRole, WorkspaceSettings } from '../db/mock-db.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: AppRole;
    tenantId: string;
    tenantName?: string;
    tenantSlug?: string;
    isPlatformOwner?: boolean;
    workspaceSettings?: WorkspaceSettings;
    customerId?: string;
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing token' });
  }

  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthRequest['user'];
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

export function requireStaffAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Missing authenticated user' });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'staff') {
    return res.status(403).json({ message: 'Staff access required' });
  }

  next();
}

export function requirePlatformOwner(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Missing authenticated user' });
  }

  if (!req.user.isPlatformOwner) {
    return res.status(403).json({ message: 'Platform owner access required' });
  }

  next();
}

export function requireCustomerAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Missing authenticated user' });
  }

  if (req.user.role !== 'customer' || !req.user.customerId) {
    return res.status(403).json({ message: 'Customer access required' });
  }

  next();
}
