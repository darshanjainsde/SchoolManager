/**
 * Demo and sample tenants exist so the product can be shown; they must never
 * be advertised as real schools. Anything public that aggregates ACROSS
 * schools (the sitemap, the jobs board, the network blog) filters with this,
 * so a visitor never meets "Sckools Demo School" hiring a PGT for class 10.
 *
 * Remove a slug here the day that school becomes a paying customer.
 */
export const SAMPLE_SLUGS: ReadonlySet<string> = new Set(['acme', 'beacon', 'darshan', 'rishika', 'riverdale', 'demo']);

/** Slug or name that marks a tenant as a demo, however it was seeded. */
const SAMPLE_WORDS = /\b(demo|sample|sandbox|test)\b/i;

export function isSampleSchool(school: { slug?: string | null; name?: string | null }): boolean {
  const slug = (school.slug ?? '').toLowerCase();
  if (SAMPLE_SLUGS.has(slug)) return true;
  if (SAMPLE_WORDS.test(slug.replace(/[-_]/g, ' '))) return true;
  return SAMPLE_WORDS.test(school.name ?? '');
}
