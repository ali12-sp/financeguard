'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import { formatCurrency, formatDateTime } from '../../components/formatters';
import { getStoredUser } from '../../components/session';
import StatCard from '../../components/stat-card';

interface AuditLog {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  createdAt: string;
}

interface DeviceCommand {
  id: string;
  type: string;
  status: string;
  reason: string;
  deviceId: string;
  createdAt: string;
}

interface NotificationRecord {
  id: string;
  channel: string;
  status: string;
  recipient: string;
  message: string;
  createdAt: string;
}

interface UpcomingInstallment {
  contractId: string;
  customerName: string;
  deviceModel: string;
  dueDate: string;
  amountDue: number;
  sequenceNumber: number;
}

interface DashboardSummary {
  customers: number;
  guarantors: number;
  contracts: number;
  activeContracts: number;
  payments: number;
  devices: number;
  enrolledDevices: number;
  lateAccounts: number;
  restrictedDevices: number;
  outstandingBalance: number;
  pendingCommands: number;
  queuedNotifications: number;
  recentAuditLogs: AuditLog[];
  recentCommands: DeviceCommand[];
  recentNotifications: NotificationRecord[];
  upcomingInstallments: UpcomingInstallment[];
}

interface PlatformWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  customerCount: number;
  deviceCount: number;
  enrolledDeviceCount: number;
  contractCount: number;
  lateAccountCount: number;
  restrictedDeviceCount: number;
  pendingCommandCount: number;
  outstandingBalance: number;
  latestRegistrationAt: string | null;
  latestDeviceSyncAt: string | null;
}

interface PlatformRegistrationRow {
  id: string;
  workspaceName: string;
  workspaceSlug: string;
  customerName: string | null;
  modelName: string | null;
  serial: string | null;
  imei: string | null;
  enrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL' | null;
  createdAt: string;
  message: string;
  template: string;
}

interface PlatformPaymentRow {
  id: string;
  workspaceName: string;
  workspaceSlug: string;
  customerName: string;
  deviceModel: string;
  receivedAmount: number;
  principalApplied: number;
  lateFeeAmount: number;
  receivedAt: string;
  monthCovered: string;
}

interface PlatformAlertRow {
  id: string;
  workspaceName: string;
  workspaceSlug: string;
  message: string;
  template: string;
  recipient: string;
  createdAt: string;
}

interface PlatformSummary {
  workspaces: number;
  activeWorkspaces: number;
  suspendedWorkspaces: number;
  customers: number;
  devices: number;
  enrolledDevices: number;
  contracts: number;
  activeContracts: number;
  lateAccounts: number;
  payments: number;
  restrictedDevices: number;
  outstandingBalance: number;
  pendingCommands: number;
  registrationAlerts: number;
  workspaceHealth: PlatformWorkspaceRow[];
  recentDeviceRegistrations: PlatformRegistrationRow[];
  recentPayments: PlatformPaymentRow[];
  recentAlerts: PlatformAlertRow[];
}

export default function DashboardPage() {
  const [tenantSummary, setTenantSummary] = useState<DashboardSummary | null>(null);
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary | null>(null);
  const [status, setStatus] = useState('');
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);

  async function loadDashboard() {
    const user = getStoredUser();
    const platformOwner = user?.isPlatformOwner === true;
    setIsPlatformOwner(platformOwner);

    if (platformOwner) {
      const data = await apiFetch<PlatformSummary>('/platform/summary');
      setPlatformSummary(data);
      setTenantSummary(null);
      return;
    }

    const data = await apiFetch<DashboardSummary>('/policies/summary');
    setTenantSummary(data);
    setPlatformSummary(null);
  }

  useEffect(() => {
    loadDashboard().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Unable to load dashboard');
    });
  }, []);

  async function runScheduler() {
    setStatus('Running scheduler...');
    try {
      const result = await apiPost<{ remindersQueued: number; autoLocks: number; autoUnlocks: number }>('/policies/recompute');
      setStatus(`Scheduler complete: ${result.remindersQueued} reminder(s), ${result.autoLocks} lock(s), ${result.autoUnlocks} unlock(s).`);
      await loadDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Scheduler failed');
    }
  }

  if (isPlatformOwner && platformSummary) {
    return (
      <LayoutShell>
        <div className="section-head">
          <div>
            <h1>Platform Dashboard</h1>
            <p className="page-copy">Track every shopkeeper workspace, watch phone registrations as they happen, and keep a live view of business activity across the whole platform.</p>
          </div>
          <div>
            <button type="button" onClick={() => loadDashboard().catch(console.error)}>Refresh Activity</button>
            {status ? <div className="status-text" style={{ marginTop: 8 }}>{status}</div> : null}
          </div>
        </div>

        <div className="grid grid-3" style={{ marginTop: 20 }}>
          <StatCard title="Workspaces" value={String(platformSummary.workspaces)} note={`${platformSummary.activeWorkspaces} active and ${platformSummary.suspendedWorkspaces} suspended`} />
          <StatCard title="Customers" value={String(platformSummary.customers)} note="Combined financed customers across all shops" />
          <StatCard title="Devices" value={String(platformSummary.devices)} note={`${platformSummary.enrolledDevices} enrolled phones across the platform`} />
          <StatCard title="Contracts" value={String(platformSummary.contracts)} note={`${platformSummary.activeContracts} active installment contracts`} />
          <StatCard title="Payments" value={String(platformSummary.payments)} note="Recorded payment events across all workspaces" />
          <StatCard title="Outstanding" value={formatCurrency(platformSummary.outstandingBalance)} note={`${platformSummary.lateAccounts} late accounts needing attention`} />
          <StatCard title="Registration Alerts" value={String(platformSummary.registrationAlerts)} note="Internal alerts captured when devices register" />
          <StatCard title="Pending Commands" value={String(platformSummary.pendingCommands)} note="Cross-workspace lock, unlock, sync, or reminder tasks still pending" />
          <StatCard title="Restricted Devices" value={String(platformSummary.restrictedDevices)} note="Phones currently blocked across all workspaces" />
        </div>

        <div className="grid grid-2" style={{ marginTop: 20 }}>
          <div className="card">
            <h2 className="section-title">Recent Phone Registrations</h2>
            <p className="page-copy">Every time a phone completes registration or re-registration, it appears here so the platform owner can verify device activity immediately.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Workspace</th>
                    <th>Device</th>
                    <th>Customer</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {platformSummary.recentDeviceRegistrations.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>
                        <div>{row.workspaceName}</div>
                        <div className="inline-note mono">{row.workspaceSlug}</div>
                      </td>
                      <td>
                        <div>{row.modelName || 'Unknown device'}</div>
                        <div className="inline-note mono">{row.serial || row.imei || '-'}</div>
                      </td>
                      <td>{row.customerName || '-'}</td>
                      <td>{row.enrollmentMode || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Recent Payments</h2>
            <p className="page-copy">This gives you a platform-level money trail so you can spot active shops and verify recorded collections.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Workspace</th>
                    <th>Customer</th>
                    <th>Device</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {platformSummary.recentPayments.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.receivedAt)}</td>
                      <td>
                        <div>{row.workspaceName}</div>
                        <div className="inline-note mono">{row.workspaceSlug}</div>
                      </td>
                      <td>{row.customerName}</td>
                      <td>{row.deviceModel}</td>
                      <td>{formatCurrency(row.receivedAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 20 }}>
          <div className="card">
            <h2 className="section-title">Recent Alerts</h2>
            <p className="page-copy">These internal system alerts include registration events and other platform-visible notifications tied to workspace activity.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Workspace</th>
                    <th>Template</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {platformSummary.recentAlerts.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>
                        <div>{row.workspaceName}</div>
                        <div className="inline-note mono">{row.workspaceSlug}</div>
                      </td>
                      <td><span className="badge info">{row.template}</span></td>
                      <td>{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 className="section-title">Workspace Health</h2>
            <p className="page-copy">This is the at-a-glance owner view for every shopkeeper workspace you create.</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Workspace</th>
                    <th>Status</th>
                    <th>Customers</th>
                    <th>Devices</th>
                    <th>Late / Restricted</th>
                    <th>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {platformSummary.workspaceHealth.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div>{row.name}</div>
                        <div className="inline-note mono">{row.slug}</div>
                      </td>
                      <td>
                        <span className={`badge ${row.status === 'ACTIVE' ? 'active' : 'danger'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>{row.customerCount}</td>
                      <td>{row.deviceCount}</td>
                      <td>{row.lateAccountCount} / {row.restrictedDeviceCount}</td>
                      <td>{formatCurrency(row.outstandingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="section-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-copy">Track financed customers, device enrollment, installment risk, reminders, queued commands, and audit activity from one place.</p>
        </div>
        <div>
          <button type="button" onClick={runScheduler}>Run Scheduler Now</button>
          {status ? <div className="status-text" style={{ marginTop: 8 }}>{status}</div> : null}
        </div>
      </div>

      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <StatCard title="Customers" value={String(tenantSummary?.customers ?? 0)} note="Registered financed customers" />
        <StatCard title="Guarantors" value={String(tenantSummary?.guarantors ?? 0)} note="Linked recovery contacts" />
        <StatCard title="Contracts" value={String(tenantSummary?.contracts ?? 0)} note={`${tenantSummary?.activeContracts ?? 0} currently active`} />
        <StatCard title="Payments" value={String(tenantSummary?.payments ?? 0)} note="Posted installment receipts" />
        <StatCard title="Devices" value={String(tenantSummary?.devices ?? 0)} note={`${tenantSummary?.enrolledDevices ?? 0} enrolled in managed mode`} />
        <StatCard title="Outstanding" value={formatCurrency(tenantSummary?.outstandingBalance ?? 0)} note={`${tenantSummary?.lateAccounts ?? 0} accounts in grace or restricted`} />
        <StatCard title="Pending Commands" value={String(tenantSummary?.pendingCommands ?? 0)} note="Lock, unlock, sync, and reminder tasks waiting on devices" />
        <StatCard title="Queued Notifications" value={String(tenantSummary?.queuedNotifications ?? 0)} note="Messages waiting for provider delivery" />
        <StatCard title="Restricted Devices" value={String(tenantSummary?.restrictedDevices ?? 0)} note="Devices currently blocked for missed payments" />
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Upcoming Installments</h2>
          <p className="page-copy">These are the next customer dues the scheduler will use for reminders and lock checks.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Device</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(tenantSummary?.upcomingInstallments ?? []).map((row) => (
                  <tr key={`${row.contractId}-${row.sequenceNumber}`}>
                    <td>{row.customerName}</td>
                    <td>{row.deviceModel}</td>
                    <td>{row.dueDate}</td>
                    <td>{formatCurrency(row.amountDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Recent Commands</h2>
          <p className="page-copy">Remote actions stay visible here so you can verify what was queued for each device.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {(tenantSummary?.recentCommands ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td><span className={`badge ${row.type.toLowerCase()}`}>{row.type}</span></td>
                    <td><span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span></td>
                    <td className="mono">{row.deviceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section-title">Recent Notifications</h2>
          <p className="page-copy">SMS and FCM delivery attempts are logged here so you can spot missing configuration quickly.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Recipient</th>
                </tr>
              </thead>
              <tbody>
                {(tenantSummary?.recentNotifications ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.channel}</td>
                    <td><span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span></td>
                    <td className="mono">{row.recipient}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Recent Audit Trail</h2>
          <p className="page-copy">Each restriction, release, payment match, and manual override appears here so staff can see what happened and why.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(tenantSummary?.recentAuditLogs ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.actorName}</td>
                    <td><span className={`badge ${row.action.toLowerCase()}`}>{row.action}</span></td>
                    <td className="mono">{row.entityType}:{row.entityId}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
