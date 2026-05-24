import {
  addAuditLog,
  db,
  persistDb,
  type DeviceIdentifierStatus,
  type DeviceRecord
} from '../db/mock-db.js';
import { type ActorInfo, issueDeviceCommand } from './device-control.js';

export interface DeviceLocationTelemetry {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  provider?: string;
  capturedAt?: string;
}

export interface DeviceTelemetryUpdate {
  uniqueId?: string;
  imeiDetected?: string | null;
  serialDetected?: string | null;
  osVersion?: string;
  appVersion?: string;
  deviceOwnerPackage?: string | null;
  batteryLevel?: number | null;
  batteryCharging?: boolean | null;
  networkStatus?: string | null;
  location?: DeviceLocationTelemetry | null;
  reason?: string;
}

function normalizeIdentifier(value?: string | null) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
}

function isPlaceholderIdentifier(value?: string | null) {
  const normalized = normalizeIdentifier(value);
  return !normalized || normalized === 'pending' || normalized === 'unknown' || normalized === 'unknownimei';
}

function identifierStatus(device: DeviceRecord, detected?: string | null): DeviceIdentifierStatus {
  const normalizedDetected = normalizeIdentifier(detected);
  if (!normalizedDetected) {
    return 'UNAVAILABLE';
  }

  if (isPlaceholderIdentifier(device.imei)) {
    return 'REPORTED';
  }

  return normalizeIdentifier(device.imei) === normalizedDetected ? 'MATCHED' : 'MISMATCHED';
}

function getActor(actor?: ActorInfo) {
  return {
    id: actor?.id ?? 'system',
    name: actor?.name ?? actor?.email ?? 'System'
  };
}

export function applyDeviceTelemetry(device: DeviceRecord, telemetry: DeviceTelemetryUpdate) {
  const now = new Date().toISOString();

  device.lastSeenAt = now;
  device.lastSeenReason = telemetry.reason ?? 'Device sync';
  device.uniqueId = telemetry.uniqueId ?? device.uniqueId;
  device.osVersion = telemetry.osVersion ?? device.osVersion;
  device.appVersion = telemetry.appVersion ?? device.appVersion;
  device.deviceOwnerPackage = telemetry.deviceOwnerPackage ?? device.deviceOwnerPackage;

  const imeiDetected = telemetry.imeiDetected?.trim();
  if (imeiDetected) {
    device.imeiDetected = imeiDetected;
    device.identifierStatus = identifierStatus(device, imeiDetected);
  } else if (!device.identifierStatus) {
    device.identifierStatus = identifierStatus(device, undefined);
  }

  const serialDetected = telemetry.serialDetected?.trim();
  if (serialDetected) {
    device.serialDetected = serialDetected;
  }

  if (typeof telemetry.batteryLevel === 'number') {
    device.batteryLevel = Math.max(0, Math.min(100, Math.round(telemetry.batteryLevel)));
  }
  if (typeof telemetry.batteryCharging === 'boolean') {
    device.batteryCharging = telemetry.batteryCharging;
  }
  if (telemetry.networkStatus) {
    device.networkStatus = telemetry.networkStatus.trim().slice(0, 80);
  }

  if (telemetry.location) {
    device.lastLocationLat = telemetry.location.latitude;
    device.lastLocationLng = telemetry.location.longitude;
    device.lastLocationAccuracyMeters = telemetry.location.accuracyMeters;
    device.lastLocationProvider = telemetry.location.provider;
    device.lastLocationAt = telemetry.location.capturedAt ?? now;
    device.locationRequestPending = false;
    device.locationRequestReason = undefined;
  }

  return device;
}

export async function requestDeviceLocation(options: {
  deviceId: string;
  reason: string;
  actor?: ActorInfo;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  const actor = getActor(options.actor);
  device.trackingEnabled = true;
  device.locationRequestPending = true;
  device.locationRequestReason = options.reason;

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'DEVICE_RECOVERY_UPDATED',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: options.reason,
    details: 'Admin requested an immediate managed-device location update.'
  });

  await persistDb();

  const command = await issueDeviceCommand({
    deviceId: device.id,
    type: 'REQUEST_LOCATION',
    reason: options.reason,
    source: 'ADMIN',
    payload: {
      forceLocation: true
    }
  });

  return { device, command };
}

export async function setDeviceLostMode(options: {
  deviceId: string;
  enabled: boolean;
  message?: string;
  actor?: ActorInfo;
}) {
  const device = db.devices.find((item) => item.id === options.deviceId);
  if (!device) {
    throw new Error('Device not found');
  }

  const actor = getActor(options.actor);
  const now = new Date().toISOString();
  const message = options.message?.trim() ||
    'This managed phone has been marked lost. Please contact the seller or office.';

  device.lostModeEnabled = options.enabled;
  device.lostModeUpdatedAt = now;
  device.trackingEnabled = options.enabled || device.trackingEnabled;
  device.locationRequestPending = options.enabled;
  device.locationRequestReason = options.enabled
    ? 'Lost mode enabled; waiting for recovery location.'
    : undefined;
  device.lostModeMessage = options.enabled ? message : undefined;

  addAuditLog({
    tenantId: device.tenantId,
    actorUserId: actor.id,
    actorName: actor.name,
    action: 'DEVICE_RECOVERY_UPDATED',
    entityType: 'DEVICE',
    entityId: device.id,
    reason: options.enabled ? 'Lost mode enabled' : 'Lost mode disabled',
    details: options.enabled
      ? `Lost mode enabled with message: ${message}`
      : 'Lost mode disabled from the dashboard.'
  });

  await persistDb();

  const command = await issueDeviceCommand({
    deviceId: device.id,
    type: options.enabled ? 'ENABLE_LOST_MODE' : 'DISABLE_LOST_MODE',
    reason: options.enabled ? 'Admin enabled lost-mode recovery.' : 'Admin disabled lost-mode recovery.',
    source: 'ADMIN',
    payload: {
      lostModeMessage: options.enabled ? message : '',
      forceLocation: options.enabled
    }
  });

  return { device, command };
}
