import { notFound } from 'next/navigation';
import PublicSite from '@/components/public/PublicSite';
import { loadSchoolSite } from '@/lib/school-view';

/**
 * Programmes. A school with no courses has no programmes page.
 *
 * Addressed by host as a route, not a header — middleware rewrites
 * <school>/academics here and the visitor's URL is untouched. Reading the host
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
  if (data.courses.length === 0) notFound();
  return <PublicSite data={data} view="academics" />;
}
