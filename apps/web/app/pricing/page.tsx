import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestCountry, getRequestHost } from '@/lib/request';
import { fetchMarketingConfig } from '@/lib/public-api';
import { currencyForCountry, fetchUsdRates } from '@/lib/fx';
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

/** Annual Offer node — plans are billed once a year, in USD or INR. */
function annualOffer(name: string, price: number) {
  return {
    '@type': 'Offer',
    name,
    price,
    priceCurrency: 'USD',
    url: 'https://sckools.com/pricing',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: 'USD',
      unitCode: 'ANN',
      unitText: 'year',
    },
  };
}

export default async function PricingPage() {
  const host = await getRequestHost();
  // Pricing belongs to the platform site only — a school host must 404.
  if (!isPlatformHost(host)) notFound();

  const [config, rates, country] = await Promise.all([
    fetchMarketingConfig(),
    fetchUsdRates(),
    getRequestCountry(),
  ]);
  const initialCurrency = currencyForCountry(country);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Sckools school website platform',
    description: 'School websites, admissions engine, management suite and an inter-school events network.',
    brand: { '@type': 'Brand', name: 'Sckools' },
    offers: [
      annualOffer('Basic', config.prices.basic.usd),
      annualOffer('Standard', config.prices.standard.usd),
      annualOffer('Pro', config.prices.pro.usd),
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
      <PricingCards config={config} rates={rates} initialCurrency={initialCurrency} />
      <PricingFaq />
    </>
  );
}
