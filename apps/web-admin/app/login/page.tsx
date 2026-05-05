'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDefaultRouteForRole, setSession } from '../../components/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function LoginPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupReady, setSetupReady] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/setup/status`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setSetupReady(Boolean(data.initialized));
        if (!data.initialized) {
          router.replace('/setup');
          return;
        }

        if (data.defaultWorkspace && !workspace) {
          setWorkspace(data.defaultWorkspace);
        }
      })
      .catch(() => {
        setSetupReady(true);
      })
      .finally(() => {
        setSetupChecked(true);
      });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, identifier, password })
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.message || 'Login failed');
      setLoading(false);
      return;
    }

    setSession(data.token, data.user);
    router.push(getDefaultRouteForRole(data.user.role));
  }

  if (!setupChecked) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h2>Preparing Workspace</h2>
          <p className="inline-note">Checking whether the system has been initialized...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="eyebrow">Managed Finance App</div>
        <h1>FinanceGuard</h1>
        <p className="page-copy">
          Sign in to your workspace to manage customers, contracts, payments, devices, and customer self-service.
        </p>
        {!setupReady ? (
          <div className="card">
            <strong>Workspace setup required</strong>
            <div className="inline-note">Initialize your first tenant before anyone can sign in.</div>
            <div style={{ marginTop: 12 }}>
              <Link href="/setup">Open Setup</Link>
            </div>
          </div>
        ) : null}
      </div>
      <div className="card auth-card">
        <h2>Sign In</h2>
        <p className="inline-note">Use workspace slug plus email for admin/staff or phone number for customers.</p>
        <form onSubmit={onSubmit} className="grid">
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="Workspace slug"
          />
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Email or phone"
          />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" />
          <button type="submit" disabled={loading}>
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
          {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
        </form>
      </div>
    </div>
  );
}
