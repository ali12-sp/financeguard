import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInstallmentSchedule,
  db,
  type ContractRecord,
  type DeviceRecord
} from '../../db/mock-db.js';
import {
  evaluatePolicy,
  getDeviceSummary,
  getRemainingBalance,
  syncContractState
} from './ledger.js';

function withTemporaryContract(contract: ContractRecord, device: DeviceRecord, fn: () => void) {
  const previousContracts = structuredClone(db.contracts);
  const previousDevices = structuredClone(db.devices);
  const previousInstallments = structuredClone(db.installments);

  try {
    db.contracts = [contract];
    db.devices = [device];
    db.installments = buildInstallmentSchedule(contract);
    fn();
  } finally {
    db.contracts = previousContracts;
    db.devices = previousDevices;
    db.installments = previousInstallments;
  }
}

test('evaluatePolicy becomes restricted after grace period is exceeded', () => {
  const contract: ContractRecord = {
    id: 'ct-policy',
    tenantId: 't-test',
    customerId: 'c-policy',
    deviceId: 'd-policy',
    guarantorIds: [],
    totalPhonePrice: 50000,
    advancePayment: 10000,
    financedAmount: 40000,
    monthlyInstallment: 10000,
    totalMonths: 4,
    dueDayOfMonth: 5,
    graceDays: 2,
    agreementAccepted: true,
    agreementAcceptedAt: '2026-05-01T00:00:00Z',
    deviceImei: 'imei-policy',
    deviceSerial: 'serial-policy',
    startDate: '2026-05-01',
    status: 'ACTIVE'
  };

  const device: DeviceRecord = {
    id: 'd-policy',
    tenantId: 't-test',
    imei: 'imei-policy',
    serial: 'serial-policy',
    modelName: 'FinanceGuard Test Device',
    agentSecret: 'FG-0001',
    enrollmentStatus: 'ENROLLED',
    state: 'ACTIVE'
  };

  withTemporaryContract(contract, device, () => {
    assert.equal(getRemainingBalance(contract), 40000);
    assert.equal(evaluatePolicy(contract, new Date('2026-05-09T00:00:00Z')), 'RESTRICTED');
  });
});

test('evaluatePolicy becomes released when installments are fully paid', () => {
  const contract: ContractRecord = {
    id: 'ct-release',
    tenantId: 't-test',
    customerId: 'c-release',
    deviceId: 'd-release',
    guarantorIds: [],
    totalPhonePrice: 30000,
    advancePayment: 5000,
    financedAmount: 25000,
    monthlyInstallment: 12500,
    totalMonths: 2,
    dueDayOfMonth: 5,
    graceDays: 2,
    agreementAccepted: true,
    agreementAcceptedAt: '2026-05-01T00:00:00Z',
    deviceImei: 'imei-release',
    deviceSerial: 'serial-release',
    startDate: '2026-05-01',
    status: 'ACTIVE'
  };

  const device: DeviceRecord = {
    id: 'd-release',
    tenantId: 't-test',
    imei: 'imei-release',
    serial: 'serial-release',
    modelName: 'FinanceGuard Release Device',
    agentSecret: 'FG-0002',
    enrollmentStatus: 'ENROLLED',
    state: 'ACTIVE'
  };

  withTemporaryContract(contract, device, () => {
    for (const installment of db.installments) {
      installment.amountPaid = installment.amountDue;
    }

    assert.equal(getRemainingBalance(contract), 0);
    assert.equal(evaluatePolicy(contract, new Date('2026-06-10T00:00:00Z')), 'RELEASED');
  });
});

test('getDeviceSummary keeps manual device state separate from policy state', () => {
  const contract: ContractRecord = {
    id: 'ct-manual-lock',
    tenantId: 't-test',
    customerId: 'c-manual-lock',
    deviceId: 'd-manual-lock',
    guarantorIds: [],
    totalPhonePrice: 60000,
    advancePayment: 10000,
    financedAmount: 50000,
    monthlyInstallment: 10000,
    totalMonths: 5,
    dueDayOfMonth: 20,
    graceDays: 2,
    agreementAccepted: true,
    agreementAcceptedAt: '2026-04-01T00:00:00Z',
    deviceImei: 'imei-manual-lock',
    deviceSerial: 'serial-manual-lock',
    startDate: '2026-04-01',
    status: 'ACTIVE'
  };

  const device: DeviceRecord = {
    id: 'd-manual-lock',
    tenantId: 't-test',
    imei: 'imei-manual-lock',
    serial: 'serial-manual-lock',
    modelName: 'FinanceGuard Manual Lock Device',
    agentSecret: 'FG-0003',
    enrollmentStatus: 'ENROLLED',
    state: 'RESTRICTED',
    restrictionReason: 'Admin manually locked the device from the dashboard.'
  };

  withTemporaryContract(contract, device, () => {
    const summary = getDeviceSummary(device, new Date('2026-04-10T00:00:00Z'));

    assert.equal(summary.state, 'RESTRICTED');
    assert.equal(summary.policyState, 'ACTIVE');
  });
});

test('syncContractState keeps admin-locked devices restricted until admin unlocks', () => {
  const contract: ContractRecord = {
    id: 'ct-admin-lock',
    tenantId: 't-test',
    customerId: 'c-admin-lock',
    deviceId: 'd-admin-lock',
    guarantorIds: [],
    totalPhonePrice: 50000,
    advancePayment: 10000,
    financedAmount: 40000,
    monthlyInstallment: 10000,
    totalMonths: 4,
    dueDayOfMonth: 25,
    graceDays: 2,
    agreementAccepted: true,
    agreementAcceptedAt: '2026-04-01T00:00:00Z',
    deviceImei: 'imei-admin-lock',
    deviceSerial: 'serial-admin-lock',
    startDate: '2026-04-01',
    status: 'ACTIVE'
  };

  const device: DeviceRecord = {
    id: 'd-admin-lock',
    tenantId: 't-test',
    imei: 'imei-admin-lock',
    serial: 'serial-admin-lock',
    modelName: 'FinanceGuard Admin Lock Device',
    agentSecret: 'FG-0004',
    enrollmentStatus: 'ENROLLED',
    state: 'RESTRICTED',
    adminLocked: true,
    restrictionReason: 'Admin manually locked the device from the dashboard.'
  };

  withTemporaryContract(contract, device, () => {
    const result = syncContractState(contract, new Date('2026-04-10T00:00:00Z'));

    assert.equal(result.policyState, 'ACTIVE');
    assert.equal(device.state, 'RESTRICTED');
    assert.equal(device.adminLocked, true);
  });
});
