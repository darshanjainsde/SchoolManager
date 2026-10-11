'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The three Settings tabs (settings audit, 11 Oct 2026). Settings had grown into
 * one page that mixed the school calendar with email, WhatsApp, the reception
 * TV and a teaching rule, in a two-column grid that stretched every card to its
 * neighbour's height. Each tab is its own route, so a link opens it directly.
 */
export const SETTINGS_TABS = [
  { href: '/app/settings', label: 'School year', subtitle: 'The calendar classes and the timetable are built on.' },
  { href: '/app/settings/notifications', label: 'Notifications', subtitle: 'How the school reaches families and staff, and what they receive.' },
  { href: '/app/settings/general', label: 'General', subtitle: 'Smaller school-wide choices.' },
] as const;

/** The tab that owns `pathname`; the bare /app/settings never lights a deeper tab. */
export function activeSettingsTab(pathname: string): (typeof SETTINGS_TABS)[number] {
  const deeper = SETTINGS_TABS.slice(1).find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  return deeper ?? SETTINGS_TABS[0];
}

export function SettingsTabs() {
  const pathname = usePathname() ?? '/app/settings';
  const active = activeSettingsTab(pathname);
  return (
    <>
      <header className="sk-pagehead">
        <div>
          <h1>Settings</h1>
          <p>{active.subtitle}</p>
        </div>
      </header>
      <nav className="sk-tabs" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => {
          const on = t.href === active.href;
          return (
            <Link key={t.href} href={t.href} className="sk-tab" data-active={on} aria-current={on ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
