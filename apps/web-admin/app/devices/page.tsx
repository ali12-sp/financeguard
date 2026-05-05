'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import { formatCurrency } from '../../components/formatters';
import { getStoredUser } from '../../components/session';

interface Device {
  id: string;
  imei: string;
  serial: string;
  modelName: string;
  enrollmentStatus: 'PENDING' | 'ENROLLED' | 'SUSPENDED';
  customerName: string | null;
  state: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
  policyState: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
  remainingBalance: number;
  restrictionReason?: string;
  pushToken?: string;
}

export default function DevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [status, setStatus] = useState('');
  const [provisioning, setProvisioning] = useState<{
    deviceId: string;
    agentSecret: string;
    apiBaseUrl: string;
    adbCommand: string;
    qrNotes: string[];
  } | null>(null);

  async function loadDevices() {
    apiFetch<Device[]>('/devices')
      .then(setRows)
      .catch(console.error);
  }

  useEffect(() => {
    loadDevices();
  }, []);

  async function changeState(deviceId: string, state: Device['state']) {
    const lockMessageTemplate =
      getStoredUser()?.workspaceSettings?.defaultLockMessage ??
      'Payment overdue. Contact the installment office to unlock this phone.';
    setStatus(`${state === 'RESTRICTED' ? 'Locking' : 'Unlocking'} device...`);

    try {
      const updated = await apiPost<Device & {
        latestCommand?: {
          status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED';
        };
      }>(`/devices/${deviceId}/state`, {
        state,
        reason:
          state === 'RESTRICTED'
            ? 'Admin manually locked the device from the dashboard.'
            : 'Admin restored access from the dashboard.',
        lockMessage:
          state === 'RESTRICTED'
            ? lockMessageTemplate
            : undefined
      });
      const deliveryNote =
        updated.pushToken
          ? updated.latestCommand?.status === 'SENT'
            ? `${state === 'RESTRICTED' ? ' Lock' : ' Unlock'} command sent to the device.`
            : ' Device state updated, but push delivery is still pending.'
          : ' Device has no Firebase push token yet, so the command will apply on the next device sync.';

      setStatus(`Device ${deviceId} updated.${deliveryNote}`);
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Device action failed');
    }
  }

  async function loadProvisioning(deviceId: string) {
    setStatus('Loading provisioning details...');

    try {
      const details = await apiFetch<{
        deviceId: string;
        agentSecret: string;
        apiBaseUrl: string;
        adbCommand: string;
        qrNotes: string[];
      }>(`/devices/${deviceId}/provisioning`);
      setProvisioning(details);
      setStatus(`Provisioning details loaded for ${deviceId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load provisioning details');
    }
  }

  return (
    <LayoutShell>
      <h1>Devices</h1>
      <p className="page-copy">Managed devices show who they belong to, whether they are enrolled correctly, what restriction state they are in, and how much contract balance is still attached.</p>
      {status ? <p className="inline-note" style={{ marginTop: 12 }}>{status}</p> : null}
      {provisioning ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="section-title">Provisioning Details</h2>
          <div className="stack">
            <div><strong>Device ID</strong><div className="inline-note mono">{provisioning.deviceId}</div></div>
            <div><strong>Agent Secret</strong><div className="inline-note mono">{provisioning.agentSecret}</div></div>
            <div><strong>API Base URL</strong><div className="inline-note mono">{provisioning.apiBaseUrl}</div></div>
            <div><strong>ADB Command</strong><div className="inline-note mono">{provisioning.adbCommand}</div></div>
            <div>
              <strong>QR Notes</strong>
              {provisioning.qrNotes.map((note) => (
                <div key={note} className="inline-note">{note}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>IMEI / Serial</th>
              <th>Customer</th>
              <th>Enrollment</th>
              <th>Device ID</th>
              <th>Live State</th>
              <th>Policy State</th>
              <th>Delivery</th>
              <th>Balance</th>
              <th>Reason</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.modelName}</td>
                <td className="mono">{row.imei}<br />{row.serial}</td>
                <td>{row.customerName || '-'}</td>
                <td><span className={`badge ${row.enrollmentStatus.toLowerCase()}`}>{row.enrollmentStatus}</span></td>
                <td className="mono">{row.id}</td>
                <td>
                  <span className={`badge ${row.state.toLowerCase()}`}>{row.state}</span>
                </td>
                <td>
                  <span className={`badge ${row.policyState.toLowerCase()}`}>{row.policyState}</span>
                </td>
                <td>{row.pushToken ? 'Push ready' : 'Polling only'}</td>
                <td>{formatCurrency(row.remainingBalance)}</td>
                <td>{row.restrictionReason || '-'}</td>
                <td>
                  <div className="button-row">
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => changeState(row.id, 'RESTRICTED')}
                    >
                      Lock
                    </button>
                    <button
                      type="button"
                      className="success-button"
                      onClick={() => changeState(row.id, 'ACTIVE')}
                    >
                      Unlock
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => loadProvisioning(row.id)}
                    >
                      Provisioning
                    </button>
                  </div>
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
