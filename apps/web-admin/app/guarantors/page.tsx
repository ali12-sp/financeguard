'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiDelete, apiFetch, apiPost } from '../../components/api';

interface GuarantorRow {
  id: string;
  fullName: string;
  phone?: string;
  cnic: string;
  relationToCustomer: string;
  customerName: string;
  contractId?: string;
  contractStatus?: string | null;
}

export default function GuarantorsPage() {
  const [rows, setRows] = useState<GuarantorRow[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; fullName: string; contracts: Array<{ id: string }> }>>([]);
  const [form, setForm] = useState({
    customerId: '',
    contractId: '',
    fullName: '',
    phone: '',
    cnic: '',
    relationToCustomer: '',
    address: ''
  });
  const [status, setStatus] = useState('');

  const contractOptions = useMemo(() => {
    return customers.find((customer) => customer.id === form.customerId)?.contracts ?? [];
  }, [customers, form.customerId]);

  async function load() {
    try {
      const [guarantors, customerRows] = await Promise.all([
        apiFetch<GuarantorRow[]>('/guarantors'),
        apiFetch<Array<{ id: string; fullName: string; contracts: Array<{ id: string }> }>>('/customers')
      ]);
      setRows(guarantors);
      setCustomers(customerRows);
      if (!form.customerId && customerRows[0]) {
        setForm((current) => ({ ...current, customerId: customerRows[0].id }));
      }
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (contractOptions.length === 0 && form.contractId) {
      setForm((current) => ({ ...current, contractId: '' }));
    }
  }, [contractOptions, form.contractId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('Saving guarantor...');

    try {
      await apiPost('/guarantors', {
        customerId: form.customerId,
        contractId: form.contractId || undefined,
        fullName: form.fullName,
        phone: form.phone || undefined,
        cnic: form.cnic,
        relationToCustomer: form.relationToCustomer,
        address: form.address || undefined
      });
      setForm((current) => ({
        ...current,
        contractId: '',
        fullName: '',
        phone: '',
        cnic: '',
        relationToCustomer: '',
        address: ''
      }));
      setStatus('Guarantor created.');
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save guarantor');
    }
  }

  async function deleteGuarantor(row: GuarantorRow) {
    if (!window.confirm(`Delete guarantor ${row.fullName}?`)) {
      return;
    }

    setStatus('Deleting guarantor...');

    try {
      const result = await apiDelete<{ message: string }>(`/guarantors/${row.id}`);
      setStatus(result.message);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete guarantor');
    }
  }

  return (
    <LayoutShell>
      <h1>Guarantors</h1>
      <p className="page-copy">Guarantors are the recovery-side references linked to customers and, when applicable, to a specific finance contract.</p>
      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Add Guarantor</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value, contractId: '' }))}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.fullName}</option>
            ))}
          </select>
          <select value={form.contractId} onChange={(event) => setForm((current) => ({ ...current, contractId: event.target.value }))}>
            <option value="">No contract yet</option>
            {contractOptions.map((contract) => (
              <option key={contract.id} value={contract.id}>{contract.id}</option>
            ))}
          </select>
          <input required value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Guarantor name" />
          <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" />
          <input required value={form.cnic} onChange={(event) => setForm((current) => ({ ...current, cnic: event.target.value }))} placeholder="CNIC" />
          <input required value={form.relationToCustomer} onChange={(event) => setForm((current) => ({ ...current, relationToCustomer: event.target.value }))} placeholder="Relation to customer" />
          <input className="form-grid-full" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Address" />
          <div className="form-grid-full button-row">
            <button type="submit">Save Guarantor</button>
            <span className="inline-note">{status}</span>
          </div>
        </form>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Relation</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>CNIC</th>
                <th>Contract</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.fullName}</td>
                  <td>{row.relationToCustomer}</td>
                  <td>{row.customerName}</td>
                  <td>{row.phone || '-'}</td>
                  <td>{row.cnic}</td>
                  <td>{row.contractId ? `${row.contractId} (${row.contractStatus || '-'})` : '-'}</td>
                  <td>
                    <button type="button" className="danger-button" onClick={() => deleteGuarantor(row)}>
                      Delete
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
