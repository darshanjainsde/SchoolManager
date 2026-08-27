import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';

/**
 * The alumni wing, on the school's own public site.
 *
 * A view of PublicSite rather than a page of its own — exactly as /connect is
 * for events. That is what gives it the school's chosen theme, its fonts, its
 * nav and its footer for free. The first version was a standalone page in the
 * ADMIN portal theme, which put two visually different products on one domain
 * and left the tab missing from the school's menu entirely.
 */
export default async function AlumniPage() {
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();

  const data = await fetchPublicSite(host);
  if (!data || !data.school.features.includes('ALUMNI')) notFound();

  return <PublicSite data={data} view="alumni" />;
}
