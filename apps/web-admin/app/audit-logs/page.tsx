'use client';

import { useEffect, useState } from 'react';
import LayoutShell from '../../components/layout-shell';
import { apiFetch } from '../../components/api';
import { formatDateTime } from '../../components/formatters';

interface AuditLogRow {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  details?: string;
  createdAt: string;
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);

  useEffect(() => {
    apiFetch<AuditLogRow[]>('/audit-logs?limit=100')
      .then(setRows)
      .catch(console.error);
  }, []);

  return (
    <LayoutShell>
      <h1>Audit Logs</h1>
      <p className="page-copy">This is the compliance trail for admin actions such as restrictions, unlocks, payment matches, and manual overrides.</p>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.actorName}</td>
                  <td><span className={`badge ${row.action.toLowerCase()}`}>{row.action}</span></td>
                  <td className="mono">{row.entityType}:{row.entityId}</td>
                  <td>{row.reason}</td>
                  <td>{row.details || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LayoutShell>
  );
}
