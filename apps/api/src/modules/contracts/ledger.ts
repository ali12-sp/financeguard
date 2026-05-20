import { db, type ContractRecord, type DeviceRecord, type InstallmentRecord, type PaymentRecord } from '../../db/mock-db.js';

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function toDayIndex(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function diffInDays(left: Date, right: Date) {
  return Math.floor((toDayIndex(left) - toDayIndex(right)) / 86400000);
}

function scopeToTenant<T extends { tenantId: string }>(rows: T[], tenantId?: string) {
  return tenantId ? rows.filter((item) => item.tenantId === tenantId) : rows;
}

export function getContractInstallments(contractId: string, tenantId?: string) {
  return scopeToTenant(db.installments, tenantId)
    .filter((item) => item.contractId === contractId)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

export function getContractPayments(contractId: string, tenantId?: string) {
  return scopeToTenant(db.payments, tenantId)
    .filter((item) => item.contractId === contractId)
    .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
}

export function getContractPrincipalPaid(contractId: string, tenantId?: string) {
  return getContractInstallments(contractId, tenantId).reduce((sum, item) => sum + item.amountPaid, 0);
}

export function getContractLateFeesPaid(contractId: string, tenantId?: string) {
  return getContractPayments(contractId, tenantId).reduce((sum, item) => sum + item.lateFeeAmount, 0);
}

export function getRemainingBalance(contract: ContractRecord) {
  return Math.max(contract.financedAmount - getContractPrincipalPaid(contract.id, contract.tenantId), 0);
}

export function getNextUnpaidInstallment(contractId: string, tenantId?: string) {
  return getContractInstallments(contractId, tenantId).find((item) => item.amountPaid < item.amountDue) ?? null;
}

export function getInstallmentStatus(
  installment: InstallmentRecord,
  contract: ContractRecord,
  today = new Date()
) {
  if (installment.amountPaid >= installment.amountDue) {
    return 'PAID' as const;
  }

  const dueDate = parseDateOnly(installment.dueDate);
  const lateDays = diffInDays(today, dueDate);

  if (lateDays < 0) return 'UPCOMING' as const;
  if (lateDays === 0) return 'DUE' as const;
  if (lateDays <= contract.graceDays) return 'GRACE' as const;
  return 'OVERDUE' as const;
}

export function evaluatePolicy(contract: ContractRecord, today = new Date()) {
  if (contract.status === 'CANCELLED') return 'RESTRICTED' as const;
  if (getRemainingBalance(contract) <= 0) return 'RELEASED' as const;

  const nextInstallment = getNextUnpaidInstallment(contract.id, contract.tenantId);
  if (!nextInstallment) return 'RELEASED' as const;

  const lateDays = diffInDays(today, parseDateOnly(nextInstallment.dueDate));

  if (lateDays < 0) return 'ACTIVE' as const;
  if (lateDays === 0) return 'REMINDER' as const;
  if (lateDays <= contract.graceDays) return 'GRACE' as const;
  return 'RESTRICTED' as const;
}

export function deriveContractStatus(contract: ContractRecord, today = new Date()) {
  if (contract.status === 'CANCELLED') return 'CANCELLED' as const;

  const state = evaluatePolicy(contract, today);
  if (state === 'RELEASED') return 'COMPLETED' as const;
  if (state === 'RESTRICTED') return 'RESTRICTED' as const;
  if (state === 'GRACE' || state === 'REMINDER') return 'LATE' as const;
  return 'ACTIVE' as const;
}

export function syncContractState(contract: ContractRecord, today = new Date()) {
  const policyState = evaluatePolicy(contract, today);
  const nextStatus = deriveContractStatus(contract, today);
  const device = scopeToTenant(db.devices, contract.tenantId).find((item) => item.id === contract.deviceId);

  contract.status = nextStatus;

  if (device) {
    if (device.adminLocked) {
      return { contract, device, policyState, status: nextStatus };
    }

    const manualUnlockActive =
      device.manualUnlockUntil && Date.parse(device.manualUnlockUntil) > today.getTime();
    if (manualUnlockActive) {
      device.state = policyState === 'RELEASED' ? 'RELEASED' : 'ACTIVE';
      device.restrictionReason = undefined;
      return { contract, device, policyState, status: nextStatus };
    }

    if (device.manualUnlockUntil) {
      device.manualUnlockUntil = undefined;
      device.manualUnlockReason = undefined;
    }

    device.state = policyState;
    if (policyState === 'RESTRICTED' && !device.restrictionReason) {
      device.restrictionReason = 'Auto: missed scheduled installments beyond grace period';
    }
    if (policyState !== 'RESTRICTED' && device.restrictionReason?.startsWith('Auto:')) {
      device.restrictionReason = undefined;
    }
  }

  return { contract, device, policyState, status: nextStatus };
}

export function getContractSummary(contract: ContractRecord, today = new Date()) {
  const customer = scopeToTenant(db.customers, contract.tenantId).find((item) => item.id === contract.customerId) ?? null;
  const device = scopeToTenant(db.devices, contract.tenantId).find((item) => item.id === contract.deviceId) ?? null;
  const guarantors = scopeToTenant(db.guarantors, contract.tenantId).filter((item) => contract.guarantorIds.includes(item.id));
  const installments = getContractInstallments(contract.id, contract.tenantId);
  const principalPaid = getContractPrincipalPaid(contract.id, contract.tenantId);
  const lateFeesPaid = getContractLateFeesPaid(contract.id, contract.tenantId);
  const remainingBalance = getRemainingBalance(contract);
  const nextInstallment = getNextUnpaidInstallment(contract.id, contract.tenantId);
  const policyState = evaluatePolicy(contract, today);
  const status = deriveContractStatus(contract, today);

  return {
    ...contract,
    status,
    customerName: customer?.fullName ?? 'Unknown customer',
    customerPhone: customer?.phone ?? '-',
    deviceModel: device?.modelName ?? '-',
    deviceEnrollmentStatus: device?.enrollmentStatus ?? 'PENDING',
    guarantorCount: guarantors.length,
    guarantors: guarantors.map((item) => ({
      id: item.id,
      fullName: item.fullName,
      relationToCustomer: item.relationToCustomer
    })),
    totalPaid: principalPaid,
    lateFeesPaid,
    remainingBalance,
    paidInstallments: installments.filter((item) => item.amountPaid >= item.amountDue).length,
    overdueInstallments: installments.filter(
      (item) => getInstallmentStatus(item, contract, today) === 'OVERDUE'
    ).length,
    nextDueDate: nextInstallment?.dueDate ?? null,
    nextDueLabel: nextInstallment?.label ?? null,
    policyState
  };
}

export function getContractDetail(contract: ContractRecord, today = new Date()) {
  const summary = getContractSummary(contract, today);
  const installments = getContractInstallments(contract.id).map((item) => ({
    ...item,
    status: getInstallmentStatus(item, contract, today),
    outstandingAmount: Math.max(item.amountDue - item.amountPaid, 0)
  }));
  const payments = getContractPayments(contract.id, contract.tenantId).map((payment) => getPaymentSummary(payment));
  const auditLogs = scopeToTenant(db.auditLogs, contract.tenantId).filter(
    (item) =>
      item.entityId === contract.id ||
      payments.some((payment) => payment.id === item.entityId) ||
      contract.deviceId === item.entityId
  );

  return {
    ...summary,
    installments,
    payments,
    auditLogs
  };
}

export function getCustomerSummary(customerId: string, today = new Date(), tenantId?: string) {
  const customer = scopeToTenant(db.customers, tenantId).find((item) => item.id === customerId);
  if (!customer) return null;

  const contracts = scopeToTenant(db.contracts, customer.tenantId)
    .filter((item) => item.customerId === customer.id)
    .map((item) => getContractSummary(item, today));
  const devices = scopeToTenant(db.devices, customer.tenantId).filter((item) => item.assignedCustomerId === customer.id);
  const guarantors = scopeToTenant(db.guarantors, customer.tenantId).filter((item) => item.customerId === customer.id);

  return {
    ...customer,
    activeContractCount: contracts.filter((item) => item.status !== 'COMPLETED').length,
    guarantorCount: guarantors.length,
    deviceCount: devices.length,
    remainingBalance: contracts.reduce((sum, item) => sum + item.remainingBalance, 0),
    contracts
  };
}

export function getCustomerDetail(customerId: string, today = new Date(), tenantId?: string) {
  const summary = getCustomerSummary(customerId, today, tenantId);
  if (!summary) return null;

  const payments = scopeToTenant(db.payments, summary.tenantId)
    .filter((item) => {
      const contract = scopeToTenant(db.contracts, summary.tenantId).find((contractItem) => contractItem.id === item.contractId);
      return contract?.customerId === customerId;
    })
    .map((item) => getPaymentSummary(item));

  return {
    ...summary,
    guarantors: scopeToTenant(db.guarantors, summary.tenantId).filter((item) => item.customerId === customerId),
    devices: scopeToTenant(db.devices, summary.tenantId).filter((item) => item.assignedCustomerId === customerId),
    payments,
    auditLogs: scopeToTenant(db.auditLogs, summary.tenantId).filter((item) =>
      [customerId, ...summary.contracts.map((contract) => contract.id)].includes(item.entityId)
    )
  };
}

export function getDeviceSummary(device: DeviceRecord, today = new Date()) {
  const contract = scopeToTenant(db.contracts, device.tenantId).find((item) => item.deviceId === device.id) ?? null;
  const customer = contract
    ? scopeToTenant(db.customers, device.tenantId).find((item) => item.id === contract.customerId) ?? null
    : null;
  const remainingBalance = contract ? getRemainingBalance(contract) : 0;
  const policyState = contract ? evaluatePolicy(contract, today) : device.state;
  const manualUnlockActive =
    device.manualUnlockUntil && Date.parse(device.manualUnlockUntil) > today.getTime();

  return {
    ...device,
    state: device.state,
    customerName: customer?.fullName ?? null,
    contractId: contract?.id ?? null,
    remainingBalance,
    policyState,
    manualUnlockActive: Boolean(manualUnlockActive)
  };
}

export function getPaymentSummary(payment: PaymentRecord) {
  const contract = scopeToTenant(db.contracts, payment.tenantId).find((item) => item.id === payment.contractId) ?? null;
  const customer = contract
    ? scopeToTenant(db.customers, payment.tenantId).find((item) => item.id === contract.customerId) ?? null
    : null;
  const device = contract
    ? scopeToTenant(db.devices, payment.tenantId).find((item) => item.id === contract.deviceId) ?? null
    : null;
  const recordedBy = scopeToTenant(db.users, payment.tenantId).find((item) => item.id === payment.recordedByUserId) ?? null;

  return {
    ...payment,
    customerName: customer?.fullName ?? 'Unknown customer',
    deviceModel: device?.modelName ?? '-',
    recordedByName: recordedBy?.name ?? 'System'
  };
}

export function allocatePaymentToInstallments(contract: ContractRecord, principalAmount: number) {
  const remainingBalance = getRemainingBalance(contract);
  if (principalAmount > remainingBalance) {
    return { error: 'Payment principal exceeds remaining financed balance.' } as const;
  }

  const installments = getContractInstallments(contract.id, contract.tenantId);
  const coveredInstallments: InstallmentRecord[] = [];
  let unallocated = principalAmount;

  for (const installment of installments) {
    if (unallocated <= 0) break;

    const outstandingAmount = Math.max(installment.amountDue - installment.amountPaid, 0);
    if (outstandingAmount === 0) continue;

    const applied = Math.min(outstandingAmount, unallocated);
    installment.amountPaid += applied;
    unallocated -= applied;
    coveredInstallments.push(installment);
  }

  if (unallocated > 0) {
    return { error: 'Unable to fully allocate payment to the contract schedule.' } as const;
  }

  return { coveredInstallments } as const;
}
