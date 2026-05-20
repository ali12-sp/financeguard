import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, buildInstallmentSchedule, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';
import { createContractInvoicePdf } from '../../services/pdf-documents.js';
import { getContractDetail, getContractSummary, syncContractState } from './ledger.js';

const router = Router();

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  res.json(scopeToTenant(db.contracts, tenantId).map((contract) => getContractSummary(contract)));
});

router.get('/:id', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const contract = scopeToTenant(db.contracts, tenantId).find((item) => item.id === req.params.id);
  if (!contract) return res.status(404).json({ message: 'Contract not found' });

  res.json(getContractDetail(contract));
});

router.get('/:id/invoice.pdf', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const contract = scopeToTenant(db.contracts, tenantId).find((item) => item.id === req.params.id);
  if (!contract) return res.status(404).json({ message: 'Contract not found' });

  const pdf = createContractInvoicePdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${contract.id}.pdf"`);
  res.send(pdf);
});

router.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    customerId: z.string(),
    deviceId: z.string(),
    guarantorIds: z.array(z.string()).default([]),
    totalPhonePrice: z.number().positive(),
    advancePayment: z.number().min(0),
    monthlyInstallment: z.number().positive(),
    totalMonths: z.number().int().positive(),
    dueDayOfMonth: z.number().int().min(1).max(31),
    graceDays: z.number().int().min(0).max(30),
    agreementAccepted: z.boolean(),
    agreementAcceptedAt: z.string().datetime().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
    .refine((value) => value.advancePayment <= value.totalPhonePrice, {
      message: 'Advance payment cannot exceed total phone price',
      path: ['advancePayment']
    })
    .refine(
      (value) =>
        value.monthlyInstallment * value.totalMonths >=
        value.totalPhonePrice - value.advancePayment,
      {
        message: 'Installment schedule does not cover the financed amount',
        path: ['monthlyInstallment']
      }
    );

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === parsed.data.customerId);
  if (!customer) return res.status(404).json({ message: 'Customer not found' });

  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === parsed.data.deviceId);
  if (!device) return res.status(404).json({ message: 'Device not found' });

  const guarantors = parsed.data.guarantorIds.map((guarantorId) =>
    scopeToTenant(db.guarantors, tenantId).find((item) => item.id === guarantorId)
  );
  if (guarantors.some((item) => !item)) {
    return res.status(404).json({ message: 'One or more guarantors were not found' });
  }

  if (
    guarantors.some(
      (item) =>
        item &&
        (item.customerId !== customer.id || (item.contractId && item.contractId !== ''))
    )
  ) {
    return res.status(400).json({
      message: 'Guarantors must belong to the selected customer and not already be assigned'
    });
  }

  const financedAmount = parsed.data.totalPhonePrice - parsed.data.advancePayment;
  const contract = {
    id: nextNumericId('ct', db.contracts),
    tenantId,
    customerId: parsed.data.customerId,
    deviceId: parsed.data.deviceId,
    guarantorIds: parsed.data.guarantorIds,
    totalPhonePrice: parsed.data.totalPhonePrice,
    advancePayment: parsed.data.advancePayment,
    financedAmount,
    monthlyInstallment: parsed.data.monthlyInstallment,
    totalMonths: parsed.data.totalMonths,
    dueDayOfMonth: parsed.data.dueDayOfMonth,
    graceDays: parsed.data.graceDays,
    agreementAccepted: parsed.data.agreementAccepted,
    agreementAcceptedAt: parsed.data.agreementAcceptedAt ?? new Date().toISOString(),
    deviceImei: device.imei,
    deviceSerial: device.serial,
    status: 'ACTIVE' as const,
    startDate: parsed.data.startDate ?? new Date().toISOString().slice(0, 10)
  };

  db.contracts.push(contract);
  db.installments.push(...buildInstallmentSchedule(contract));
  device.assignedCustomerId = customer.id;

  for (const guarantor of guarantors) {
    if (guarantor) guarantor.contractId = contract.id;
  }

  syncContractState(contract);
  await persistDb();

  const actor = (req as AuthRequest).user;
  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'CONTRACT_CREATED',
    entityType: 'CONTRACT',
    entityId: contract.id,
    reason: parsed.data.agreementAccepted
      ? 'Financing contract created after agreement acceptance'
      : 'Financing contract created before agreement was marked accepted',
    details: `${customer.fullName} financed ${device.modelName} with a balance of Rs. ${financedAmount}.`
  });

  res.status(201).json(getContractDetail(contract));
}));

export default router;
