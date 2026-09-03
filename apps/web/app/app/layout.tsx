'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Menu, X,
} from 'lucide-react';
import { NAV_MODEL, groupOf, leafActive, navLeaves, visibleModel, type NavEntry, type NavLeaf } from './nav-model';
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
  collapsed,
  nested,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  pathname: string;
  /** Icon-only rail: hide the label, centre the icon, name it via a tooltip. */
  collapsed?: boolean;
  /** A group child — indents under its header. */
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const active = leafActive(href, pathname);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-lg transition-colors',
        collapsed ? 'justify-center px-0 py-2.5' : nested ? 'gap-3 py-2 pl-9 pr-3' : 'gap-3 px-3 py-2.5',
        active ? 'bg-emerald-400/15 font-semibold text-emerald-300' : 'hover:bg-white/5',
      )}
    >
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && label}
    </Link>
  );
}

/**
 * One collapsible section. The header is a real button (aria-expanded); when
 * the group is shut but holds the active page, an emerald dot says so — the
 * page never feels lost behind a closed heading.
 */
function NavGroup({
  entry, pathname, open, onToggle, onNavigate,
}: {
  entry: Extract<NavEntry, { kind: 'group' }>;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const holdsActive = entry.items.some((i) => leafActive(i.href, pathname));
  const Icon = entry.icon;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5',
          holdsActive && !open ? 'text-emerald-300' : 'text-slate-300',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className={cn('flex-1 text-[11px] font-semibold uppercase tracking-wider', holdsActive && !open ? 'text-emerald-300' : 'text-slate-400')}>
          {entry.label}
        </span>
        {holdsActive && !open && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
        <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {entry.items.map((item) => (
            <AdminNavLink key={item.href} {...item} pathname={pathname} nested onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The whole menu, grouped — the drawer and the expanded sidebar share it. */
function GroupedNav({
  model, pathname, openGroup, setOpenGroup, onNavigate,
}: {
  model: NavEntry[];
  pathname: string;
  openGroup: string | null;
  setOpenGroup: (k: string | null) => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      {model.map((e) =>
        e.kind === 'item' ? (
          <AdminNavLink key={e.item.href} {...e.item} pathname={pathname} onNavigate={onNavigate} />
        ) : (
          <NavGroup
            key={e.key}
            entry={e}
            pathname={pathname}
            open={openGroup === e.key}
            onToggle={() => setOpenGroup(openGroup === e.key ? null : e.key)}
            onNavigate={onNavigate}
          />
        ),
      )}
    </>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * `/` focuses the command bar from anywhere in the console — the Front
   * Desk's front door. Off the dashboard it navigates there first; the bar
   * listens for the event and takes focus. Never while the person is already
   * typing somewhere.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      if (window.location.pathname !== '/app') router.push('/app');
      // Next paint on the dashboard, the bar exists and takes focus.
      setTimeout(() => window.dispatchEvent(new Event('sk-focus-command-bar')), 80);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router]);
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
  // Collapse the desktop sidebar to an icons-only rail, so the main editor gets
  // the horizontal space. Remembered across sessions.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sk-sidebar-collapsed') === '1';
  });
  useEffect(() => {
    localStorage.setItem('sk-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

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
  const model = visibleModel(features ?? null);
  const leaves = navLeaves(model);

  /**
   * The accordion follows the route: the group that owns the current page is
   * open, everything else stays shut, so the menu can never grow long again.
   * Initialised from pathname (identical on server and client — no hydration
   * risk), re-synced on navigation; a hand-opened group closes on the next
   * route change into a different group.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(() => groupOf(pathname));
  useEffect(() => {
    const g = groupOf(pathname);
    if (g) setOpenGroup(g);
  }, [pathname]);

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
  //
  // `pathname` is in the deps deliberately. Without it this fired on mount
  // only: `me.role` does not change during a client-side navigation and the
  // layout does not remount, so a non-admin who was bounced once could then
  // click any sidebar link and STAY inside the admin console — every
  // `/manage/*` call 403-ing behind a fully-rendered admin UI. Hard navigation
  // was guarded; soft navigation was not. Re-evaluating per route closes it.
  //
  // This is chrome, not authorization. What actually protects these routes is
  // `SchoolJwtGuard + RolesGuard` on the API; this only stops a non-admin
  // being shown a console that will refuse everything they touch.
  useEffect(() => {
    if (me?.role && me.role !== 'SCHOOL_ADMIN') {
      router.replace(homeForRole(me.role));
    }
  }, [me?.role, pathname, router]);

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
    // h-screen + overflow-hidden makes the shell a fixed viewport: the sidebar
    // and the main area each scroll on their OWN, so scrolling the sidebar's
    // menu no longer drags the whole page up with it.
    <div className="flex h-screen flex-col overflow-hidden">
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
              <GroupedNav
                model={model}
                pathname={pathname}
                openGroup={openGroup}
                setOpenGroup={setOpenGroup}
                onNavigate={() => setDrawerOpen(false)}
              />
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
      {/* Sidebar — min-h-0 so its nav can own the overflow instead of the page. */}
      <aside
        className={cn(
          'hidden min-h-0 flex-col bg-slate-900 text-slate-300 transition-[width] duration-200 sm:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Logo + collapse toggle */}
        <div className={cn('flex p-4', collapsed ? 'flex-col items-center gap-3' : 'items-start justify-between')}>
          {collapsed ? (
            <SckoolsLogo theme="dark" size={26} />
          ) : (
            <div className="flex flex-col gap-1">
              <SckoolsLogo theme="dark" size={28} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">School Admin</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Nav — scrolls on its own; a long menu never scrolls the page. */}
        <nav className={cn('mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-sm', collapsed ? 'px-2' : 'px-3')}>
          {collapsed ? (
            // The icon rail stays FLAT — a closed heading has no meaning at
            // 16px wide, and every icon already names itself via its tooltip.
            leaves.map((item) => (
              <AdminNavLink key={item.href} {...item} pathname={pathname} collapsed />
            ))
          ) : (
            <GroupedNav model={model} pathname={pathname} openGroup={openGroup} setOpenGroup={setOpenGroup} />
          )}
        </nav>

        {/* Logout */}
        <div className={cn('border-t border-white/10', collapsed ? 'p-2' : 'p-4')}>
          {!collapsed && <div className="skosx mb-3"><ThemeToggle /></div>}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Log out' : undefined}
            aria-label={collapsed ? 'Log out' : undefined}
            className={cn(
              'flex w-full items-center rounded-lg text-sm hover:bg-white/5',
              collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2',
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Log out'}
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
