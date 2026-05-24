import { Router } from 'express';
import { z } from 'zod';
import { addAuditLog, db, persistDb } from '../../db/mock-db.js';
import {
  recordSystemNotification,
  sendDeviceRegistrationNotifications
} from '../../services/notifications.js';
import { scopeToTenant } from '../../services/tenancy.js';
import { getDeviceSummary } from '../contracts/ledger.js';
import {
  acknowledgeDeviceCommand,
  getPendingCommandsForDevice
} from '../../services/device-control.js';
import { asyncHandler } from '../../services/async-handler.js';
import { finalizeReleaseControlAcknowledgement } from '../../services/record-deletion.js';
import { applyDeviceTelemetry } from '../../services/device-recovery.js';

const router = Router();

function findDeviceBySecret(agentSecret: string) {
  return db.devices.find((item) => item.agentSecret === agentSecret) ?? null;
}

const telemetrySchema = z.object({
  uniqueId: z.string().min(3).optional(),
  imeiDetected: z.string().min(2).nullable().optional(),
  serialDetected: z.string().min(2).nullable().optional(),
  osVersion: z.string().min(1).optional(),
  appVersion: z.string().min(1).optional(),
  deviceOwnerPackage: z.string().nullable().optional(),
  batteryLevel: z.number().min(0).max(100).nullable().optional(),
  batteryCharging: z.boolean().nullable().optional(),
  networkStatus: z.string().max(80).nullable().optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().optional(),
    provider: z.string().max(40).optional(),
    capturedAt: z.string().datetime().optional()
  }).nullable().optional(),
  telemetryReason: z.string().max(120).optional()
});

function buildSyncResponse(agentSecret: string) {
  const device = findDeviceBySecret(agentSecret);
  if (!device) {
    return null;
  }

  const contract = scopeToTenant(db.contracts, device.tenantId).find((item) => item.deviceId === device.id) ?? null;
  const summary = getDeviceSummary(device);
  const customerName = summary.customerName ?? '';

  return {
    customerName,
    device: {
      ...summary,
      lastSyncAt: device.lastSyncAt
    },
    contract,
    pendingCommands: getPendingCommandsForDevice(device.id)
  };
}

async function recordRegistrationActivity(deviceId: string, isFirstEnrollment: boolean) {
  const device = db.devices.find((item) => item.id === deviceId) ?? null;
  if (!device) {
    return;
  }

  const tenant = db.tenants.find((item) => item.id === device.tenantId) ?? null;
  const contract = scopeToTenant(db.contracts, device.tenantId).find((item) => item.deviceId === device.id) ?? null;
  const customer = contract
    ? scopeToTenant(db.customers, device.tenantId).find((item) => item.id === contract.customerId) ?? null
    : null;
  const eventLabel = isFirstEnrollment ? 'registered' : 're-registered';
  const message = [
    `${device.modelName} (${device.serial}) ${eventLabel}.`,
    customer ? `Customer: ${customer.fullName}.` : null,
    tenant ? `Workspace: ${tenant.name}.` : null
  ]
    .filter(Boolean)
    .join(' ');

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: 'device-agent',
    actorName: 'Android Agent',
    action: 'DEVICE_REGISTERED',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: isFirstEnrollment ? 'Managed device completed enrollment' : 'Managed device registration was refreshed',
    details: message
  });

  recordSystemNotification({
    tenantId: device.tenantId,
    recipient: tenant?.contactEmail ?? tenant?.contactPhone ?? tenant?.name ?? 'workspace-admin',
    customerId: customer?.id,
    deviceId: device.id,
    contractId: contract?.id,
    message,
    template: isFirstEnrollment ? 'device.registered' : 'device.reregistered',
    providerResponse: `Device registration event captured for ${tenant?.name ?? device.tenantId}.`
  });

  await sendDeviceRegistrationNotifications({
    tenantId: device.tenantId,
    customerId: customer?.id,
    deviceId: device.id,
    contractId: contract?.id,
    message,
    template: isFirstEnrollment ? 'device.registered' : 'device.reregistered',
    subject: `${tenant?.name ?? 'FinanceGuard'} device ${eventLabel}`
  });
}

router.post('/register', asyncHandler(async (req, res) => {
  const schema = z.object({
    uniqueId: z.string().min(3),
    agentSecret: z.string().min(4)
      .transform((value) => value.trim()),
    pushToken: z.string().nullable().optional(),
    modelName: z.string().min(2),
    serial: z.string().min(2),
    imei: z.string().min(2),
    osVersion: z.string().min(1),
    appVersion: z.string().min(1),
    enrollmentMode: z.enum(['ADB', 'QR', 'ZERO_TOUCH', 'MANUAL']).default('MANUAL'),
    deviceOwnerPackage: z.string().nullable().optional(),
    imeiDetected: z.string().min(2).nullable().optional(),
    serialDetected: z.string().min(2).nullable().optional(),
    batteryLevel: z.number().min(0).max(100).nullable().optional(),
    batteryCharging: z.boolean().nullable().optional(),
    networkStatus: z.string().max(80).nullable().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const device = findDeviceBySecret(parsed.data.agentSecret);
  if (!device) {
    return res.status(404).json({ message: 'Managed device not found or secret is invalid' });
  }
  const isFirstEnrollment = device.enrollmentStatus !== 'ENROLLED';

  device.uniqueId = parsed.data.uniqueId;
  device.pushToken = parsed.data.pushToken ?? undefined;
  device.modelName = parsed.data.modelName;
  device.serial = parsed.data.serial;
  device.imei = parsed.data.imei;
  device.osVersion = parsed.data.osVersion;
  device.appVersion = parsed.data.appVersion;
  device.enrollmentMode = parsed.data.enrollmentMode;
  device.deviceOwnerPackage = parsed.data.deviceOwnerPackage ?? undefined;
  device.enrollmentStatus = 'ENROLLED';
  device.lastSyncAt = new Date().toISOString();
  applyDeviceTelemetry(device, {
    uniqueId: parsed.data.uniqueId,
    imeiDetected: parsed.data.imeiDetected ?? parsed.data.imei,
    serialDetected: parsed.data.serialDetected ?? parsed.data.serial,
    osVersion: parsed.data.osVersion,
    appVersion: parsed.data.appVersion,
    deviceOwnerPackage: parsed.data.deviceOwnerPackage,
    batteryLevel: parsed.data.batteryLevel,
    batteryCharging: parsed.data.batteryCharging,
    networkStatus: parsed.data.networkStatus,
    reason: isFirstEnrollment ? 'Device registration' : 'Device re-registration'
  });
  await persistDb();
  await recordRegistrationActivity(device.id, isFirstEnrollment);

  const response = buildSyncResponse(parsed.data.agentSecret);
  return res.status(201).json(response);
}));

router.post('/sync', asyncHandler(async (req, res) => {
  const schema = z.object({
    uniqueId: z.string().min(3).optional(),
    agentSecret: z.string().min(4).transform((value) => value.trim()),
    pushToken: z.string().nullable().optional(),
    osVersion: z.string().min(1).optional(),
    appVersion: z.string().min(1).optional(),
    currentState: z.enum(['ACTIVE', 'REMINDER', 'GRACE', 'RESTRICTED', 'RELEASED']).optional(),
    restrictionReason: z.string().nullable().optional(),
    telemetry: telemetrySchema.optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const device = findDeviceBySecret(parsed.data.agentSecret);

  if (!device) {
    return res.status(404).json({ message: 'Managed device not found or secret is invalid' });
  }

  device.uniqueId = parsed.data.uniqueId ?? device.uniqueId;
  device.pushToken = parsed.data.pushToken ?? device.pushToken;
  device.osVersion = parsed.data.osVersion ?? device.osVersion;
  device.appVersion = parsed.data.appVersion ?? device.appVersion;
  device.lastSyncAt = new Date().toISOString();
  applyDeviceTelemetry(device, {
    ...parsed.data.telemetry,
    uniqueId: parsed.data.telemetry?.uniqueId ?? parsed.data.uniqueId,
    osVersion: parsed.data.telemetry?.osVersion ?? parsed.data.osVersion,
    appVersion: parsed.data.telemetry?.appVersion ?? parsed.data.appVersion,
    reason: parsed.data.telemetry?.telemetryReason ?? 'Device sync'
  });
  if (parsed.data.telemetry?.deviceOwnerPackage) {
    device.enrollmentStatus = 'ENROLLED';
  }
  if (parsed.data.currentState === 'RESTRICTED') {
    device.restrictionReason =
      parsed.data.restrictionReason ?? device.restrictionReason;
  }

  await persistDb();

  const response = buildSyncResponse(parsed.data.agentSecret);
  return res.json(response);
}));

router.post('/telemetry', asyncHandler(async (req, res) => {
  const schema = z.object({
    agentSecret: z.string().min(4).transform((value) => value.trim()),
    telemetry: telemetrySchema
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const device = findDeviceBySecret(parsed.data.agentSecret);
  if (!device) {
    return res.status(404).json({ message: 'Managed device not found or secret is invalid' });
  }

  device.lastSyncAt = new Date().toISOString();
  applyDeviceTelemetry(device, {
    ...parsed.data.telemetry,
    reason: parsed.data.telemetry.telemetryReason ?? 'Device telemetry'
  });
  await persistDb();

  return res.json({
    ok: true,
    device: {
      ...getDeviceSummary(device),
      lastSyncAt: device.lastSyncAt
    }
  });
}));

router.post('/commands/:commandId/ack', asyncHandler(async (req, res) => {
  const schema = z.object({
    agentSecret: z.string().min(4),
    success: z.boolean(),
    note: z.string().optional().nullable()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.flatten() });
  }

  const device = findDeviceBySecret(parsed.data.agentSecret);
  if (!device) {
    return res.status(404).json({ message: 'Managed device not found or secret is invalid' });
  }

  try {
    const command = await acknowledgeDeviceCommand({
      commandId: String(req.params.commandId),
      deviceId: device.id,
      success: parsed.data.success,
      note: parsed.data.note ?? undefined
    });
    await finalizeReleaseControlAcknowledgement(command);

    return res.json(command);
  } catch (error) {
    return res.status(404).json({ message: error instanceof Error ? error.message : 'Command not found' });
  }
}));

export default router;
