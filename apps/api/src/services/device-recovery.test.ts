import assert from 'node:assert/strict';
import test from 'node:test';
import { type DeviceRecord } from '../db/mock-db.js';
import { applyDeviceTelemetry } from './device-recovery.js';

function device(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: 'd-test',
    tenantId: 't-test',
    imei: '123456789012345',
    serial: 'serial-test',
    modelName: 'Recovery Test Phone',
    agentSecret: 'FG-test',
    enrollmentStatus: 'ENROLLED',
    state: 'ACTIVE',
    ...overrides
  };
}

test('applyDeviceTelemetry records last seen, matching IMEI, and location', () => {
  const record = device();

  applyDeviceTelemetry(record, {
    imeiDetected: '123456789012345',
    serialDetected: 'serial-test',
    batteryLevel: 74,
    batteryCharging: true,
    networkStatus: 'wifi',
    reason: 'Recovery sync',
    location: {
      latitude: 31.5204,
      longitude: 74.3587,
      accuracyMeters: 14,
      provider: 'gps',
      capturedAt: '2026-05-23T10:00:00.000Z'
    }
  });

  assert.equal(record.identifierStatus, 'MATCHED');
  assert.equal(record.lastSeenReason, 'Recovery sync');
  assert.equal(record.batteryLevel, 74);
  assert.equal(record.batteryCharging, true);
  assert.equal(record.networkStatus, 'wifi');
  assert.equal(record.lastLocationLat, 31.5204);
  assert.equal(record.lastLocationLng, 74.3587);
  assert.equal(record.lastLocationAccuracyMeters, 14);
  assert.equal(record.locationRequestPending, false);
});

test('applyDeviceTelemetry flags detected IMEI mismatch', () => {
  const record = device();

  applyDeviceTelemetry(record, {
    imeiDetected: '999999999999999'
  });

  assert.equal(record.identifierStatus, 'MISMATCHED');
});
