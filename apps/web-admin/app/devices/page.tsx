'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import LayoutShell from '../../components/layout-shell';
import { apiDelete, apiFetch, apiPost } from '../../components/api';
import { formatCurrency, formatDateTime } from '../../components/formatters';
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
  scheduledPolicyState?: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
  remainingBalance: number;
  restrictionReason?: string;
  pushToken?: string;
  manualUnlockUntil?: string;
  manualUnlockReason?: string;
  manualUnlockActive?: boolean;
  adminUnlocked?: boolean;
  pendingDeletion?: boolean;
  lastSyncAt?: string;
  lastSeenAt?: string;
  lastSeenReason?: string;
  imeiDetected?: string;
  serialDetected?: string;
  identifierStatus?: 'MATCHED' | 'MISMATCHED' | 'REPORTED' | 'UNAVAILABLE';
  lastLocationLat?: number;
  lastLocationLng?: number;
  lastLocationAccuracyMeters?: number;
  lastLocationProvider?: string;
  lastLocationAt?: string;
  locationRequestPending?: boolean;
  locationRequestReason?: string;
  trackingEnabled?: boolean;
  lostModeEnabled?: boolean;
  lostModeMessage?: string;
  batteryLevel?: number;
  batteryCharging?: boolean;
  networkStatus?: string;
}

function mapsUrl(row: Device) {
  if (typeof row.lastLocationLat !== 'number' || typeof row.lastLocationLng !== 'number') {
    return undefined;
  }

  return `https://www.google.com/maps/search/?api=1&query=${row.lastLocationLat},${row.lastLocationLng}`;
}

function identifierBadgeClass(status?: Device['identifierStatus']) {
  if (status === 'MATCHED') return 'active';
  if (status === 'MISMATCHED') return 'restricted';
  if (status === 'REPORTED') return 'info';
  return 'pending';
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
    qrMissingRequirements?: string[];
    qrExpiresAt?: string | null;
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

  async function requestLocation(row: Device) {
    setStatus(`Requesting recovery location for ${row.id}...`);

    try {
      await apiPost(`/devices/${row.id}/request-location`, {
        reason: 'Admin requested recovery location from the dashboard.'
      });
      setStatus(row.pushToken ? 'Location request sent.' : 'Location request queued. The phone will report when it syncs.');
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to request location');
    }
  }

  async function setLostMode(row: Device, enabled: boolean) {
    const defaultMessage = row.lostModeMessage || 'This managed phone has been marked lost. Please contact the seller or office.';
    const message = enabled
      ? window.prompt('Lost mode message shown on the phone', defaultMessage)
      : undefined;
    if (enabled && !message?.trim()) {
      return;
    }

    setStatus(`${enabled ? 'Enabling' : 'Disabling'} lost mode for ${row.id}...`);

    try {
      await apiPost(`/devices/${row.id}/lost-mode`, {
        enabled,
        message: message?.trim()
      });
      setStatus(enabled ? 'Lost mode enabled and location requested.' : 'Lost mode disabled.');
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update lost mode');
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

  async function releaseControl(row: Device) {
    if (!window.confirm(`Release managed control from ${row.modelName} (${row.id})?`)) {
      return;
    }

    setStatus('Queueing release-control command...');

    try {
      await apiPost(`/devices/${row.id}/release-control`, {
        reason: 'Admin released managed control from the dashboard.'
      });
      setStatus(row.pushToken ? 'Release-control command sent.' : 'Release-control command queued. The phone will apply it on next sync.');
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to release device control');
    }
  }

  async function deleteDevice(row: Device) {
    if (!window.confirm(`Delete ${row.modelName} (${row.id})? Registered phones will be released from managed control before the record is removed.`)) {
      return;
    }

    setStatus('Deleting device...');

    try {
      const result = await apiDelete<{ message: string; releaseQueued: boolean }>(`/devices/${row.id}`);
      setStatus(result.message);
      loadDevices();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete device');
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
        agentApkDownloadUrl?: string;
        agentApkChecksum?: string;
        qrMissingRequirements?: string[];
        qrExpiresAt?: string | null;
        qrPayload?: string;
        qrPayloadPretty?: string;
      }>(`/devices/${deviceId}/provisioning`);

      setProvisioning({
        ...details
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
            <div><strong>QR Expiry</strong><div className="inline-note">{provisioning.qrExpiresAt ? new Date(provisioning.qrExpiresAt).toLocaleString() : 'No built-in expiry'}</div></div>
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
                Add {provisioning.qrMissingRequirements?.join(' and ') || 'the agent APK download URL and checksum'} in Workspace settings once, then this page will generate the QR code automatically for every device.
              </div>
            )}
          </div>
        </div>
      ) : null}
      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Recovery Ready</h2>
          <div className="topbar-title">{rows.filter((row) => row.trackingEnabled).length}</div>
          <div className="inline-note">Devices with tracking/recovery enabled</div>
        </div>
        <div className="card">
          <h2 className="section-title">Lost Mode</h2>
          <div className="topbar-title">{rows.filter((row) => row.lostModeEnabled).length}</div>
          <div className="inline-note">Phones currently marked lost or stolen</div>
        </div>
        <div className="card">
          <h2 className="section-title">Located</h2>
          <div className="topbar-title">{rows.filter((row) => typeof row.lastLocationLat === 'number').length}</div>
          <div className="inline-note">Devices with at least one GPS/network fix</div>
        </div>
      </div>
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
              <th>Recovery</th>
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
                  {row.scheduledPolicyState && row.scheduledPolicyState !== row.policyState ? (
                    <div className="inline-note">Schedule: {row.scheduledPolicyState}</div>
                  ) : null}
                </td>
                <td>{row.pendingDeletion ? 'Release pending' : row.pushToken ? 'Push ready' : 'Polling only'}</td>
                <td>
                  <div>
                    {row.lostModeEnabled ? (
                      <span className="badge restricted">LOST MODE</span>
                    ) : row.trackingEnabled ? (
                      <span className="badge active">TRACKING</span>
                    ) : (
                      <span className="badge pending">IDLE</span>
                    )}
                    {row.locationRequestPending ? <span className="badge queued" style={{ marginLeft: 6 }}>LOCATING</span> : null}
                  </div>
                  <div className="inline-note">Seen: {formatDateTime(row.lastSeenAt ?? row.lastSyncAt)}</div>
                  {mapsUrl(row) ? (
                    <a className="inline-note" href={mapsUrl(row)} target="_blank" rel="noreferrer">
                      Map: {row.lastLocationLat?.toFixed(5)}, {row.lastLocationLng?.toFixed(5)}
                    </a>
                  ) : (
                    <div className="inline-note">Map: waiting for location</div>
                  )}
                  {row.lastLocationAt ? (
                    <div className="inline-note">
                      {formatDateTime(row.lastLocationAt)} | {row.lastLocationAccuracyMeters ? `${Math.round(row.lastLocationAccuracyMeters)}m` : 'accuracy n/a'}
                    </div>
                  ) : null}
                  <div className="inline-note">
                    IMEI: {row.imeiDetected || row.imei || '-'} <span className={`badge ${identifierBadgeClass(row.identifierStatus)}`}>{row.identifierStatus || 'UNAVAILABLE'}</span>
                  </div>
                  <div className="inline-note">
                    Battery: {typeof row.batteryLevel === 'number' ? `${row.batteryLevel}%${row.batteryCharging ? ' charging' : ''}` : '-'} | {row.networkStatus || 'network n/a'}
                  </div>
                </td>
                <td>{formatCurrency(row.remainingBalance)}</td>
                <td>{row.restrictionReason || '-'}</td>
                <td>
                  {row.pendingDeletion ? (
                    <span className="badge pending">DELETE PENDING</span>
                  ) : row.adminUnlocked ? (
                    <span className="badge active">ADMIN ACTIVE</span>
                  ) : row.manualUnlockUntil ? (
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
                      onClick={() => requestLocation(row)}
                    >
                      Locate
                    </button>
                    {row.lostModeEnabled ? (
                      <button
                        type="button"
                        className="success-button"
                        onClick={() => setLostMode(row, false)}
                      >
                        Clear Lost
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => setLostMode(row, true)}
                      >
                        Lost Mode
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => releaseControl(row)}
                    >
                      Release Control
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => deleteDevice(row)}
                      disabled={row.pendingDeletion}
                    >
                      {row.pendingDeletion ? 'Pending' : 'Delete'}
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
