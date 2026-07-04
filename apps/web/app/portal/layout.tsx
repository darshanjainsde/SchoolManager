'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { LayoutDashboard, CalendarDays, Megaphone, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';

const NAV_ITEMS = [
  { href: '/portal', label: 'Home', icon: LayoutDashboard },
  { href: '/portal/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/portal/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/portal/profile', label: 'Profile', icon: User },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    if (!refreshToken || audience !== 'school') {
      router.replace('/login');
    }
  }, [refreshToken, audience, router]);

  if (!refreshToken || audience !== 'school') return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          {/* Brand */}
          <div className="flex items-center gap-2 font-extrabold text-slate-800">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-teal-500 text-xs text-white">
              S
            </span>
            <span>Student Portal</span>
          </div>

          {/* Nav links */}
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active =
                href === '/portal'
                  ? pathname === '/portal'
                  : pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium',
                    active
                      ? 'bg-teal-50 text-teal-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Logout */}
          <button
            onClick={() => {
              clear();
              router.replace('/login');
            }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Log out</span>
          </button>
        </div>

        {/* Mobile nav (below header row) */}
        <nav className="flex sm:hidden items-center gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 text-xs">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/portal'
                ? pathname === '/portal'
                : pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 font-medium',
                  active
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
