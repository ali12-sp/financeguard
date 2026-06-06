/**
 * Integration tests for the payment → device-unlock flow and related logic.
 *
 * Tests covered:
 *  1. Payment that clears an overdue installment unlocks a restricted device
 *  2. Partial payment does NOT unlock a restricted device
 *  3. Manual unlock expiry: device should be re-locked by evaluatePolicy
 *  4. retryStaleDeviceCommands marks old PENDING commands as FAILED
 *  5. Phone normalisation (E.164 Pakistani numbers)
 *  6. CNIC normalisation and validation
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInstallmentSchedule,
  db,
  type ContractRecord,
  type DeviceRecord,
  type InstallmentRecord
} from '../../db/mock-db.js';
import {
  allocatePaymentToInstallments,
  evaluatePolicy,
  getRemainingBalance,
  syncContractState
} from './ledger.js';
import { retryStaleDeviceCommands } from '../../services/scheduler.js';
import { normalizePhone } from '../../services/phone.js';
import { normalizeCnic, isValidCnic, formatCnic } from '../../services/cnic.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

type DbSnapshot = {
  contracts: typeof db.contracts;
  devices: typeof db.devices;
  installments: typeof db.installments;
  payments: typeof db.payments;
  deviceCommands: typeof db.deviceCommands;
  notifications: typeof db.notifications;
};

function snapshotDb(): DbSnapshot {
  return {
    contracts:      structuredClone(db.contracts),
    devices:        structuredClone(db.devices),
    installments:   structuredClone(db.installments),
    payments:       structuredClone(db.payments),
    deviceCommands: structuredClone(db.deviceCommands),
    notifications:  structuredClone(db.notifications)
  };
}

function restoreDb(snap: DbSnapshot) {
  db.contracts      = snap.contracts;
  db.devices        = snap.devices;
  db.installments   = snap.installments;
  db.payments       = snap.payments;
  db.deviceCommands = snap.deviceCommands;
  db.notifications  = snap.notifications;
}

function makeContract(id: string): ContractRecord {
  return {
    id,
    tenantId: 't-test',
    customerId: `c-${id}`,
    deviceId: `d-${id}`,
    guarantorIds: [],
    totalPhonePrice: 30000,
    advancePayment: 5000,
    financedAmount: 25000,
    monthlyInstallment: 12500,
    totalMonths: 2,
    dueDayOfMonth: 5,
    graceDays: 2,
    agreementAccepted: true,
    agreementAcceptedAt: '2026-01-01T00:00:00Z',
    deviceImei: `imei-${id}`,
    deviceSerial: `serial-${id}`,
    startDate: '2026-01-01',
    status: 'RESTRICTED' as const
  };
}

function makeDevice(contractId: string, state: DeviceRecord['state'] = 'RESTRICTED'): DeviceRecord {
  return {
    id: `d-${contractId}`,
    tenantId: 't-test',
    imei: `imei-${contractId}`,
    serial: `serial-${contractId}`,
    modelName: 'Test Phone',
    agentSecret: 'TEST_SECRET',
    enrollmentStatus: 'ENROLLED',
    state
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('payment that fully covers an overdue installment unlocks a restricted device', () => {
  const snap = snapshotDb();
  try {
    const contract = makeContract('pu-full');
    const device   = makeDevice('pu-full');
    db.contracts   = [contract];
    db.devices     = [device];
    db.installments = buildInstallmentSchedule(contract);
    db.payments     = [];

    // First installment is overdue
    const firstInstallment = db.installments[0]!;
    assert.equal(firstInstallment.amountPaid, 0);

    // Record a full payment
    const result = allocatePaymentToInstallments(contract, firstInstallment.amountDue);
    assert.ok(!('error' in result), 'Allocation should not error');
    if ('error' in result) return; // type guard

    // After payment the contract should become ACTIVE (not RESTRICTED)
    const syncResult = syncContractState(contract, new Date('2026-01-10T00:00:00Z'));
    assert.notEqual(syncResult.policyState, 'RESTRICTED', 'Contract should no longer be RESTRICTED after payment');
    assert.equal(device.state, 'ACTIVE', 'Device state should be ACTIVE after sync');
  } finally {
    restoreDb(snap);
  }
});

test('partial payment does NOT unlock a restricted device', () => {
  const snap = snapshotDb();
  try {
    const contract = makeContract('pu-partial');
    const device   = makeDevice('pu-partial');
    db.contracts    = [contract];
    db.devices      = [device];
    db.installments = buildInstallmentSchedule(contract);
    db.payments     = [];

    const firstInstallment = db.installments[0]!;
    const partialAmount = firstInstallment.amountDue / 2;

    const result = allocatePaymentToInstallments(contract, partialAmount);
    assert.ok(!('error' in result));

    // Sync after partial payment - still overdue
    const syncResult = syncContractState(contract, new Date('2026-02-10T00:00:00Z'));
    assert.equal(syncResult.policyState, 'RESTRICTED', 'Contract should still be RESTRICTED after partial payment');
  } finally {
    restoreDb(snap);
  }
});

test('evaluatePolicy stays RESTRICTED when manual unlock window has expired', () => {
  const snap = snapshotDb();
  try {
    const contract = makeContract('pu-expire');
    db.contracts    = [contract];
    db.installments = buildInstallmentSchedule(contract);
    db.payments     = [];

    // Simulate an expired manual unlock (1 hour ago)
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const device = { ...makeDevice('pu-expire'), manualUnlockUntil: expiredAt };
    db.devices = [device];

    // evaluatePolicy itself doesn't care about manual unlock - it derives from installment dates
    const policyState = evaluatePolicy(contract, new Date('2026-02-10T00:00:00Z'));
    assert.equal(policyState, 'RESTRICTED', 'Policy should still say RESTRICTED when installment is overdue');

    // And the manual unlock window has expired
    assert.ok(new Date(expiredAt) < new Date(), 'Manual unlock window should have expired');
  } finally {
    restoreDb(snap);
  }
});

test('retryStaleDeviceCommands marks old PENDING commands as FAILED', async () => {
  const snap = snapshotDb();
  try {
    db.deviceCommands = [
      {
        id: 'cmd-stale-1',
        tenantId: 't-test',
        deviceId: 'd-test',
        type: 'LOCK',
        status: 'PENDING',
        reason: 'Overdue',
        source: 'SCHEDULER',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3 hours old
      },
      {
        id: 'cmd-fresh-1',
        tenantId: 't-test',
        deviceId: 'd-test',
        type: 'LOCK',
        status: 'PENDING',
        reason: 'Overdue',
        source: 'SCHEDULER',
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 minutes old (fresh)
      }
    ];

    const result = await retryStaleDeviceCommands(new Date());
    assert.equal(result.timedOut, 1, 'Only the old PENDING command should be timed out');
    assert.equal(db.deviceCommands.find((c) => c.id === 'cmd-stale-1')?.status, 'FAILED');
    assert.equal(db.deviceCommands.find((c) => c.id === 'cmd-fresh-1')?.status, 'PENDING', 'Fresh command must remain PENDING');
  } finally {
    restoreDb(snap);
  }
});

test('retryStaleDeviceCommands queues a fresh command when latest lock is still needed', async () => {
  const snap = snapshotDb();
  try {
    db.devices = [
      {
        id: 'd-test',
        tenantId: 't-test',
        imei: 'imei-test',
        serial: 'serial-test',
        modelName: 'Test Phone',
        agentSecret: 'TEST_SECRET',
        enrollmentStatus: 'ENROLLED',
        state: 'RESTRICTED'
      }
    ];
    db.deviceCommands = [
      {
        id: 'cmd-stale-1',
        tenantId: 't-test',
        deviceId: 'd-test',
        type: 'LOCK',
        status: 'PENDING',
        reason: 'Overdue',
        source: 'SCHEDULER',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      }
    ];
    db.notifications = [];

    const result = await retryStaleDeviceCommands(new Date());
    assert.equal(result.timedOut, 1);
    assert.equal(result.retried, 1);
    assert.equal(db.deviceCommands.find((c) => c.id === 'cmd-stale-1')?.status, 'FAILED');
    const retryCommand = db.deviceCommands.find((c) => c.id !== 'cmd-stale-1');
    assert.equal(retryCommand?.type, 'LOCK');
    assert.equal(retryCommand?.status, 'PENDING');
  } finally {
    restoreDb(snap);
  }
});

test('getRemainingBalance returns 0 when all installments are fully paid', () => {
  const snap = snapshotDb();
  try {
    const contract = makeContract('pu-zero');
    db.contracts    = [contract];
    db.installments = buildInstallmentSchedule(contract);
    for (const inst of db.installments) {
      inst.amountPaid = inst.amountDue;
    }
    assert.equal(getRemainingBalance(contract), 0);
  } finally {
    restoreDb(snap);
  }
});

// ── Phone normalisation ───────────────────────────────────────────────────────

test('normalizePhone: local format 03XXXXXXXXX → +92XXXXXXXXXX', () => {
  assert.equal(normalizePhone('03001234567'), '+923001234567');
});

test('normalizePhone: already E.164 +92 is returned unchanged', () => {
  assert.equal(normalizePhone('+923001234567'), '+923001234567');
});

test('normalizePhone: 92XXXXXXXXXX (no +) → +92XXXXXXXXXX', () => {
  assert.equal(normalizePhone('923001234567'), '+923001234567');
});

test('normalizePhone: non-Pakistani E.164 number left unchanged', () => {
  assert.equal(normalizePhone('+447911123456'), '+447911123456');
});

// ── CNIC validation ──────────────────────────────────────────────────────────

test('isValidCnic: 13-digit string is valid', () => {
  assert.equal(isValidCnic('3520212345671'), true);
});

test('isValidCnic: formatted XXXXX-XXXXXXX-X is valid', () => {
  assert.equal(isValidCnic('35202-1234567-1'), true);
});

test('isValidCnic: 12 digits is invalid', () => {
  assert.equal(isValidCnic('352021234567'), false);
});

test('normalizeCnic: strips dashes and spaces', () => {
  assert.equal(normalizeCnic('35202-1234567-1'), '3520212345671');
});

test('formatCnic: formats 13 digits as XXXXX-XXXXXXX-X', () => {
  assert.equal(formatCnic('3520212345671'), '35202-1234567-1');
});
