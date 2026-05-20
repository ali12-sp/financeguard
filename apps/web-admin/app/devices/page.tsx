'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
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
  manualUnlockUntil?: string;
  manualUnlockReason?: string;
  manualUnlockActive?: boolean;
}

export default function DevicesPage() {
  const [rows, setRows] = useState<Device[]>([]);
  const [status, setStatus] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [provisioning, setProvisioning] = useState<{
    deviceId: string;
    agentSecret: string;
    apiBaseUrl: string;
    adminComponent: string;
    organizationId: string;
    adminExtras: {
      apiBaseUrl: string;
      agentSecret: string;
      deviceId: string;
      organizationId: string;
      organizationName: string;
    };
    adbCommand: string;
    qrNotes: string[];
    agentApkDownloadUrl?: string;
    agentApkChecksum?: string;
    qrPayload?: string;
    qrPayloadPretty?: string;
  } | null>(null);

  useEffect(() => {
    if (!provisioning?.qrPayload) {
      setQrCodeDataUrl('');
      return;
    }

    QRCode.toDataURL(provisioning.qrPayload, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 420
    })
      .then(setQrCodeDataUrl)
      .catch(() => setQrCodeDataUrl(''));
  }, [provisioning?.qrPayload]);

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

  async function requestSync(deviceId: string) {
    setStatus('Queueing sync command...');

    try {
      await apiPost(`/devices/${deviceId}/commands`, {
        type: 'SYNC',
        reason: 'Admin requested device sync from the dashboard.'
      });
      setStatus(`Sync command queued for ${deviceId}.`);
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to queue sync command');
    }
  }

  async function overrideUnlock(row: Device) {
    const reason = window.prompt(
      'Reason for manual unlock override',
      row.restrictionReason || row.manualUnlockReason || 'Customer disputed this lock.'
    );
    if (!reason?.trim()) {
      return;
    }

    setStatus('Applying manual unlock override...');

    try {
      await apiPost(`/devices/${row.id}/manual-unlock`, {
        reason: reason.trim(),
        hours: 24
      });
      setStatus(`Manual unlock override applied to ${row.id} for 24 hours.`);
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to apply manual unlock override');
    }
  }

  async function loadProvisioning(deviceId: string) {
    setStatus('Loading provisioning details...');

    try {
      const details = await apiFetch<{
        deviceId: string;
        agentSecret: string;
        apiBaseUrl: string;
        adminComponent: string;
        organizationId: string;
        adminExtras: {
          apiBaseUrl: string;
          agentSecret: string;
          deviceId: string;
          organizationId: string;
          organizationName: string;
        };
        adbCommand: string;
        qrNotes: string[];
      }>(`/devices/${deviceId}/provisioning`);
      const workspaceSettings = getStoredUser()?.workspaceSettings;
      const agentApkDownloadUrl = workspaceSettings?.agentApkDownloadUrl?.trim() || undefined;
      const agentApkChecksum = workspaceSettings?.agentApkChecksum?.trim() || undefined;
      const qrPayloadData =
        agentApkDownloadUrl && agentApkChecksum
          ? {
              'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': details.adminComponent,
              'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': agentApkDownloadUrl,
              'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM': agentApkChecksum,
              'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': details.adminExtras
            }
          : undefined;
      const qrPayload = qrPayloadData ? JSON.stringify(qrPayloadData) : undefined;
      const qrPayloadPretty = qrPayloadData ? JSON.stringify(qrPayloadData, null, 2) : undefined;

      setProvisioning({
        ...details,
        agentApkDownloadUrl,
        agentApkChecksum,
        qrPayload,
        qrPayloadPretty
      });
      setStatus(`Provisioning details loaded for ${deviceId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load provisioning details');
    }
  }

  async function copyProvisioningJson() {
    if (!provisioning?.qrPayload) {
      return;
    }

    try {
      await navigator.clipboard.writeText(provisioning.qrPayload);
      setStatus('Provisioning JSON copied to clipboard.');
    } catch {
      setStatus('Unable to copy provisioning JSON from this browser.');
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
            <div><strong>Workspace Slug</strong><div className="inline-note mono">{provisioning.organizationId}</div></div>
            <div><strong>ADB Command</strong><div className="inline-note mono">{provisioning.adbCommand}</div></div>
            <div><strong>APK Download URL</strong><div className="inline-note mono">{provisioning.agentApkDownloadUrl || 'Set this in Workspaces once and the QR will auto-generate here.'}</div></div>
            <div><strong>APK Checksum</strong><div className="inline-note mono">{provisioning.agentApkChecksum || 'Missing'}</div></div>
            <div>
              <strong>QR Notes</strong>
              {provisioning.qrNotes.map((note) => (
                <div key={note} className="inline-note">{note}</div>
              ))}
            </div>
            {provisioning.qrPayload && qrCodeDataUrl ? (
              <div className="grid grid-2" style={{ alignItems: 'start', marginTop: 12 }}>
                <div>
                  <strong>Provisioning QR</strong>
                  <div style={{ marginTop: 12 }}>
                    <img
                      src={qrCodeDataUrl}
                      alt={`Provisioning QR for ${provisioning.deviceId}`}
                      style={{ background: '#fff', padding: 12, borderRadius: 18, maxWidth: 320, width: '100%' }}
                    />
                  </div>
                  <div className="button-row" style={{ marginTop: 12 }}>
                    <button type="button" className="ghost-button" onClick={copyProvisioningJson}>
                      Copy JSON
                    </button>
                    {provisioning.agentApkDownloadUrl ? (
                      <a className="ghost-button" href={provisioning.agentApkDownloadUrl} target="_blank" rel="noreferrer">
                        Open APK
                      </a>
                    ) : null}
                  </div>
                </div>
                <div>
                  <strong>Provisioning JSON</strong>
                  <textarea
                    readOnly
                    value={provisioning.qrPayloadPretty ?? provisioning.qrPayload}
                    style={{ minHeight: 280, marginTop: 12 }}
                  />
                </div>
              </div>
            ) : (
              <div className="inline-note" style={{ marginTop: 12 }}>
                Add the agent APK download URL and checksum in Workspace settings once, then this page will generate the QR code automatically for every device.
              </div>
            )}
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
              <th>Override</th>
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
                  {row.manualUnlockUntil ? (
                    <div>
                      <span className={`badge ${row.manualUnlockActive ? 'active' : 'pending'}`}>
                        {row.manualUnlockActive ? 'ACTIVE' : 'EXPIRED'}
                      </span>
                      <div className="inline-note">{new Date(row.manualUnlockUntil).toLocaleString()}</div>
                    </div>
                  ) : '-'}
                </td>
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
                      className="success-button"
                      onClick={() => overrideUnlock(row)}
                    >
                      Override 24h
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => requestSync(row.id)}
                    >
                      Sync
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
