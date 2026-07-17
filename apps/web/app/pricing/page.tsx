import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { fetchMarketingConfig } from '@/lib/public-api';
import PricingCards from '@/components/marketing/PricingCards';
import PricingFaq from '@/components/marketing/PricingFaq';
import { PRICING_FAQ } from '@/components/marketing/pricing-faq-data';

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

export const metadata: Metadata = {
  title: 'Sckools Pricing — Basic, Standard & Pro Plans for Schools',
  description:
    'Transparent pricing for school websites, admissions and the inter-school events network. Every plan includes hosting, your own domain and 2 months of custom feature support.',
  alternates: { canonical: 'https://sckools.com/pricing' },
  metadataBase: new URL('https://sckools.com'),
  icons: ICONS,
  openGraph: {
    title: 'Sckools Pricing — Plans for Every School',
    description: 'Basic, Standard and Pro plans for school websites, admissions and inter-school events.',
    url: 'https://sckools.com/pricing',
    siteName: 'Sckools',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sckools pricing — plans for every school' }],
  },
  twitter: { card: 'summary_large_image', title: 'Sckools Pricing', images: ['/og.png'] },
};

export default async function PricingPage() {
  const host = headers().get('host') ?? '';
  // Pricing belongs to the platform site only — a school host must 404.
  if (!isPlatformHost(host)) notFound();

  const config = await fetchMarketingConfig();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Sckools school website platform',
    description: 'School websites, admissions engine, management suite and an inter-school events network.',
    brand: { '@type': 'Brand', name: 'Sckools' },
    offers: [
      { '@type': 'Offer', name: 'Basic', price: config.prices.basic.usd, priceCurrency: 'USD', url: 'https://sckools.com/pricing' },
      { '@type': 'Offer', name: 'Standard', price: config.prices.standard.usd, priceCurrency: 'USD', url: 'https://sckools.com/pricing' },
      { '@type': 'Offer', name: 'Pro', price: config.prices.pro.usd, priceCurrency: 'USD', url: 'https://sckools.com/pricing' },
    ],
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PRICING_FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PricingCards config={config} />
      <PricingFaq />
    </>
  );
}
