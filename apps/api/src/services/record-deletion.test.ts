import assert from 'node:assert/strict';
import test from 'node:test';
import { db, type DeviceCommandRecord, type DeviceRecord } from '../db/mock-db.js';
import { requestDeviceControlRelease } from './record-deletion.js';

function device(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: 'd-release-test',
    tenantId: 't-test',
    imei: 'imei-test',
    serial: 'serial-test',
    modelName: 'Test Phone',
    agentSecret: 'FG-TEST',
    enrollmentStatus: 'SUSPENDED',
    state: 'RELEASED',
    uniqueId: 'test-unique-id',
    lastSyncAt: '2026-06-06T10:00:00.000Z',
    ...overrides
  };
}

function command(overrides: Partial<DeviceCommandRecord>): DeviceCommandRecord {
  return {
    id: 'cmd1',
    tenantId: 't-test',
    deviceId: 'd-release-test',
    type: 'RELEASE_CONTROL',
    status: 'FAILED',
    reason: 'Release control',
    source: 'ADMIN',
    createdAt: '2026-06-06T09:00:00.000Z',
    ...overrides
  };
}

test('failed release-control command does not block a fresh release retry', async () => {
  const previousDevices = structuredClone(db.devices);
  const previousCommands = structuredClone(db.deviceCommands);
  const previousAuditLogs = structuredClone(db.auditLogs);
  const previousNotifications = structuredClone(db.notifications);

  try {
    db.devices = [device()];
    db.deviceCommands = [command({})];
    db.auditLogs = [];
    db.notifications = [];

    const result = await requestDeviceControlRelease({
      deviceId: 'd-release-test',
      reason: 'Retry release from admin'
    });

    assert.equal(result.command?.type, 'RELEASE_CONTROL');
    assert.notEqual(result.command?.id, 'cmd1');
    assert.equal(result.command?.status, 'PENDING');
    assert.equal(db.deviceCommands.length, 2);
  } finally {
    db.devices = previousDevices;
    db.deviceCommands = previousCommands;
    db.auditLogs = previousAuditLogs;
    db.notifications = previousNotifications;
  }
});
