import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PublicSite from '@/components/public/PublicSite';
import { loadSchoolSite } from '@/lib/school-view';
import { fetchPublicRecords } from '@/lib/public-api';

/**
 * The Book of Records, gated on the school's own switch and consent (the API
 * answers 404 otherwise). Addressed by host as a route, not a header —
 * middleware rewrites <school>/records here; same shape as birthdays/page.tsx.
 */
// Literal, not an imported constant: Next requires segment config to be
// statically analysable and rejects the build otherwise.
export const revalidate = 60;
export function generateStaticParams(): { host: string }[] {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const { host } = await params;
  const data = await loadSchoolSite(host);
  return { title: `Book of Records · ${data.school.name}`, description: `School sports records at ${data.school.name}: every verified record and the all-time bests.` };
}

export default async function SchoolRecords({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const data = await loadSchoolSite(host);
  if (!data.records?.enabled) notFound();
  const records = await fetchPublicRecords(decodeURIComponent(host));
  if (!records) notFound();
  return <PublicSite data={data} view="records" records={records} />;
}
