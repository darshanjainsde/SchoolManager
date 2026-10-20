import type { MetadataRoute } from 'next';
import { fetchDirectory } from '@/lib/public-api';
import { fetchGlobalBlog } from '@/lib/blog-api';
import { fetchPublicSite } from '@/lib/public-api';
import { getRequestHost } from '@/lib/request';
import { isPlatformHost } from '@/lib/hosts';
import { SAMPLE_SLUGS } from '@/lib/sample-schools';
import { buildSchoolSitemap } from '@/lib/school-sitemap';

/**
 * Marketing pages + every LIVE school's homepage. sckools.com is verified as
 * a Domain property in Search Console, so subdomain URLs here are valid and
 * get each new school discovered by Google the day it goes live. Only the
 * school root is listed — sub-pages vary by tier/content and Google crawls
 * them from the homepage's own links.
 */
/**
 * On a school's own host this is THAT school's sitemap (its root and the
 * pages its tier serves), never the marketing one: before this every tenant
 * answered /sitemap.xml with sckools.com's pages and none of its own.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = await getRequestHost();
  if (host && !isPlatformHost(host)) {
    const site = await fetchPublicSite(host);
    if (!site) return [];
    return buildSchoolSitemap(`https://${host.split(':')[0]}`, { school: site.school, pages: (site as { pages?: { slug: string }[] }).pages ?? null });
  }
  const globalBlog = await fetchGlobalBlog();
  const marketing: MetadataRoute.Sitemap = [
    { url: 'https://sckools.com/', changeFrequency: 'weekly', priority: 1 },
    { url: 'https://sckools.com/pricing', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://sckools.com/features', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://sckools.com/start', changeFrequency: 'monthly', priority: 0.6 },
    { url: 'https://sckools.com/school-website-builder', changeFrequency: 'weekly', priority: 0.9 },
    { url: 'https://sckools.com/blog', changeFrequency: 'weekly', priority: 0.7 },
    { url: 'https://sckools.com/about', changeFrequency: 'monthly', priority: 0.5 },
    ...(globalBlog?.posts ?? []).map((p) => ({
      url: `https://sckools.com/blog/${p.slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];

  const schools = await fetchDirectory();
  const schoolUrls: MetadataRoute.Sitemap = schools
    .filter((s) => !SAMPLE_SLUGS.has(s.slug))
    .map((s) => ({
      url: `https://${s.host.split(':')[0]}/`,
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

  return [...marketing, ...schoolUrls];
}
