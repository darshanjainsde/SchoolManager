import type { Metadata } from 'next';
import { schoolPageMetadata } from '@/lib/school-metadata';
import { notFound } from 'next/navigation';
import PublicSite from '@/components/public/PublicSite';
import { loadSchoolSite } from '@/lib/school-view';
import { fetchPublicBirthdays } from '@/lib/public-api';

/**
 * The birthday wall, gated on the school's own switch and audience.
 *
 * Addressed by host as a route, not a header — middleware rewrites
 * <school>/birthdays here and the visitor's URL is untouched. Same shape as
 * app/s/[host]/gallery/page.tsx; see app/s/[host]/page.tsx for why
 * `revalidate` and the empty `generateStaticParams` matter.
 */
// Literal, not an imported constant: Next requires segment config to be
// statically analysable and rejects the build otherwise.
export const revalidate = 60;
export function generateStaticParams(): { host: string }[] {
  return [];
}

// Children's names are not search results (spec D8).
/**
 * The school's own name and mark in the tab — and STILL out of the index.
 * `metadata` and `generateMetadata` cannot both be exported, so the noindex
 * that kept children's birthdays off search engines lives in here now.
 */
export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const { host } = await params;
  return { ...(await schoolPageMetadata(decodeURIComponent(host), 'Birthdays')), robots: { index: false, follow: false } };
}

export default async function SchoolBirthdays({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const data = await loadSchoolSite(host);
  if (!data.celebrations?.enabled) notFound();
  const birthdays = await fetchPublicBirthdays(decodeURIComponent(host), data.celebrations.window);
  if (!birthdays) notFound();
  return <PublicSite data={data} view="birthdays" birthdays={birthdays} />;
}
