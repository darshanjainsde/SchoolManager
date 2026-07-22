'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ClipboardCheck,
  BookOpen,
  FileText,
  GraduationCap,
  Megaphone,
  Inbox,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import '../sk-theme.css';

export default function TeacherLayout({ children }: { children: ReactNode }) {
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
    if (me.data && me.data.role !== 'TEACHER' && me.data.role !== 'SCHOOL_ADMIN') router.replace('/app');
  }, [refreshToken, audience, me.data, router]);

  if (!refreshToken) return null;

  const items = [
    { href: '/teacher', label: 'My classes', icon: LayoutDashboard },
    { href: '/teacher/attendance', label: 'Attendance', icon: ClipboardCheck },
    { href: '/teacher/tests', label: 'Tests', icon: FileText },
    { href: '/teacher/results', label: 'Results', icon: GraduationCap },
    { href: '/teacher/assignments', label: 'Assignments', icon: BookOpen },
    { href: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
    { href: '/teacher/inbox', label: 'Inbox', icon: Inbox },
  ];

  const isActive = (href: string) => pathname === href || (href !== '/teacher' && pathname.startsWith(href));

  return (
    <div className="skosx sk-app">
      <aside className="sk-side">
        <div className="sk-side-brand">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="role">Teacher portal</div>
          <div className="sub">{host?.split(':')[0]}</div>
        </div>
        <div className="sk-navlabel">Classroom</div>
        <nav className="flex flex-col gap-[3px]">
          {items.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sk-nav" data-active={isActive(href)}>
              <Icon className="ic" aria-hidden="true" /> {label}
            </Link>
          ))}
        </nav>
        <div className="sk-side-foot">
          <div style={{ padding: '8px 11px' }}><ThemeToggle /></div>
          <button
            onClick={async () => {
              const rt = useAuthStore.getState().refreshToken;
              if (rt) await api.post('/auth/logout', { refreshToken: rt }).catch(() => undefined);
              clear();
              router.replace('/login');
            }}
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
