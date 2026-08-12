import type { Metadata } from 'next';
import './lbx.css';

export const metadata: Metadata = {
  title: 'Sckools Library',
  description: 'Catalogue, circulation desk and reading room for your school library.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
