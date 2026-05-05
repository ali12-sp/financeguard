import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FinanceGuard',
    short_name: 'FinanceGuard',
    description: 'Managed finance portal for admins and financed-device customers.',
    start_url: '/login',
    display: 'standalone',
    background_color: '#08131f',
    theme_color: '#0f8b8d',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable'
      }
    ]
  };
}
