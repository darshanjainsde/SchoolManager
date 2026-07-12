'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, ClipboardCheck, FileText, Receipt, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

export default function MeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const me = useQuery({
    queryKey: ['me'],
    enabled: !!refreshToken && audience === 'school' && !!host,
    queryFn: () => api.get<{ role: string }>('/auth/me'),
  });

  useEffect(() => {
    if (!refreshToken || audience !== 'school') router.replace('/login');
  }, [refreshToken, audience, router]);

  if (!refreshToken) return null;

  const items = [
    { href: '/me', label: 'Overview', icon: LayoutDashboard },
    { href: '/me/attendance', label: 'Attendance', icon: ClipboardCheck },
    { href: '/me/assignments', label: 'Assignments', icon: FileText },
    { href: '/me/results', label: 'Results', icon: FileText },
    { href: '/me/invoices', label: 'Invoices', icon: Receipt },
    { href: '/me/profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <div className="mb-6 px-2">
          <SckoolsLogo size={26} className="mb-2" />
          <div className="text-sm font-semibold">{me.data?.role === 'PARENT' ? 'Parent portal' : 'Student portal'}</div>
          <div className="text-xs text-slate-500">{host?.split(':')[0]}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/me' && pathname.startsWith(href));
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
            if (rt) await api.post('/auth/logout', { refreshToken: rt }).catch(() => undefined);
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
