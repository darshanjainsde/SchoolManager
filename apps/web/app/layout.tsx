import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkoolOS',
  description: 'Multi-tenant school management platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
