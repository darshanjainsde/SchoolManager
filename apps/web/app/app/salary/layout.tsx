'use client';
import type { ReactNode } from 'react';
import { SalaryShell } from './shell';

export default function AppSalaryLayout({ children }: { children: ReactNode }) {
  return (
    <SalaryShell base="/app/salary" subtitle="Pay, deductions and what the school files.">
      {children}
    </SalaryShell>
  );
}
