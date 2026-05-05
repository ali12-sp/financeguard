'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch } from '../../components/api';
import { formatCurrency, formatDate } from '../../components/formatters';

interface ContractRow {
  id: string;
  customerName: string;
  customerPhone: string;
  deviceModel: string;
  totalPhonePrice: number;
  advancePayment: number;
  monthlyInstallment: number;
  totalMonths: number;
  paidInstallments: number;
  guarantorCount: number;
  nextDueDate: string | null;
  remainingBalance: number;
  status: 'ACTIVE' | 'LATE' | 'RESTRICTED' | 'COMPLETED' | 'CANCELLED';
  policyState: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
  agreementAccepted: boolean;
}

export default function ContractsPage() {
  const [rows, setRows] = useState<ContractRow[]>([]);

  useEffect(() => {
    apiFetch<ContractRow[]>('/contracts')
      .then(setRows)
      .catch(console.error);
  }, []);

  return (
    <LayoutShell>
      <h1>Contracts</h1>
      <p className="page-copy">Every contract combines customer, device, guarantors, installment progress, policy state, and remaining financed balance.</p>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Device</th>
                <th>Total Price</th>
                <th>Advance</th>
                <th>Installment Plan</th>
                <th>Guarantors</th>
                <th>Next Due</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Policy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.customerName}<br />{row.customerPhone}</td>
                  <td>{row.deviceModel}</td>
                  <td>{formatCurrency(row.totalPhonePrice)}</td>
                  <td>{formatCurrency(row.advancePayment)}</td>
                  <td>{formatCurrency(row.monthlyInstallment)}<br />{row.paidInstallments}/{row.totalMonths} paid</td>
                  <td>{row.guarantorCount}</td>
                  <td>{formatDate(row.nextDueDate)}</td>
                  <td>{formatCurrency(row.remainingBalance)}</td>
                  <td><span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td><span className={`badge ${row.policyState.toLowerCase()}`}>{row.policyState}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutShell>
  );
}
