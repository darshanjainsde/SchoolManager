'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  CalendarDays,
  CalendarCheck,
  BookOpen,
  GraduationCap,
  Megaphone,
  MessageSquare,
  User,
  LogOut,
  NotebookPen,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useApi } from '@/lib/use-api';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { isSchoolHost, exampleSchoolHost } from '@/lib/hosts';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationBell } from '@/components/notifications/notification-bell';
import '../sk-theme.css';

const NAV_ITEMS = [
  { href: '/portal', label: 'Home', icon: LayoutDashboard },
  { href: '/portal/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/portal/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/portal/diary', label: 'Diary', icon: NotebookPen },
  { href: '/portal/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/portal/results', label: 'Results', icon: GraduationCap },
  { href: '/portal/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare },
  { href: '/portal/profile', label: 'Profile', icon: User },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const host = useHost();
  const status = useAuthStore((s) => s.status);
  const audience = useAuthStore((s) => s.audience);
  const probeApi = useApi({ audience: 'school', hostHeader: host });
  // Waits for the tenant host: a school refresh without it cannot resolve
  // which school the session belongs to.
  useSessionProbe(probeApi, 'school', !!host);
  const clear = useAuthStore((s) => s.clear);

  // Same role guard as /teacher and /app: this portal is student-only. The
  // /me/* endpoints already 403 other roles server-side, but without this a
  // signed-in teacher landing here saw a wall of errors instead of their home.
  const me = useQuery({
    queryKey: ['me'],
    enabled: status === 'authed' && audience === 'school' && !!host,
    queryFn: () => probeApi.get<{ role: string }>('/auth/me'),
  });

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) {
      router.replace('/login');
    }
    if (me.data && me.data.role !== 'STUDENT') {
      router.replace(homeForRole(me.data.role));
    }
  }, [hydrated, status, audience, me.data, router]);

  // Until hydrated, render nothing so the first client paint matches the server.
  if (!hydrated) return null;

  // The portal resolves its school from the host — only works on a school subdomain.
  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">🎓</div>
          <h1 className="text-lg font-bold text-slate-900">Open the portal at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The student portal lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'authed' || audience !== 'school') return null;

  const isActive = (href: string) =>
    href === '/portal' ? pathname === '/portal' : pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="skosx sk-shell">
      <header className="sk-topbar">
        <div className="sk-topbar-inner">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">Student portal</div>
            <div className="s">{host?.split(':')[0] ?? 'Sckools'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <NotificationBell portal="student" />
          <ThemeToggle />
          <button
            className="sk-signout"
            onClick={() => {
              clear();
              router.replace('/login');
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
        <nav className="sk-tabs" aria-label="Portal sections">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sk-tab" data-active={isActive(href)}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="sk-main">{children}</main>
    </div>
  );
}
