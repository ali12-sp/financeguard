import assert from 'node:assert/strict';
import test from 'node:test';
import { db, type DeviceCommandRecord } from '../db/mock-db.js';
import { getPendingCommandsForDevice } from './device-control.js';

function command(overrides: Partial<DeviceCommandRecord>): DeviceCommandRecord {
  return {
    id: 'cmd1',
    tenantId: 't-test',
    deviceId: 'd-test',
    type: 'LOCK',
    status: 'PENDING',
    reason: 'Test command',
    source: 'ADMIN',
    createdAt: '2026-05-22T00:00:00.000Z',
    ...overrides
  };
}

function withTemporaryCommands(commands: DeviceCommandRecord[], fn: () => void) {
  const previousCommands = structuredClone(db.deviceCommands);

  try {
    db.deviceCommands = commands;
    fn();
  } finally {
    db.deviceCommands = previousCommands;
  }
}

test('pending device commands return oldest first and keep only the latest state command', () => {
  withTemporaryCommands([
    command({
      id: 'cmd3',
      type: 'UNLOCK',
      createdAt: '2026-05-22T10:02:00.000Z'
    }),
    command({
      id: 'cmd2',
      type: 'REMINDER',
      createdAt: '2026-05-22T10:01:00.000Z'
    }),
    command({
      id: 'cmd1',
      type: 'LOCK',
      createdAt: '2026-05-22T10:00:00.000Z'
    }),
    command({
      id: 'cmd4',
      deviceId: 'd-other',
      type: 'LOCK',
      createdAt: '2026-05-22T10:03:00.000Z'
    })
  ], () => {
    assert.deepEqual(
      getPendingCommandsForDevice('d-test').map((item) => item.id),
      ['cmd2', 'cmd3']
    );
  });
});

test('acknowledged latest unlock hides older pending locks from legacy polling', () => {
  withTemporaryCommands([
    command({
      id: 'cmd2',
      type: 'UNLOCK',
      status: 'ACKNOWLEDGED',
      createdAt: '2026-05-22T10:01:00.000Z',
      acknowledgedAt: '2026-05-22T10:01:05.000Z'
    }),
    command({
      id: 'cmd1',
      type: 'LOCK',
      createdAt: '2026-05-22T10:00:00.000Z'
    })
  ], () => {
    assert.deepEqual(getPendingCommandsForDevice('d-test'), []);
  });
});

test('failed commands are not returned to polling devices', () => {
  withTemporaryCommands([
    command({
      id: 'cmd1',
      type: 'LOCK',
      status: 'FAILED',
      createdAt: '2026-05-22T10:00:00.000Z'
    })
  ], () => {
    assert.deepEqual(getPendingCommandsForDevice('d-test'), []);
  });
});
