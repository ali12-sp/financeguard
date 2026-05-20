'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import StatCard from '../../components/stat-card';
import { apiDownload, apiFetch } from '../../components/api';
import { formatCurrency, formatDate, formatDateTime } from '../../components/formatters';

interface PortfolioReport {
  generatedAt: string;
  totals: {
    customers: number;
    activeCustomers: number;
    contracts: number;
    activeContracts: number;
    devices: number;
    restrictedDevices: number;
    financedPrincipal: number;
    principalCollected: number;
    lateFeesCollected: number;
    outstandingBalance: number;
    overdueAmount: number;
    totalDue: number;
    collectedAgainstDue: number;
    collectionRate: number;
    paymentsThisMonth: number;
    collectionsThisMonth: number;
  };
  riskBuckets: Array<{
    label: string;
    count: number;
    balance: number;
  }>;
  monthlyCollections: Array<{
    month: string;
    receivedAmount: number;
    principalApplied: number;
    lateFeeAmount: number;
    paymentCount: number;
  }>;
  upcomingInstallments: Array<{
    contractId: string;
    customerName: string;
    deviceModel: string;
    dueDate: string;
    amountDue: number;
    sequenceNumber: number;
  }>;
  delinquentAccounts: Array<{
    contractId: string;
    customerName: string;
    customerPhone: string;
    deviceModel: string;
    policyState: 'GRACE' | 'RESTRICTED';
    nextDueDate: string | null;
    overdueInstallments: number;
    remainingBalance: number;
  }>;
  recentPayments: Array<{
    id: string;
    customerName: string;
    deviceModel: string;
    receivedAt: string;
    receivedAmount: number;
    principalApplied: number;
    lateFeeAmount: number;
    monthCovered: string;
  }>;
}

const exportLinks = [
  { path: '/exports/portfolio.csv', filename: 'financeguard-portfolio.csv', label: 'Portfolio CSV' },
  { path: '/exports/customers.csv', filename: 'financeguard-customers.csv', label: 'Customers CSV' },
  { path: '/exports/contracts.csv', filename: 'financeguard-contracts.csv', label: 'Contracts CSV' },
  { path: '/exports/payments.csv', filename: 'financeguard-payments.csv', label: 'Payments CSV' }
];

export default function ReportsPage() {
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [status, setStatus] = useState('');

  async function loadReport() {
    try {
      const data = await apiFetch<PortfolioReport>('/reports/portfolio');
      setReport(data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load report');
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  async function downloadCsv(path: string, filename: string) {
    try {
      await apiDownload(path, filename);
      setStatus(`${filename} downloaded.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to export CSV');
    }
  }

  const collectionRate = report ? `${Math.round(report.totals.collectionRate * 100)}%` : '0%';

  return (
    <LayoutShell>
      <div className="section-head">
        <div>
          <h1>Reports & Exports</h1>
          <p className="page-copy">Portfolio health, collections, delinquency, and accountant-ready CSV exports.</p>
          {report ? <p className="inline-note">Generated {formatDateTime(report.generatedAt)}</p> : null}
        </div>
        <div className="button-row">
          <button type="button" onClick={loadReport}>Refresh</button>
        </div>
      </div>

      {status ? <p className="inline-note">{status}</p> : null}

      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <StatCard title="Outstanding" value={formatCurrency(report?.totals.outstandingBalance ?? 0)} note={`${report?.totals.activeContracts ?? 0} active contracts`} />
        <StatCard title="Collected" value={formatCurrency(report?.totals.principalCollected ?? 0)} note={`${formatCurrency(report?.totals.lateFeesCollected ?? 0)} late fees`} />
        <StatCard title="Collection Rate" value={collectionRate} note={`${formatCurrency(report?.totals.collectedAgainstDue ?? 0)} of due schedule`} />
        <StatCard title="Overdue Amount" value={formatCurrency(report?.totals.overdueAmount ?? 0)} note="Unpaid balance on overdue installments" />
        <StatCard title="This Month" value={formatCurrency(report?.totals.collectionsThisMonth ?? 0)} note={`${report?.totals.paymentsThisMonth ?? 0} payment events`} />
        <StatCard title="Restricted" value={String(report?.totals.restrictedDevices ?? 0)} note={`${report?.totals.devices ?? 0} managed devices`} />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">CSV Exports</h2>
        <div className="button-row">
          {exportLinks.map((link) => (
            <button
              key={link.path}
              type="button"
              className="ghost-button"
              onClick={() => downloadCsv(link.path, link.filename)}
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Risk Buckets</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Contracts</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(report?.riskBuckets ?? []).map((bucket) => (
                  <tr key={bucket.label}>
                    <td><span className={`badge ${bucket.label.toLowerCase()}`}>{bucket.label}</span></td>
                    <td>{bucket.count}</td>
                    <td>{formatCurrency(bucket.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Monthly Collections</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Payments</th>
                  <th>Received</th>
                  <th>Late Fees</th>
                </tr>
              </thead>
              <tbody>
                {(report?.monthlyCollections ?? []).map((month) => (
                  <tr key={month.month}>
                    <td>{month.month}</td>
                    <td>{month.paymentCount}</td>
                    <td>{formatCurrency(month.receivedAmount)}</td>
                    <td>{formatCurrency(month.lateFeeAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Delinquent Accounts</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>State</th>
                  <th>Next Due</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(report?.delinquentAccounts ?? []).map((row) => (
                  <tr key={row.contractId}>
                    <td>{row.customerName}<br />{row.customerPhone}</td>
                    <td><span className={`badge ${row.policyState.toLowerCase()}`}>{row.policyState}</span></td>
                    <td>{formatDate(row.nextDueDate)}</td>
                    <td>{formatCurrency(row.remainingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Upcoming Dues</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Device</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(report?.upcomingInstallments ?? []).map((row) => (
                  <tr key={`${row.contractId}-${row.sequenceNumber}`}>
                    <td>{row.customerName}</td>
                    <td>{row.deviceModel}</td>
                    <td>{formatDate(row.dueDate)}</td>
                    <td>{formatCurrency(row.amountDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}

