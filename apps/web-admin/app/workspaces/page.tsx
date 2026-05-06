'use client';

import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPatch, apiPost } from '../../components/api';
import { formatCurrency, formatDateTime } from '../../components/formatters';
import StatCard from '../../components/stat-card';
import { getStoredUser } from '../../components/session';

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  contactEmail?: string;
  contactPhone?: string;
  createdAt: string;
  settings: {
    defaultDueDayOfMonth: number;
    defaultGraceDays: number;
    defaultEnrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
    defaultLockMessage: string;
    notifyOnDeviceRegistration: boolean;
    supportEmail?: string;
    supportPhone?: string;
    supportWhatsapp?: string;
    agentApkDownloadUrl?: string;
    agentApkChecksum?: string;
    frpGoogleAccounts?: string[];
  };
  adminCount: number;
  staffCount: number;
  customerCount: number;
  deviceCount: number;
  enrolledDeviceCount: number;
  contractCount: number;
  activeContractCount: number;
  lateAccountCount: number;
  paymentCount: number;
  notificationCount: number;
  failedNotificationCount: number;
  restrictedDeviceCount: number;
  pendingCommandCount: number;
  outstandingBalance: number;
  latestRegistrationAt: string | null;
  latestAlertAt: string | null;
  latestDeviceSyncAt: string | null;
  primaryAdmin: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  } | null;
}

interface WorkspaceFormState {
  organizationName: string;
  organizationSlug: string;
  contactEmail: string;
  contactPhone: string;
  defaultDueDayOfMonth: string;
  defaultGraceDays: string;
  defaultEnrollmentMode: 'ADB' | 'QR' | 'ZERO_TOUCH' | 'MANUAL';
  defaultLockMessage: string;
  notifyOnDeviceRegistration: 'true' | 'false';
  supportEmail: string;
  supportPhone: string;
  supportWhatsapp: string;
  agentApkDownloadUrl: string;
  agentApkChecksum: string;
  frpGoogleAccountsText: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  adminPassword: string;
}

const emptyForm: WorkspaceFormState = {
  organizationName: '',
  organizationSlug: '',
  contactEmail: '',
  contactPhone: '',
  defaultDueDayOfMonth: '10',
  defaultGraceDays: '3',
  defaultEnrollmentMode: 'QR',
  defaultLockMessage: 'Payment overdue. Contact the installment office to unlock this phone.',
  notifyOnDeviceRegistration: 'true',
  supportEmail: '',
  supportPhone: '',
  supportWhatsapp: '',
  agentApkDownloadUrl: '',
  agentApkChecksum: '',
  frpGoogleAccountsText: '',
  adminName: '',
  adminEmail: '',
  adminPhone: '',
  adminPassword: ''
};

function parseFrpGoogleAccounts(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function toEditorForm(row: WorkspaceRow): WorkspaceFormState {
  return {
    organizationName: row.name,
    organizationSlug: row.slug,
    contactEmail: row.contactEmail || '',
    contactPhone: row.contactPhone || '',
    defaultDueDayOfMonth: String(row.settings.defaultDueDayOfMonth),
    defaultGraceDays: String(row.settings.defaultGraceDays),
    defaultEnrollmentMode: row.settings.defaultEnrollmentMode,
    defaultLockMessage: row.settings.defaultLockMessage,
    notifyOnDeviceRegistration: row.settings.notifyOnDeviceRegistration ? 'true' : 'false',
    supportEmail: row.settings.supportEmail || '',
    supportPhone: row.settings.supportPhone || '',
    supportWhatsapp: row.settings.supportWhatsapp || '',
    agentApkDownloadUrl: row.settings.agentApkDownloadUrl || '',
    agentApkChecksum: row.settings.agentApkChecksum || '',
    frpGoogleAccountsText: (row.settings.frpGoogleAccounts ?? []).join('\n'),
    adminName: row.primaryAdmin?.name || '',
    adminEmail: row.primaryAdmin?.email || '',
    adminPhone: row.primaryAdmin?.phone || '',
    adminPassword: ''
  };
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<WorkspaceFormState>(emptyForm);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [editorForm, setEditorForm] = useState<WorkspaceFormState | null>(null);

  const summary = useMemo(() => ({
    total: rows.length,
    active: rows.filter((item) => item.status === 'ACTIVE').length,
    suspended: rows.filter((item) => item.status === 'SUSPENDED').length,
    customers: rows.reduce((sum, item) => sum + item.customerCount, 0),
    devices: rows.reduce((sum, item) => sum + item.deviceCount, 0),
    restricted: rows.reduce((sum, item) => sum + item.restrictedDeviceCount, 0),
    failedAlerts: rows.reduce((sum, item) => sum + item.failedNotificationCount, 0)
  }), [rows]);

  const selectedWorkspace = rows.find((item) => item.id === selectedWorkspaceId) ?? null;

  async function loadWorkspaces(preferredWorkspaceId?: string | null) {
    const data = await apiFetch<WorkspaceRow[]>('/platform/workspaces');
    setRows(data);

    const targetId = preferredWorkspaceId ?? selectedWorkspaceId;
    if (!targetId) {
      return;
    }

    const nextSelected = data.find((item) => item.id === targetId) ?? null;
    setSelectedWorkspaceId(nextSelected?.id ?? null);
    setEditorForm(nextSelected ? toEditorForm(nextSelected) : null);
  }

  useEffect(() => {
    const user = getStoredUser();
    if (!user || !user.isPlatformOwner) {
      router.replace('/dashboard');
      return;
    }

    loadWorkspaces().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Unable to load workspaces');
    });
  }, [router]);

  function updateForm(
    stateSetter: Dispatch<SetStateAction<WorkspaceFormState>>,
    field: keyof WorkspaceFormState,
    value: string
  ) {
    stateSetter((current) => ({ ...current, [field]: value }));
  }

  function updateEditorForm(field: keyof WorkspaceFormState, value: string) {
    setEditorForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus('Creating workspace...');

    try {
      const created = await apiPost<WorkspaceRow>('/platform/workspaces', {
        organizationName: form.organizationName,
        organizationSlug: form.organizationSlug || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPhone: form.adminPhone || undefined,
        adminPassword: form.adminPassword,
        settings: {
          defaultDueDayOfMonth: Number(form.defaultDueDayOfMonth),
          defaultGraceDays: Number(form.defaultGraceDays),
          defaultEnrollmentMode: form.defaultEnrollmentMode,
          defaultLockMessage: form.defaultLockMessage,
          notifyOnDeviceRegistration: form.notifyOnDeviceRegistration === 'true',
          supportEmail: form.supportEmail || undefined,
          supportPhone: form.supportPhone || undefined,
          supportWhatsapp: form.supportWhatsapp || undefined,
          agentApkDownloadUrl: form.agentApkDownloadUrl || undefined,
          agentApkChecksum: form.agentApkChecksum || undefined,
          frpGoogleAccounts: parseFrpGoogleAccounts(form.frpGoogleAccountsText)
        }
      });
      setForm(emptyForm);
      setStatus('Workspace created successfully.');
      await loadWorkspaces(created.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create workspace');
    } finally {
      setLoading(false);
    }
  }

  function selectWorkspace(row: WorkspaceRow) {
    setSelectedWorkspaceId(row.id);
    setEditorForm(toEditorForm(row));
    setStatus(`Editing ${row.name}.`);
  }

  async function handleSaveWorkspace() {
    if (!selectedWorkspace || !editorForm) {
      return;
    }

    setLoading(true);
    setStatus(`Saving ${selectedWorkspace.name}...`);

    try {
      await apiPatch<WorkspaceRow>(`/platform/workspaces/${selectedWorkspace.id}`, {
        organizationName: editorForm.organizationName,
        contactEmail: editorForm.contactEmail || '',
        contactPhone: editorForm.contactPhone || '',
        settings: {
          defaultDueDayOfMonth: Number(editorForm.defaultDueDayOfMonth),
          defaultGraceDays: Number(editorForm.defaultGraceDays),
          defaultEnrollmentMode: editorForm.defaultEnrollmentMode,
          defaultLockMessage: editorForm.defaultLockMessage,
          notifyOnDeviceRegistration: editorForm.notifyOnDeviceRegistration === 'true',
          supportEmail: editorForm.supportEmail || '',
          supportPhone: editorForm.supportPhone || '',
          supportWhatsapp: editorForm.supportWhatsapp || '',
          agentApkDownloadUrl: editorForm.agentApkDownloadUrl || '',
          agentApkChecksum: editorForm.agentApkChecksum || '',
          frpGoogleAccounts: parseFrpGoogleAccounts(editorForm.frpGoogleAccountsText)
        }
      });
      setStatus(`${editorForm.organizationName} updated successfully.`);
      await loadWorkspaces(selectedWorkspace.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update workspace');
    } finally {
      setLoading(false);
    }
  }

  async function toggleWorkspaceStatus(row: WorkspaceRow) {
    const nextStatus = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setStatus(`${nextStatus === 'ACTIVE' ? 'Reactivating' : 'Suspending'} ${row.name}...`);

    try {
      await apiPatch<WorkspaceRow>(`/platform/workspaces/${row.id}`, { status: nextStatus });
      setStatus(`${row.name} is now ${nextStatus}.`);
      await loadWorkspaces(row.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to update workspace');
    }
  }

  async function sendTestAlert() {
    if (!selectedWorkspace) {
      return;
    }

    setLoading(true);
    setStatus(`Sending a test alert for ${selectedWorkspace.name}...`);

    try {
      const result = await apiPost<{
        ok: boolean;
        deliveries: Array<{
          channel: string;
          status: string;
          recipient: string;
          providerResponse?: string;
        }>;
      }>(`/platform/workspaces/${selectedWorkspace.id}/test-registration-alert`);
      setStatus(
        result.deliveries.length > 0
          ? `Test alert sent. ${result.deliveries.length} delivery attempt(s) were recorded.`
          : 'No external recipients are configured for this workspace yet.'
      );
      await loadWorkspaces(selectedWorkspace.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to send test alert');
    } finally {
      setLoading(false);
    }
  }

  return (
    <LayoutShell>
      <div className="section-head">
        <div>
          <h1>Workspaces</h1>
          <p className="page-copy">
            Create every shopkeeper workspace from one deployment, keep the default setup consistent, and verify alerts before handing over access.
          </p>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 20 }}>
        <StatCard title="Workspaces" value={String(summary.total)} note={`${summary.active} active and ${summary.suspended} suspended`} />
        <StatCard title="Customers" value={String(summary.customers)} note="Combined customer records across all workspaces" />
        <StatCard title="Devices" value={String(summary.devices)} note={`${summary.restricted} devices currently restricted`} />
        <StatCard title="Failed Alerts" value={String(summary.failedAlerts)} note="Notification attempts that need follow-up" />
      </div>

      <div className="grid grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h2 className="section-title">Create Workspace</h2>
          <p className="page-copy">Each workspace gets its own tenant boundary, default policy setup, alert contacts, and first admin.</p>
          <form className="grid" onSubmit={handleCreateWorkspace}>
            <input
              value={form.organizationName}
              onChange={(event) => updateForm(setForm, 'organizationName', event.target.value)}
              placeholder="Workspace name"
              required
            />
            <input
              value={form.organizationSlug}
              onChange={(event) => updateForm(setForm, 'organizationSlug', event.target.value.toLowerCase())}
              placeholder="Workspace slug (optional)"
            />
            <input
              value={form.contactEmail}
              onChange={(event) => updateForm(setForm, 'contactEmail', event.target.value)}
              placeholder="Workspace contact email"
              type="email"
            />
            <input
              value={form.contactPhone}
              onChange={(event) => updateForm(setForm, 'contactPhone', event.target.value)}
              placeholder="Workspace contact phone"
            />
            <input
              value={form.defaultDueDayOfMonth}
              onChange={(event) => updateForm(setForm, 'defaultDueDayOfMonth', event.target.value)}
              placeholder="Default due day"
              type="number"
              min={1}
              max={31}
              required
            />
            <input
              value={form.defaultGraceDays}
              onChange={(event) => updateForm(setForm, 'defaultGraceDays', event.target.value)}
              placeholder="Default grace days"
              type="number"
              min={0}
              max={30}
              required
            />
            <select
              value={form.defaultEnrollmentMode}
              onChange={(event) => updateForm(setForm, 'defaultEnrollmentMode', event.target.value)}
            >
              <option value="QR">QR Enrollment</option>
              <option value="ADB">ADB Enrollment</option>
              <option value="ZERO_TOUCH">Zero-Touch</option>
              <option value="MANUAL">Manual</option>
            </select>
            <select
              value={form.notifyOnDeviceRegistration}
              onChange={(event) => updateForm(setForm, 'notifyOnDeviceRegistration', event.target.value)}
            >
              <option value="true">Registration alerts enabled</option>
              <option value="false">Registration alerts disabled</option>
            </select>
            <input
              value={form.supportEmail}
              onChange={(event) => updateForm(setForm, 'supportEmail', event.target.value)}
              placeholder="Alert email recipient"
              type="email"
            />
            <input
              value={form.supportPhone}
              onChange={(event) => updateForm(setForm, 'supportPhone', event.target.value)}
              placeholder="Alert SMS recipient"
            />
            <input
              value={form.supportWhatsapp}
              onChange={(event) => updateForm(setForm, 'supportWhatsapp', event.target.value)}
              placeholder="Alert WhatsApp recipient"
            />
            <input
              value={form.agentApkDownloadUrl}
              onChange={(event) => updateForm(setForm, 'agentApkDownloadUrl', event.target.value)}
              placeholder="Agent APK download URL"
              type="url"
            />
            <input
              value={form.agentApkChecksum}
              onChange={(event) => updateForm(setForm, 'agentApkChecksum', event.target.value)}
              placeholder="Agent APK SHA-256 checksum"
            />
            <textarea
              value={form.frpGoogleAccountsText}
              onChange={(event) => updateForm(setForm, 'frpGoogleAccountsText', event.target.value)}
              placeholder="FRP Google accounts (one email per line)"
            />
            <input
              value={form.defaultLockMessage}
              onChange={(event) => updateForm(setForm, 'defaultLockMessage', event.target.value)}
              placeholder="Default lock message"
              required
            />
            <input
              value={form.adminName}
              onChange={(event) => updateForm(setForm, 'adminName', event.target.value)}
              placeholder="First admin full name"
              required
            />
            <input
              value={form.adminEmail}
              onChange={(event) => updateForm(setForm, 'adminEmail', event.target.value)}
              placeholder="First admin email"
              type="email"
              required
            />
            <input
              value={form.adminPhone}
              onChange={(event) => updateForm(setForm, 'adminPhone', event.target.value)}
              placeholder="First admin phone"
            />
            <input
              value={form.adminPassword}
              onChange={(event) => updateForm(setForm, 'adminPassword', event.target.value)}
              placeholder="Temporary admin password"
              type="password"
              minLength={8}
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Creating Workspace...' : 'Create Workspace'}
            </button>
          </form>
          {status ? <p className="inline-note" style={{ marginTop: 12 }}>{status}</p> : null}
        </div>

        <div className="card">
          <h2 className="section-title">Workspace Editor</h2>
          {selectedWorkspace && editorForm ? (
            <div className="grid">
              <input
                value={editorForm.organizationName}
                onChange={(event) => updateEditorForm('organizationName', event.target.value)}
                placeholder="Workspace name"
              />
              <input value={editorForm.organizationSlug} disabled placeholder="Workspace slug" />
              <input
                value={editorForm.contactEmail}
                onChange={(event) => updateEditorForm('contactEmail', event.target.value)}
                placeholder="Workspace contact email"
                type="email"
              />
              <input
                value={editorForm.contactPhone}
                onChange={(event) => updateEditorForm('contactPhone', event.target.value)}
                placeholder="Workspace contact phone"
              />
              <input
                value={editorForm.defaultDueDayOfMonth}
                onChange={(event) => updateEditorForm('defaultDueDayOfMonth', event.target.value)}
                placeholder="Default due day"
                type="number"
                min={1}
                max={31}
              />
              <input
                value={editorForm.defaultGraceDays}
                onChange={(event) => updateEditorForm('defaultGraceDays', event.target.value)}
                placeholder="Default grace days"
                type="number"
                min={0}
                max={30}
              />
              <select
                value={editorForm.defaultEnrollmentMode}
                onChange={(event) => updateEditorForm('defaultEnrollmentMode', event.target.value)}
              >
                <option value="QR">QR Enrollment</option>
                <option value="ADB">ADB Enrollment</option>
                <option value="ZERO_TOUCH">Zero-Touch</option>
                <option value="MANUAL">Manual</option>
              </select>
              <select
                value={editorForm.notifyOnDeviceRegistration}
                onChange={(event) => updateEditorForm('notifyOnDeviceRegistration', event.target.value)}
              >
                <option value="true">Registration alerts enabled</option>
                <option value="false">Registration alerts disabled</option>
              </select>
              <input
                value={editorForm.supportEmail}
                onChange={(event) => updateEditorForm('supportEmail', event.target.value)}
                placeholder="Alert email recipient"
                type="email"
              />
              <input
                value={editorForm.supportPhone}
                onChange={(event) => updateEditorForm('supportPhone', event.target.value)}
                placeholder="Alert SMS recipient"
              />
              <input
                value={editorForm.supportWhatsapp}
                onChange={(event) => updateEditorForm('supportWhatsapp', event.target.value)}
                placeholder="Alert WhatsApp recipient"
              />
              <input
                value={editorForm.agentApkDownloadUrl}
                onChange={(event) => updateEditorForm('agentApkDownloadUrl', event.target.value)}
                placeholder="Agent APK download URL"
                type="url"
              />
              <input
                value={editorForm.agentApkChecksum}
                onChange={(event) => updateEditorForm('agentApkChecksum', event.target.value)}
                placeholder="Agent APK SHA-256 checksum"
              />
              <textarea
                value={editorForm.frpGoogleAccountsText}
                onChange={(event) => updateEditorForm('frpGoogleAccountsText', event.target.value)}
                placeholder="FRP Google accounts (one email per line)"
              />
              <textarea
                value={editorForm.defaultLockMessage}
                onChange={(event) => updateEditorForm('defaultLockMessage', event.target.value)}
                placeholder="Default lock message"
              />
              <div className="button-row">
                <button type="button" onClick={handleSaveWorkspace} disabled={loading}>
                  Save Workspace
                </button>
                <button type="button" className="ghost-button" onClick={sendTestAlert} disabled={loading}>
                  Send Test Alert
                </button>
                <button
                  type="button"
                  className={selectedWorkspace.status === 'ACTIVE' ? 'danger-button' : 'success-button'}
                  onClick={() => toggleWorkspaceStatus(selectedWorkspace)}
                >
                  {selectedWorkspace.status === 'ACTIVE' ? 'Suspend Workspace' : 'Reactivate Workspace'}
                </button>
              </div>
              <div className="inline-note">
                Latest registration: {formatDateTime(selectedWorkspace.latestRegistrationAt)} | Latest alert: {formatDateTime(selectedWorkspace.latestAlertAt)} | Latest sync: {formatDateTime(selectedWorkspace.latestDeviceSyncAt)}
              </div>
            </div>
          ) : (
            <div className="inline-note">Select a workspace from the directory below to edit its defaults and alert routing.</div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title">Workspace Directory</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Primary Admin</th>
                <th>Status</th>
                <th>Counts</th>
                <th>Alerts</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="inline-note mono">{row.slug}</div>
                    <div className="inline-note">{row.contactEmail || row.contactPhone || 'No workspace contact saved'}</div>
                    <div className="inline-note">
                      Due day {row.settings.defaultDueDayOfMonth} | Grace {row.settings.defaultGraceDays} | {row.settings.defaultEnrollmentMode}
                    </div>
                  </td>
                  <td>
                    {row.primaryAdmin ? (
                      <>
                        <div>{row.primaryAdmin.name}</div>
                        <div className="inline-note">{row.primaryAdmin.email}</div>
                        <div className="inline-note">{row.primaryAdmin.phone || 'No phone on file'}</div>
                      </>
                    ) : (
                      <span className="inline-note">No admin assigned</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${row.status === 'ACTIVE' ? 'active' : 'danger'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>
                    <div>{row.customerCount} customers</div>
                    <div className="inline-note">{row.deviceCount} devices | {row.enrolledDeviceCount} enrolled</div>
                    <div className="inline-note">{row.contractCount} contracts | {row.lateAccountCount} late</div>
                    <div className="inline-note">Balance {formatCurrency(row.outstandingBalance)} | {row.pendingCommandCount} pending commands</div>
                  </td>
                  <td>
                    <div>{row.notificationCount} alerts</div>
                    <div className="inline-note">{row.failedNotificationCount} failed | {row.settings.notifyOnDeviceRegistration ? 'Auto-registration alerts on' : 'Registration alerts off'}</div>
                    <div className="inline-note">{formatDateTime(row.latestAlertAt)}</div>
                  </td>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>
                    <div className="button-row">
                      <button type="button" className="ghost-button" onClick={() => selectWorkspace(row)}>
                        Configure
                      </button>
                      <button
                        type="button"
                        className={row.status === 'ACTIVE' ? 'danger-button' : 'success-button'}
                        onClick={() => toggleWorkspaceStatus(row)}
                      >
                        {row.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
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
