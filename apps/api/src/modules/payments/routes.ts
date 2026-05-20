import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';
import {
  allocatePaymentToInstallments,
  getContractDetail,
  getPaymentSummary,
  getRemainingBalance,
  syncContractState
} from '../contracts/ledger.js';
import { issueDeviceCommand } from '../../services/device-control.js';
import { createPaymentReceiptPdf } from '../../services/pdf-documents.js';

const router = Router();

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const contractId =
    typeof req.query.contractId === 'string' ? req.query.contractId : undefined;
  const tenantPayments = scopeToTenant(db.payments, tenantId);
  const rows = contractId
    ? tenantPayments.filter((payment) => payment.contractId === contractId)
    : tenantPayments;

  res.json(rows.map((payment) => getPaymentSummary(payment)));
});

router.get('/:id/receipt.pdf', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const payment = scopeToTenant(db.payments, tenantId).find((item) => item.id === req.params.id);
  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  const pdf = createPaymentReceiptPdf(payment);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${payment.id}.pdf"`);
  res.send(pdf);
});

router.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    contractId: z.string(),
    principalAmount: z.number().positive(),
    lateFeeAmount: z.number().min(0).default(0),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH', 'CARD', 'OTHER']).default('CASH'),
    referenceNumber: z.string().max(120).optional(),
    receiptUrl: z.string().url().optional().or(z.literal('')),
    monthCovered: z.string().optional(),
    matchedBy: z.enum(['AUTO', 'MANUAL_OVERRIDE']).default('AUTO'),
    note: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const contract = scopeToTenant(db.contracts, tenantId).find((item) => item.id === parsed.data.contractId);
  if (!contract) return res.status(404).json({ message: 'Contract not found' });

  const previousDeviceState = scopeToTenant(db.devices, tenantId).find((item) => item.id === contract.deviceId)?.state;
  const allocation = allocatePaymentToInstallments(contract, parsed.data.principalAmount);
  if ('error' in allocation) {
    return res.status(400).json({ message: allocation.error });
  }

  const remainingBalanceAfter = getRemainingBalance(contract);
  const coveredInstallmentIds = allocation.coveredInstallments.map((item) => item.id);
  const monthCovered =
    parsed.data.monthCovered ??
    allocation.coveredInstallments.map((item) => item.label).join(', ');
  const actor = (req as AuthRequest).user;
  const payment = {
    id: nextNumericId('p', db.payments),
    tenantId,
    contractId: contract.id,
    coveredInstallmentIds,
    receivedAmount: parsed.data.principalAmount + parsed.data.lateFeeAmount,
    principalApplied: parsed.data.principalAmount,
    lateFeeAmount: parsed.data.lateFeeAmount,
    paymentMethod: parsed.data.paymentMethod,
    referenceNumber: parsed.data.referenceNumber?.trim() || undefined,
    receiptUrl: parsed.data.receiptUrl?.trim() || undefined,
    receivedAt: new Date().toISOString(),
    monthCovered,
    matchedBy: parsed.data.matchedBy,
    remainingBalanceAfter,
    recordedByUserId: actor?.id ?? 'system',
    note: parsed.data.note
  };

  db.payments.push(payment);
  const syncResult = syncContractState(contract);
  await persistDb();

  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'PAYMENT_RECORDED',
    entityType: 'PAYMENT',
    entityId: payment.id,
    reason: 'Installment payment received',
    details: `Rs. ${payment.principalApplied} principal and Rs. ${payment.lateFeeAmount} late fee were posted to ${monthCovered}. Method: ${payment.paymentMethod}. Reference: ${payment.referenceNumber ?? 'n/a'}.`
  });

  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: parsed.data.matchedBy === 'MANUAL_OVERRIDE' ? 'MANUAL_OVERRIDE' : 'PAYMENT_MATCHED',
    entityType: 'POLICY',
    entityId: contract.id,
    reason:
      parsed.data.matchedBy === 'MANUAL_OVERRIDE'
        ? 'Payment was manually assigned to the ledger'
        : 'Payment matched automatically to scheduled installments',
    details: `Covered installments: ${monthCovered || 'n/a'}. Remaining balance is Rs. ${remainingBalanceAfter}.`
  });

  if (previousDeviceState === 'RESTRICTED' && syncResult.device && syncResult.device.state !== 'RESTRICTED') {
    addAuditLog({
      tenantId,
      actorUserId: actor?.id ?? 'system',
      actorName: actor?.email ?? 'System',
      action: syncResult.device.state === 'RELEASED' ? 'DEVICE_RELEASED' : 'DEVICE_UNLOCKED',
      entityType: 'DEVICE',
      entityId: syncResult.device.id,
      reason: 'Payment changed the restriction state',
      details: `Device moved from ${previousDeviceState} to ${syncResult.device.state}.`
    });

    await issueDeviceCommand({
      deviceId: syncResult.device.id,
      contractId: contract.id,
      type: 'UNLOCK',
      reason:
        syncResult.device.state === 'RELEASED'
          ? 'Financing completed. Device fully released.'
          : 'Payment received. Device access restored.',
      source: 'PAYMENT'
    });
  }

  res.status(201).json({
    payment: getPaymentSummary(payment),
    contract: getContractDetail(contract),
    device: syncResult.device
  });
}));

export default router;
