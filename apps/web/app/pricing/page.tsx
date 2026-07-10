import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { fetchMarketingConfig } from '@/lib/public-api';
import PricingCards from '@/components/marketing/PricingCards';

export const metadata: Metadata = {
  title: 'Sckools Pricing — Basic, Standard & Pro Plans for Schools',
  description:
    'Transparent pricing for school websites, admissions and the inter-school events network. Every plan includes hosting, your own domain and 2 months of custom feature support.',
  alternates: { canonical: 'https://sckools.com/pricing' },
  openGraph: {
    title: 'Sckools Pricing — Plans for Every School',
    description: 'Basic, Standard and Pro plans for school websites, admissions and inter-school events.',
    url: 'https://sckools.com/pricing',
    siteName: 'Sckools',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Sckools Pricing' },
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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PricingCards config={config} />
    </>
  );
}
