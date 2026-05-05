'use client';

import { FormEvent, useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import { formatCurrency, formatDateTime } from '../../components/formatters';

interface PaymentRow {
  id: string;
  customerName: string;
  deviceModel: string;
  monthCovered: string;
  receivedAmount: number;
  principalApplied: number;
  lateFeeAmount: number;
  remainingBalanceAfter: number;
  matchedBy: 'AUTO' | 'MANUAL_OVERRIDE';
  recordedByName: string;
  receivedAt: string;
}

interface ContractOption {
  id: string;
  customerName: string;
  deviceModel: string;
  remainingBalance: number;
  monthlyInstallment: number;
}

export default function PaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [selectedContract, setSelectedContract] = useState('');
  const [principalAmount, setPrincipalAmount] = useState('7000');
  const [lateFeeAmount, setLateFeeAmount] = useState('0');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');

  async function load() {
    try {
      const [payments, contractRows] = await Promise.all([
        apiFetch<PaymentRow[]>('/payments'),
        apiFetch<ContractOption[]>('/contracts')
      ]);
      setRows(payments);
      setContracts(contractRows);
      if (!selectedContract && contractRows[0]) {
        setSelectedContract(contractRows[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('Posting payment...');

    try {
      await apiPost('/payments', {
        contractId: selectedContract,
        principalAmount: Number(principalAmount),
        lateFeeAmount: Number(lateFeeAmount),
        note: note || undefined
      });
      setStatus('Payment recorded.');
      setNote('');
      setLateFeeAmount('0');
      load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Payment failed');
    }
  }

  return (
    <LayoutShell>
      <h1>Payments</h1>
      <p className="page-copy">Posted payments show how much money came in, how much reduced principal, whether a late fee was added, and whether the match was automatic or manual.</p>
      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Record Payment</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <select value={selectedContract} onChange={(event) => setSelectedContract(event.target.value)}>
            {contracts.map((contract) => (
              <option key={contract.id} value={contract.id}>
                {contract.customerName} - {contract.deviceModel} - {formatCurrency(contract.remainingBalance)} left
              </option>
            ))}
          </select>
          <input type="number" value={principalAmount} onChange={(event) => setPrincipalAmount(event.target.value)} placeholder="Principal amount" />
          <input type="number" value={lateFeeAmount} onChange={(event) => setLateFeeAmount(event.target.value)} placeholder="Late fee" />
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
          <div className="form-grid-full">
            <div className="button-row">
              <button type="submit">Post Payment</button>
              <span className="inline-note">{status}</span>
            </div>
          </div>
        </form>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Customer</th>
                <th>Device</th>
                <th>Month Covered</th>
                <th>Received</th>
                <th>Principal</th>
                <th>Late Fee</th>
                <th>Balance After</th>
                <th>Matched By</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.receivedAt)}</td>
                  <td>{row.customerName}</td>
                  <td>{row.deviceModel}</td>
                  <td>{row.monthCovered}</td>
                  <td>{formatCurrency(row.receivedAmount)}</td>
                  <td>{formatCurrency(row.principalApplied)}</td>
                  <td>{formatCurrency(row.lateFeeAmount)}</td>
                  <td>{formatCurrency(row.remainingBalanceAfter)}</td>
                  <td><span className={`badge ${row.matchedBy.toLowerCase()}`}>{row.matchedBy}</span></td>
                  <td>{row.recordedByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutShell>
  );
}
