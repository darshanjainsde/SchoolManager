'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useApi } from '@/lib/use-api';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { isSchoolHost, exampleSchoolHost } from '@/lib/hosts';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import '../sk-theme.css';

/**
 * The tab rail is the approved "book spine" look: each tab a spine with its
 * own cloth colour, the active one pulled out of the shelf. Data drives
 * nothing here, so the array is plain module data (same reasoning as
 * teacher/nav-items.ts — and layout files must not export it).
 */
const NAV: { href: string; label: string; glyph: string; spine: string }[] = [
  { href: '/library', label: 'Dashboard', glyph: '📊', spine: 'var(--sk-brand)' },
  { href: '/library/hall', label: 'Hall', glyph: '🏛️', spine: 'var(--sk-good)' },
  { href: '/library/counter', label: 'Counter', glyph: '🔁', spine: 'var(--sk-amber)' },
  { href: '/library/books', label: 'New books', glyph: '📚', spine: 'var(--sk-brand-2)' },
  { href: '/library/fines', label: 'Fines', glyph: '₹', spine: 'var(--sk-bad)' },
  { href: '/library/settings', label: 'Settings', glyph: '⚙️', spine: 'var(--sk-line-2)' },
];

export default function LibraryLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const host = useHost();
  const status = useAuthStore((s) => s.status);
  const audience = useAuthStore((s) => s.audience);
  const api = useApi({ audience: 'school', hostHeader: host });
  useSessionProbe(api, 'school', !!host);
  const clear = useAuthStore((s) => s.clear);

  const me = useQuery({
    queryKey: ['me'],
    enabled: status === 'authed' && audience === 'school' && !!host,
    queryFn: () => api.get<{ role: string; name: string | null; staffRole: string | null }>('/auth/me'),
  });

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) router.replace('/login');
    // Librarian-or-admin only. Any other session that lands here (an office
    // staff bookmark, a student typing the URL) goes to ITS portal, never
    // stays — the same rule every portal layout enforces for itself.
    if (me.data) {
      const allowed =
        me.data.role === 'SCHOOL_ADMIN' || (me.data.role === 'STAFF' && me.data.staffRole === 'LIBRARIAN');
      if (!allowed) router.replace(homeForRole(me.data.role, me.data.staffRole));
    }
  }, [hydrated, status, audience, me.data, router]);

  if (!hydrated) return null;

  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">📚</div>
          <h1 className="text-lg font-bold text-slate-900">Open the library at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The library lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'authed' || audience !== 'school') return null;

  const isActive = (href: string) =>
    href === '/library' ? pathname === '/library' : pathname === href || pathname.startsWith(href + '/');

  async function handleLogout() {
    const rt = useAuthStore.getState().refreshToken;
    await api.post('/auth/logout', rt ? { refreshToken: rt } : {}).catch(() => undefined);
    clear();
    router.replace('/login');
  }

  return (
    <div className="skosx sk-shell">
      <header className="sk-topbar">
        <div className="sk-topbar-inner">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">The library</div>
            <div className="s">{me.data?.name ?? host?.split(':')[0] ?? 'Sckools'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <button className="sk-signout" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 md:flex-row md:px-5">
        {/* The shelf. Horizontal scroll strip on phones, spine rail on desktop. */}
        <nav
          aria-label="Library sections"
          className="flex shrink-0 gap-2 overflow-x-auto pb-1 md:w-48 md:flex-col md:overflow-visible md:pb-0"
        >
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-r-lg rounded-l-[5px] border border-[var(--sk-line)] bg-[var(--sk-card)] py-2.5 pl-2 pr-3 text-[13px] font-semibold shadow-sm transition-transform ${
                  active
                    ? 'translate-x-0 text-[var(--sk-ink)] shadow md:translate-x-1.5'
                    : 'text-[var(--sk-ink-2)] hover:translate-x-0.5'
                }`}
                style={{ borderLeft: `5px solid ${item.spine}` }}
              >
                <span aria-hidden="true" className="text-sm">{item.glyph}</span>
                {item.label}
                {active ? (
                  <span aria-hidden="true" className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-[var(--sk-amber)] md:block" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
