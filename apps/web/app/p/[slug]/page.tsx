import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';

/**
 * An admin-built page (Transport, Scholarships, Alumni…), served at its FROZEN
 * slug. Unpublished or unknown slugs 404 like any other missing page.
 */
export default async function SchoolCustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();

  const data = await fetchPublicSite(host);
  const page = data?.pages?.find((p) => p.slug === slug);
  if (!data || !page) notFound();

  return <PublicSite data={data} view="page" page={page} />;
}
