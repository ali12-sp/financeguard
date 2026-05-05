'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch } from '../../components/api';
import { formatCurrency, formatDate } from '../../components/formatters';

interface LateRow {
  contractId: string;
  customerName: string;
  phone: string;
  deviceModel: string;
  state: 'GRACE' | 'RESTRICTED';
  dueDayOfMonth: number;
  monthlyInstallment: number;
  remainingBalance: number;
  nextDueDate: string | null;
  overdueInstallments: number;
}

export default function LatePaymentsPage() {
  const [rows, setRows] = useState<LateRow[]>([]);

  useEffect(() => {
    apiFetch<LateRow[]>('/policies/late-customers')
      .then(setRows)
      .catch(console.error);
  }, []);

  return (
    <LayoutShell>
      <h1>Late Payments</h1>
      <p className="page-copy">These are the accounts currently inside the grace window or already restricted because scheduled installments were not covered in time.</p>
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
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </LayoutShell>
  );
}
