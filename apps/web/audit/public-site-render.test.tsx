/**
 * Renders the REAL school site to static HTML, across every view and a spread
 * of studio settings.
 *
 * Written as a DIFFERENTIAL harness when PublicSite became a server component:
 * a frozen copy of the pre-change tree was rendered beside the new one and the
 * HTML compared byte for byte — 73 comparisons, all identical, which is what
 * proved that change carried no visual regression. Tests that assert "a class
 * is present" could not have proved that.
 *
 * The frozen copy was deleted afterwards rather than kept: a snapshot of an old
 * implementation drifts into meaninglessness, and pinning HTML output would
 * fail on every legitimate edit. What is worth keeping is the other half — that
 * every view and every studio permutation still renders a substantial page
 * without throwing. A server component that reaches for a browser API, a
 * section that assumes a field the API may not send, a hero layout with no
 * images: all of those land here as a failure rather than on a school's
 * homepage.
 */
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/font/google only runs inside the Next build; outside it the loaders are
// not functions. Nothing here depends on the real font files, only on each
// family resolving to something, so one stub serves them all.
vi.mock('next/font/google', () => {
  const face = (name: string) => () => ({
    className: `f-${name}`,
    variable: `--f-${name}`,
    style: { fontFamily: name },
  });
  return {
    Inter: face('inter'),
    Fraunces: face('fraunces'),
    Poppins: face('poppins'),
    Nunito: face('nunito'),
    Playfair_Display: face('playfair'),
    Space_Grotesk: face('grotesk'),
    Montserrat: face('montserrat'),
    Lora: face('lora'),
  };
});
import PublicSite from '@/components/public/PublicSite';
import type { PublicSiteData } from '@/lib/public-api';

type SiteProps = ComponentProps<typeof PublicSite>;

const FEATURES = ['GALLERY', 'ENQUIRY', 'EVENTS', 'ALUMNI', 'BLOG', 'SPORTS'];
const M = 'https://x.supabase.co/storage/v1/object/public/m';

/** Longest realistic values, per the ledger — full Indian names, long labels. */
export function siteData(over: Record<string, unknown> = {}): PublicSiteData {
  const base = {
    school: { name: 'Raffles International School', slug: 'raffles', tier: 'PRO', features: FEATURES, timezone: 'Asia/Kolkata' },
    profile: {
      logoUrl: `${M}/logo.png`, faviconUrl: null,
      brandColorPrimary: '#2f6b4f', brandColorSecondary: '#e8b04b',
      phone: '+91 141 2345678', email: 'office@raffles.edu.in',
      addressLine1: 'Plot 12, Vaishali Nagar', addressLine2: 'Near the water tank',
      city: 'Jaipur', region: 'Rajasthan', postalCode: '302021', country: 'India',
      mapEmbedUrl: null, headingFont: 'Fraunces', heroStyle: 'PHOTO',
      animationLevel: 'FULL', heroLayout: 'COLLAGE', heroTextAlign: 'LEFT',
      heroOverlayStyle: 'WASH', heroOverlayOpacity: 0.5, heroHeight: 'FULL',
      headlineAccent: 'UNDERLINE', scrollFeel: 'GLIDE',
      navStyle: 'PILL', navColor: '#ffffff', navTextColor: '#14261d',
      navCtaLabel: 'Enquire', navShowCta: true, navShowLogin: true, navLoginLabel: 'Log in',
      sectionVariants: null, festiveTheme: null, customSectionCss: null,
      heroVideoUrl: null, customHtmlBlock: null,
    },
    homepage: {
      headline: 'A school that knows every child by name',
      subheadline: 'Admissions open for 2027-28',
      heroUrl: `${M}/hero.jpg`,
      heroImages: [`${M}/h1.jpg`, `${M}/h2.jpg`, `${M}/h3.jpg`, `${M}/h4.jpg`],
      aboutText: 'Founded in 1994, we teach 1,240 children from nursery to Class 12.',
      principalName: 'Dr Aadhya Venkataraghavan',
      principalMessage: 'Every child is known here, by somebody, every day.',
      principalPhotoUrl: `${M}/p.jpg`, aboutImageUrl: `${M}/about.jpg`,
      showAdmissions: true, showGallery: true, showEvents: true, showContact: true, showBirthdays: true,
    },
    celebrations: {
      enabled: true, placement: 'TEASER_AND_PAGE', audience: 'BOTH', teaser: 'CAKE_BADGE',
      page: 'PARTY_WALL', nameFormat: 'FIRST', showClass: true,
      wishLine: 'Many happy returns from all of us', window: 'WEEK',
    },
    records: { enabled: true, pageLayout: 'SCOREBOARD', showTopFive: true },
    stats: [{ label: 'Children on the roll', value: '1240' }, { label: 'Pass rate', value: '98%' }],
    socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/raffles' }],
    gallery: [{ url: `${M}/g1.jpg`, caption: 'Sports day, 2025' }, { url: `${M}/g2.jpg`, caption: null }],
    staff: [{ name: 'Saanvi Krishnamurthy', role: 'Head of Science', photoUrl: `${M}/s1.jpg` }],
    courses: [
      { id: 'c1', name: 'Senior Secondary — Science', tagline: 'Physics, Chemistry, Biology, Maths', imageUrl: `${M}/c1.jpg`, highlights: ['CBSE', 'Labs'], ageFrom: 16, ageTo: 18, featured: true, order: 0 },
      { id: 'c2', name: 'Primary', tagline: 'Classes 1 to 5', imageUrl: null, highlights: [], ageFrom: 6, ageTo: 10, featured: false, order: 1 },
    ],
    hallOfFame: {
      landingYear: 2025, years: [2025, 2024],
      groups: [{ id: 'g1', label: 'Class 12 — Science', entries: [
        { batchYear: 2025, rank: 1, name: 'Kabir Bhat', achievement: '98.4%', photoUrl: `${M}/h.jpg` },
        { batchYear: 2025, rank: 2, name: 'Aarav Mehta', achievement: '97.2%', photoUrl: null },
      ] }],
    },
    admissions: { steps: [{ title: 'Send an enquiry', description: 'Fill the form and we call back.' }], showFees: true, feeNote: 'Fees are per year.' },
    pages: [{ slug: 'transport', title: 'Transport', blocks: [], showInNav: true }],
    events: [{ id: 'e1', title: 'Open Day', description: 'Come and see the school.', coverUrl: `${M}/e1.jpg`, startAt: '2026-11-02T04:00:00.000Z', endAt: null, venue: 'Main field', scope: 'SCHOOL' }],
  } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    base[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? { ...(base[k] as object), ...(v as object) }
      : v;
  }
  return base as unknown as PublicSiteData;
}

const row = (name: string, d: number) => ({ day: d, month: 11, name, classLabel: 'Class 4-B', photoUrl: null, key: `${name}-${d}` });
const BIRTHDAYS = {
  generatedFor: '2026-11-02', window: 'WEEK',
  today: [row('Aarav Mehta', 2)], upcoming: [row('Saanvi Krishnamurthy', 4)],
  next: row('Saanvi Krishnamurthy', 4), maxAge: 18,
} as never;
const holder = { name: 'Aarav Mehta', classLabel: 'Class 10-A', year: 2025, value: 11.8, display: '11.8 s' };
const RECORDS = {
  generatedAt: '2026-11-02T00:00:00.000Z', nameFormat: 'FIRST', pageLayout: 'SCOREBOARD', showTopFive: true,
  lines: [{
    key: 'ath-100-sen-boys', sportKey: 'ath-100', sportName: '100 m', groupKey: 'sen', groupLabel: 'Senior',
    category: 'Boys', unit: 's', lowerIsBetter: true,
    record: { ...holder, setOn: '2025-11-20' }, history: [], top: [{ ...holder, rank: 1 }],
  }],
  home: ['ath-100-sen-boys'],
} as never;

const VIEWS = ['home', 'academics', 'admissions', 'gallery', 'events', 'alumni', 'birthdays', 'records', 'contact'] as const;

/** Studio permutations that switch whole branches of the renderer. */
const CONFIGS: { name: string; data: PublicSiteData }[] = [
  { name: 'defaults', data: siteData() },
  { name: 'split-mosaic hero', data: siteData({ profile: { heroLayout: 'SPLIT_MOSAIC', scrollFeel: 'CLASSIC' } }) },
  { name: 'full-bleed hero', data: siteData({ profile: { heroLayout: 'FULL_BLEED' } }) },
  { name: 'side-panel hero, one image', data: siteData({ profile: { heroLayout: 'SIDE_PANEL' }, homepage: { heroImages: ['https://x.supabase.co/storage/v1/object/public/m/only.jpg'] } }) },
  { name: 'illustrated legacy hero', data: siteData({ profile: { heroStyle: 'ILLUSTRATED', heroLayout: 'ILLUSTRATED' } }) },
  // The fixture used to send { key, recolour }; the normaliser reads
  // { festival, recolor }, so this case had never rendered a festival. Now one
  // case per treatment, so every dressed branch of the hero and footer runs.
  { name: 'festive diwali · LAYER', data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', variant: 'DEEPAVALI', treatment: 'LAYER', ribbon: true, recolor: true } } }) },
  { name: 'festive ganesh · HERO, the school\u2019s own murti photo', data: siteData({ profile: { festiveTheme: { festival: 'GANESH', variant: 'MURTI', treatment: 'HERO', imageAssetId: 'a-1' }, festiveImageUrl: 'https://cdn.example.com/murti.jpg' } }) },
  { name: 'festive navratri · DUSSEHRA on a split hero', data: siteData({ profile: { festiveTheme: { festival: 'NAVRATRI', variant: 'DUSSEHRA', treatment: 'WASH' }, heroLayout: 'SPLIT' } }) },
  { name: 'festive christmas · NIGHT tree, floating nav', data: siteData({ profile: { festiveTheme: { festival: 'CHRISTMAS', variant: 'TREE', treatment: 'NIGHT' }, navStyle: 'PILL' } }) },
  { name: 'festive diwali · CHROME', data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'CHROME' } } }) },
  { name: 'festive diwali · HERO', data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'HERO' } } }) },
  { name: 'festive diwali · WASH', data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'WASH' } } }) },
  { name: 'festive diwali · NIGHT', data: siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'NIGHT' } } }) },
  { name: 'festive holi · WASH on a full-bleed photo hero', data: siteData({ profile: { festiveTheme: { festival: 'HOLI', treatment: 'WASH' }, heroLayout: 'FULL_BLEED' } }) },
  { name: 'festive tiranga · HERO on a minimal hero', data: siteData({ profile: { festiveTheme: { festival: 'INDEPENDENCE', treatment: 'HERO' }, heroLayout: 'MINIMAL' } }) },
  { name: 'festive eid · NIGHT, animation off', data: siteData({ profile: { festiveTheme: { festival: 'EID', treatment: 'NIGHT' }, animationLevel: 'NONE' } }) },
  { name: 'motion off', data: siteData({ profile: { animationLevel: 'NONE', scrollFeel: 'CLASSIC' } }) },
  { name: 'bare school', data: siteData({ school: { name: 'A', slug: 'a', tier: 'BASIC', features: [], timezone: 'Asia/Kolkata' }, courses: [], gallery: [], events: [], staff: [], celebrations: null, records: null, homepage: { aboutText: null, heroImages: [], heroUrl: null, stats: [] } }) },
];

describe('every view and studio permutation renders', () => {
  for (const cfg of CONFIGS) {
    for (const view of VIEWS) {
      it(`${cfg.name} · ${view}`, () => {
        const props: SiteProps = { data: cfg.data, view, birthdays: BIRTHDAYS, records: RECORDS };
        const html = renderToStaticMarkup(<PublicSite {...props} />);
        expect(html).toContain('ps-root');
        expect(html.length).toBeGreaterThan(2_000);
      });
    }
  }

  it('an admin-built page renders', () => {
    const props: SiteProps = { data: siteData(), view: 'page', page: { slug: 'transport', title: 'Transport', blocks: [{ kind: 'text', text: 'Buses leave at 7.' }] }, birthdays: null, records: null };
    expect(renderToStaticMarkup(<PublicSite {...props} />)).toContain('ps-root');
  });
});

describe('the fixture actually exercises the page', () => {
  it('renders a substantial tree, not an empty shell', () => {
    const props: SiteProps = { data: siteData(), view: 'home', birthdays: BIRTHDAYS, records: RECORDS };
    const html = renderToStaticMarkup(<PublicSite {...props} />);
    expect(html.length).toBeGreaterThan(20_000);
    for (const marker of [
      'Raffles International School', 'Dr Aadhya Venkataraghavan', 'Kabir Bhat',
      'Senior Secondary', 'Open Day', 'Aarav Mehta', 'ps-root',
    ]) {
      expect(html, `fixture should reach ${marker}`).toContain(marker);
    }
    // The optimiser must be reached for the hero photos (the H5 fix).
    expect(html).toContain('/_next/image?url=');
  });
});


describe('the festive fixtures really render a festival', () => {
  it('every treatment draws the festival\u2019s scene inside the hero; the page-wide emoji field is gone for good', () => {
    for (const treatment of ['LAYER', 'CHROME', 'HERO', 'WASH', 'NIGHT']) {
      const html = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment } } })} view="home" />);
      expect(html, treatment).toContain(`data-fest-dress="${treatment}"`);
      expect(html, treatment).toContain('data-fest-scene="DEEPAVALI"');
      expect(html, treatment).not.toContain('class="ps-fx"');
    }
  });
  it('the footer edge follows the dressed treatments only', () => {
    const hero = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'HERO' } } })} view="home" />);
    expect(hero).toContain('ps-fest-footedge');
    expect(hero).toContain('ps-fest-hero');
    const layer = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment: 'LAYER' } } })} view="home" />);
    expect(layer).not.toContain('ps-fest-footedge');
  });
  it('a scene with a picture shows the school\u2019s own upload when the theme names it, else the shipped painting', () => {
    const own = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'GANESH', variant: 'MURTI', treatment: 'HERO', imageAssetId: 'a-1' }, festiveImageUrl: 'https://cdn.example.com/murti.jpg' } })} view="home" />);
    expect(own).toContain('src="https://cdn.example.com/murti.jpg"');
    expect(own).not.toContain('/festive/art/ganesha.webp');
    // The asset was removed from the theme but the API still resolved a URL: the painting wins.
    const stale = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'GANESH', variant: 'MURTI', treatment: 'HERO' }, festiveImageUrl: 'https://cdn.example.com/murti.jpg' } })} view="home" />);
    expect(stale).toContain('/festive/art/ganesha.webp');
  });
  it('no treatment writes a greeting or an emoji into the page — the school\u2019s own headline stays', () => {
    for (const treatment of ['LAYER', 'CHROME', 'HERO', 'WASH', 'NIGHT']) {
      const html = renderToStaticMarkup(<PublicSite data={siteData({ profile: { festiveTheme: { festival: 'DIWALI', treatment, ribbon: false } } })} view="home" />);
      expect(html).toContain('A school that knows every child by name');
      expect(html).not.toMatch(/Happy Diwali/);
      // The dress itself carries no emoji glyph (scenes.test.tsx checks every scene); the
      // page keeps its own ✓ / 📞 / medal glyphs, which are not the festival's.
      expect(html, treatment).not.toContain('ps-fx-diya');
    }
  });
});
