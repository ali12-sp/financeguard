'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LayoutShell from '../../components/layout-shell';
import { apiFetch } from '../../components/api';
import { formatCurrency, formatDate, formatDateTime } from '../../components/formatters';
import { getStoredUser } from '../../components/session';

interface SearchResults {
  query: string;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'SUSPENDED';
    contactEmail?: string;
    contactPhone?: string;
    deviceCount: number;
    customerCount: number;
    latestRegistrationAt: string | null;
  }>;
  customers: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    fullName: string;
    phone: string;
    cnic: string;
    activeContractCount: number;
    remainingBalance: number;
  }>;
  devices: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    imei: string;
    serial: string;
    modelName: string;
    enrollmentStatus: 'PENDING' | 'ENROLLED' | 'SUSPENDED';
    state: 'ACTIVE' | 'REMINDER' | 'GRACE' | 'RESTRICTED' | 'RELEASED';
    customerName: string | null;
    remainingBalance: number;
  }>;
  contracts: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    customerName: string;
    customerPhone: string;
    deviceModel: string;
    imei: string;
    status: string;
    remainingBalance: number;
    nextDueDate: string | null;
  }>;
}

const emptyResults: SearchResults = {
  query: '',
  workspaces: [],
  customers: [],
  devices: [],
  contracts: []
};

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Search across every workspace by IMEI, phone, customer, or workspace name.');
  const [results, setResults] = useState<SearchResults>(emptyResults);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user || !user.isPlatformOwner) {
      router.replace('/dashboard');
    }
  }, [router]);

  async function runSearch(nextQuery?: string) {
    const value = (nextQuery ?? query).trim();
    if (value.length < 2) {
      setResults(emptyResults);
      setStatus('Enter at least 2 characters to search globally.');
      return;
    }

    setLoading(true);
    setStatus(`Searching for "${value}"...`);

    try {
      const data = await apiFetch<SearchResults>(`/platform/search?q=${encodeURIComponent(value)}`);
      setResults(data);
      const total =
        data.workspaces.length +
        data.customers.length +
        data.devices.length +
        data.contracts.length;
      setStatus(total > 0 ? `Found ${total} matches for "${value}".` : `No matches for "${value}".`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch();
  }

  return (
    <LayoutShell>
      <div className="section-head">
        <div>
          <h1>Global Search</h1>
          <p className="page-copy">
            Search across all workspaces from one place. This is the fastest way to locate a device, customer, contract, or shopkeeper without switching tenant context.
          </p>
        </div>
      </div>

      <div className="card">
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search IMEI, phone, customer, workspace, serial, or contract ID"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
        <p className="inline-note" style={{ marginTop: 12 }}>{status}</p>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h2 className="section-title">Workspaces</h2>
          <div className="stack">
            {results.workspaces.length === 0 ? (
              <div className="inline-note">No workspace matches yet.</div>
            ) : results.workspaces.map((row) => (
              <div key={row.id} className="search-result">
                <div>
                  <strong>{row.name}</strong>
                  <div className="inline-note mono">{row.slug}</div>
                  <div className="inline-note">{row.contactEmail || row.contactPhone || 'No contact saved'}</div>
                </div>
                <div className="inline-note">
                  {row.customerCount} customers | {row.deviceCount} devices | Last registration {formatDateTime(row.latestRegistrationAt)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Customers</h2>
          <div className="stack">
            {results.customers.length === 0 ? (
              <div className="inline-note">No customer matches yet.</div>
            ) : results.customers.map((row) => (
              <div key={row.id} className="search-result">
                <div>
                  <strong>{row.fullName}</strong>
                  <div className="inline-note">{row.phone} | {row.cnic}</div>
                  <div className="inline-note">{row.workspaceName} ({row.workspaceSlug})</div>
                </div>
                <div className="inline-note">
                  {row.activeContractCount} active contracts | Balance {formatCurrency(row.remainingBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h2 className="section-title">Devices</h2>
          <div className="stack">
            {results.devices.length === 0 ? (
              <div className="inline-note">No device matches yet.</div>
            ) : results.devices.map((row) => (
              <div key={row.id} className="search-result">
                <div>
                  <strong>{row.modelName}</strong>
                  <div className="inline-note mono">{row.imei} | {row.serial}</div>
                  <div className="inline-note">{row.workspaceName} | {row.customerName || 'Unassigned'}</div>
                </div>
                <div className="inline-note">
                  <span className={`badge ${row.enrollmentStatus.toLowerCase()}`}>{row.enrollmentStatus}</span>{' '}
                  <span className={`badge ${row.state.toLowerCase()}`}>{row.state}</span>{' '}
                  Balance {formatCurrency(row.remainingBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">Contracts</h2>
          <div className="stack">
            {results.contracts.length === 0 ? (
              <div className="inline-note">No contract matches yet.</div>
            ) : results.contracts.map((row) => (
              <div key={row.id} className="search-result">
                <div>
                  <strong>{row.customerName}</strong>
                  <div className="inline-note">{row.workspaceName} | {row.customerPhone}</div>
                  <div className="inline-note">{row.deviceModel} | IMEI {row.imei}</div>
                </div>
                <div className="inline-note">
                  <span className={`badge ${row.status.toLowerCase()}`}>{row.status}</span>{' '}
                  Balance {formatCurrency(row.remainingBalance)} | Next due {formatDate(row.nextDueDate)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
