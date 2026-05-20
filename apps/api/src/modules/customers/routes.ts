import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, buildInstallmentSchedule, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { hashPassword } from '../../services/passwords.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';
import { createAgentSecret, createTemporaryPortalPassword } from '../../services/secrets.js';
import { getCustomerDetail, getCustomerSummary } from '../contracts/ledger.js';

const router = Router();

function ensureUniqueCustomerIdentity(tenantId: string, phone: string, cnic: string) {
  const normalizedPhone = phone.trim();
  const normalizedCnic = cnic.trim();

  if (scopeToTenant(db.customers, tenantId).some((item) => item.phone === normalizedPhone)) {
    return 'A customer with this phone number already exists.';
  }

  if (scopeToTenant(db.customers, tenantId).some((item) => item.cnic === normalizedCnic)) {
    return 'A customer with this CNIC already exists.';
  }

  return null;
}

function createPortalUser(
  tenantId: string,
  customerId: string,
  fullName: string,
  phone: string,
  portalPin?: string
) {
  const nextPassword = portalPin ?? createTemporaryPortalPassword();
  const existing = db.users.find((item) => item.tenantId === tenantId && (item.customerId === customerId || item.phone === phone));
  if (existing) {
    existing.name = fullName;
    existing.phone = phone;
    existing.role = 'customer';
    existing.customerId = customerId;
    if (portalPin) {
      existing.password = hashPassword(portalPin);
    }
    if (!existing.email) {
      existing.email = `customer-${customerId}@financeguard.local`;
    }
    return { user: existing, plainPassword: portalPin };
  }

  const user = {
    id: nextNumericId('u', db.users),
    tenantId,
    name: fullName,
    email: `customer-${customerId}@financeguard.local`,
    phone,
    password: hashPassword(nextPassword),
    role: 'customer' as const,
    mustChangePassword: true,
    customerId
  };
  db.users.push(user);
  return { user, plainPassword: nextPassword };
}

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  res.json(
    scopeToTenant(db.customers, tenantId)
      .map((customer) => getCustomerSummary(customer.id, new Date(), tenantId))
      .filter((customer) => customer !== null)
  );
});

router.post('/onboard', asyncHandler(async (req, res) => {
  const schema = z.object({
    customer: z.object({
      fullName: z.string().min(2),
      phone: z.string().min(8),
      cnic: z.string().min(5),
      address: z.string().optional(),
      notes: z.string().optional(),
      portalPin: z.string().min(4).max(12).optional()
    }),
    device: z.object({
      modelName: z.string().min(2),
      serial: z.string().min(3),
      imei: z.string().min(3).default('PENDING'),
      uniqueId: z.string().optional(),
      enrollmentMode: z.enum(['ADB', 'QR', 'ZERO_TOUCH', 'MANUAL']).optional()
    }),
    contract: z.object({
      totalPhonePrice: z.number().positive(),
      advancePayment: z.number().min(0),
      monthlyInstallment: z.number().positive(),
      totalMonths: z.number().int().positive(),
      dueDayOfMonth: z.number().int().min(1).max(31).optional(),
      graceDays: z.number().int().min(0).max(30).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      agreementAccepted: z.boolean().default(true)
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
      )
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid payload',
      errors: parsed.error.flatten(),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }

  const actor = (req as AuthRequest).user;
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const tenantSettings = db.tenants.find((item) => item.id === tenantId)?.settings;
  const identityError = ensureUniqueCustomerIdentity(
    tenantId,
    parsed.data.customer.phone,
    parsed.data.customer.cnic
  );
  if (identityError) {
    return res.status(409).json({ message: identityError });
  }

  const { portalPin, ...customerInput } = parsed.data.customer;
  const customer = {
    id: nextNumericId('c', db.customers),
    tenantId,
    ...customerInput
  };
  const device = {
    id: nextNumericId('d', db.devices),
    tenantId,
    modelName: parsed.data.device.modelName,
    serial: parsed.data.device.serial,
    imei: parsed.data.device.imei,
    uniqueId: parsed.data.device.uniqueId,
    agentSecret: createAgentSecret(),
    enrollmentStatus: 'PENDING' as const,
    enrollmentMode: parsed.data.device.enrollmentMode ?? tenantSettings?.defaultEnrollmentMode ?? 'QR',
    state: 'ACTIVE' as const,
    assignedCustomerId: customer.id
  };
  const financedAmount = parsed.data.contract.totalPhonePrice - parsed.data.contract.advancePayment;
  const contract = {
    id: nextNumericId('ct', db.contracts),
    tenantId,
    customerId: customer.id,
    deviceId: device.id,
    guarantorIds: [] as string[],
    totalPhonePrice: parsed.data.contract.totalPhonePrice,
    advancePayment: parsed.data.contract.advancePayment,
    financedAmount,
    monthlyInstallment: parsed.data.contract.monthlyInstallment,
    totalMonths: parsed.data.contract.totalMonths,
    dueDayOfMonth: parsed.data.contract.dueDayOfMonth ?? tenantSettings?.defaultDueDayOfMonth ?? 10,
    graceDays: parsed.data.contract.graceDays ?? tenantSettings?.defaultGraceDays ?? 3,
    agreementAccepted: parsed.data.contract.agreementAccepted,
    agreementAcceptedAt: new Date().toISOString(),
    deviceImei: device.imei,
    deviceSerial: device.serial,
    startDate: parsed.data.contract.startDate,
    status: 'ACTIVE' as const
  };

  db.customers.push(customer);
  const portalUser = createPortalUser(
    tenantId,
    customer.id,
    customer.fullName,
    customer.phone,
    portalPin
  );
  db.devices.push(device);
  db.contracts.push(contract);
  db.installments.push(...buildInstallmentSchedule(contract));
  await persistDb();

  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'CUSTOMER_CREATED',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    reason: 'Admin onboarded a financed customer',
    details: `${customer.fullName} was created together with ${device.modelName}.`
  });

  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'CONTRACT_CREATED',
    entityType: 'CONTRACT',
    entityId: contract.id,
    reason: 'Admin created a contract during customer onboarding',
    details: `${customer.fullName} financed ${device.modelName} with a balance of Rs. ${financedAmount}.`
  });

  return res.status(201).json({
    customer: getCustomerDetail(customer.id, new Date(), tenantId),
    device,
    portalCredentials: {
      identifier: portalUser.user.phone ?? portalUser.user.email,
      password: portalUser.plainPassword
    }
  });
}));

router.get('/:id', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const customer = getCustomerDetail(req.params.id, new Date(), tenantId);
  if (!customer) return res.status(404).json({ message: 'Customer not found' });

  res.json(customer);
});

router.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    phone: z.string().min(8),
    cnic: z.string().min(5),
    address: z.string().optional(),
    notes: z.string().optional(),
    portalPin: z.string().min(4).max(12).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const identityError = ensureUniqueCustomerIdentity(tenantId, parsed.data.phone, parsed.data.cnic);
  if (identityError) {
    return res.status(409).json({ message: identityError });
  }

  const { portalPin, ...customerInput } = parsed.data;
  const record = { id: nextNumericId('c', db.customers), tenantId, ...customerInput };
  db.customers.push(record);
  const portalUser = createPortalUser(
    tenantId,
    record.id,
    record.fullName,
    record.phone,
    portalPin
  );
  await persistDb();

  const actor = (req as AuthRequest).user;
  addAuditLog({
    tenantId,
    actorUserId: actor?.id ?? 'system',
    actorName: actor?.email ?? 'System',
    action: 'CUSTOMER_CREATED',
    entityType: 'CUSTOMER',
    entityId: record.id,
    reason: 'Admin created a new financed customer profile',
    details: `${record.fullName} was added to the customer ledger.`
  });

  res.status(201).json({
    customer: getCustomerDetail(record.id, new Date(), tenantId),
    portalCredentials: {
      identifier: portalUser.user.phone ?? portalUser.user.email,
      password: portalUser.plainPassword
    }
  });
}));

export default router;
