import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, addNotification, db, persistDb } from '../../db/mock-db.js';
import { requireCustomerAccess, type AuthRequest } from '../../middleware/auth.js';
import { scopeToTenant } from '../../services/tenancy.js';
import { getCustomerDetail, getPaymentSummary } from '../contracts/ledger.js';
import { asyncHandler } from '../../services/async-handler.js';
import { createContractInvoicePdf, createPaymentReceiptPdf } from '../../services/pdf-documents.js';

const router = Router();

router.use(requireCustomerAccess);

router.get('/summary', (req, res) => {
  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const user = scopeToTenant(db.users, tenantId).find((item) => item.id === authUser.id) ?? null;
  const customer = getCustomerDetail(customerId, new Date(), tenantId);

  if (!customer) {
    return res.status(404).json({ message: 'Customer profile not found' });
  }

  const activeContracts = customer.contracts.filter(
    (contract) => contract.status !== 'COMPLETED' && contract.status !== 'CANCELLED'
  );

  const latestContract = activeContracts[0] ?? customer.contracts[0] ?? null;
  const latestDevice = customer.devices[0] ?? null;

  return res.json({
    user: user
      ? {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          customerId: user.customerId
        }
      : null,
    customer,
    activeContract: latestContract,
    activeDevice: latestDevice,
    nextPaymentDate: latestContract?.nextDueDate ?? null,
    nextPaymentAmount: latestContract?.monthlyInstallment ?? 0,
    remainingBalance: customer.remainingBalance,
    restricted: latestContract?.policyState === 'RESTRICTED'
  });
});

router.get('/payments', (req, res) => {
  const customerId = (req as AuthRequest).user?.customerId;
  const tenantId = (req as AuthRequest).user?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const rows = scopeToTenant(db.payments, tenantId)
    .filter((item) => {
      const contract = scopeToTenant(db.contracts, tenantId).find((contractRow) => contractRow.id === item.contractId);
      return contract?.customerId === customerId;
    })
    .map((item) => getPaymentSummary(item));

  res.json(rows);
});

router.get('/payments/:id/receipt.pdf', (req, res) => {
  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const payment = scopeToTenant(db.payments, tenantId).find((item) => item.id === req.params.id);
  const contract = payment
    ? scopeToTenant(db.contracts, tenantId).find((contractRow) => contractRow.id === payment.contractId)
    : null;
  if (!payment || contract?.customerId !== customerId) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  const pdf = createPaymentReceiptPdf(payment);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${payment.id}.pdf"`);
  res.send(pdf);
});

router.get('/contracts/:id/invoice.pdf', (req, res) => {
  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;

  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const contract = scopeToTenant(db.contracts, tenantId).find((item) => item.id === req.params.id);
  if (!contract || contract.customerId !== customerId) {
    return res.status(404).json({ message: 'Contract not found' });
  }

  const pdf = createContractInvoicePdf(contract);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${contract.id}.pdf"`);
  res.send(pdf);
});

router.post('/payment-notice', asyncHandler(async (req, res) => {
  const schema = z.object({
    contractId: z.string(),
    amount: z.number().positive(),
    paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH', 'CARD', 'OTHER']).default('CASH'),
    referenceNumber: z.string().max(120).optional(),
    note: z.string().max(500).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;
  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === customerId);
  const contract = scopeToTenant(db.contracts, tenantId).find(
    (item) => item.id === parsed.data.contractId && item.customerId === customerId
  );
  if (!customer || !contract) {
    return res.status(404).json({ message: 'Contract not found' });
  }

  const tenant = db.tenants.find((item) => item.id === tenantId) ?? null;
  const recipient = tenant?.contactEmail ?? tenant?.contactPhone ?? tenant?.name ?? tenantId;
  const message = [
    `${customer.fullName} submitted a payment notice for PKR ${parsed.data.amount}.`,
    `Method: ${parsed.data.paymentMethod}.`,
    `Reference: ${parsed.data.referenceNumber?.trim() || 'n/a'}.`
  ].join(' ');

  addNotification({
    tenantId,
    channel: 'SYSTEM',
    status: 'QUEUED',
    recipient,
    customerId,
    contractId: contract.id,
    message,
    template: 'portal.payment_notice',
    providerResponse: parsed.data.note?.trim()
  });

  addAuditLog({
    tenantId,
    actorUserId: authUser?.id ?? customerId,
    actorName: authUser?.email ?? customer.fullName,
    action: 'PORTAL_PAYMENT_NOTICE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    reason: 'Customer submitted payment details from the portal',
    details: message
  });

  await persistDb();
  res.status(201).json({ ok: true, message: 'Payment notice submitted for staff review.' });
}));

router.post('/unlock-request', asyncHandler(async (req, res) => {
  const schema = z.object({
    contractId: z.string(),
    message: z.string().max(500).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const authUser = (req as AuthRequest).user;
  const customerId = authUser?.customerId;
  const tenantId = authUser?.tenantId;
  if (!customerId || !tenantId) {
    return res.status(400).json({ message: 'Customer account is not linked correctly' });
  }

  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === customerId);
  const contract = scopeToTenant(db.contracts, tenantId).find(
    (item) => item.id === parsed.data.contractId && item.customerId === customerId
  );
  const device = contract
    ? scopeToTenant(db.devices, tenantId).find((item) => item.id === contract.deviceId)
    : null;
  if (!customer || !contract || !device) {
    return res.status(404).json({ message: 'Device not found for this contract' });
  }

  const tenant = db.tenants.find((item) => item.id === tenantId) ?? null;
  const recipient = tenant?.contactEmail ?? tenant?.contactPhone ?? tenant?.name ?? tenantId;
  const message = [
    `${customer.fullName} requested an unlock review for ${device.modelName}.`,
    parsed.data.message?.trim() ? `Customer note: ${parsed.data.message.trim()}` : ''
  ].filter(Boolean).join(' ');

  addNotification({
    tenantId,
    channel: 'SYSTEM',
    status: 'QUEUED',
    recipient,
    customerId,
    deviceId: device.id,
    contractId: contract.id,
    message,
    template: 'portal.unlock_request'
  });

  addAuditLog({
    tenantId,
    actorUserId: authUser?.id ?? customerId,
    actorName: authUser?.email ?? customer.fullName,
    action: 'UNLOCK_REVIEW_REQUESTED',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: 'Customer requested a staff review before unlock',
    details: message
  });

  await persistDb();
  res.status(201).json({ ok: true, message: 'Unlock review request sent to staff.' });
}));

export default router;
