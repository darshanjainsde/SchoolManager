export interface PublicSiteData {
  school: {
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    features: string[];
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
  } | null;
  homepage: {
    headline: string;
    subheadline: string | null;
    heroUrl: string | null;
    aboutText: string | null;
    principalName: string | null;
    principalMessage: string | null;
    principalPhotoUrl: string | null;
  } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];
  gallery: { url: string; caption: string | null }[];
  staff: { name: string; role: string; photoUrl: string | null }[];
  menu: { label: string; gradeId: string }[];
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

export async function fetchPublicSite(host: string): Promise<PublicSiteData | null> {
  // Server-to-server call (Next server → API). Prefer an explicit server-side
  // base, then fall back to the public URL. Normalise `localhost` → `127.0.0.1`
  // because Node's fetch (undici) resolves `localhost` to IPv6 `::1`, which the
  // API (bound to IPv4 0.0.0.0) refuses — silently turning every fetch into null.
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/public/site`, {
      headers: { 'X-Forwarded-Host': host },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json() as Promise<PublicSiteData>;
  } catch {
    return null;
  }
}
