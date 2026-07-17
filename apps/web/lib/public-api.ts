export interface PublicSiteData {
  school: {
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    features: string[];
    timezone: string;
  };
  profile: {
    logoUrl: string | null;
    faviconUrl: string | null;
    brandColorPrimary: string;
    brandColorSecondary: string;
    phone: string | null;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    mapEmbedUrl: string | null;
    headingFont: string;
    heroStyle: string;
    animationLevel: string;
    heroLayout: string;
    heroTextAlign: string;
    heroOverlayStyle: string;
    heroOverlayOpacity: number;
    heroHeight: string;
    headlineAccent: string;
    navStyle: string;
    navColor: string;
    navTextColor: string;
    navCtaLabel: string;
    navShowCta: boolean;
  } | null;
  homepage: {
    headline: string;
    subheadline: string | null;
    heroUrl: string | null;
    heroImages: string[];
    aboutText: string | null;
    principalName: string | null;
    principalMessage: string | null;
    principalPhotoUrl: string | null;
    aboutImageUrl: string | null;
    showAdmissions: boolean;
    showGallery: boolean;
    showEvents: boolean;
    showContact: boolean;
  } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];
  gallery: { url: string; caption: string | null }[];
  staff: { name: string; role: string; photoUrl: string | null }[];
  courses: PublicCourse[];
  admissions: {
    steps: { title: string; description: string | null }[];
    showFees: boolean;
    feeNote: string | null;
  };
  events: {
    id: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    startAt: string;
    endAt: string | null;
    venue: string | null;
    scope: 'SCHOOL' | 'NETWORK';
    originSchoolName: string | null;
    isHost: boolean;
  }[];
}

export interface PublicCourse {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  highlights: string[];
  ageRange: string | null;
  imageUrl: string | null;
  featured: boolean;
  fee: { admissionFee: string | null; annualFee: string | null; includes: string | null } | null;
  hallOfFame: { rank: number; name: string; achievement: string | null; year: string | null; photoUrl: string | null }[];
}

export interface DirectorySchool {
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  host: string;
}

/** Server-side fetch of the LIVE-school directory for the platform landing page. */
export async function fetchDirectory(): Promise<DirectorySchool[]> {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/directory`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as DirectorySchool[];
  } catch {
    return [];
  }
}

export async function fetchPublicSite(host: string): Promise<PublicSiteData | null> {
  // Server-to-server call (Next server → API). Prefer an explicit server-side
  // base, then fall back to the public URL. Normalise `localhost` → `127.0.0.1`
  // because Node's fetch (undici) resolves `localhost` to IPv6 `::1`, which the
  // API (bound to IPv4 0.0.0.0) refuses — silently turning every fetch into null.
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/public/site`, {
      // Send both: X-Skoolos-Host survives ingress that rewrites
      // X-Forwarded-Host (e.g. Vercel); the API prefers X-Skoolos-Host.
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<PublicSiteData>;
  } catch {
    return null;
  }
}

// ── Marketing site (sckools.com) ────────────────────────────────────────────

export interface MarketingConfigData {
  prices: {
    basic: { usd: number; inr: number };
    standard: { usd: number; inr: number };
    pro: { usd: number; inr: number };
  };
  contactEmail: string;
  contactPhone: string;
}

const MARKETING_DEFAULTS: MarketingConfigData = {
  prices: {
    basic: { usd: 19, inr: 999 },
    standard: { usd: 49, inr: 2499 },
    pro: { usd: 99, inr: 4999 },
  },
  contactEmail: 'admin@sckools.com',
  contactPhone: '',
};

/** Owner-editable pricing/contact for the marketing pages (60 s revalidate). */
export async function fetchMarketingConfig(): Promise<MarketingConfigData> {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/marketing/config`, { next: { revalidate: 60 } });
    if (!res.ok) return MARKETING_DEFAULTS;
    return (await res.json()) as MarketingConfigData;
  } catch {
    return MARKETING_DEFAULTS;
  }
}
