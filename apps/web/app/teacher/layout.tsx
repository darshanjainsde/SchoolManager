'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ClipboardCheck,
  BookOpen,
  FileText,
  GraduationCap,
  Megaphone,
  Inbox,
  CalendarDays,
  CalendarOff,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/lib/use-api';
import { useHydrated } from '@/lib/use-hydrated';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import '../sk-theme.css';

const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/teacher', label: 'My classes', icon: LayoutDashboard },
  { href: '/teacher/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/teacher/attendance', label: 'Attendance', icon: ClipboardCheck },
  { href: '/teacher/tests', label: 'Tests', icon: FileText },
  { href: '/teacher/results', label: 'Results', icon: GraduationCap },
  { href: '/teacher/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/teacher/inbox', label: 'Inbox', icon: Inbox },
  { href: '/teacher/requests', label: 'Requests', icon: CalendarOff },
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

function TeacherNavLink({
  href,
  label,
  icon: Icon,
  isActive,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className="sk-nav" data-active={isActive}>
      <Icon className="ic" aria-hidden="true" /> {label}
    </Link>
  );
}

export default function TeacherLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const status = useAuthStore((s) => s.status);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  useSessionProbe(api, 'school', !!host);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);

  const me = useQuery({
    queryKey: ['me'],
    enabled: status === 'authed' && audience === 'school' && !!host,
    queryFn: () => api.get<{ role: string }>('/auth/me'),
  });

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) router.replace('/login');
    if (me.data && me.data.role !== 'TEACHER' && me.data.role !== 'SCHOOL_ADMIN') router.replace('/app');
  }, [hydrated, status, audience, me.data, router]);

  // Close the mobile drawer whenever navigation happens.
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

  if (!hydrated) return null;
  // `unknown` = the session probe is still in flight.
  if (status !== 'authed') return null;

  const isActive = (href: string) => pathname === href || (href !== '/teacher' && pathname.startsWith(href));

  async function handleLogout() {
    // No token needed: the API revokes whatever the cookie carries and clears
    // it. The body form is kept for pre-cookie sessions.
    const rt = useAuthStore.getState().refreshToken;
    await api.post('/auth/logout', rt ? { refreshToken: rt } : {}).catch(() => undefined);
    clear();
    router.replace('/login');
  }

  return (
    <div className="skosx sk-app">
      {/* Mobile top bar — shown only under the 640px breakpoint, where the sidebar is hidden. */}
      <div className="sk-mobile-topbar">
        <div className="brand">
          <SckoolsLogo variant="symbol" size={26} />
          <span className="role">Teacher portal</span>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="teacher-mobile-drawer"
          className="sk-mobile-menu-btn"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      {/* Mobile drawer — mounted only while open, so it's never tab-reachable when closed. */}
      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="sk-drawer-scrim"
          />
          <div
            id="teacher-mobile-drawer"
            ref={drawerPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            onKeyDown={(e) => trapFocus(e, drawerPanelRef.current)}
            className="sk-drawer-panel"
          >
            <div className="sk-side-brand" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <SckoolsLogo variant="symbol" size={30} />
                <div className="role">Teacher portal</div>
                <div className="sub">{host?.split(':')[0]}</div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="sk-drawer-close"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="sk-navlabel">Classroom</div>
            <nav className="flex flex-col gap-[3px]">
              {NAV_ITEMS.map(({ href, label, icon }) => (
                <TeacherNavLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  isActive={isActive(href)}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </nav>
            <div className="sk-side-foot">
              <div style={{ padding: '8px 11px' }}><ThemeToggle /></div>
              <button
                onClick={handleLogout}
                className="sk-nav"
                style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer' }}
              >
                <LogOut className="ic" /> Sign out
              </button>
            </div>
          </div>
        </>
      )}

      <aside className="sk-side">
        <div className="sk-side-brand">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="role">Teacher portal</div>
          <div className="sub">{host?.split(':')[0]}</div>
        </div>
        <div className="sk-navlabel">Classroom</div>
        <nav className="flex flex-col gap-[3px]">
          {NAV_ITEMS.map(({ href, label, icon }) => (
            <TeacherNavLink key={href} href={href} label={label} icon={icon} isActive={isActive(href)} />
          ))}
        </nav>
        <div className="sk-side-foot">
          <div style={{ padding: '8px 11px' }}><ThemeToggle /></div>
          <button
            onClick={handleLogout}
            className="sk-nav"
            style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer' }}
          >
            <LogOut className="ic" /> Sign out
          </button>
        </div>
      </aside>
      <main className="sk-content sk-anim">{children}</main>
    </div>
  );
}
