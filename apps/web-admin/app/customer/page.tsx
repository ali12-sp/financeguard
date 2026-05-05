'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch } from '../../components/api';
import { formatCurrency, formatDate, formatDateTime } from '../../components/formatters';
import StatCard from '../../components/stat-card';

interface CustomerContract {
  id: string;
  deviceModel: string;
  monthlyInstallment: number;
  nextDueDate: string | null;
  remainingBalance: number;
  policyState: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
  status: 'ACTIVE' | 'LATE' | 'RESTRICTED' | 'COMPLETED' | 'CANCELLED';
}

interface CustomerPayment {
  id: string;
  monthCovered: string;
  receivedAmount: number;
  principalApplied: number;
  lateFeeAmount: number;
  remainingBalanceAfter: number;
  receivedAt: string;
}

interface PortalSummary {
  customer: {
    fullName: string;
    phone: string;
    contracts: CustomerContract[];
  };
  activeContract: CustomerContract | null;
  activeDevice: {
    modelName: string;
    serial: string;
    state: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
    restrictionReason?: string;
  } | null;
  nextPaymentDate: string | null;
  nextPaymentAmount: number;
  remainingBalance: number;
  restricted: boolean;
}

export default function CustomerPage() {
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<PortalSummary>('/portal/summary'),
      apiFetch<CustomerPayment[]>('/portal/payments')
    ])
      .then(([portalSummary, portalPayments]) => {
        setSummary(portalSummary);
        setPayments(portalPayments);
      })
      .catch(console.error);
  }, []);

  return (
    <LayoutShell allowedRoles={['customer']}>
      <h1>My Account</h1>
      <p className="page-copy">
        See your installment status, remaining balance, and whether your financed device is active, in grace, or restricted.
      </p>

      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <StatCard
          title="Remaining Balance"
          value={formatCurrency(summary?.remainingBalance ?? 0)}
          note="Outstanding financed amount"
        />
        <StatCard
          title="Next Due"
          value={formatDate(summary?.nextPaymentDate)}
          note={summary ? formatCurrency(summary.nextPaymentAmount) : 'No active plan'}
        />
        <StatCard
          title="Device Status"
          value={summary?.activeDevice?.state ?? 'PENDING'}
          note={summary?.restricted ? 'Payment required to restore access' : 'Your device is in good standing'}
        />
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Current Plan</h2>
          <div className="stack">
            <div>
              <strong>Customer</strong>
              <div className="inline-note">{summary?.customer.fullName || '-'}</div>
            </div>
            <div>
              <strong>Phone</strong>
              <div className="inline-note">{summary?.customer.phone || '-'}</div>
            </div>
            <div>
              <strong>Device</strong>
              <div className="inline-note">{summary?.activeDevice?.modelName || '-'}</div>
            </div>
            <div>
              <strong>Monthly Installment</strong>
              <div className="inline-note">
                {summary?.activeContract ? formatCurrency(summary.activeContract.monthlyInstallment) : '-'}
              </div>
            </div>
            <div>
              <strong>Restriction Reason</strong>
              <div className="inline-note">{summary?.activeDevice?.restrictionReason || 'No restriction active.'}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Payment Help</h2>
          <p className="inline-note">
            When your payment is recorded by the admin, your status is updated automatically and the financed device can be released from restricted mode.
          </p>
          <div className="stack">
            <div>
              <strong>Next payment date</strong>
              <div className="inline-note">{formatDate(summary?.nextPaymentDate)}</div>
            </div>
            <div>
              <strong>Amount due</strong>
              <div className="inline-note">{formatCurrency(summary?.nextPaymentAmount ?? 0)}</div>
            </div>
            <div>
              <strong>Live policy state</strong>
              <div className="inline-note">{summary?.activeContract?.policyState || '-'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Payment History</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Month Covered</th>
                <th>Received</th>
                <th>Principal</th>
                <th>Late Fee</th>
                <th>Balance After</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatDateTime(payment.receivedAt)}</td>
                  <td>{payment.monthCovered}</td>
                  <td>{formatCurrency(payment.receivedAmount)}</td>
                  <td>{formatCurrency(payment.principalApplied)}</td>
                  <td>{formatCurrency(payment.lateFeeAmount)}</td>
                  <td>{formatCurrency(payment.remainingBalanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutShell>
  );
}
