import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, buildInstallmentSchedule, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { hashPassword } from '../../services/passwords.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';
import { createAgentSecret, createTemporaryPortalPassword } from '../../services/secrets.js';
import { getCustomerDetail, getCustomerSummary } from '../contracts/ledger.js';
import { requestCustomerDeletion } from '../../services/record-deletion.js';
import { normalizePhone } from '../../services/phone.js';
import { normalizeCnic, isValidCnic } from '../../services/cnic.js';

const router = Router();

function ensureUniqueCustomerIdentity(tenantId: string, phone: string, cnic: string) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedCnic = normalizeCnic(cnic);

  if (scopeToTenant(db.customers, tenantId).some((item) => normalizePhone(item.phone) === normalizedPhone)) {
    return 'A customer with this phone number already exists.';
  }

  if (scopeToTenant(db.customers, tenantId).some((item) => normalizeCnic(item.cnic) === normalizedCnic)) {
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
      cnic: z.string().refine((v) => isValidCnic(normalizeCnic(v)), {
        message: 'CNIC must be 13 digits (format: XXXXX-XXXXXXX-X)'
      }),
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

  // Guard: device serial/IMEI must not already be on an active contract
  const existingDeviceBySerial = scopeToTenant(db.devices, tenantId).find(
    (d) => d.serial === parsed.data.device.serial.trim()
  );
  if (existingDeviceBySerial) {
    const activeContract = scopeToTenant(db.contracts, tenantId).find(
      (ct) => ct.deviceId === existingDeviceBySerial.id && ct.status !== 'COMPLETED' && ct.status !== 'CANCELLED'
    );
    if (activeContract) {
      return res.status(409).json({
        message: `Device with serial ${parsed.data.device.serial} is already assigned to an active contract (${activeContract.id}).`
      });
    }
  }
  if (parsed.data.device.imei && parsed.data.device.imei !== 'PENDING') {
    const existingDeviceByImei = scopeToTenant(db.devices, tenantId).find(
      (d) => d.imei === parsed.data.device.imei.trim()
    );
    if (existingDeviceByImei) {
      const activeContract = scopeToTenant(db.contracts, tenantId).find(
        (ct) => ct.deviceId === existingDeviceByImei.id && ct.status !== 'COMPLETED' && ct.status !== 'CANCELLED'
      );
      if (activeContract) {
        return res.status(409).json({
          message: `Device with IMEI ${parsed.data.device.imei} is already assigned to an active contract (${activeContract.id}).`
        });
      }
    }
  }

  const { portalPin, ...customerInput } = parsed.data.customer;
  const customer = {
    id: nextNumericId('c', db.customers),
    tenantId,
    ...customerInput,
    phone: normalizePhone(customerInput.phone),
    cnic: normalizeCnic(customerInput.cnic)
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

/**
 * POST /api/customers/import
 * Bulk import customers from CSV body.
 *
 * Expected CSV columns (header row required):
 *   fullName, phone, cnic, address, modelName, serial, imei,
 *   totalPhonePrice, advancePayment, monthlyInstallment, totalMonths, startDate
 *
 * Returns per-row success/error report.
 */
router.post('/import', asyncHandler(async (req, res) => {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('text/csv') && !contentType.includes('text/plain')) {
    return res.status(415).json({
      message: 'Content-Type must be text/csv. Send the CSV as raw request body.'
    });
  }

  const rawBody: string = typeof req.body === 'string' ? req.body : '';

  if (!rawBody.trim()) {
    return res.status(400).json({ message: 'CSV body is empty.' });
  }

  const lines = rawBody.trim().split(/\r?\n/);
  const headers = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];

  const REQUIRED_COLS = [
    'fullname', 'phone', 'cnic', 'address',
    'modelname', 'serial', 'imei',
    'totalphoeprice', 'advancepayment', 'monthlyinstallment', 'totalmonths', 'startdate'
  ];
  // Allow flexible header names (totalphoeprice / totalpriceprice / totalphoneprice)
  const col = (name: string) => {
    const aliases: Record<string, string[]> = {
      fullname:            ['fullname', 'full_name', 'name', 'customername'],
      phone:               ['phone', 'mobilenumber', 'mobile', 'phonenumber'],
      cnic:                ['cnic', 'nationalid', 'nic'],
      address:             ['address', 'addr'],
      modelname:           ['modelname', 'model', 'devicemodel', 'device_model'],
      serial:              ['serial', 'serialnumber', 'serialno'],
      imei:                ['imei', 'deviceimei'],
      totalphoeprice:      ['totalphoeprice', 'totalprice', 'totalphoneprice', 'price'],
      advancepayment:      ['advancepayment', 'advance', 'downpayment', 'down_payment'],
      monthlyinstallment:  ['monthlyinstallment', 'installment', 'monthly'],
      totalmonths:         ['totalmonths', 'months', 'duration'],
      startdate:           ['startdate', 'start_date', 'contractstart']
    };
    const opts = aliases[name] ?? [name];
    const idx = headers.findIndex((h) => opts.includes(h));
    return idx;
  };

  const actor = (req as AuthRequest).user;
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const tenantSettings = db.tenants.find((item) => item.id === tenantId)?.settings;

  const results: Array<{
    row: number;
    status: 'success' | 'error';
    customerId?: string;
    contractId?: string;
    message?: string;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const get = (name: string) => cells[col(name)] ?? '';

    const rowNum = i + 1;
    const fullName = get('fullname');
    const phone = get('phone');
    const cnic = get('cnic');
    const address = get('address');
    const modelName = get('modelname');
    const serial = get('serial');
    const imei = get('imei') || 'PENDING';
    const totalPhonePrice = Number(get('totalphoeprice'));
    const advancePayment = Number(get('advancepayment')) || 0;
    const monthlyInstallment = Number(get('monthlyinstallment'));
    const totalMonths = Number(get('totalmonths'));
    const startDate = get('startdate');

    // Basic validation
    if (!fullName || !phone || !cnic || !modelName || !serial || !totalPhonePrice || !monthlyInstallment || !totalMonths || !startDate) {
      results.push({ row: rowNum, status: 'error', message: 'Missing required fields.' });
      continue;
    }
    if (!isValidCnic(normalizeCnic(cnic))) {
      results.push({ row: rowNum, status: 'error', message: `Invalid CNIC: ${cnic}` });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      results.push({ row: rowNum, status: 'error', message: `Invalid startDate format (expected YYYY-MM-DD): ${startDate}` });
      continue;
    }
    const identityError = ensureUniqueCustomerIdentity(tenantId, phone, cnic);
    if (identityError) {
      results.push({ row: rowNum, status: 'error', message: identityError });
      continue;
    }

    try {
      const normPhone = normalizePhone(phone);
      const normCnic  = normalizeCnic(cnic);
      const financedAmount = totalPhonePrice - advancePayment;

      const customer = {
        id: nextNumericId('c', db.customers),
        tenantId,
        fullName,
        phone: normPhone,
        cnic: normCnic,
        address: address || undefined
      };
      const device = {
        id: nextNumericId('d', db.devices),
        tenantId,
        modelName,
        serial,
        imei,
        agentSecret: createAgentSecret(),
        enrollmentStatus: 'PENDING' as const,
        enrollmentMode: tenantSettings?.defaultEnrollmentMode ?? 'QR' as const,
        state: 'ACTIVE' as const,
        assignedCustomerId: customer.id
      };
      const contract = {
        id: nextNumericId('ct', db.contracts),
        tenantId,
        customerId: customer.id,
        deviceId: device.id,
        guarantorIds: [] as string[],
        totalPhonePrice,
        advancePayment,
        financedAmount,
        monthlyInstallment,
        totalMonths,
        dueDayOfMonth: tenantSettings?.defaultDueDayOfMonth ?? 10,
        graceDays: tenantSettings?.defaultGraceDays ?? 3,
        agreementAccepted: true,
        agreementAcceptedAt: new Date().toISOString(),
        deviceImei: imei,
        deviceSerial: serial,
        startDate,
        status: 'ACTIVE' as const
      };

      db.customers.push(customer);
      createPortalUser(tenantId, customer.id, customer.fullName, customer.phone);
      db.devices.push(device);
      db.contracts.push(contract);
      db.installments.push(...buildInstallmentSchedule(contract));

      addAuditLog({
        tenantId,
        actorUserId: actor?.id ?? 'system',
        actorName: actor?.email ?? 'System',
        action: 'CUSTOMER_CREATED',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        reason: 'Bulk CSV import',
        details: `${customer.fullName} imported with device ${modelName}.`
      });

      results.push({ row: rowNum, status: 'success', customerId: customer.id, contractId: contract.id });
    } catch (err) {
      results.push({ row: rowNum, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  await persistDb();

  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed    = results.filter((r) => r.status === 'error').length;

  res.status(207).json({
    imported: succeeded,
    failed,
    total: results.length,
    rows: results
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
    cnic: z.string().refine((v) => isValidCnic(normalizeCnic(v)), {
      message: 'CNIC must be 13 digits (format: XXXXX-XXXXXXX-X)'
    }),
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
  const record = {
    id: nextNumericId('c', db.customers),
    tenantId,
    ...customerInput,
    phone: normalizePhone(customerInput.phone),
    cnic: normalizeCnic(customerInput.cnic)
  };
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

router.delete('/:id', asyncHandler(async (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await requestCustomerDeletion({
    customerId: customer.id,
    reason: 'Admin deleted the customer from the dashboard.',
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.status(result.deleted ? 200 : 202).json(result);
}));

export default router;
