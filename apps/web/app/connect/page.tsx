import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { isPlatformHost } from '@/lib/hosts';

export default async function ConnectPage() {
  const host = headers().get('host') ?? '';
  if (isPlatformHost(host)) notFound();

  const data = await fetchPublicSite(host);
  if (!data || !data.school.features.includes('EVENTS')) notFound();

  return <PublicSite data={data} view="events" />;
}
