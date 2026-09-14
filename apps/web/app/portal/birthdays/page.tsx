'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import BirthdaysSection from '@/components/public/sections/BirthdaysSection';
import { PS_CSS } from '@/components/public/ps-css';
import type { BirthdaysResult, PublicSiteData } from '@/lib/public-api';

/**
 * The birthday wall for a signed-in family (audience FAMILIES or BOTH). The
 * section is the public site's own, so it wears the school's colours: the
 * page hands it the `.ps-root` tokens from the school's public profile.
 */
export default function PortalBirthdaysPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const site = useQuery({
    queryKey: ['public-site', host],
    queryFn: () => api.get<PublicSiteData>('/public/site'),
    enabled: !!host,
    staleTime: 60_000,
  });
  const wall = useQuery({
    queryKey: ['me-birthdays', host],
    queryFn: () => api.get<BirthdaysResult>('/me/birthdays'),
    enabled: !!host,
    retry: false,
  });

  const c = site.data?.celebrations;
  if (wall.isLoading || site.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (wall.error || !wall.data || !c) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-slate-900">Birthdays</h1>
        <p className="mt-1 text-sm text-slate-600">
          Your school has not switched on the birthday wall for families yet. When it does, the birthdays in your child&rsquo;s
          class will show here.
        </p>
      </div>
    );
  }
  const p = site.data?.profile;
  return (
    <div
      className="ps-root"
      style={
        {
          '--ps1': p?.brandColorPrimary ?? '#4F46E5',
          '--ps2': p?.brandColorSecondary ?? '#F59E0B',
          '--ink': '#0F172A',
          '--paper': '#FFFFFF',
        } as React.CSSProperties
      }
    >
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />
      <BirthdaysSection data={wall.data} style={c.page} wishLine={c.wishLine} schoolName={site.data?.school.name ?? 'your school'} onOwnPage />
    </div>
  );
}
