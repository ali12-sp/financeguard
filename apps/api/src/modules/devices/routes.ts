import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db, nextNumericId, persistDb } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';
import { getDeviceSummary } from '../contracts/ledger.js';
import {
  applyDeviceStateChange,
  applyManualUnlockOverride,
  getPendingCommandsForDevice,
  issueDeviceCommand
} from '../../services/device-control.js';
import { asyncHandler } from '../../services/async-handler.js';
import { createAgentSecret } from '../../services/secrets.js';
import { buildAndroidProvisioningPayload } from '../../services/provisioning.js';
import {
  requestDeviceLocation,
  setDeviceLostMode
} from '../../services/device-recovery.js';
import {
  requestDeviceControlRelease,
  requestDeviceDeletion
} from '../../services/record-deletion.js';

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
    agentSecret: createAgentSecret(),
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

router.post('/:id/manual-unlock', asyncHandler(async (req, res) => {
  const schema = z.object({
    reason: z.string().min(3),
    hours: z.number().int().min(1).max(168).default(24)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await applyManualUnlockOverride({
    deviceId: device.id,
    reason: parsed.data.reason,
    hours: parsed.data.hours,
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.json({
    ...getDeviceSummary(result.device),
    manualUnlockUntil: result.manualUnlockUntil,
    latestCommand: result.command
  });
}));

router.post('/:id/commands', async (req, res) => {
  const schema = z.object({
    type: z.enum([
      'LOCK',
      'UNLOCK',
      'REMINDER',
      'SYNC',
      'RELEASE_CONTROL',
      'REQUEST_LOCATION',
      'ENABLE_LOST_MODE',
      'DISABLE_LOST_MODE'
    ]),
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

router.post('/:id/request-location', asyncHandler(async (req, res) => {
  const schema = z.object({
    reason: z.string().min(3).max(160).default('Admin requested recovery location from the dashboard.')
  });

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await requestDeviceLocation({
    deviceId: device.id,
    reason: parsed.data.reason,
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.json({
    ...getDeviceSummary(result.device),
    latestCommand: result.command
  });
}));

router.post('/:id/lost-mode', asyncHandler(async (req, res) => {
  const schema = z.object({
    enabled: z.boolean(),
    message: z.string().min(3).max(220).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await setDeviceLostMode({
    deviceId: device.id,
    enabled: parsed.data.enabled,
    message: parsed.data.message,
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.json({
    ...getDeviceSummary(result.device),
    latestCommand: result.command
  });
}));

router.post('/:id/release-control', asyncHandler(async (req, res) => {
  const schema = z.object({
    reason: z.string().min(3).default('Admin released managed control from the dashboard.')
  });

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await requestDeviceControlRelease({
    deviceId: device.id,
    reason: parsed.data.reason,
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.json({
    ...getDeviceSummary(device),
    latestCommand: result.command
  });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const device = scopeToTenant(db.devices, tenantId).find((item) => item.id === req.params.id);
  if (!device) {
    return res.status(404).json({ message: 'Device not found' });
  }

  const actor = (req as AuthRequest).user;
  const result = await requestDeviceDeletion({
    deviceId: device.id,
    reason: 'Admin deleted the device from the dashboard.',
    actor: actor ? { id: actor.id, email: actor.email } : undefined
  });

  res.status(result.deleted ? 200 : 202).json(result);
}));

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
  const adminComponent = 'com.financeguard.agent/.FinanceGuardDeviceAdminReceiver';
  const organizationId = tenant?.slug ?? tenantId;
  const organizationName = tenant?.name ?? 'FinanceGuard Workspace';
  const frpAccountsCsv = (tenant?.settings.frpGoogleAccounts ?? []).join(',');
  const provisioning = buildAndroidProvisioningPayload({
    adminComponent,
    apiBaseUrl: env.publicApiUrl,
    agentSecret: device.agentSecret,
    deviceId: device.id,
    organizationId,
    organizationName,
    frpAccountsCsv,
    settings: tenant?.settings
  });

  res.json({
    deviceId: device.id,
    agentSecret: device.agentSecret,
    adminComponent,
    apiBaseUrl: env.publicApiUrl,
    organizationId,
    frpGoogleAccounts: tenant?.settings.frpGoogleAccounts ?? [],
    adminExtras: provisioning.adminExtras,
    agentApkDownloadUrl: provisioning.agentApkDownloadUrl,
    agentApkChecksum: provisioning.agentApkChecksum,
    qrPayload: provisioning.qrPayload,
    qrPayloadPretty: provisioning.qrPayloadPretty,
    qrMissingRequirements: provisioning.missingRequirements,
    qrExpiresAt: null,
    adbCommand:
      'adb shell dpm set-device-owner com.financeguard.agent/.FinanceGuardDeviceAdminReceiver',
    qrNotes: [
      'Use a stable HTTPS APK download URL. Temporary tunnel or signed storage URLs can make the QR stop working.',
      'The APK checksum is normalized to Android provisioning format when a 64-character SHA-256 hex value is saved.',
      'This QR has no built-in expiry; it remains valid while the device record and APK URL/checksum stay unchanged.'
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
