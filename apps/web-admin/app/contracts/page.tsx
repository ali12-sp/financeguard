'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiDownload, apiFetch } from '../../components/api';
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
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiFetch<ContractRow[]>('/contracts')
      .then(setRows)
      .catch(console.error);
  }, []);

  async function downloadInvoice(row: ContractRow) {
    try {
      await apiDownload(`/contracts/${row.id}/invoice.pdf`, `invoice-${row.id}.pdf`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to download invoice');
    }
  }

  return (
    <LayoutShell>
      <h1>Contracts</h1>
      <p className="page-copy">Every contract combines customer, device, guarantors, installment progress, policy state, and remaining financed balance.</p>
      {status ? <p className="inline-note" style={{ marginTop: 12 }}>{status}</p> : null}
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
                <th>Invoice</th>
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
                  <td>
                    <button type="button" className="ghost-button" onClick={() => downloadInvoice(row)}>
                      PDF
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
