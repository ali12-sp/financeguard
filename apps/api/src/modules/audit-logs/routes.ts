import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';

const router = Router();

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const schema = z.object({
    entityId: z.string().optional(),
    entityType: z.enum(['CUSTOMER', 'GUARANTOR', 'CONTRACT', 'PAYMENT', 'DEVICE', 'POLICY']).optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid query', errors: parsed.error.flatten() });
  }

  const rows = scopeToTenant(db.auditLogs, tenantId)
    .filter((log) => (parsed.data.entityId ? log.entityId === parsed.data.entityId : true))
    .filter((log) => (parsed.data.entityType ? log.entityType === parsed.data.entityType : true))
    .slice(0, parsed.data.limit ?? 50);

  res.json(rows);
});

export default router;
