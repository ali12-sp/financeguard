'use client';

import { FormEvent, useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import { formatCurrency } from '../../components/formatters';
import { getStoredUser } from '../../components/session';

interface Customer {
  id: string;
  fullName: string;
  phone: string;
  cnic: string;
  address?: string;
  activeContractCount: number;
  guarantorCount: number;
  deviceCount: number;
  remainingBalance: number;
}

interface OnboardResponse {
  device: {
    agentSecret: string;
    serial: string;
  };
  portalCredentials?: {
    identifier: string;
    password: string;
  };
}

function createInitialForm() {
  const workspaceSettings = getStoredUser()?.workspaceSettings;

  return {
  fullName: '',
  phone: '',
  cnic: '',
  address: '',
  notes: '',
  portalPin: '',
  modelName: '',
  serial: '',
  imei: '',
  totalPhonePrice: '65000',
  advancePayment: '15000',
  monthlyInstallment: '7000',
  totalMonths: '6',
  dueDayOfMonth: String(workspaceSettings?.defaultDueDayOfMonth ?? 10),
  graceDays: String(workspaceSettings?.defaultGraceDays ?? 3),
  enrollmentMode: workspaceSettings?.defaultEnrollmentMode ?? 'QR',
  startDate: new Date().toISOString().slice(0, 10)
  };
}

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [form, setForm] = useState(createInitialForm);
  const [status, setStatus] = useState('');
  const [portalCredentials, setPortalCredentials] = useState<OnboardResponse['portalCredentials'] | null>(null);

  const totalPhonePrice = Number(form.totalPhonePrice) || 0;
  const advancePayment = Number(form.advancePayment) || 0;
  const monthlyInstallment = Number(form.monthlyInstallment) || 0;
  const totalMonths = Number(form.totalMonths) || 0;
  const financedAmount = Math.max(totalPhonePrice - advancePayment, 0);
  const scheduledAmount = monthlyInstallment * totalMonths;
  const isScheduleCovered = scheduledAmount >= financedAmount;
  const serialTooShort = form.serial.trim().length > 0 && form.serial.trim().length < 3;

  async function loadCustomers() {
    apiFetch<Customer[]>('/customers')
      .then(setRows)
      .catch(console.error);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('Saving customer and contract...');
    setPortalCredentials(null);

    try {
      const created = await apiPost<OnboardResponse>('/customers/onboard', {
        customer: {
          fullName: form.fullName,
          phone: form.phone,
          cnic: form.cnic,
          address: form.address || undefined,
          notes: form.notes || undefined,
          portalPin: form.portalPin || undefined
        },
        device: {
          modelName: form.modelName,
          serial: form.serial,
          imei: form.imei || 'PENDING',
          enrollmentMode: form.enrollmentMode
        },
        contract: {
          totalPhonePrice: Number(form.totalPhonePrice),
          advancePayment: Number(form.advancePayment),
          monthlyInstallment: Number(form.monthlyInstallment),
          totalMonths: Number(form.totalMonths),
          dueDayOfMonth: Number(form.dueDayOfMonth),
          graceDays: Number(form.graceDays),
          startDate: form.startDate,
          agreementAccepted: true
        }
      });

      setForm(createInitialForm());
      setPortalCredentials(created.portalCredentials ?? null);
      setStatus(`Customer created. Device secret: ${created.device.agentSecret}`);
      loadCustomers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save customer');
    }
  }

  return (
    <LayoutShell>
      <h1>Customers</h1>
      <p className="page-copy">Customer profiles hold identity details plus the live financing picture: open contracts, linked guarantors, assigned devices, and remaining balance.</p>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Onboard Financed Customer</h2>
        <p className="page-copy">Use one form to create the customer, the financed phone, and the installment plan the scheduler will track.</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <input required minLength={2} placeholder="Customer name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
          <input required minLength={8} placeholder="Phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          <input required minLength={5} placeholder="CNIC" value={form.cnic} onChange={(event) => setForm((current) => ({ ...current, cnic: event.target.value }))} />
          <input placeholder="Address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          <input placeholder="Portal PIN (optional)" value={form.portalPin} onChange={(event) => setForm((current) => ({ ...current, portalPin: event.target.value }))} />
          <input placeholder="Internal notes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          <input required minLength={2} placeholder="Phone model" value={form.modelName} onChange={(event) => setForm((current) => ({ ...current, modelName: event.target.value }))} />
          <input required minLength={3} placeholder="Serial number" value={form.serial} onChange={(event) => setForm((current) => ({ ...current, serial: event.target.value }))} />
          <input placeholder="IMEI or placeholder" value={form.imei} onChange={(event) => setForm((current) => ({ ...current, imei: event.target.value }))} />
          <input required type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
          <input required min={1} type="number" placeholder="Total phone price" value={form.totalPhonePrice} onChange={(event) => setForm((current) => ({ ...current, totalPhonePrice: event.target.value }))} />
          <input required min={0} type="number" placeholder="Advance payment" value={form.advancePayment} onChange={(event) => setForm((current) => ({ ...current, advancePayment: event.target.value }))} />
          <input required min={1} type="number" placeholder="Monthly installment" value={form.monthlyInstallment} onChange={(event) => setForm((current) => ({ ...current, monthlyInstallment: event.target.value }))} />
          <input required min={1} type="number" placeholder="Total months" value={form.totalMonths} onChange={(event) => setForm((current) => ({ ...current, totalMonths: event.target.value }))} />
          <input required min={1} max={31} type="number" placeholder="Due day of month" value={form.dueDayOfMonth} onChange={(event) => setForm((current) => ({ ...current, dueDayOfMonth: event.target.value }))} />
          <input required min={0} max={30} type="number" placeholder="Grace days" value={form.graceDays} onChange={(event) => setForm((current) => ({ ...current, graceDays: event.target.value }))} />
          <div className="form-grid-full">
            <p className="inline-note">
              Financed amount: {formatCurrency(financedAmount)}. Scheduled installments: {formatCurrency(scheduledAmount)}.
              {!isScheduleCovered ? ' Increase the monthly installment or total months so the plan covers the financed amount.' : ''}
              {serialTooShort ? ' Serial number must be at least 3 characters.' : ''}
              {isScheduleCovered && !serialTooShort ? ` Default enrollment mode: ${form.enrollmentMode}.` : ''}
            </p>
            <div className="button-row">
              <button type="submit" disabled={!isScheduleCovered || serialTooShort}>Create Customer Plan</button>
              <span className="inline-note">{status}</span>
            </div>
            {portalCredentials ? (
              <div className="card" style={{ marginTop: 12 }}>
                <strong>Customer portal credentials</strong>
                <div className="inline-note">Identifier: {portalCredentials.identifier}</div>
                <div className="inline-note">Password: {portalCredentials.password}</div>
              </div>
            ) : null}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>CNIC</th>
              <th>Address</th>
              <th>Active Contracts</th>
              <th>Guarantors</th>
              <th>Devices</th>
              <th>Remaining Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.fullName}</td>
                <td>{row.phone}</td>
                <td>{row.cnic}</td>
                <td>{row.address || '-'}</td>
                <td>{row.activeContractCount}</td>
                <td>{row.guarantorCount}</td>
                <td>{row.deviceCount}</td>
                <td>{formatCurrency(row.remainingBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </LayoutShell>
  );
}
