'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Users, GraduationCap, BookOpen, Layers, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/lib/use-api';

interface MeResponse {
  userId: string;
  schoolId: string;
  role: 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF';
}

/**
 * Tenant-themed shell. Reads /auth/me on mount so we know the user's role
 * (which drives which sidebar items render). Theming is intentionally light
 * — Phase 3 surfaces existing brandColors via inline CSS variables; the full
 * theming pass lands when we add `/api/school` settings.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const me = useQuery({
    queryKey: ['me'],
    enabled: !!refreshToken && audience === 'school' && !!host,
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  useEffect(() => {
    if (!refreshToken || audience !== 'school') {
      router.replace('/login');
    }
  }, [refreshToken, audience, router]);

  if (!refreshToken || audience !== 'school') return null;

  const role = me.data?.role;
  const items = [
    { href: '/app', label: 'Dashboard', icon: LayoutDashboard, roles: ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'] },
    { href: '/app/people', label: 'People', icon: Users, roles: ['SCHOOL_ADMIN', 'STAFF'] },
    { href: '/app/grades', label: 'Grades', icon: Layers, roles: ['SCHOOL_ADMIN', 'STAFF'] },
    { href: '/app/classes', label: 'Classes', icon: GraduationCap, roles: ['SCHOOL_ADMIN', 'TEACHER', 'STAFF'] },
    { href: '/app/subjects', label: 'Subjects', icon: BookOpen, roles: ['SCHOOL_ADMIN', 'TEACHER', 'STAFF'] },
    { href: '/app/enrollments', label: 'Enrollment', icon: Users, roles: ['SCHOOL_ADMIN', 'STAFF'] },
    { href: '/app/settings', label: 'Settings', icon: Settings, roles: ['SCHOOL_ADMIN'] },
  ].filter((i) => !role || i.roles.includes(role));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold text-slate-900">{host?.split(':')[0]}</div>
          <div className="text-xs text-slate-500 capitalize">{role?.toLowerCase().replace('_', ' ')}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/app' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded px-3 py-2 text-sm',
                  active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={async () => {
            const rt = useAuthStore.getState().refreshToken;
            if (rt) {
              await api.post('/auth/logout', { refreshToken: rt }).catch(() => undefined);
            }
            clear();
            router.replace('/login');
          }}
          className="mt-2 flex items-center gap-3 rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </aside>
      <main className="flex-1 p-6 sm:p-10">{children}</main>
    </div>
  );
}
