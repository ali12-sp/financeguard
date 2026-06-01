import { db } from '../db/mock-db.js';
import { getContractSummary, getInstallmentStatus, getPaymentSummary } from '../modules/contracts/ledger.js';
import { getUpcomingInstallments } from './scheduler.js';
import { scopeToTenant } from './tenancy.js';

function monthKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function lastMonthKeys(count: number, today = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (count - index - 1), 1));
    return monthKey(date);
  });
}

export function buildPortfolioReport(tenantId: string, today = new Date()) {
  const customers = scopeToTenant(db.customers, tenantId);
  const contracts = scopeToTenant(db.contracts, tenantId);
  const devices = scopeToTenant(db.devices, tenantId);
  const payments = scopeToTenant(db.payments, tenantId);
  const installments = scopeToTenant(db.installments, tenantId);
  const contractSummaries = contracts.map((contract) => getContractSummary(contract, today));
  const currentMonth = startOfUtcMonth(today).toISOString();

  const dueInstallments = installments.filter((installment) => {
    const contract = contracts.find((item) => item.id === installment.contractId);
    if (!contract) return false;
    return getInstallmentStatus(installment, contract, today) !== 'UPCOMING';
  });
  const overdueInstallments = installments.filter((installment) => {
    const contract = contracts.find((item) => item.id === installment.contractId);
    if (!contract) return false;
    return getInstallmentStatus(installment, contract, today) === 'OVERDUE';
  });

  const totalDue = dueInstallments.reduce((sum, installment) => sum + installment.amountDue, 0);
  const collectedAgainstDue = dueInstallments.reduce((sum, installment) => sum + installment.amountPaid, 0);
  const overdueAmount = overdueInstallments.reduce(
    (sum, installment) => sum + Math.max(installment.amountDue - installment.amountPaid, 0),
    0
  );
  const principalCollected = contractSummaries.reduce((sum, contract) => sum + contract.totalPaid, 0);
  const lateFeesCollected = contractSummaries.reduce((sum, contract) => sum + contract.lateFeesPaid, 0);
  const outstandingBalance = contractSummaries.reduce((sum, contract) => sum + contract.remainingBalance, 0);
  const financedPrincipal = contracts.reduce((sum, contract) => sum + contract.financedAmount, 0);
  const thisMonthPayments = payments.filter((payment) => payment.receivedAt >= currentMonth);
  const activeCustomerIds = new Set(
    contractSummaries
      .filter((contract) => contract.status !== 'COMPLETED' && contract.status !== 'CANCELLED')
      .map((contract) => contract.customerId)
  );

  const riskBuckets = [
    {
      label: 'Current',
      count: contractSummaries.filter((contract) => contract.policyState === 'ACTIVE').length,
      balance: contractSummaries
        .filter((contract) => contract.policyState === 'ACTIVE')
        .reduce((sum, contract) => sum + contract.remainingBalance, 0)
    },
    {
      label: 'Reminder',
      count: contractSummaries.filter((contract) => contract.policyState === 'REMINDER').length,
      balance: contractSummaries
        .filter((contract) => contract.policyState === 'REMINDER')
        .reduce((sum, contract) => sum + contract.remainingBalance, 0)
    },
    {
      label: 'Grace',
      count: contractSummaries.filter((contract) => contract.policyState === 'GRACE').length,
      balance: contractSummaries
        .filter((contract) => contract.policyState === 'GRACE')
        .reduce((sum, contract) => sum + contract.remainingBalance, 0)
    },
    {
      label: 'Restricted',
      count: contractSummaries.filter((contract) => contract.policyState === 'RESTRICTED').length,
      balance: contractSummaries
        .filter((contract) => contract.policyState === 'RESTRICTED')
        .reduce((sum, contract) => sum + contract.remainingBalance, 0)
    },
    {
      label: 'Released',
      count: contractSummaries.filter((contract) => contract.policyState === 'RELEASED').length,
      balance: contractSummaries
        .filter((contract) => contract.policyState === 'RELEASED')
        .reduce((sum, contract) => sum + contract.remainingBalance, 0)
    }
  ];

  const monthlyCollections = lastMonthKeys(6, today).map((key) => {
    const monthPayments = payments.filter((payment) => monthKey(payment.receivedAt) === key);
    return {
      month: key,
      receivedAmount: monthPayments.reduce((sum, payment) => sum + payment.receivedAmount, 0),
      principalApplied: monthPayments.reduce((sum, payment) => sum + payment.principalApplied, 0),
      lateFeeAmount: monthPayments.reduce((sum, payment) => sum + payment.lateFeeAmount, 0),
      paymentCount: monthPayments.length
    };
  });

  const delinquentAccounts = contractSummaries
    .filter((contract) => contract.policyState === 'GRACE' || contract.policyState === 'RESTRICTED')
    .sort((left, right) => right.remainingBalance - left.remainingBalance)
    .slice(0, 10)
    .map((contract) => ({
      contractId: contract.id,
      customerName: contract.customerName,
      customerPhone: contract.customerPhone,
      deviceModel: contract.deviceModel,
      policyState: contract.policyState,
      nextDueDate: contract.nextDueDate,
      overdueInstallments: contract.overdueInstallments,
      remainingBalance: contract.remainingBalance
    }));

  // ── Overdue aging buckets ─────────────────────────────────────────────────
  const nowMs = today.getTime();
  function daysOverdue(dueDate: string) {
    return Math.max(0, Math.floor((nowMs - new Date(`${dueDate}T00:00:00Z`).getTime()) / 86400000));
  }

  const agingBuckets = [
    { label: '1–7 days',  min: 1,  max: 7 },
    { label: '8–30 days', min: 8,  max: 30 },
    { label: '31–60 days',min: 31, max: 60 },
    { label: '60+ days',  min: 61, max: Infinity }
  ].map(({ label, min, max }) => {
    const matching = overdueInstallments.filter((inst) => {
      const days = daysOverdue(inst.dueDate);
      return days >= min && days <= max;
    });
    return {
      label,
      count: matching.length,
      overdueAmount: matching.reduce((sum, inst) => sum + Math.max(inst.amountDue - inst.amountPaid, 0), 0)
    };
  });

  // ── Payment method breakdown ──────────────────────────────────────────────
  const paymentMethods = ['CASH', 'BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH', 'CARD', 'OTHER'] as const;
  const paymentMethodBreakdown = paymentMethods.map((method) => {
    const matched = payments.filter((p) => p.paymentMethod === method);
    return {
      method,
      count: matched.length,
      totalReceived: matched.reduce((sum, p) => sum + p.receivedAmount, 0)
    };
  });

  return {
    generatedAt: today.toISOString(),
    totals: {
      customers: customers.length,
      activeCustomers: activeCustomerIds.size,
      contracts: contracts.length,
      activeContracts: contractSummaries.filter(
        (contract) => contract.status !== 'COMPLETED' && contract.status !== 'CANCELLED'
      ).length,
      devices: devices.length,
      restrictedDevices: devices.filter((device) => device.state === 'RESTRICTED').length,
      financedPrincipal,
      principalCollected,
      lateFeesCollected,
      outstandingBalance,
      overdueAmount,
      totalDue,
      collectedAgainstDue,
      collectionRate: totalDue > 0 ? collectedAgainstDue / totalDue : 1,
      paymentsThisMonth: thisMonthPayments.length,
      collectionsThisMonth: thisMonthPayments.reduce((sum, payment) => sum + payment.receivedAmount, 0)
    },
    riskBuckets,
    agingBuckets,
    paymentMethodBreakdown,
    monthlyCollections,
    upcomingInstallments: getUpcomingInstallments(10, tenantId),
    delinquentAccounts,
    recentPayments: payments
      .map((payment) => getPaymentSummary(payment))
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, 10)
  };
}
