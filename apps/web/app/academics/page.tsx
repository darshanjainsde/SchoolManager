import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';

/** Dedicated programmes page for a school (tenant) host — same chrome as the homepage. */
export default async function AcademicsPage() {
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();

  const data = await fetchPublicSite(host);
  if (!data || data.courses.length === 0) notFound();

  return <PublicSite data={data} view="academics" />;
}
