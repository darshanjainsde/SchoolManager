import type { PublicSiteData } from '@/lib/public-api';

/**
 * Structured data for a school's homepage: the one block that makes
 * "<school name> <city>" searches show the school's own site with its phone
 * and address. Tenant homepages shipped with no JSON-LD and no canonical,
 * while the product's own blog tells schools SEO basics matter.
 *
 * Only facts the school entered are emitted; nothing is invented to fill a
 * field, so a school with no address simply has no address property.
 */
export function schoolJsonLd(host: string, data: Pick<PublicSiteData, 'school' | 'profile'>) {
  const origin = `https://${host.split(':')[0]}`;
  const p = data.profile;
  const address =
    p?.addressLine1 || p?.city || p?.postalCode
      ? {
          '@type': 'PostalAddress',
          ...(p.addressLine1 ? { streetAddress: [p.addressLine1, p.addressLine2].filter(Boolean).join(', ') } : {}),
          ...(p.city ? { addressLocality: p.city } : {}),
          ...(p.region ? { addressRegion: p.region } : {}),
          ...(p.postalCode ? { postalCode: p.postalCode } : {}),
          addressCountry: p.country || 'IN',
        }
      : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'School',
    name: data.school.name,
    url: `${origin}/`,
    ...(p?.logoUrl ? { logo: p.logoUrl } : {}),
    ...(p?.phone ? { telephone: p.phone } : {}),
    ...(p?.email ? { email: p.email } : {}),
    ...(address ? { address } : {}),
  };
}
