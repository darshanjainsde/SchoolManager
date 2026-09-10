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
    /** Optional: the api may predate the column by a few minutes on deploy. */
    sectionShape?: string;
    motionGesture?: string;
    backgroundTexture?: string;
    /** The school's own menu arrangement; absent = the default model. */
    navConfig?: { items: { key: string; slug: string; label: string; behaviour: 'menu' | 'page' | 'overview'; children: { key: string; label: string }[] }[] } | null;
    navStyle: string;
    navColor: string;
    navTextColor: string;
    navCtaLabel: string;
    navShowCta: boolean;
    navShowLogin: boolean;
    navLoginLabel: string;
    navLoginStyle?: string;
    /** Website-studio axes. All optional: the api may predate them on deploy. */
    scrollFeel?: string;
    navDropdownAnim?: string;
    heroMedia?: string;
    heroVideoUrl?: string | null;
    sectionVariants?: unknown;
    festiveTheme?: unknown;
    footerConfig?: unknown;
    customSectionCss?: unknown;
    /** Sanitized server-side on write; rendered as-is before the footer. */
    customHtmlBlock?: string | null;
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
    showBirthdays: boolean;
  } | null;
  /** Birthdays & celebrations (Track B): settings only; rows come from fetchPublicBirthdays. */
  celebrations: {
    enabled: boolean;
    placement: 'TEASER_AND_PAGE' | 'PAGE_ONLY';
    audience: 'FAMILIES' | 'PUBLIC' | 'BOTH';
    teaser: 'CAKE_BADGE' | 'RIBBON';
    page: 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD';
    nameFormat: 'FIRST' | 'FIRST_INITIAL' | 'FULL';
    showClass: boolean;
    wishLine: string;
    window: 'TODAY' | 'WEEK' | 'MONTH';
  } | null;
  /** The Book of Records (Sports wing): the page exists and how it is laid out; lines come from fetchPublicRecords. */
  records: { enabled: true; pageLayout: 'SCOREBOARD' | 'REGISTER' | 'CABINET' | 'PROGRESSION'; showTopFive: boolean } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];
  gallery: { url: string; caption: string | null }[];
  staff: { name: string; role: string; photoUrl: string | null }[];
  courses: PublicCourse[];
  /** Batches × groups × podium. Absent/null = nothing to show. */
  hallOfFame?: PublicHallOfFame | null;
  admissions: {
    steps: { title: string; description: string | null }[];
    showFees: boolean;
    feeNote: string | null;
  };
  /** Admin-built pages (published only). Optional: older api payloads lack it. */
  pages?: { slug: string; title: string; blocks: unknown; showInNav?: boolean }[];
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
    // Registration facts. OPTIONAL on purpose: web and api are two Vercel
    // projects fed by the same push and live in mixed versions for minutes, so
    // the page has to render against an api that has never heard of them.
    /** The ticket a public join registers against. Null = nothing to join. */
    ticketTypeId?: string | null;
    /** null = uncapped. 0 is real: sold out by configuration. */
    capacity?: number | null;
    /** null means UNKNOWN — uncapped, or another school's event we cannot count. */
    seatsLeft?: number | null;
    registrationOpen?: boolean;
    priceMinor?: number;
    currency?: string;
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

export interface PublicHallOfFameEntry {
  batchYear: number;
  rank: number;
  name: string;
  achievement: string | null;
  photoUrl: string | null;
}
export interface PublicHallOfFameGroup {
  id: string;
  label: string;
  entries: PublicHallOfFameEntry[];
}
export interface PublicHallOfFame {
  /** The batch the section opens on. */
  landingYear: number;
  /** Newest first — the chips a visitor can pick. */
  years: number[];
  /** Only groups with a podium inside the shown years. */
  groups: PublicHallOfFameGroup[];
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
      // Was `cache: 'no-store'`, which did two things: it re-ran eleven
      // database queries on every single view of every school website, and —
      // because a no-store fetch opts the route into dynamic rendering — it
      // was one of the two reasons no public page could ever be cached.
      //
      // Tagged per host so a school's own publish can purge exactly its own
      // pages and nobody else's; 60s is the backstop until that purge is
      // wired from the API.
      next: { revalidate: 60, tags: [`site:${host}`] },
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

// ── Birthdays (Active Roster, Track B) ──────────────────────────────────────

/** One birthday on the wall: day and month only — never a year, an age or an id. */
export interface BirthdayRow {
  day: number;
  month: number;
  name: string;
  classLabel: string | null;
  photoUrl: string | null;
  key: string;
}

export interface BirthdaysResult {
  /** The school's "today", YYYY-MM-DD in its own timezone. */
  generatedFor: string;
  window: 'TODAY' | 'WEEK' | 'MONTH';
  today: BirthdayRow[];
  upcoming: BirthdayRow[];
  next: BirthdayRow | null;
  maxAge: number;
}

/**
 * The birthday wall for a school host. Null when the school has not switched
 * Birthdays on for the public (the API answers 404). Same server-side base,
 * headers and per-host tag as fetchPublicSite, so a school's publish purges it.
 */
export async function fetchPublicBirthdays(host: string, window?: string): Promise<BirthdaysResult | null> {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  const qs = window ? `?window=${encodeURIComponent(window)}` : '';
  try {
    const res = await fetch(`${base}/public/birthdays${qs}`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      next: { revalidate: 60, tags: [`site:${host}`] },
    });
    if (!res.ok) return null;
    return res.json() as Promise<BirthdaysResult>;
  } catch {
    return null;
  }
}

// ── The Book of Records (Sports wing) ────────────────────────────────────────

export interface RecordHolder { name: string; text: string; value: number; year: number }
export interface RecordLine {
  key: string;
  sportKey: string; sportName: string; groupKey: string; groupLabel: string; category: string;
  unit: string; lowerIsBetter: boolean;
  record: (RecordHolder & { setOn: string | null }) | null;
  history: (RecordHolder & { untilYear: number | null })[];
  top: (RecordHolder & { rank: number })[];
}
export interface RecordsBook {
  generatedAt: string;
  nameFormat: 'FIRST' | 'FIRST_INITIAL' | 'FULL';
  pageLayout: 'SCOREBOARD' | 'REGISTER' | 'CABINET' | 'PROGRESSION';
  showTopFive: boolean;
  lines: RecordLine[];
  /** Line keys the homepage band shows, in order. */
  home: string[];
}

/** The book for a school host; null when the school has not switched it on (the API answers 404). */
export async function fetchPublicRecords(host: string): Promise<RecordsBook | null> {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  const base = raw.replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${base}/public/records`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      next: { revalidate: 60, tags: [`site:${host}`] },
    });
    if (!res.ok) return null;
    return res.json() as Promise<RecordsBook>;
  } catch {
    return null;
  }
}
