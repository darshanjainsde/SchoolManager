'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Globe, Inbox, LogOut, School, Users, GraduationCap, CalendarDays, Clock, CalendarHeart, Megaphone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useHost } from '@/components/use-host';
import { useApi } from '@/lib/use-api';
import { isSchoolHost, exampleSchoolHost, platformHref } from '@/lib/hosts';

// `requiredFeature` hides the item for schools whose tier lacks it. Items with
// no requiredFeature are always shown.
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; requiredFeature?: string }[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/website', label: 'Website', icon: Globe },
  { href: '/app/enquiries', label: 'Enquiries', icon: Inbox, requiredFeature: 'ENQUIRY' },
  { href: '/app/classes', label: 'Classes', icon: School, requiredFeature: 'MANAGEMENT' },
  { href: '/app/teachers', label: 'Teachers', icon: GraduationCap, requiredFeature: 'MANAGEMENT' },
  { href: '/app/students', label: 'Students', icon: Users, requiredFeature: 'MANAGEMENT' },
  { href: '/app/timetable', label: 'Timetable', icon: CalendarDays, requiredFeature: 'MANAGEMENT' },
  { href: '/app/availability', label: 'Availability', icon: Clock, requiredFeature: 'MANAGEMENT' },
  { href: '/app/events', label: 'Events', icon: CalendarHeart, requiredFeature: 'EVENTS' },
  { href: '/app/announcements', label: 'Announcements', icon: Megaphone },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const host = useHost();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const api = useApi({ audience: 'school', hostHeader: host });

  // The school's resolved feature set drives which nav items are shown.
  const { data: me } = useQuery({
    queryKey: ['me', host],
    queryFn: () => api.get<{ features?: string[] }>('/auth/me'),
    enabled: hydrated && isSchoolHost(host) && !!refreshToken && audience === 'school',
    staleTime: 5 * 60_000,
  });
  const features = me?.features;
  // Until features load, show every item (avoids hiding things on a slow fetch).
  const navItems = features
    ? NAV_ITEMS.filter((i) => !i.requiredFeature || features.includes(i.requiredFeature))
    : NAV_ITEMS;

  useEffect(() => {
    if (hydrated && (!refreshToken || audience !== 'school')) {
      router.replace('/login');
    }
  }, [hydrated, refreshToken, audience, router]);

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

  if (!refreshToken || audience !== 'school') return null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col bg-slate-900 text-slate-300 sm:flex">
        {/* Logo */}
        <div className="flex items-center gap-2 p-5 font-extrabold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-600 text-sm">S</span>
          <span>School Admin</span>
        </div>

        {/* Nav */}
        <nav className="mt-2 flex flex-1 flex-col gap-1 px-3 text-sm">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/app'
                ? pathname === '/app'
                : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5',
                  active
                    ? 'bg-teal-100 font-semibold text-teal-700'
                    : 'hover:bg-white/5',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="border-t border-white/10 p-4">
          <button
            onClick={() => {
              clear();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6 sm:p-10">{children}</main>
    </div>
  );
}
