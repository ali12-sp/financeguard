import { Router } from 'express';
import { z } from 'zod';
import { buildDefaultWorkspaceSettings, db, nextNumericId, persistDb } from '../../db/mock-db.js';
import { getContractSummary, getDeviceSummary, getPaymentSummary } from '../contracts/ledger.js';
import { hashPassword } from '../../services/passwords.js';
import { generateTenantSlug } from '../../services/tenancy.js';
import { asyncHandler } from '../../services/async-handler.js';
import {
  recordSystemNotification,
  sendDeviceRegistrationNotifications
} from '../../services/notifications.js';

const router = Router();

const workspaceSettingsSchema = z.object({
  defaultDueDayOfMonth: z.number().int().min(1).max(31).optional(),
  defaultGraceDays: z.number().int().min(0).max(30).optional(),
  defaultEnrollmentMode: z.enum(['ADB', 'QR', 'ZERO_TOUCH', 'MANUAL']).optional(),
  defaultLockMessage: z.string().min(5).max(220).optional(),
  notifyOnDeviceRegistration: z.boolean().optional(),
  supportEmail: z.string().email().optional().or(z.literal('')),
  supportPhone: z.string().min(8).max(30).optional().or(z.literal('')),
  supportWhatsapp: z.string().min(8).max(30).optional().or(z.literal('')),
  agentApkDownloadUrl: z.string().url().optional().or(z.literal('')),
  agentApkChecksum: z.string().min(16).max(255).optional().or(z.literal('')),
  frpGoogleAccounts: z.array(z.string().email()).optional()
});

function isRegistrationTemplate(template: string) {
  return template === 'device.registered' || template === 'device.reregistered';
}

function scoreField(value: string | undefined | null, query: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  if (normalized === query) {
    return 120;
  }
  if (normalized.startsWith(query)) {
    return 80;
  }
  if (normalized.includes(query)) {
    return 45;
  }
  return 0;
}

function scoreFields(values: Array<string | undefined | null>, query: string) {
  return values.reduce((max, value) => Math.max(max, scoreField(value, query)), 0);
}

function buildWorkspaceSettings(input: {
  settings?: z.infer<typeof workspaceSettingsSchema>;
  contactEmail?: string;
  contactPhone?: string;
  existing?: ReturnType<typeof buildDefaultWorkspaceSettings>;
}) {
  return buildDefaultWorkspaceSettings({
    defaultDueDayOfMonth:
      input.settings?.defaultDueDayOfMonth ?? input.existing?.defaultDueDayOfMonth,
    defaultGraceDays: input.settings?.defaultGraceDays ?? input.existing?.defaultGraceDays,
    defaultEnrollmentMode:
      input.settings?.defaultEnrollmentMode ?? input.existing?.defaultEnrollmentMode,
    defaultLockMessage: input.settings?.defaultLockMessage ?? input.existing?.defaultLockMessage,
    notifyOnDeviceRegistration:
      input.settings?.notifyOnDeviceRegistration ??
      input.existing?.notifyOnDeviceRegistration,
    supportEmail:
      input.settings?.supportEmail ??
      input.existing?.supportEmail ??
      input.contactEmail,
    supportPhone:
      input.settings?.supportPhone ??
      input.existing?.supportPhone ??
      input.contactPhone,
    supportWhatsapp:
      input.settings?.supportWhatsapp ?? input.existing?.supportWhatsapp,
    agentApkDownloadUrl:
      input.settings?.agentApkDownloadUrl ?? input.existing?.agentApkDownloadUrl,
    agentApkChecksum:
      input.settings?.agentApkChecksum ?? input.existing?.agentApkChecksum,
    frpGoogleAccounts:
      input.settings?.frpGoogleAccounts ?? input.existing?.frpGoogleAccounts
  });
}

function getWorkspaceSummary(tenantId: string) {
  const tenant = db.tenants.find((item) => item.id === tenantId) ?? null;
  const admins = db.users.filter((item) => item.tenantId === tenantId && item.role === 'admin');
  const staff = db.users.filter((item) => item.tenantId === tenantId && item.role === 'staff');
  const customers = db.customers.filter((item) => item.tenantId === tenantId);
  const devices = db.devices.filter((item) => item.tenantId === tenantId);
  const contracts = db.contracts
    .filter((item) => item.tenantId === tenantId)
    .map((item) => getContractSummary(item));
  const payments = db.payments.filter((item) => item.tenantId === tenantId);
  const pendingCommands = db.deviceCommands.filter(
    (item) => item.tenantId === tenantId && item.status !== 'ACKNOWLEDGED'
  );
  const notifications = db.notifications.filter((item) => item.tenantId === tenantId);
  const latestRegistrationAt = notifications
    .filter((item) => item.channel === 'SYSTEM' && isRegistrationTemplate(item.template))
    .map((item) => item.createdAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const latestAlertAt = notifications
    .map((item) => item.createdAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const latestDeviceSyncAt = devices
    .map((item) => item.lastSyncAt)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null;

  return {
    id: tenantId,
    name: tenant?.name ?? 'Unknown workspace',
    slug: tenant?.slug ?? tenantId,
    status: tenant?.status ?? 'SUSPENDED',
    contactEmail: tenant?.contactEmail,
    contactPhone: tenant?.contactPhone,
    settings: tenant?.settings ?? buildDefaultWorkspaceSettings(),
    createdAt: tenant?.createdAt ?? new Date(0).toISOString(),
    adminCount: admins.length,
    staffCount: staff.length,
    customerCount: customers.length,
    deviceCount: devices.length,
    enrolledDeviceCount: devices.filter((item) => item.enrollmentStatus === 'ENROLLED').length,
    contractCount: contracts.length,
    activeContractCount: contracts.filter(
      (item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED'
    ).length,
    lateAccountCount: contracts.filter(
      (item) => item.policyState === 'GRACE' || item.policyState === 'RESTRICTED'
    ).length,
    paymentCount: payments.length,
    notificationCount: notifications.length,
    failedNotificationCount: notifications.filter((item) => item.status === 'FAILED').length,
    restrictedDeviceCount: devices.filter((item) => item.state === 'RESTRICTED').length,
    pendingCommandCount: pendingCommands.length,
    outstandingBalance: contracts.reduce((sum, item) => sum + item.remainingBalance, 0),
    latestRegistrationAt,
    latestAlertAt,
    latestDeviceSyncAt,
    primaryAdmin: admins[0]
      ? {
          id: admins[0].id,
          name: admins[0].name,
          email: admins[0].email,
          phone: admins[0].phone
        }
      : null
  };
}

router.get('/summary', (_req, res) => {
  const workspaceHealth = db.tenants
    .map((tenant) => getWorkspaceSummary(tenant.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const contractSummaries = db.contracts.map((item) => getContractSummary(item));
  const deviceSummaries = db.devices.map((item) => getDeviceSummary(item));

  const recentDeviceRegistrations = db.notifications
    .filter((item) => item.channel === 'SYSTEM' && isRegistrationTemplate(item.template))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 10)
    .map((item) => {
      const tenant = db.tenants.find((tenantItem) => tenantItem.id === item.tenantId) ?? null;
      const device = item.deviceId
        ? db.devices.find((deviceItem) => deviceItem.id === item.deviceId) ?? null
        : null;
      const customer = item.customerId
        ? db.customers.find((customerItem) => customerItem.id === item.customerId) ?? null
        : null;

      return {
        id: item.id,
        workspaceId: item.tenantId,
        workspaceName: tenant?.name ?? item.tenantId,
        workspaceSlug: tenant?.slug ?? item.tenantId,
        deviceId: item.deviceId ?? null,
        customerName: customer?.fullName ?? null,
        modelName: device?.modelName ?? null,
        serial: device?.serial ?? null,
        imei: device?.imei ?? null,
        enrollmentMode: device?.enrollmentMode ?? null,
        deviceOwnerPackage: device?.deviceOwnerPackage ?? null,
        createdAt: item.createdAt,
        message: item.message,
        template: item.template
      };
    });

  const recentPayments = db.payments
    .map((item) => getPaymentSummary(item))
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
    .slice(0, 10)
    .map((item) => {
      const tenant = db.tenants.find((tenantItem) => tenantItem.id === item.tenantId) ?? null;
      return {
        ...item,
        workspaceName: tenant?.name ?? item.tenantId,
        workspaceSlug: tenant?.slug ?? item.tenantId
      };
    });

  const recentCommands = db.deviceCommands
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 10)
    .map((item) => {
      const tenant = db.tenants.find((tenantItem) => tenantItem.id === item.tenantId) ?? null;
      const device = db.devices.find((deviceItem) => deviceItem.id === item.deviceId) ?? null;
      return {
        ...item,
        workspaceName: tenant?.name ?? item.tenantId,
        workspaceSlug: tenant?.slug ?? item.tenantId,
        deviceModel: device?.modelName ?? null,
        serial: device?.serial ?? null
      };
    });

  const recentAlerts = db.notifications
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20)
    .map((item) => {
      const tenant = db.tenants.find((tenantItem) => tenantItem.id === item.tenantId) ?? null;
      return {
        ...item,
        workspaceName: tenant?.name ?? item.tenantId,
        workspaceSlug: tenant?.slug ?? item.tenantId
      };
    });

  res.json({
    workspaces: db.tenants.length,
    activeWorkspaces: db.tenants.filter((item) => item.status === 'ACTIVE').length,
    suspendedWorkspaces: db.tenants.filter((item) => item.status === 'SUSPENDED').length,
    customers: db.customers.length,
    devices: db.devices.length,
    enrolledDevices: deviceSummaries.filter((item) => item.enrollmentStatus === 'ENROLLED').length,
    contracts: db.contracts.length,
    activeContracts: contractSummaries.filter(
      (item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED'
    ).length,
    lateAccounts: contractSummaries.filter(
      (item) => item.policyState === 'GRACE' || item.policyState === 'RESTRICTED'
    ).length,
    payments: db.payments.length,
    restrictedDevices: deviceSummaries.filter((item) => item.state === 'RESTRICTED').length,
    outstandingBalance: contractSummaries.reduce((sum, item) => sum + item.remainingBalance, 0),
    pendingCommands: db.deviceCommands.filter((item) => item.status !== 'ACKNOWLEDGED').length,
    registrationAlerts: db.notifications.filter(
      (item) => item.channel === 'SYSTEM' && isRegistrationTemplate(item.template)
    ).length,
    notificationDeliveries: db.notifications.length,
    failedNotificationDeliveries: db.notifications.filter((item) => item.status === 'FAILED').length,
    workspaceHealth,
    recentDeviceRegistrations,
    recentPayments,
    recentCommands,
    recentAlerts
  });
});

router.get('/workspaces', (_req, res) => {
  const rows = db.tenants
    .map((tenant) => getWorkspaceSummary(tenant.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  res.json(rows);
});

router.get('/search', (req, res) => {
  const query = String(req.query.q ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 12) || 12, 1), 50);

  if (query.length < 2) {
    return res.json({
      query,
      workspaces: [],
      customers: [],
      devices: [],
      contracts: []
    });
  }

  const workspaces = db.tenants
    .map((tenant) => {
      const score = scoreFields(
        [tenant.name, tenant.slug, tenant.contactEmail, tenant.contactPhone],
        query
      );
      return score > 0
        ? {
            ...getWorkspaceSummary(tenant.id),
            score
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);

  const customers = db.customers
    .map((customer) => {
      const tenant = db.tenants.find((item) => item.id === customer.tenantId) ?? null;
      const summary = getContractSummary;
      const customerSummaryContracts = db.contracts
        .filter((item) => item.tenantId === customer.tenantId && item.customerId === customer.id)
        .map((item) => summary(item));
      const score = scoreFields(
        [
          customer.fullName,
          customer.phone,
          customer.cnic,
          customer.address,
          tenant?.name,
          tenant?.slug
        ],
        query
      );
      return score > 0
        ? {
            id: customer.id,
            workspaceId: customer.tenantId,
            workspaceName: tenant?.name ?? customer.tenantId,
            workspaceSlug: tenant?.slug ?? customer.tenantId,
            fullName: customer.fullName,
            phone: customer.phone,
            cnic: customer.cnic,
            activeContractCount: customerSummaryContracts.filter(
              (item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED'
            ).length,
            remainingBalance: customerSummaryContracts.reduce(
              (sum, item) => sum + item.remainingBalance,
              0
            ),
            score
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score || left.fullName.localeCompare(right.fullName))
    .slice(0, limit);

  const devices = db.devices
    .map((device) => {
      const tenant = db.tenants.find((item) => item.id === device.tenantId) ?? null;
      const contract = db.contracts.find(
        (item) => item.tenantId === device.tenantId && item.deviceId === device.id
      ) ?? null;
      const customer = contract
        ? db.customers.find(
            (item) => item.tenantId === device.tenantId && item.id === contract.customerId
          ) ?? null
        : null;
      const score = scoreFields(
        [
          device.id,
          device.imei,
          device.serial,
          device.modelName,
          device.uniqueId,
          customer?.fullName,
          customer?.phone,
          tenant?.name,
          tenant?.slug
        ],
        query
      );
      return score > 0
        ? {
            ...getDeviceSummary(device),
            workspaceId: device.tenantId,
            workspaceName: tenant?.name ?? device.tenantId,
            workspaceSlug: tenant?.slug ?? device.tenantId,
            score
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score || left.modelName.localeCompare(right.modelName))
    .slice(0, limit);

  const contracts = db.contracts
    .map((contract) => {
      const tenant = db.tenants.find((item) => item.id === contract.tenantId) ?? null;
      const customer = db.customers.find(
        (item) => item.tenantId === contract.tenantId && item.id === contract.customerId
      ) ?? null;
      const device = db.devices.find(
        (item) => item.tenantId === contract.tenantId && item.id === contract.deviceId
      ) ?? null;
      const summary = getContractSummary(contract);
      const score = scoreFields(
        [
          contract.id,
          customer?.fullName,
          customer?.phone,
          device?.imei,
          device?.serial,
          device?.modelName,
          tenant?.name,
          tenant?.slug
        ],
        query
      );
      return score > 0
        ? {
            id: contract.id,
            workspaceId: contract.tenantId,
            workspaceName: tenant?.name ?? contract.tenantId,
            workspaceSlug: tenant?.slug ?? contract.tenantId,
            customerName: customer?.fullName ?? 'Unknown customer',
            customerPhone: customer?.phone ?? '-',
            deviceModel: device?.modelName ?? '-',
            imei: device?.imei ?? '-',
            status: summary.status,
            remainingBalance: summary.remainingBalance,
            nextDueDate: summary.nextDueDate,
            score
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit);

  return res.json({
    query,
    workspaces,
    customers,
    devices,
    contracts
  });
});

router.post('/workspaces', asyncHandler(async (req, res) => {
  const schema = z.object({
    organizationName: z.string().min(2).max(120),
    organizationSlug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().min(8).max(30).optional(),
    adminName: z.string().min(2).max(120),
    adminEmail: z.string().email(),
    adminPhone: z.string().min(8).max(30).optional(),
    adminPassword: z.string().min(8).max(128),
    settings: workspaceSettingsSchema.optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const existingSlugs = db.tenants.map((item) => item.slug);
  const tenantSlug = parsed.data.organizationSlug
    ? generateTenantSlug(parsed.data.organizationSlug, existingSlugs)
    : generateTenantSlug(parsed.data.organizationName, existingSlugs);
  const tenantId = nextNumericId('t', db.tenants);
  const normalizedAdminEmail = parsed.data.adminEmail.trim().toLowerCase();
  const normalizedContactPhone = parsed.data.contactPhone?.trim() ?? parsed.data.adminPhone?.trim();
  const normalizedContactEmail =
    parsed.data.contactEmail?.trim().toLowerCase() ?? normalizedAdminEmail;

  db.tenants.push({
    id: tenantId,
    name: parsed.data.organizationName.trim(),
    slug: tenantSlug,
    status: 'ACTIVE',
    contactEmail: normalizedContactEmail,
    contactPhone: normalizedContactPhone,
    settings: buildWorkspaceSettings({
      settings: parsed.data.settings,
      contactEmail: normalizedContactEmail,
      contactPhone: normalizedContactPhone
    }),
    createdAt: new Date().toISOString()
  });

  db.users.push({
    id: nextNumericId('u', db.users),
    tenantId,
    name: parsed.data.adminName.trim(),
    email: normalizedAdminEmail,
    phone: parsed.data.adminPhone?.trim(),
    password: hashPassword(parsed.data.adminPassword),
    role: 'admin',
    isPlatformOwner: false
  });

  await persistDb();

  return res.status(201).json(getWorkspaceSummary(tenantId));
}));

router.patch('/workspaces/:id', asyncHandler(async (req, res) => {
  const schema = z.object({
    organizationName: z.string().min(2).max(120).optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    contactPhone: z.string().min(8).max(30).optional().or(z.literal('')),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    settings: workspaceSettingsSchema.optional()
  }).refine(
    (value) =>
      value.organizationName ||
      value.contactEmail !== undefined ||
      value.contactPhone !== undefined ||
      value.status ||
      value.settings,
    { message: 'At least one field must be updated' }
  );

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenant = db.tenants.find((item) => item.id === req.params.id);
  if (!tenant) {
    return res.status(404).json({ message: 'Workspace not found' });
  }

  if (parsed.data.organizationName) {
    tenant.name = parsed.data.organizationName.trim();
  }

  if (parsed.data.contactEmail !== undefined) {
    tenant.contactEmail = parsed.data.contactEmail.trim()
      ? parsed.data.contactEmail.trim().toLowerCase()
      : undefined;
  }

  if (parsed.data.contactPhone !== undefined) {
    tenant.contactPhone = parsed.data.contactPhone.trim()
      ? parsed.data.contactPhone.trim()
      : undefined;
  }

  if (parsed.data.settings) {
    tenant.settings = buildWorkspaceSettings({
      settings: parsed.data.settings,
      existing: tenant.settings,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone
    });
  }

  if (parsed.data.status) {
    if (
      parsed.data.status === 'SUSPENDED' &&
      db.users.some((item) => item.tenantId === tenant.id && item.isPlatformOwner)
    ) {
      return res.status(400).json({
        message: 'You cannot suspend the workspace that owns platform access.'
      });
    }

    tenant.status = parsed.data.status;
  }

  await persistDb();

  res.json(getWorkspaceSummary(tenant.id));
}));

router.post('/workspaces/:id/test-registration-alert', asyncHandler(async (req, res) => {
  const tenant = db.tenants.find((item) => item.id === req.params.id) ?? null;
  if (!tenant) {
    return res.status(404).json({ message: 'Workspace not found' });
  }

  const message = [
    `Test alert from FinanceGuard for ${tenant.name}.`,
    'This confirms that device registration notifications are configured.'
  ].join(' ');

  recordSystemNotification({
    tenantId: tenant.id,
    recipient: tenant.contactEmail ?? tenant.contactPhone ?? tenant.name,
    message,
    template: 'device.registration.test',
    providerResponse: 'Manual test alert recorded by platform owner.'
  });

  const deliveries = await sendDeviceRegistrationNotifications({
    tenantId: tenant.id,
    message,
    template: 'device.registration.test',
    subject: `FinanceGuard test alert for ${tenant.name}`,
    force: true
  });

  await persistDb();

  res.json({
    ok: true,
    deliveries: deliveries.map((item) => ({
      id: item.id,
      channel: item.channel,
      status: item.status,
      recipient: item.recipient,
      providerResponse: item.providerResponse
    }))
  });
}));

export default router;
