import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';

const router = Router();

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const customerId =
    typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  const contractId =
    typeof req.query.contractId === 'string' ? req.query.contractId : undefined;

  const rows = scopeToTenant(db.guarantors, tenantId)
    .filter((guarantor) => (customerId ? guarantor.customerId === customerId : true))
    .filter((guarantor) => (contractId ? guarantor.contractId === contractId : true))
    .map((guarantor) => {
      const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === guarantor.customerId);
      const contract = guarantor.contractId
        ? scopeToTenant(db.contracts, tenantId).find((item) => item.id === guarantor.contractId)
        : null;

      return {
        ...guarantor,
        customerName: customer?.fullName ?? 'Unknown customer',
        contractStatus: contract?.status ?? null
      };
    });

  res.json(rows);
});

router.get('/:id', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const guarantor = scopeToTenant(db.guarantors, tenantId).find((item) => item.id === req.params.id);
  if (!guarantor) return res.status(404).json({ message: 'Guarantor not found' });

  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === guarantor.customerId) ?? null;
  const contract = guarantor.contractId
    ? scopeToTenant(db.contracts, tenantId).find((item) => item.id === guarantor.contractId) ?? null
    : null;
  const auditLogs = scopeToTenant(db.auditLogs, tenantId).filter((item) => item.entityId === guarantor.id);

  res.json({
    ...guarantor,
    customer,
    contract,
    auditLogs
  });
});

router.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    customerId: z.string(),
    contractId: z.string().optional(),
    fullName: z.string().min(2),
    phone: z.string().min(8).optional(),
    cnic: z.string().min(5),
    relationToCustomer: z.string().min(2),
    address: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === parsed.data.customerId);
  if (!customer) return res.status(404).json({ message: 'Customer not found' });

  const contract = parsed.data.contractId
    ? scopeToTenant(db.contracts, tenantId).find((item) => item.id === parsed.data.contractId)
    : undefined;
  if (parsed.data.contractId && !contract) {
    return res.status(404).json({ message: 'Contract not found' });
  }
  if (contract && contract.customerId !== customer.id) {
    return res.status(400).json({ message: 'Contract does not belong to the selected customer' });
  }

  const guarantor = {
    id: nextNumericId('g', db.guarantors),
    tenantId,
    ...parsed.data
  };

  db.guarantors.push(guarantor);
  if (contract && !contract.guarantorIds.includes(guarantor.id)) {
    contract.guarantorIds.push(guarantor.id);
  }
  await persistDb();

  const actor = (req as AuthRequest).user;
  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'GUARANTOR_CREATED',
    entityType: 'GUARANTOR',
    entityId: guarantor.id,
    reason: 'Guarantor added to the finance record',
    details: `${guarantor.fullName} was linked to customer ${customer.fullName}.`
  });

  res.status(201).json(guarantor);
}));

export default router;
