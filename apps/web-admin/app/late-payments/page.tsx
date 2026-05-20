'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import { formatCurrency, formatDate, formatDateTime } from '../../components/formatters';

interface LateRow {
  contractId: string;
  deviceId: string;
  customerName: string;
  phone: string;
  deviceModel: string;
  state: 'GRACE' | 'RESTRICTED';
  manualUnlockUntil?: string;
  manualUnlockReason?: string;
  dueDayOfMonth: number;
  monthlyInstallment: number;
  remainingBalance: number;
  nextDueDate: string | null;
  overdueInstallments: number;
}

export default function LatePaymentsPage() {
  const [rows, setRows] = useState<LateRow[]>([]);
  const [status, setStatus] = useState('');

  async function loadRows() {
    apiFetch<LateRow[]>('/policies/late-customers')
      .then(setRows)
      .catch(console.error);
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function overrideUnlock(row: LateRow) {
    const reason = window.prompt(
      'Reason for manual unlock override',
      row.manualUnlockReason || 'Customer disputed this lock.'
    );
    if (!reason?.trim()) {
      return;
    }

    setStatus('Applying manual unlock override...');
    try {
      await apiPost(`/devices/${row.deviceId}/manual-unlock`, {
        reason: reason.trim(),
        hours: 24
      });
      setStatus(`Manual unlock override applied for ${row.customerName}.`);
      loadRows();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to apply manual unlock override');
    }
  }

  return (
    <LayoutShell>
      <h1>Late Payments</h1>
      <p className="page-copy">These are the accounts currently inside the grace window or already restricted because scheduled installments were not covered in time.</p>
      {status ? <p className="inline-note" style={{ marginTop: 12 }}>{status}</p> : null}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Device</th>
              <th>Next Due</th>
              <th>Monthly Installment</th>
              <th>Overdue Installments</th>
              <th>Balance</th>
              <th>State</th>
              <th>Manual Override</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contractId}>
                <td>{row.customerName}</td>
                <td>{row.phone}</td>
                <td>{row.deviceModel}</td>
                <td>{formatDate(row.nextDueDate)}</td>
                <td>{formatCurrency(row.monthlyInstallment)}</td>
                <td>{row.overdueInstallments}</td>
                <td>{formatCurrency(row.remainingBalance)}</td>
                <td><span className={`badge ${row.state.toLowerCase()}`}>{row.state}</span></td>
                <td>{row.manualUnlockUntil ? formatDateTime(row.manualUnlockUntil) : '-'}</td>
                <td>
                  <button type="button" className="success-button" onClick={() => overrideUnlock(row)}>
                    Override 24h
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </LayoutShell>
  );
}
