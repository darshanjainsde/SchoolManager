import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ThemeScript } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Sckools',
  description: 'Multi-tenant school management platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
