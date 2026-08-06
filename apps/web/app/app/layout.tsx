'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CalendarDays, CalendarHeart, CalendarX, ClipboardCheck, ClipboardList, Clock, Globe, GraduationCap, Inbox, LayoutDashboard, LogOut, Megaphone, Menu, Newspaper, School, Settings, UserCog, Users, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { useApi } from '@/lib/use-api';
import { isSchoolHost, exampleSchoolHost, platformHref } from '@/lib/hosts';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import '../sk-theme.css';

// `requiredFeature` hides the item for schools whose tier lacks it. Items with
// no requiredFeature are always shown.
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; requiredFeature?: string }[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/website', label: 'Website', icon: Globe },
  { href: '/app/blog', label: 'Blog', icon: Newspaper, requiredFeature: 'BLOG' },
  { href: '/app/enquiries', label: 'Enquiries', icon: Inbox, requiredFeature: 'ENQUIRY' },
  { href: '/app/classes', label: 'Classes', icon: School, requiredFeature: 'MANAGEMENT' },
  { href: '/app/teachers', label: 'Teachers', icon: GraduationCap, requiredFeature: 'MANAGEMENT' },
  { href: '/app/staff', label: 'Staff', icon: UserCog, requiredFeature: 'MANAGEMENT' },
  { href: '/app/staff-attendance', label: 'Staff attendance', icon: ClipboardList, requiredFeature: 'MANAGEMENT' },
  { href: '/app/students', label: 'Students', icon: Users, requiredFeature: 'MANAGEMENT' },
  { href: '/app/timetable', label: 'Timetable', icon: CalendarDays, requiredFeature: 'MANAGEMENT' },
  { href: '/app/availability', label: 'Availability', icon: Clock, requiredFeature: 'MANAGEMENT' },
  { href: '/app/leave', label: 'Leave', icon: CalendarX, requiredFeature: 'MANAGEMENT' },
  { href: '/app/requests', label: 'Requests', icon: ClipboardCheck, requiredFeature: 'MANAGEMENT' },
  { href: '/app/settings', label: 'Settings', icon: Settings, requiredFeature: 'MANAGEMENT' },
  { href: '/app/jobs', label: 'Jobs', icon: Briefcase, requiredFeature: 'HIRING' },
  { href: '/app/events', label: 'Events', icon: CalendarHeart, requiredFeature: 'EVENTS' },
  { href: '/app/announcements', label: 'Announcements', icon: Megaphone },
];

/** Moves focus back inside the drawer when Tab would otherwise leave it. */
function trapFocus(e: React.KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function AdminNavLink({
  href,
  label,
  icon: Icon,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
        active ? 'bg-emerald-400/15 font-semibold text-emerald-300' : 'hover:bg-white/5',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const host = useHost();
  const status = useAuthStore((s) => s.status);
  const accessToken = useAuthStore((s) => s.accessToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const api = useApi({ audience: 'school', hostHeader: host });
  useSessionProbe(api, 'school', !!host);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);

  // Impersonation sessions carry an access token only — no refresh token and
  // no cookie — so they count as a session even though the probe cannot
  // reproduce them after a reload (that was already true before the cookie).
  const hasSession = status === 'authed' || !!accessToken;
  const impersonated = (() => {
    if (!accessToken) return false;
    try {
      return Boolean((JSON.parse(atob(accessToken.split('.')[1])) as { imp?: boolean }).imp);
    } catch {
      return false;
    }
  })();

  // The school's resolved feature set drives which nav items are shown, and
  // `role` gates the console itself — see the redirect effect below.
  const { data: me } = useQuery({
    queryKey: ['me', host],
    queryFn: () => api.get<{ features?: string[]; role?: string }>('/auth/me'),
    enabled: hydrated && isSchoolHost(host) && hasSession && audience === 'school',
    staleTime: 5 * 60_000,
  });
  const features = me?.features;
  // Until features load, show every item (avoids hiding things on a slow fetch).
  const navItems = features
    ? NAV_ITEMS.filter((i) => !i.requiredFeature || features.includes(i.requiredFeature))
    : NAV_ITEMS;

  useEffect(() => {
    // `unknown` means the probe has not answered yet — don't bounce to /login
    // before we know.
    if (hydrated && status !== 'unknown' && (!hasSession || audience !== 'school')) {
      router.replace('/login');
    }
  }, [hydrated, status, hasSession, audience, router]);

  // The admin console is SCHOOL_ADMIN-only — this was previously the ONE
  // school-audience layout with no role check at all, so a STAFF (or any
  // other non-admin) session that landed here directly (e.g. bounced out of
  // /teacher's own guard) saw the full admin UI. `role` is undefined until
  // `me` resolves, so this only fires once we actually know it's wrong.
  useEffect(() => {
    if (me?.role && me.role !== 'SCHOOL_ADMIN') {
      router.replace(homeForRole(me.role));
    }
  }, [me?.role, router]);

  // Close the mobile drawer whenever navigation happens (Link clicks already
  // do this eagerly; this covers back/forward and any other route change).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Move focus into the drawer once it mounts.
  useEffect(() => {
    if (drawerOpen) drawerPanelRef.current?.focus();
  }, [drawerOpen]);

  // Until hydrated, render nothing so the first client paint matches the server.
  if (!hydrated) return null;

  // The admin portal resolves its school from the host. On the platform host
  // (localhost / owner.localhost) there is no tenant, so every API call would
  // fail with "Tenant context required". Show clear guidance instead.
  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">🏫</div>
          <h1 className="text-lg font-bold text-slate-900">Open the admin at a school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The school admin portal lives on each school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
          </p>
          <a
            href={platformHref()}
            className="mt-5 inline-block rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700"
          >
            Go to the launcher &amp; pick a school →
          </a>
        </div>
      </div>
    );
  }

  if (status === 'unknown' && !accessToken) return null;
  if (!hasSession || audience !== 'school') return null;

  function handleLogout() {
    clear();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      {impersonated && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-violet-600 px-3 py-1.5 text-center text-xs font-bold text-white sm:px-4">
          ⚡ Owner view — you are signed in as this school&rsquo;s admin via the owner console. The session ends automatically.
        </div>
      )}

      {/* Mobile top bar — hidden at sm and above, where the sidebar takes over. */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-2.5 sm:hidden">
        <div className="flex items-center gap-2">
          <SckoolsLogo theme="dark" size={24} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">School Admin</span>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="app-mobile-drawer"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      {/* Mobile drawer — mounted only while open, so it's never tab-reachable when closed. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/50"
          />
          <div
            id="app-mobile-drawer"
            ref={drawerPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            onKeyDown={(e) => trapFocus(e, drawerPanelRef.current)}
            className="sk-mobile-drawer relative flex h-full w-[260px] max-w-[80vw] flex-col bg-slate-900 text-slate-300 shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-1 p-5">
              <SckoolsLogo theme="dark" size={28} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-3 text-sm">
              {navItems.map((item) => (
                <AdminNavLink key={item.href} {...item} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              ))}
            </nav>

            <div className="border-t border-white/10 p-4">
              <div className="skosx mb-3">
                <ThemeToggle />
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Log out
              </button>
            </div>
          </div>
          <style jsx>{`
            .sk-mobile-drawer {
              animation: sk-drawer-in 0.22s ease-out both;
            }
            @keyframes sk-drawer-in {
              from {
                transform: translateX(-100%);
              }
              to {
                transform: translateX(0);
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .sk-mobile-drawer {
                animation: none;
              }
            }
          `}</style>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col bg-slate-900 text-slate-300 sm:flex">
        {/* Logo */}
        <div className="flex flex-col gap-1 p-5">
          <SckoolsLogo theme="dark" size={28} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">School Admin</span>
        </div>

        {/* Nav */}
        <nav className="mt-2 flex flex-1 flex-col gap-1 px-3 text-sm">
          {navItems.map((item) => (
            <AdminNavLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>

        {/* Logout */}
        <div className="border-t border-white/10 p-4">
          <div className="skosx mb-3"><ThemeToggle /></div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="skosx sk-anim min-w-0 flex-1 overflow-auto overflow-x-hidden p-6 sm:p-10" style={{ background: 'var(--sk-paper)' }}>
        {children}
      </main>
      </div>
    </div>
  );
}
