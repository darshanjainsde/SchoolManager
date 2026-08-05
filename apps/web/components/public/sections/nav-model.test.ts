import { describe, it, expect } from 'vitest';
import { navModel, NAV_CAP, type NavNode } from './nav-model';
import type { NavFlags } from './SiteNav';
import { SUBPAGES } from '../subpages';

/**
 * ONE MODEL, READ BY EVERY BAR.
 *
 * SiteNav hardcoded its link list three times over — NavLinks (desktop CLASSIC/
 * PILL plus the mobile drawer), and the CENTER branch's two split navs, which
 * had already drifted: CENTER silently dropped Hall of Fame. Grouping applied to
 * one list and not another is how a school loses a page it published.
 *
 * These tests are about the MODEL, not the layout. The cap is the bug being
 * fixed (a seventh control truncates a typical school name at 1280px), and
 * reachability is the regression that duplication caused once already.
 */

const ALL_ON: NavFlags = {
  hasAbout: true,
  hasAcademics: true,
  hasAdmissions: true,
  hasHof: true,
  hasGallery: true,
  hasEvents: true,
  hasBlog: true,
  hasContact: true,
  hasEnquiry: true,
};

const NONE_ON: NavFlags = {
  hasAbout: false,
  hasAcademics: false,
  hasAdmissions: false,
  hasHof: false,
  hasGallery: false,
  hasEvents: false,
  hasBlog: false,
  hasContact: false,
  hasEnquiry: false,
};

const COURSES = [
  { id: 'c1', name: 'Preschool (Nursery–UKG)', ageRange: '3–5 yrs' },
  { id: 'c2', name: 'Primary (I–V)', ageRange: null },
];

function model(over: Partial<NavFlags> = {}, base = ''): NavNode[] {
  return navModel({ flags: { ...ALL_ON, ...over }, base, courses: COURSES });
}

/** Every href the model can reach: group parents and their children alike. */
function hrefs(nodes: NavNode[]): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'group' ? [...(n.href ? [n.href] : []), ...n.children.map((c) => c.href)] : [n.href],
  );
}

function labels(nodes: NavNode[]): string[] {
  return nodes.map((n) => n.label);
}

describe('the cap', () => {
  it('never exceeds six top-level controls, even with every page published', () => {
    expect(model().length).toBeLessThanOrEqual(NAV_CAP);
  });

  it('ships five by default, leaving a slot the school can spend', () => {
    expect(labels(model())).toEqual(['Our school', 'Academics', 'Admissions', 'News & events', 'Contact']);
  });

  it('has no Home control — the crest already links home', () => {
    expect(labels(model())).not.toContain('Home');
  });
});

describe('reachability', () => {
  /**
   * Where each dedicated page actually lives. Read against PublicSite's own
   * SUBPAGES rather than a list copied by hand: a hand-copied list cannot fail
   * when somebody adds a page, which is the entire failure this guards. Note
   * `events` is served at /connect — the map is where that stops being folklore.
   */
  const ROUTE_OF: Record<keyof typeof SUBPAGES, string> = {
    academics: '/academics',
    admissions: '/admissions',
    gallery: '/gallery',
    events: '/connect',
    contact: '/contact',
  };

  it('has somewhere to send every dedicated page the site renders', () => {
    // If this fails after you added a page, the page has no route in the nav
    // model — decide which group owns it rather than deleting the assertion.
    expect(Object.keys(ROUTE_OF).sort()).toEqual(Object.keys(SUBPAGES).sort());
  });

  it('reaches every one of those pages from the default model', () => {
    const reachable = hrefs(model());
    for (const href of Object.values(ROUTE_OF)) {
      expect(reachable).toContain(href);
    }
  });

  it('also reaches the sections that are anchors on the home page, and the blog', () => {
    const reachable = hrefs(model());
    for (const href of ['#about', '#hall-of-fame', '/blog']) {
      expect(reachable).toContain(href);
    }
  });

  it('prefixes the homepage anchors with / when read from a subpage', () => {
    const reachable = hrefs(model({}, '/'));
    expect(reachable).toContain('/#about');
    expect(reachable).toContain('/#hall-of-fame');
  });

  it('keeps Admissions flat — it is the page the site exists to do', () => {
    const admissions = model().find((n) => n.label === 'Admissions');
    expect(admissions?.kind).toBe('link');
  });
});

describe('a group is only worth the slot it costs', () => {
  it('drops a group whose every child is unpublished, rather than opening an empty menu', () => {
    expect(labels(model({ hasEvents: false, hasBlog: false }))).not.toContain('News & events');
  });

  it('collapses a one-child group to that child, named for the page it opens', () => {
    const nodes = model({ hasAbout: false, hasHof: false });
    expect(labels(nodes)).not.toContain('Our school');
    expect(labels(nodes)).toContain('Gallery');
  });

  it('leaves nothing at all for a school that has published nothing', () => {
    expect(navModel({ flags: NONE_ON, base: '', courses: [] })).toEqual([]);
  });
});

describe('Academics is a page that also opens', () => {
  it('opens the programme list while still navigating to the page itself', () => {
    const academics = model().find((n) => n.label === 'Academics');
    expect(academics?.kind).toBe('group');
    if (academics?.kind !== 'group') throw new Error('Academics should be a group');
    expect(academics.href).toBe('/academics');
    expect(academics.children.map((c) => c.label)).toEqual(['Preschool (Nursery–UKG)', 'Primary (I–V)']);
  });

  it('stays a plain link for a school with no programmes yet — an empty menu opens onto nothing', () => {
    const nodes = navModel({ flags: ALL_ON, base: '', courses: [] });
    const academics = nodes.find((n) => n.label === 'Academics');
    expect(academics?.kind).toBe('link');
    expect(academics?.kind === 'link' && academics.href).toBe('/academics');
  });

  it('links programme anchors relative to the academics page when already on it', () => {
    const nodes = navModel({ flags: ALL_ON, base: '/', courses: COURSES, onAcademicsPage: true });
    const academics = nodes.find((n) => n.label === 'Academics');
    if (academics?.kind !== 'group') throw new Error('Academics should be a group');
    expect(academics.children[0].href).toBe('#course-c1');
  });
});
