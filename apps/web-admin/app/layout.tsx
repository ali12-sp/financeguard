import './globals.css';
import type { Metadata } from 'next';
import PwaRegister from '../components/pwa-register';

export const metadata: Metadata = {
  title: 'FinanceGuard',
  description: 'Managed finance portal for financed devices, payments, and customer accounts.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg'
  },
  appleWebApp: {
    capable: true,
    title: 'FinanceGuard',
    statusBarStyle: 'black-translucent'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
