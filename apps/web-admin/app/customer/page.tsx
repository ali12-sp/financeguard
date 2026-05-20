'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiDownload, apiFetch, apiPost } from '../../components/api';
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
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [unlockMessage, setUnlockMessage] = useState('');
  const [actionStatus, setActionStatus] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<PortalSummary>('/portal/summary'),
      apiFetch<CustomerPayment[]>('/portal/payments')
    ])
      .then(([portalSummary, portalPayments]) => {
        setSummary(portalSummary);
        setPayments(portalPayments);
        setPaymentAmount(portalSummary.nextPaymentAmount ? String(portalSummary.nextPaymentAmount) : '');
      })
      .catch(console.error);
  }, []);

  async function submitPaymentNotice() {
    if (!summary?.activeContract) {
      setActionStatus('No active contract found.');
      return;
    }

    setActionStatus('Sending payment notice...');
    try {
      await apiPost('/portal/payment-notice', {
        contractId: summary.activeContract.id,
        amount: Number(paymentAmount),
        paymentMethod,
        referenceNumber: referenceNumber || undefined,
        note: paymentNote || undefined
      });
      setReferenceNumber('');
      setPaymentNote('');
      setActionStatus('Payment notice sent for staff review.');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Unable to send payment notice');
    }
  }

  async function requestUnlockReview() {
    if (!summary?.activeContract) {
      setActionStatus('No active contract found.');
      return;
    }

    setActionStatus('Sending unlock review request...');
    try {
      await apiPost('/portal/unlock-request', {
        contractId: summary.activeContract.id,
        message: unlockMessage || undefined
      });
      setUnlockMessage('');
      setActionStatus('Unlock review request sent to staff.');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Unable to request unlock review');
    }
  }

  async function downloadInvoice() {
    if (!summary?.activeContract) return;
    try {
      await apiDownload(`/portal/contracts/${summary.activeContract.id}/invoice.pdf`, `invoice-${summary.activeContract.id}.pdf`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Unable to download invoice');
    }
  }

  async function downloadReceipt(payment: CustomerPayment) {
    try {
      await apiDownload(`/portal/payments/${payment.id}/receipt.pdf`, `receipt-${payment.id}.pdf`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Unable to download receipt');
    }
  }

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
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={downloadInvoice}>
                Download Invoice
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Send Payment Notice</h2>
          <div className="form-grid">
            <input
              type="number"
              min={1}
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              placeholder="Amount paid"
            />
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="EASYPAISA">Easypaisa</option>
              <option value="JAZZCASH">JazzCash</option>
              <option value="CARD">Card</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              placeholder="Reference number"
            />
            <input
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.target.value)}
              placeholder="Note for staff"
            />
            <div className="form-grid-full">
              <button type="button" onClick={submitPaymentNotice}>Send Notice</button>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Unlock Review</h2>
          <div className="stack">
            <textarea
              value={unlockMessage}
              onChange={(event) => setUnlockMessage(event.target.value)}
              placeholder="Message for staff"
            />
            <button type="button" className="success-button" onClick={requestUnlockReview}>
              Request Review
            </button>
          </div>
        </div>
      </div>

      {actionStatus ? <p className="inline-note" style={{ marginTop: 12 }}>{actionStatus}</p> : null}

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
                <th>Receipt</th>
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
                  <td>
                    <button type="button" className="ghost-button" onClick={() => downloadReceipt(payment)}>
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
