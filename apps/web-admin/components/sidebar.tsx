'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SessionUser } from './session';

const adminLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/customers', label: 'Customers' },
  { href: '/guarantors', label: 'Guarantors' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/payments', label: 'Payments' },
  { href: '/reports', label: 'Reports & Exports' },
  { href: '/devices', label: 'Devices' },
  { href: '/late-payments', label: 'Late Payments' },
  { href: '/audit-logs', label: 'Audit Logs' },
  { href: '/change-password', label: 'Security' }
];

const customerLinks = [
  { href: '/customer', label: 'My Account' },
  { href: '/change-password', label: 'Security' }
];

interface SidebarProps {
  user: SessionUser;
  onLogout: () => void;
}

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const links = user.role === 'customer'
    ? customerLinks
    : user.isPlatformOwner
      ? [
          adminLinks[0],
          { href: '/search', label: 'Global Search' },
          { href: '/workspaces', label: 'Workspaces' },
          ...adminLinks.slice(1)
        ]
      : adminLinks;

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-badge">FG</div>
        <div>
          <h1>FinanceGuard</h1>
          <p className="sidebar-copy">
            {user.role === 'customer'
              ? 'Payment and device status'
              : 'Installment device control'}
          </p>
          {user.tenantName ? (
            <p className="inline-note" style={{ marginTop: 4 }}>{user.tenantName}</p>
          ) : null}
        </div>
      </div>
      <nav>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname === link.href ? 'active' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="inline-note">
          {user.role === 'customer'
            ? 'Install this portal on phone or desktop for quick access.'
            : 'Use the admin console to onboard devices and manage restrictions.'}
        </div>
        <button type="button" className="ghost-button" onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
