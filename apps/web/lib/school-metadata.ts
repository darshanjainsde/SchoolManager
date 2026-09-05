import type { Metadata } from 'next';
import { cache } from 'react';
import { fetchPublicSite } from '@/lib/public-api';

/**
 * The <head> for a school's public site.
 *
 * Lifted out of app/page.tsx when the host-routed copy at /s/[host] was added,
 * so the two cannot drift: a school whose title tag depended on which route
 * happened to serve it would be a search-visibility bug nobody would notice
 * for months.
 */
/** One fetch per request even though generateMetadata and the page both need it. */
export const getPublicSite = cache(fetchPublicSite);

export async function schoolMetadata(host: string): Promise<Metadata> {
  const data = await getPublicSite(host);
  if (!data) return {};
  const { school, profile, homepage } = data;
  const title = profile?.city ? `${school.name} — ${profile.city}` : school.name;
  const rawDesc =
    homepage?.subheadline ||
    homepage?.aboutText ||
    `${school.name}: admissions, academics, gallery, events and contact details.`;
  const description = rawDesc.replace(/\s+/g, ' ').trim().slice(0, 160);
  const icon = profile?.faviconUrl ?? profile?.logoUrl ?? null;
  return {
    title,
    description,
    ...(icon ? { icons: { icon } } : {}),
    openGraph: {
      title,
      description,
      siteName: school.name,
      type: 'website',
      ...(homepage?.heroUrl ? { images: [{ url: homepage.heroUrl }] } : {}),
    },
  };
}

