import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { admissionsHasContent } from '@/components/public/site-utils';
import { isPlatformHost } from '@/lib/hosts';

export default async function AdmissionsPage() {
  const host = headers().get('host') ?? '';
  if (isPlatformHost(host)) notFound();

  const data = await fetchPublicSite(host);
  if (!data || !admissionsHasContent(data.admissions, data.courses)) notFound();

  return <PublicSite data={data} view="admissions" />;
}
