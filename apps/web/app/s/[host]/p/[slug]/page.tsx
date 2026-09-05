import { notFound } from 'next/navigation';
import PublicSite from '@/components/public/PublicSite';
import { loadSchoolSite } from '@/lib/school-view';

/**
 * An admin-built page (Transport, Scholarships, Alumni…) at its frozen slug.
 * Unpublished or unknown slugs 404 like any other missing page.
 */
// Literal, not an imported constant: Next requires segment config to be
// statically analysable and rejects the build otherwise.
export const revalidate = 60;
export function generateStaticParams(): { host: string; slug: string }[] {
  return [];
}

export default async function SchoolCustomPage({
  params,
}: {
  params: Promise<{ host: string; slug: string }>;
}) {
  const { host, slug } = await params;
  const data = await loadSchoolSite(host);
  const page = data.pages?.find((p) => p.slug === slug);
  if (!page) notFound();
  return <PublicSite data={data} view="page" page={page} />;
}
