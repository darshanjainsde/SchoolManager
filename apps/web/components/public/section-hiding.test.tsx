/**
 * A band the school switched off in Studio → Per-section layout.
 *
 * The switch has to REMOVE the band, not merely restyle it: the admin toggling
 * it is watching the live preview, and a band that stays put reads as a broken
 * control. And it is a HOMEPAGE decision — the band's own page (/gallery,
 * /admissions, /records) is untouched, because "not on the front page" and
 * "deleted from the site" are different things and only one of them was asked
 * for.
 *
 * Renders the real PublicSite rather than a stand-in, per the UI ledger.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/font/local only exists inside the Next build; nothing here depends on
// the real faces, only on each family resolving to something.
vi.mock('next/font/local', () => ({
  default: ({ variable }: { variable: string }) => ({
    className: variable.replace('--f-', 'f-'),
    variable,
    style: { fontFamily: variable },
  }),
}));

import PublicSite from '@/components/public/PublicSite';
import type { PublicSiteData } from '@/lib/public-api';

const M = 'https://x.supabase.co/storage/v1/object/public/m';

function siteData(sectionVariants: Record<string, unknown> | null): PublicSiteData {
  return {
    school: {
      name: 'Raffles International School',
      slug: 'raffles',
      tier: 'PRO',
      features: ['GALLERY', 'ENQUIRY', 'EVENTS', 'ALUMNI', 'BLOG', 'SPORTS'],
      timezone: 'Asia/Kolkata',
    },
    profile: {
      logoUrl: `${M}/logo.png`,
      faviconUrl: null,
      brandColorPrimary: '#2f6b4f',
      brandColorSecondary: '#e8b04b',
      phone: '+91 141 2345678',
      email: 'office@raffles.edu.in',
      addressLine1: 'Plot 12, Vaishali Nagar',
      city: 'Jaipur',
      region: 'Rajasthan',
      headingFont: 'Fraunces',
      heroStyle: 'PHOTO',
      animationLevel: 'FULL',
      heroLayout: 'COLLAGE',
      heroTextAlign: 'LEFT',
      heroOverlayStyle: 'WASH',
      heroOverlayOpacity: 0.5,
      heroHeight: 'FULL',
      headlineAccent: 'UNDERLINE',
      navStyle: 'PILL',
      navColor: '#ffffff',
      navTextColor: '#14261d',
      sectionVariants,
      festiveTheme: null,
    },
    homepage: {
      headline: 'A school that knows every child by name',
      subheadline: 'Admissions open for 2027-28',
      heroUrl: `${M}/hero.jpg`,
      heroImages: [`${M}/h1.jpg`],
      aboutText: 'Founded in 1994, we teach 1,240 children from nursery to Class 12.',
      showAdmissions: true,
      showGallery: true,
      showEvents: true,
      showContact: true,
    },
    stats: [{ label: 'Children on the roll', value: '1240' }],
    socialLinks: [],
    gallery: [{ url: `${M}/g1.jpg`, caption: 'Sports day, 2025' }],
    staff: [{ name: 'Saanvi Krishnamurthy', role: 'Head of Science', photoUrl: null }],
    courses: [
      { id: 'c1', name: 'Primary', tagline: 'Classes 1 to 5', imageUrl: null, highlights: [], ageFrom: 6, ageTo: 10, featured: true, order: 0 },
    ],
    hallOfFame: {
      landingYear: 2025,
      years: [2025],
      groups: [
        {
          id: 'g1',
          label: 'Class 12 — Science',
          entries: [{ batchYear: 2025, rank: 1, name: 'Kabir Bhat', achievement: '98.4%', photoUrl: null }],
        },
      ],
    },
    admissions: { steps: [{ title: 'Send an enquiry', description: 'Fill the form and we call back.' }], showFees: false, feeNote: null },
    pages: [],
    events: [],
  } as unknown as PublicSiteData;
}

const home = (v: Record<string, unknown> | null) => renderToStaticMarkup(<PublicSite data={siteData(v)} view="home" />);

describe('switching a band off the homepage', () => {
  it('takes that band away and leaves every other one', () => {
    const shown = home(null);
    expect(shown).toContain('data-sec="hof"');
    expect(shown).toContain('data-sec="gallery"');
    expect(shown).toContain('data-sec="about"');

    const hidden = home({ hof: { hidden: true } });
    expect(hidden).not.toContain('data-sec="hof"');
    // One switch, one band.
    expect(hidden).toContain('data-sec="gallery"');
    expect(hidden).toContain('data-sec="about"');
  });

  it('works for every band the switch is offered for', () => {
    for (const key of ['stats', 'about', 'courses', 'admissions', 'gallery', 'hof', 'staff', 'contact']) {
      expect(home(null)).toContain(`data-sec="${key}"`);
      expect(home({ [key]: { hidden: true } })).not.toContain(`data-sec="${key}"`);
    }
  });

  it('keeps the band’s own page whole', () => {
    // Hiding the homepage gallery band must not empty /gallery. The photo is
    // addressed through the optimiser now, so look for it encoded rather than
    // raw (GallerySection.test.tsx owns that behaviour).
    const page = renderToStaticMarkup(<PublicSite data={siteData({ gallery: { hidden: true } })} view="gallery" />);
    expect(page).toContain(encodeURIComponent(`${M}/g1.jpg`));
  });

  it('leaves a layout choice on a hidden band alone, so switching back restores it', () => {
    const v = { hof: { hidden: true, layout: 'PODIUM' } };
    expect(home(v)).not.toContain('data-sec="hof"');
    const back = home({ hof: { layout: 'PODIUM' } });
    expect(back).toContain('data-sec="hof"');
  });
});

/**
 * The contact facts are shown the same way wherever they appear.
 *
 * The footer was the report, but the Contact band one section above it had
 * the identical defect — 📞 ✉️ 📍 as literal emoji, and not one of them
 * pressable. Both read from the same profile, so both use the same drawn
 * icons and the same tel:/mailto: links now (sections/ContactIcon.tsx).
 */
describe('contact details on the homepage', () => {
  it('use drawn icons, never emoji, and can be pressed', () => {
    const html = home(null);
    for (const emoji of ['\u{1F4DE}', '\u{2709}\u{FE0F}', '\u{1F4CD}']) {
      // The enquiry wizard's own question labels are conversational prompts,
      // not icons standing in for data, and keep their emoji deliberately.
      const outsideWizard = html.split('ps-wiz-phone')[0];
      expect(outsideWizard).not.toContain(emoji);
    }
    expect(html).toContain('href="tel:+911412345678"');
    expect(html).toContain('href="mailto:office@raffles.edu.in"');
  });
});
