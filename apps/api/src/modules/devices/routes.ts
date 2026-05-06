import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { getDeviceSummary } from '../contracts/ledger.js';
import {
  applyDeviceStateChange,
  getPendingCommandsForDevice,
  issueDeviceCommand
} from '../../services/device-control.js';
import { asyncHandler } from '../../services/async-handler.js';

const router = Router();

router.get('/', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  res.json(scopeToTenant(db.devices, tenantId).map((device) => getDeviceSummary(device)));
});

router.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({
    modelName: z.string().min(2),
    serial: z.string().min(3),
    imei: z.string().min(3).default('PENDING'),
    uniqueId: z.string().optional(),
    enrollmentMode: z.enum(['ADB', 'QR', 'ZERO_TOUCH', 'MANUAL']).default('QR'),
    assignedCustomerId: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = {
    id: nextNumericId('d', db.devices),
    tenantId,
    modelName: parsed.data.modelName,
    serial: parsed.data.serial,
    imei: parsed.data.imei,
    uniqueId: parsed.data.uniqueId,
    agentSecret: `FG-${Math.floor(Math.random() * 9000) + 1000}`,
    enrollmentStatus: 'PENDING' as const,
    enrollmentMode: parsed.data.enrollmentMode,
    assignedCustomerId: parsed.data.assignedCustomerId,
    state: 'ACTIVE' as const
  };

  db.devices.push(device);
  await persistDb();
  res.status(201).json(device);
}));

router.post('/:id/state', async (req, res) => {
  const schema = z.object({
    state: z.enum(['ACTIVE', 'REMINDER', 'GRACE', 'RESTRICTED', 'RELEASED']),
    reason: z.string().min(3),
    lockMessage: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const actor = (req as AuthRequest).user;
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }
  try {
    const result = await applyDeviceStateChange({
      deviceId: device.id,
      nextState: parsed.data.state,
      reason: parsed.data.reason,
      source: 'ADMIN',
      actor: actor ? { id: actor.id, email: actor.email } : undefined,
      lockMessage: parsed.data.lockMessage
    });
    res.json({
      ...getDeviceSummary(result.device),
      latestCommand: result.command
    });
  } catch (error) {
    res.status(404).json({ message: error instanceof Error ? error.message : 'Device not found' });
  }
});

router.post('/:id/commands', async (req, res) => {
  const schema = z.object({
    type: z.enum(['LOCK', 'UNLOCK', 'REMINDER', 'SYNC']),
    reason: z.string().min(3),
    lockMessage: z.string().optional(),
    payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  try {
    const tenantId = getTenantIdFromAuth(req as AuthRequest);
    const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const command = await issueDeviceCommand({
      deviceId: device.id,
      type: parsed.data.type,
      reason: parsed.data.reason,
      source: 'ADMIN',
      lockMessage: parsed.data.lockMessage,
      payload: parsed.data.payload
    });

    return res.status(201).json(command);
  } catch (error) {
    return res.status(404).json({ message: error instanceof Error ? error.message : 'Device not found' });
  }
});

router.get('/:imei/sync', asyncHandler(async (req, res) => {
  const device = db.devices.find((item) => item.imei === req.params.imei);
  if (!device) return res.status(404).json({ message: 'Device not found' });

  const contract = scopeToTenant(db.contracts, device.tenantId).find((item) => item.deviceId === device.id) ?? null;
  device.lastSyncAt = new Date().toISOString();
  await persistDb();
  const summary = getDeviceSummary(device);

  res.json({
    imei: device.imei,
    serial: device.serial,
    enrollmentStatus: device.enrollmentStatus,
    state: summary.state,
    policyState: summary.policyState,
    restrictionReason: device.restrictionReason,
    contractId: contract?.id ?? null,
    customerName: summary.customerName,
    remainingBalance: summary.remainingBalance,
    allowlistedApps: [
      'com.android.dialer',
      'com.whatsapp',
      'com.financeguard.agent'
    ],
    updatedAt: device.lastSyncAt
  });
}));

router.get('/:id/commands', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) return res.status(404).json({ message: 'Device not found' });

  res.json(getPendingCommandsForDevice(device.id));
});

router.get('/:id/provisioning', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) return res.status(404).json({ message: 'Device not found' });
  const tenant = db.tenants.find((item) => item.id === tenantId) ?? null;

  res.json({
    deviceId: device.id,
    agentSecret: device.agentSecret,
    adminComponent: 'com.financeguard.agent/.FinanceGuardDeviceAdminReceiver',
    apiBaseUrl: env.publicApiUrl,
    organizationId: tenant?.slug ?? tenantId,
    frpGoogleAccounts: tenant?.settings.frpGoogleAccounts ?? [],
    adminExtras: {
      apiBaseUrl: env.publicApiUrl,
      agentSecret: device.agentSecret,
      deviceId: device.id,
      organizationId: tenant?.slug ?? tenantId,
      organizationName: tenant?.name ?? 'FinanceGuard Workspace',
      frpAccountsCsv: (tenant?.settings.frpGoogleAccounts ?? []).join(',')
    },
    adbCommand:
      'adb shell dpm set-device-owner com.financeguard.agent/.FinanceGuardDeviceAdminReceiver',
    qrNotes: [
      'Host the APK on HTTPS and calculate its SHA-256 checksum before generating a production QR code.',
      'Include the admin extras bundle from this response in your QR payload so the app can auto-register.'
    ]
  });
});

router.get('/:id', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) return res.status(404).json({ message: 'Device not found' });

  const contract = scopeToTenant(db.contracts, tenantId).find((item) => item.deviceId === device.id) ?? null;
  const auditLogs = scopeToTenant(db.auditLogs, tenantId).filter((item) =>
    [device.id, contract?.id].filter(Boolean).includes(item.entityId)
  );

  res.json({
    ...getDeviceSummary(device),
    contract,
    auditLogs,
    pendingCommands: getPendingCommandsForDevice(device.id)
  });
});

export default router;
