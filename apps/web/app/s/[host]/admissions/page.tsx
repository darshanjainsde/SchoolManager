import { notFound } from 'next/navigation';
import PublicSite from '@/components/public/PublicSite';
import { admissionsHasContent } from '@/components/public/site-utils';
import { loadSchoolSite } from '@/lib/school-view';

/**
 * Admissions, only once the school has filled it in.
 *
 * Addressed by host as a route, not a header — middleware rewrites
 * <school>/admissions here and the visitor's URL is untouched. Reading the host
 * from `headers()` is what made this page uncacheable; see app/s/[host]/page.tsx.
 */
// Literal, not an imported constant: Next requires segment config to be
// statically analysable and rejects the build otherwise.
export const revalidate = 60;
export function generateStaticParams(): { host: string }[] {
  return [];
}

export default async function SchoolView({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const data = await loadSchoolSite(host);
  if (!admissionsHasContent(data.admissions, data.courses)) notFound();
  return <PublicSite data={data} view="admissions" />;
}
