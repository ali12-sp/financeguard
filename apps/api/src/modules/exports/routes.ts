import { Router } from 'express';
import { db } from '../../db/mock-db.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getContractSummary, getPaymentSummary } from '../contracts/ledger.js';
import { buildPortfolioReport } from '../../services/reporting.js';
import { getTenantIdFromAuth, scopeToTenant } from '../../services/tenancy.js';

const router = Router();

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(','))
  ].join('\n');
}

function sendCsv(res: { setHeader(name: string, value: string): void; type(value: string): void; send(value: string): void }, filename: string, csv: string) {
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.type('text/csv');
  res.send(`${csv}\n`);
}

router.get('/customers.csv', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const rows = scopeToTenant(db.customers, tenantId).map((customer) => {
    const contracts = scopeToTenant(db.contracts, tenantId)
      .filter((contract) => contract.customerId === customer.id)
      .map((contract) => getContractSummary(contract));

    return [
      customer.id,
      customer.fullName,
      customer.phone,
      customer.cnic,
      customer.address,
      customer.notes,
      contracts.length,
      contracts.reduce((sum, contract) => sum + contract.remainingBalance, 0)
    ];
  });

  sendCsv(res, 'financeguard-customers.csv', buildCsv([
    'customer_id',
    'full_name',
    'phone',
    'cnic',
    'address',
    'notes',
    'contract_count',
    'remaining_balance'
  ], rows));
});

router.get('/contracts.csv', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const rows = scopeToTenant(db.contracts, tenantId)
    .map((contract) => getContractSummary(contract))
    .map((contract) => [
      contract.id,
      contract.customerName,
      contract.customerPhone,
      contract.deviceModel,
      contract.deviceImei,
      contract.status,
      contract.policyState,
      contract.totalPhonePrice,
      contract.advancePayment,
      contract.financedAmount,
      contract.monthlyInstallment,
      contract.totalMonths,
      contract.totalPaid,
      contract.lateFeesPaid,
      contract.remainingBalance,
      contract.nextDueDate,
      contract.overdueInstallments
    ]);

  sendCsv(res, 'financeguard-contracts.csv', buildCsv([
    'contract_id',
    'customer_name',
    'customer_phone',
    'device_model',
    'device_imei',
    'status',
    'policy_state',
    'total_phone_price',
    'advance_payment',
    'financed_amount',
    'monthly_installment',
    'total_months',
    'principal_paid',
    'late_fees_paid',
    'remaining_balance',
    'next_due_date',
    'overdue_installments'
  ], rows));
});

router.get('/payments.csv', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const rows = scopeToTenant(db.payments, tenantId)
    .map((payment) => getPaymentSummary(payment))
    .map((payment) => [
      payment.id,
      payment.contractId,
      payment.customerName,
      payment.deviceModel,
      payment.receivedAt,
      payment.monthCovered,
      payment.receivedAmount,
      payment.principalApplied,
      payment.lateFeeAmount,
      payment.paymentMethod,
      payment.referenceNumber,
      payment.remainingBalanceAfter,
      payment.matchedBy,
      payment.recordedByName,
      payment.note
    ]);

  sendCsv(res, 'financeguard-payments.csv', buildCsv([
    'payment_id',
    'contract_id',
    'customer_name',
    'device_model',
    'received_at',
    'month_covered',
    'received_amount',
    'principal_applied',
    'late_fee_amount',
    'payment_method',
    'reference_number',
    'remaining_balance_after',
    'matched_by',
    'recorded_by',
    'note'
  ], rows));
});

router.get('/portfolio.csv', (req, res) => {
  const tenantId = getTenantIdFromAuth(req as AuthRequest);
  const report = buildPortfolioReport(tenantId);
  const rows = [
    ['customers', report.totals.customers],
    ['active_customers', report.totals.activeCustomers],
    ['contracts', report.totals.contracts],
    ['active_contracts', report.totals.activeContracts],
    ['devices', report.totals.devices],
    ['restricted_devices', report.totals.restrictedDevices],
    ['financed_principal', report.totals.financedPrincipal],
    ['principal_collected', report.totals.principalCollected],
    ['late_fees_collected', report.totals.lateFeesCollected],
    ['outstanding_balance', report.totals.outstandingBalance],
    ['overdue_amount', report.totals.overdueAmount],
    ['collection_rate', report.totals.collectionRate],
    ['collections_this_month', report.totals.collectionsThisMonth]
  ];

  sendCsv(res, 'financeguard-portfolio.csv', buildCsv(['metric', 'value'], rows));
});

export default router;

