import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchPublicSite, fetchMarketingConfig } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import MarketingSite from '@/components/marketing/MarketingSite';
import { isPlatformHost } from '@/lib/hosts';

export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get('host') ?? '';
  if (!isPlatformHost(host)) return {}; // school sites keep the layout default
  return {
    title: 'Sckools — School Websites, Admissions & Inter-School Events Network',
    description:
      'Sckools gives your school a stunning website, an admissions enquiry engine, effortless management — and a live network where students from different schools compete, connect and win bigger.',
    keywords: ['sckools', 'school website builder', 'school management software', 'inter-school events', 'school admissions software', 'school website India'],
    alternates: { canonical: 'https://sckools.com/' },
    metadataBase: new URL('https://sckools.com'),
    openGraph: {
      title: 'Sckools — Your school, on a bigger stage',
      description: 'School websites, admissions, management and an inter-school events network — one platform, zero developers needed.',
      url: 'https://sckools.com/',
      siteName: 'Sckools',
      type: 'website',
      locale: 'en_IN',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Sckools — Your school, on a bigger stage',
      description: 'School websites, admissions, management and an inter-school events network.',
    },
    robots: { index: true, follow: true },
  };
}

export default async function HomePage() {
  const host = headers().get('host') ?? '';

  if (!isPlatformHost(host)) {
    const data = await fetchPublicSite(host);
    if (data) {
      return <PublicSite data={data} />;
    }
    // A school-style host that resolves to no live site (unknown/suspended/not
    // yet live) must 404 — never fall through to platform pages.
    notFound();
  }

  const config = await fetchMarketingConfig();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Sckools',
    url: 'https://sckools.com',
    email: config.contactEmail,
    ...(config.contactPhone ? { telephone: config.contactPhone } : {}),
    description: 'School websites, admissions engine, management suite and an inter-school events network.',
    sameAs: [],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <MarketingSite config={config} />
    </>
  );
}
