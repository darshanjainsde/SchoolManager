import type { ReactNode } from 'react';
import { SettingsTabs } from './tabs';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
