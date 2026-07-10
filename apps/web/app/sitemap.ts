import type { MetadataRoute } from 'next';
import { fetchDirectory } from '@/lib/public-api';

/**
 * Marketing pages + every LIVE school's homepage. sckools.com is verified as
 * a Domain property in Search Console, so subdomain URLs here are valid and
 * get each new school discovered by Google the day it goes live. Only the
 * school root is listed — sub-pages vary by tier/content and Google crawls
 * them from the homepage's own links.
 */
/**
 * Demo/sample schools that must never be advertised to search engines.
 * Remove a slug here if that school ever becomes a real customer.
 */
const SAMPLE_SLUGS = new Set(['acme', 'beacon', 'darshan', 'rishika', 'riverdale']);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const marketing: MetadataRoute.Sitemap = [
    { url: 'https://sckools.com/', changeFrequency: 'weekly', priority: 1 },
    { url: 'https://sckools.com/pricing', changeFrequency: 'weekly', priority: 0.9 },
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
