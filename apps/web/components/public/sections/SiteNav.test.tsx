import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SiteNav, { type NavFlags } from './SiteNav';
import type { PublicSiteData, PublicCourse } from '@/lib/public-api';

/**
 * EVERY BAR READS THE SAME MODEL.
 *
 * The three link lists in this file had already drifted: the CENTER bar's two
 * split navs never rendered Hall of Fame at all, and the mobile drawer flattened
 * Academics to a single link. A school that published a page could therefore
 * lose it depending on which nav style it picked — which is exactly what one
 * shared model is for.
 *
 * Built from the real PublicSiteData shape rather than an `as` cast, so a
 * fixture cannot silently drift from the type the component actually reads.
 */

function course(over: Partial<PublicCourse> & { id: string; name: string }): PublicCourse {
  return {
    tagline: null,
    description: null,
    highlights: [],
    ageRange: null,
    imageUrl: null,
    featured: false,
    fee: null,
    hallOfFame: [],
    ...over,
  };
}

function profile(over: Partial<NonNullable<PublicSiteData['profile']>> = {}): PublicSiteData['profile'] {
  return {
    logoUrl: null,
    faviconUrl: null,
    brandColorPrimary: '#2f6b4f',
    brandColorSecondary: '#ffffff',
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    mapEmbedUrl: null,
    headingFont: 'Fraunces',
    heroStyle: 'CLASSIC',
    animationLevel: 'FULL',
    heroLayout: 'CENTERED',
    heroTextAlign: 'CENTER',
    heroOverlayStyle: 'WASH',
    heroOverlayOpacity: 0.5,
    heroHeight: 'TALL',
    headlineAccent: 'NONE',
    navStyle: 'CLASSIC',
    navColor: 'PAPER',
    navTextColor: 'AUTO',
    navCtaLabel: 'Enquire',
    navShowCta: true,
    navShowLogin: true,
    navLoginLabel: 'Login',
    ...over,
  };
}

function site(navStyle: string): PublicSiteData {
  return {
    school: { name: 'Raffles Public School', slug: 'raffles', tier: 'PRO', features: [], timezone: 'Asia/Kolkata' },
    profile: profile({ navStyle }),
    homepage: null,
    stats: [],
    socialLinks: [],
    gallery: [],
    staff: [],
    courses: [course({ id: 'c1', name: 'Preschool', ageRange: '3–5 yrs' }), course({ id: 'c2', name: 'Primary' })],
    admissions: { steps: [], showFees: false, feeNote: null },
    events: [],
  };
}

const ALL_ON: NavFlags = {
  hasAbout: true,
  hasAcademics: true,
  hasAdmissions: true,
  hasHof: true,
  hasGallery: true,
  hasEvents: true, hasAlumni: true,
  hasBlog: true,
  hasContact: true,
  hasEnquiry: true,
};

function renderNav(navStyle: string) {
  return render(
    <SiteNav
      data={site(navStyle)}
      flags={ALL_ON}
      base=""
      view="home"
      onAcademicsPage={false}
      enquireHref="#enquire"
      ink="#fff"
    />,
  );
}

/** The desktop bar, scoped so the always-mounted mobile drawer can't answer for it. */
function primaryNav() {
  return within(screen.getByRole('navigation', { name: 'Primary' }));
}

describe.each(['CLASSIC', 'PILL', 'CENTER', 'GHOST', 'STRIP'])('the %s bar', (navStyle) => {
  it('renders the same five grouped controls, never a sixth', () => {
    renderNav(navStyle);
    const controls = primaryNav().getAllByRole('button');
    expect(controls.map((c) => c.textContent?.replace('▾', '').trim())).toEqual([
      'Our school',
      'Academics',
      'News & events',
    ]);
    // Groups plus the two flat links — five controls, one slot to spare.
    expect(primaryNav().getByRole('link', { name: 'Admissions' })).toBeInTheDocument();
    expect(primaryNav().getByRole('link', { name: 'Contact' })).toBeInTheDocument();
  });

  it('has no Home link — the crest already goes home', () => {
    renderNav(navStyle);
    expect(primaryNav().queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('reaches Hall of Fame, which the CENTER bar used to drop entirely', async () => {
    const user = userEvent.setup({ delay: null });
    renderNav(navStyle);
    await user.click(primaryNav().getByRole('button', { name: /Our school/ }));
    expect(primaryNav().getByRole('link', { name: 'Hall of Fame' })).toHaveAttribute('href', '#hall-of-fame');
  });
});

describe('the mobile drawer', () => {
  // The drawer only exists when links overflow the bar. jsdom does no layout,
  // so force a narrow bar with wide links: the hamburger appears and the whole
  // menu falls into the drawer — the tightest-screen case this feature targets.
  let origClientWidth: PropertyDescriptor | undefined;
  let origRect: typeof HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 10 });
    origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ width: 200, height: 20, top: 0, left: 0, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  });
  afterEach(() => {
    if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
    HTMLElement.prototype.getBoundingClientRect = origRect;
  });

  it('renders the groups as expandable sections rather than the old flat list', async () => {
    const user = userEvent.setup({ delay: null });
    renderNav('CLASSIC');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = within(screen.getByRole('navigation', { name: 'Mobile' }));
    const ourSchool = drawer.getByRole('button', { name: /Our school/ });
    expect(ourSchool).toHaveAttribute('aria-expanded', 'false');
    await user.click(ourSchool);
    expect(drawer.getByRole('link', { name: 'Hall of Fame' })).toBeInTheDocument();
  });

  it('opens the programme list on the first tap instead of navigating away', async () => {
    const user = userEvent.setup({ delay: null });
    renderNav('CLASSIC');
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = within(screen.getByRole('navigation', { name: 'Mobile' }));
    // The old drawer collapsed Academics to a bare link, so a parent on a phone
    // could never see the programmes from the menu.
    expect(drawer.queryByRole('link', { name: 'Academics' })).not.toBeInTheDocument();
    await user.click(drawer.getByRole('button', { name: /Academics/ }));
    // The age range is part of the row, so it is part of the link's name too.
    expect(drawer.getByRole('link', { name: 'Preschool 3–5 yrs' })).toHaveAttribute('href', '/academics#course-c1');
    expect(drawer.getByRole('link', { name: /All of Academics/ })).toHaveAttribute('href', '/academics');
  });
});

describe('the sign-in control stays visible whatever the school picks', () => {
  function renderWith(over: Record<string, unknown>) {
    const data = site('CLASSIC');
    return render(
      <SiteNav
        data={{ ...data, profile: { ...data.profile!, ...over } as PublicSiteData['profile'] }}
        flags={ALL_ON}
        base=""
        view="home"
        onAcademicsPage={false}
        enquireHref="#enquire"
        ink="#fff"
      />,
    );
  }

  it('adds no style class by default — LINK is what every school already renders', () => {
    renderWith({});
    const login = screen.getAllByRole('link', { name: 'Login' })[0];
    expect(login.className).not.toMatch(/ps-login-(outline|solid)/);
  });

  it('gives sign-in a drawn edge when the school asks for one', () => {
    renderWith({ navLoginStyle: 'OUTLINE' });
    expect(screen.getAllByRole('link', { name: 'Login' })[0].className).toContain('ps-login-outline');
  });

  it('fills it when the school asks for that instead', () => {
    renderWith({ navLoginStyle: 'SOLID' });
    expect(screen.getAllByRole('link', { name: 'Login' })[0].className).toContain('ps-login-solid');
  });

  it('keeps the nav-link class in every style, which is what carries the bar’s ink', () => {
    // The fix for the dull-Login bug lives on .ps-nav-link; a style that
    // dropped it would take the contrast fix with it.
    for (const s of ['LINK', 'OUTLINE', 'SOLID']) {
      const { unmount } = renderWith({ navLoginStyle: s });
      expect(screen.getAllByRole('link', { name: 'Login' })[0].className).toContain('ps-nav-link');
      unmount();
    }
  });
});
