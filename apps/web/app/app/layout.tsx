'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { LayoutDashboard, Globe, LogOut, School, Users, GraduationCap, CalendarDays, Clock, CalendarHeart } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';

const NAV_ITEMS = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/website', label: 'Website', icon: Globe },
  { href: '/app/classes', label: 'Classes', icon: School },
  { href: '/app/teachers', label: 'Teachers', icon: GraduationCap },
  { href: '/app/students', label: 'Students', icon: Users },
  { href: '/app/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/app/availability', label: 'Availability', icon: Clock },
  { href: '/app/events', label: 'Events', icon: CalendarHeart },
];

export default function AppLayout({ children }: { children: ReactNode }) {
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
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
