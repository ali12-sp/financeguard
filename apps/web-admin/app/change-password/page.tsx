'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LayoutShell from '../../components/layout-shell';
import { apiFetch, apiPost } from '../../components/api';
import {
  getDefaultRouteForRole,
  getStoredToken,
  getStoredUser,
  setSession
} from '../../components/session';

interface ResetUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'staff' | 'customer';
  mustChangePassword: boolean;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('');
  const [resetUsers, setResetUsers] = useState<ResetUser[]>([]);
  const [resetStatus, setResetStatus] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState<{
    name: string;
    identifier: string;
    password: string;
  } | null>(null);
  const [currentUser, setCurrentUser] = useState<ReturnType<typeof getStoredUser>>();

  async function loadResetUsers(user = getStoredUser()) {
    if (user?.role !== 'admin' && user?.role !== 'staff') {
      return;
    }

    try {
      const rows = await apiFetch<ResetUser[]>('/auth/users');
      setResetUsers(rows);
    } catch (error) {
      setResetStatus(error instanceof Error ? error.message : 'Unable to load users');
    }
  }

  useEffect(() => {
    const storedUser = getStoredUser();
    setCurrentUser(storedUser);
    loadResetUsers(storedUser);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('');

    if (newPassword !== confirmPassword) {
      setStatus('New password and confirmation do not match.');
      return;
    }

    try {
      await apiPost('/auth/change-password', { currentPassword, newPassword });
      const token = getStoredToken();
      const user = getStoredUser();
      if (token && user) {
        setSession(token, { ...user, mustChangePassword: false });
        router.replace(getDefaultRouteForRole(user.role));
        return;
      }

      router.replace('/login');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to change password');
    }
  }

  async function resetPassword(user: ResetUser) {
    setResetStatus('Issuing temporary password...');
    setTemporaryPassword(null);

    try {
      const result = await apiPost<{ temporaryPassword: string; user: ResetUser }>(
        `/auth/users/${user.id}/reset-password`,
        {}
      );
      setTemporaryPassword({
        name: result.user.name,
        identifier: result.user.phone || result.user.email,
        password: result.temporaryPassword
      });
      setResetStatus(`${result.user.name} must change password on next login.`);
      loadResetUsers(currentUser);
    } catch (error) {
      setResetStatus(error instanceof Error ? error.message : 'Unable to reset password');
    }
  }

  return (
    <LayoutShell allowedRoles={['admin', 'staff', 'customer']}>
      <h1>Security</h1>
      <p className="page-copy">Update the temporary password before using the account.</p>
      <div className="card" style={{ marginTop: 20, maxWidth: 560 }}>
        <form className="grid" onSubmit={handleSubmit}>
          <input
            required
            minLength={3}
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <input
            required
            minLength={8}
            maxLength={128}
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <input
            required
            minLength={8}
            maxLength={128}
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <div className="button-row">
            <button type="submit">Update Password</button>
            {status ? <span className="inline-note">{status}</span> : null}
          </div>
        </form>
      </div>

      {currentUser?.role === 'admin' || currentUser?.role === 'staff' ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="section-title">Password Reset</h2>
          <p className="page-copy">Issue a temporary password for customer recovery. Admins can also recover staff accounts.</p>
          {resetStatus ? <p className="inline-note">{resetStatus}</p> : null}
          {temporaryPassword ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <div>
                <strong>{temporaryPassword.name}</strong>
                <div className="inline-note">Identifier: {temporaryPassword.identifier}</div>
                <div className="inline-note">Temporary password: {temporaryPassword.password}</div>
              </div>
            </div>
          ) : null}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Identifier</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {resetUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td><span className={`badge ${user.role === 'customer' ? 'reminder' : 'active'}`}>{user.role.toUpperCase()}</span></td>
                    <td>{user.phone || user.email}</td>
                    <td>{user.mustChangePassword ? 'Must change password' : 'Active'}</td>
                    <td>
                      <button type="button" className="ghost-button" onClick={() => resetPassword(user)}>
                        Reset
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </LayoutShell>
  );
}
