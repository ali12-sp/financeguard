'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDefaultRouteForRole, setSession } from '../../components/session';
import { getApiUrl } from '../../components/api';

export default function SetupPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch(`${getApiUrl()}/setup/status`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.initialized) {
          router.replace('/login');
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus('');

    const res = await fetch(`${getApiUrl()}/setup/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName,
        organizationSlug: organizationSlug || undefined,
        adminName,
        adminEmail,
        adminPhone: adminPhone || undefined,
        adminPassword
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(data?.message || 'Unable to initialize workspace');
      setLoading(false);
      return;
    }

    setSession(data.token, data.user);
    router.replace(getDefaultRouteForRole(data.user.role));
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="eyebrow">First-Time Setup</div>
        <h1>Launch FinanceGuard</h1>
        <p className="page-copy">
          Create your first tenant, owner account, and workspace slug. After this step the system is ready for real business data instead of demo-style bootstrapping.
        </p>
      </div>
      <div className="card auth-card">
        <h2>Initialize Workspace</h2>
        <form onSubmit={onSubmit} className="grid">
          <input
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            placeholder="Business / organization name"
          />
          <input
            value={organizationSlug}
            onChange={(event) => setOrganizationSlug(event.target.value.toLowerCase())}
            placeholder="Workspace slug (optional)"
          />
          <input
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            placeholder="Owner / admin name"
          />
          <input
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            type="email"
            placeholder="Admin email"
          />
          <input
            value={adminPhone}
            onChange={(event) => setAdminPhone(event.target.value)}
            placeholder="Admin phone (optional)"
          />
          <input
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            type="password"
            placeholder="Admin password"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Creating Workspace...' : 'Create Workspace'}
          </button>
          {status ? <p style={{ color: 'var(--danger)' }}>{status}</p> : null}
        </form>
      </div>
    </div>
  );
}
