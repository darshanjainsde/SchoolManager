'use client';
import type { ReactNode } from 'react';
import { PayShell } from './shell';

export default function AppPayLayout({ children }: { children: ReactNode }) {
  return (
    <PayShell base="/app/pay" subtitle="What the school pays, and what it files.">
      {children}
    </PayShell>
  );
}
