/**
 * The footer, rendered for real in every layout.
 *
 * Written against the 2026-09-27 report ("the footer seems too odd") after the
 * screenshot was measured: emoji standing in for icons, nine links in one thin
 * stack beside an empty column, nothing tappable, and a flat one-line sign-off.
 * Each of those is a claim below, asserted on the markup the site actually
 * ships — per the UI ledger, a hand-written imitation of a component proves
 * nothing about the component.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FooterSection from './FooterSection';
import { FOOTER_LAYOUTS, type FooterLayout } from '../site-variants';
import type { PublicSiteData } from '@/lib/public-api';

const FLAGS = {
  hasAbout: true,
  hasAcademics: true,
  hasAdmissions: true,
  hasHof: true,
  hasGallery: true,
  hasEvents: true,
  hasAlumni: true,
  hasBirthdays: true,
  hasRecords: true,
  hasBlog: true,
  hasContact: true,
  hasEnquiry: true,
};

/** Longest realistic values, per the ledger — a full Indian address. */
function data(footerConfig: Record<string, unknown> | null = null, over: Record<string, unknown> = {}): PublicSiteData {
  // `profile` is merged FIELD BY FIELD below; spreading `over` wholesale at
  // the end would replace the merged profile with the override's few keys and
  // silently drop the footerConfig under test.
  const { profile: profileOver, ...rest } = over;
  return {
    school: { name: 'Raffles Primary School', slug: 'raffles', tier: 'PRO', features: [], timezone: 'Asia/Kolkata' },
    profile: {
      logoUrl: null,
      faviconUrl: null,
      brandColorPrimary: '#2f6b4f',
      brandColorSecondary: '#e8b04b',
      phone: '+91 80 4123 5678',
      email: 'info@raffles.edu',
      addressLine1: '14 Cunningham Road',
      addressLine2: null,
      city: 'Bengaluru',
      region: 'Karnataka',
      postalCode: '560052',
      country: 'India',
      affiliationNo: '830xxx',
      footerConfig,
      ...(profileOver as Record<string, unknown> | undefined),
    },
    socialLinks: [
      { platform: 'INSTAGRAM', url: 'https://instagram.com/raffles' },
      { platform: 'FACEBOOK', url: 'https://facebook.com/raffles' },
    ],
    pages: [{ slug: 'transport', title: 'Transport', blocks: [], showInNav: true }],
    ...rest,
  } as unknown as PublicSiteData;
}

const render = (cfg: Record<string, unknown> | null = null, over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<FooterSection data={data(cfg, over)} flags={FLAGS} base="/" year={2026} />);

describe('every layout', () => {
  it.each(FOOTER_LAYOUTS.map((l) => l.value))('%s keeps the school, the legal links and a way back', (layout: FooterLayout) => {
    const html = render({ layout });
    expect(html).toContain('Raffles Primary School');
    expect(html).toContain('© 2026');
    // DPDP launch gate: the policy is one click from every page a parent sees.
    expect(html).toContain('sckools.com/privacy');
    expect(html).toContain('sckools.com/terms');
    expect(html).toContain('Back to top');
    // The layout names itself so CSS and the audit harness can find it.
    expect(html).toContain(`data-foot="${layout}"`);
  });

  it.each(FOOTER_LAYOUTS.map((l) => l.value))('%s carries no emoji where an icon belongs', (layout: FooterLayout) => {
    const html = render({ layout });
    // These three rendered in the device's own emoji font — a different
    // footer on every phone, and the only cartoon on the page.
    for (const emoji of ['📞', '✉️', '📍', '🕐']) expect(html).not.toContain(emoji);
  });
});

describe('the contact lines do something', () => {
  it('phone, email and address are all pressable', () => {
    const html = render();
    expect(html).toContain('href="tel:+918041235678"');
    expect(html).toContain('href="mailto:info@raffles.edu"');
    expect(html).toContain('google.com/maps/search/');
    // The address a parent reads is the one the Maps link searches for.
    expect(html).toContain('14 Cunningham Road');
  });

  it('WhatsApp is opt-in and strips the number down to digits', () => {
    expect(render()).not.toContain('wa.me');
    const html = render({ whatsapp: true });
    expect(html).toContain('https://wa.me/918041235678');
  });

  it('office hours and the affiliation number appear when the school has them', () => {
    const html = render({ hours: 'Mon–Sat · 8:30 am – 3:30 pm' });
    expect(html).toContain('Mon–Sat · 8:30 am – 3:30 pm');
    expect(html).toContain('Affiliation no. 830xxx');
  });

  it('a school with no contact details at all still renders, with a dash', () => {
    const html = render(null, {
      profile: { phone: null, email: null, addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, affiliationNo: null },
    });
    expect(html).toContain('Visit us');
    expect(html).not.toContain('tel:');
  });
});

describe('the Explore list', () => {
  it('splits itself once it is long, with no setting to remember', () => {
    // Nine links with every feature on: About, Academics, Admissions, Hall of
    // Fame, Gallery, Connect, Blog, Transport, Enquire.
    expect(render()).toContain('sm:columns-2');
  });

  it('stays one column for a short menu', () => {
    const html = renderToStaticMarkup(
      <FooterSection
        data={data()}
        flags={{ ...FLAGS, hasAbout: false, hasHof: false, hasGallery: false, hasEvents: false, hasBlog: false }}
        base="/"
        year={2026}
      />,
    );
    expect(html).not.toContain('sm:columns-2');
  });

  it('honours a school that asked for two columns anyway', () => {
    const html = renderToStaticMarkup(
      <FooterSection
        data={data({ twoCols: true })}
        flags={{ ...FLAGS, hasAbout: false, hasHof: false, hasGallery: false, hasEvents: false, hasBlog: false }}
        base="/"
        year={2026}
      />,
    );
    expect(html).toContain('sm:columns-2');
  });
});

describe('social links', () => {
  it('are drawn marks, not the letters that read as typos', () => {
    const html = render({ social: true });
    expect(html).toContain('aria-label="instagram"');
    // `f`, `ig` and `▶` stood in for the real marks before.
    expect(html).not.toContain('>ig<');
    expect(html).not.toContain('>▶<');
    expect(html).toContain('<svg');
  });

  it('stay off unless the school switched them on', () => {
    expect(render()).not.toContain('Social links');
  });
});

describe('admissions', () => {
  it('Notice board gives admissions its own column with the school’s own line', () => {
    const html = render({ layout: 'NOTICE', admissionsNote: 'Nursery to Class 8 · closes 31 January' });
    expect(html).toContain('Admissions');
    expect(html).toContain('Nursery to Class 8 · closes 31 January');
    expect(html).toContain('Enquire now');
  });

  it('the band is off by default and rides any layout when switched on', () => {
    expect(render({ layout: 'LEDGER' })).not.toContain('Book a visit');
    const html = render({ layout: 'LEDGER', admissionsBand: true, admissionsNote: 'Applications close 31 January' });
    expect(html).toContain('Admissions are open');
    expect(html).toContain('Applications close 31 January');
    expect(html).toContain('Book a visit');
  });

  it('a school with no admissions page gets neither', () => {
    const html = renderToStaticMarkup(
      <FooterSection data={data({ layout: 'NOTICE', admissionsBand: true })} flags={{ ...FLAGS, hasAdmissions: false }} base="/" year={2026} />,
    );
    expect(html).not.toContain('Enquire now');
    expect(html).not.toContain('Book a visit');
  });
});

describe('colour', () => {
  it('paper is classless, so today’s footer is untouched', () => {
    expect(render()).not.toContain('ps-footc-');
  });

  it('“follows the festival” only takes the ink while a full look is on', () => {
    const layer = { festiveTheme: { festival: 'DIWALI', treatment: 'LAYER' } };
    const night = { festiveTheme: { festival: 'DIWALI', treatment: 'NIGHT' } };
    expect(render({ color: 'FESTIVE' }, { profile: layer })).not.toContain('ps-footc-dark');
    expect(render({ color: 'FESTIVE' }, { profile: night })).toContain('ps-footc-dark');
  });
});
