import type { Metadata } from 'next';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { fetchPublicSite, fetchMarketingConfig } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import MarketingSite from '@/components/marketing/MarketingSite';
import { isPlatformHost } from '@/lib/hosts';

/** Real public profiles only — used for Organization.sameAs entity signals. */
const SOCIAL_PROFILES: string[] = [
  // Filled from Darshan's list (see plan header "User-supplied data").
  // Ship [] if no URLs were provided — never invent profiles.
];

const ICONS = {
  icon: [
    { url: '/favicon.ico', sizes: '48x48' },
    { url: '/icon-48.png', type: 'image/png', sizes: '48x48' },
    { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    { url: '/sckools-icon.svg', type: 'image/svg+xml' },
  ],
  apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
};

const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Sckools — school websites, admissions and the inter-school events network',
};

/** One fetch per request even though generateMetadata and the page both need it. */
const getPublicSite = cache(fetchPublicSite);

async function schoolMetadata(host: string): Promise<Metadata> {
  const data = await getPublicSite(host);
  if (!data) return {};
  const { school, profile, homepage } = data;
  const title = profile?.city ? `${school.name} — ${profile.city}` : school.name;
  const rawDesc =
    homepage?.subheadline ||
    homepage?.aboutText ||
    `${school.name}: admissions, academics, gallery, events and contact details.`;
  const description = rawDesc.replace(/\s+/g, ' ').trim().slice(0, 160);
  const icon = profile?.faviconUrl ?? profile?.logoUrl ?? null;
  return {
    title,
    description,
    ...(icon ? { icons: { icon } } : {}),
    openGraph: {
      title,
      description,
      siteName: school.name,
      type: 'website',
      ...(homepage?.heroUrl ? { images: [{ url: homepage.heroUrl }] } : {}),
    },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get('host') ?? '';
  if (!isPlatformHost(host)) return schoolMetadata(host);
  return {
    title: 'Sckools — The Complete Operating System for Schools',
    description:
      'Sckools runs your entire school online — a stunning website, admissions enquiry engine, management suite, portals and a live inter-school events network. Zero developers needed.',
    keywords: ['sckools', 'school operating system', 'school website builder', 'school management software', 'inter-school events', 'school admissions software', 'school website India'],
    alternates: { canonical: 'https://sckools.com/' },
    metadataBase: new URL('https://sckools.com'),
    icons: ICONS,
    openGraph: {
      title: 'Sckools — The Complete Operating System for Schools',
      description: 'Website, admissions, management, portals and an inter-school events network — one platform, zero developers needed.',
      url: 'https://sckools.com/',
      siteName: 'Sckools',
      type: 'website',
      locale: 'en_IN',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Sckools — The Complete Operating System for Schools',
      description: 'Website, admissions, management, portals and an inter-school events network — one platform.',
      images: ['/og.png'],
    },
    robots: { index: true, follow: true },
  };
}

export default async function HomePage() {
  const host = headers().get('host') ?? '';

  if (!isPlatformHost(host)) {
    const data = await getPublicSite(host);
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
    logo: 'https://sckools.com/icon-512.png',
    email: config.contactEmail,
    ...(config.contactPhone ? { telephone: config.contactPhone } : {}),
    description: 'School websites, admissions engine, management suite and an inter-school events network.',
    sameAs: SOCIAL_PROFILES,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <MarketingSite config={config} />
    </>
  );
}
