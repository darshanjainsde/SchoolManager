import type { ReactNode } from 'react';
import { SportsShell } from './shell';

/** The sports desk as a tab of the admin console (session and role already enforced by app/app/layout.tsx). */
export default function AppSportsLayout({ children }: { children: ReactNode }) {
  return (
    <SportsShell base="/app/sports" subtitle="Tournaments, the Book of Records and the house table.">
      {children}
    </SportsShell>
  );
}
