import type { MetadataRoute } from 'next';

/**
 * A school's own sitemap. Pure so it can be tested without next/headers.
 *
 * Until this existed every tenant host answered /sitemap.xml with the
 * MARKETING sitemap: raffles.sckools.com told Google to index sckools.com/,
 * /pricing and the platform blog, and never listed its own admissions or
 * gallery pages. A school's sitemap lists the school's pages and nothing else.
 *
 * Which pages exist follows the feature keys that gate them (the same keys the
 * nav uses), so a Basic school never advertises a /contact page it cannot
 * serve.
 */
export interface SchoolSitemapInput {
  school: { features: string[] };
  pages?: { slug: string; showInNav?: boolean }[] | null;
}

const GATED: { path: string; feature: string; priority: number }[] = [
  { path: '/academics', feature: 'PUBLIC_SITE', priority: 0.8 },
  { path: '/admissions', feature: 'ENQUIRY', priority: 0.9 },
  { path: '/gallery', feature: 'GALLERY', priority: 0.6 },
  { path: '/contact', feature: 'ABOUT_CONTACT', priority: 0.7 },
  { path: '/connect', feature: 'EVENTS', priority: 0.6 },
  { path: '/blog', feature: 'BLOG', priority: 0.6 },
  { path: '/alumni', feature: 'ALUMNI', priority: 0.4 },
];

export function buildSchoolSitemap(origin: string, site: SchoolSitemapInput): MetadataRoute.Sitemap {
  const has = new Set(site.school.features ?? []);
  const base = origin.replace(/\/+$/, '');
  const urls: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: 'weekly', priority: 1 }];
  for (const g of GATED) {
    if (has.has(g.feature)) urls.push({ url: `${base}${g.path}`, changeFrequency: 'monthly', priority: g.priority });
  }
  for (const p of site.pages ?? []) {
    if (p.slug) urls.push({ url: `${base}/p/${encodeURIComponent(p.slug)}`, changeFrequency: 'monthly', priority: 0.5 });
  }
  return urls;
}
