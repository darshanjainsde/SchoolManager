import { describe, it, expect } from 'vitest';
import { NAV_CAP } from './nav-model';
import { defaultNavConfig, validateNavConfig, slugify, type NavConfig } from './nav-config';

/**
 * THE RULES THE EDITOR ENFORCES, BEFORE THERE IS AN EDITOR.
 *
 * A drag-and-drop nav editor is mostly craft, but four of its behaviours are
 * correctness and belong in tested code rather than in event handlers:
 *
 *   - SIX top-level controls, because seven truncates a typical school name at
 *     1280px — the bug the whole nav step exists to fix;
 *   - no EMPTY group, which opens a menu onto nothing;
 *   - no group inside a group: two levels is a school website, three is a
 *     filing system;
 *   - and above all, NO LOST PAGE. Dragging a page out of every group makes it
 *     top-level; it must never make it invisible. A page a school published and
 *     cannot reach is worse than any layout mistake.
 *
 * Plus the one that bites later rather than now: the label is editable and the
 * SLUG IS FROZEN at creation, so renaming a group cannot break shared links or
 * drop a page from results it already ranks for.
 */

const PAGES = ['about', 'hof', 'gallery', 'academics', 'admissions', 'connect', 'blog', 'contact'];

function config(over: Partial<NavConfig> = {}): NavConfig {
  return { ...defaultNavConfig(), ...over };
}

describe('the default a school starts from', () => {
  it('is the five-control model already shipped', () => {
    expect(defaultNavConfig().items.map((i) => i.label)).toEqual([
      'Our school',
      'Academics',
      'Admissions',
      'News & events',
      'Contact',
    ]);
  });

  it('is itself valid, or the editor would open on a page it refuses to save', () => {
    expect(validateNavConfig(defaultNavConfig(), PAGES).errors).toEqual([]);
  });
});

describe('what the editor refuses', () => {
  it('refuses a seventh top-level control, and says why', () => {
    const items = Array.from({ length: NAV_CAP + 1 }, (_, i) => ({
      key: `g${i}`,
      slug: `g${i}`,
      label: `Group ${i}`,
      behaviour: 'menu' as const,
      children: [{ key: 'about', label: 'About' }],
    }));
    const { ok, errors } = validateNavConfig(config({ items }), PAGES);
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/six/i);
  });

  it('refuses a group with nothing in it', () => {
    const items = [{ key: 'empty', slug: 'empty', label: 'Empty', behaviour: 'menu' as const, children: [] }];
    const { errors } = validateNavConfig(config({ items }), PAGES);
    expect(errors.join(' ')).toMatch(/empty/i);
  });

  it('refuses the same page appearing in two places', () => {
    const items = [
      { key: 'a', slug: 'a', label: 'A', behaviour: 'menu' as const, children: [{ key: 'about', label: 'About' }] },
      { key: 'b', slug: 'b', label: 'B', behaviour: 'menu' as const, children: [{ key: 'about', label: 'About' }] },
    ];
    const { errors } = validateNavConfig(config({ items }), PAGES);
    expect(errors.join(' ')).toMatch(/twice|more than once/i);
  });

  it('REFUSES TO LOSE A PAGE — the rule that matters most', () => {
    // A config that simply omits `gallery` would silently take a published page
    // off the school's site with no error anywhere.
    const items = defaultNavConfig().items.map((i) => ({
      ...i,
      children: i.children.filter((c) => c.key !== 'gallery'),
    }));
    const { ok, errors } = validateNavConfig(config({ items }), PAGES);
    expect(ok).toBe(false);
    expect(errors.join(' ')).toMatch(/gallery/i);
  });

  it('accepts a page dragged OUT of every group, because that makes it top-level', () => {
    // Out of a group is not out of the nav. This is the same edit as above from
    // the visitor's side, and it must be allowed.
    const items = defaultNavConfig()
      .items.map((i) => ({ ...i, children: i.children.filter((c) => c.key !== 'gallery') }))
      // Only a MENU left empty by the drag disappears. The flat pages
      // (Academics, Admissions, Contact) have no children by design and must
      // survive — dropping them here is how this test first failed, and the
      // validator was right to refuse it.
      .filter((i) => i.behaviour !== 'menu' || i.children.length > 0);
    items.push({ key: 'gallery', slug: 'gallery', label: 'Gallery', behaviour: 'page', children: [] });
    const { ok } = validateNavConfig(config({ items }), PAGES);
    expect(ok).toBe(true);
  });

  it('refuses a group nested inside a group', () => {
    const items = [
      {
        key: 'a',
        slug: 'a',
        label: 'A',
        behaviour: 'menu' as const,
        // A child carrying its own children is a third level.
        children: [{ key: 'about', label: 'About', children: [{ key: 'hof', label: 'Hall of Fame' }] }],
      },
    ] as unknown as NavConfig['items'];
    const { errors } = validateNavConfig(config({ items }), PAGES);
    expect(errors.join(' ')).toMatch(/inside another|two levels|nested/i);
  });
});

describe('the slug is frozen, the label is not', () => {
  it('derives a slug from the label when a group is created', () => {
    expect(slugify('Our school')).toBe('our-school');
    expect(slugify('News & events')).toBe('news-events');
  });

  it('refuses two groups claiming the same slug', () => {
    const items = [
      { key: 'a', slug: 'same', label: 'A', behaviour: 'menu' as const, children: [{ key: 'about', label: 'About' }] },
      { key: 'b', slug: 'same', label: 'B', behaviour: 'menu' as const, children: [{ key: 'hof', label: 'Hall of Fame' }] },
    ];
    const { errors } = validateNavConfig(config({ items }), PAGES);
    expect(errors.join(' ')).toMatch(/slug/i);
  });

  it('lets a label be renamed without the slug following it', () => {
    // Renaming "Our school" to "Discover us" must NOT move /our-school, or
    // every shared link and every ranked result breaks on a rename.
    const items = defaultNavConfig().items.map((i) =>
      i.slug === 'our-school' ? { ...i, label: 'Discover us' } : i,
    );
    const { ok } = validateNavConfig(config({ items }), PAGES);
    expect(ok).toBe(true);
    expect(items.find((i) => i.label === 'Discover us')?.slug).toBe('our-school');
  });
});

describe('a school that has published less', () => {
  it('only requires the pages it actually has', () => {
    // A BASIC school with no blog or events must not be told it lost them.
    const few = ['about', 'academics', 'contact'];
    const items = [
      { key: 'our-school', slug: 'our-school', label: 'Our school', behaviour: 'menu' as const, children: [{ key: 'about', label: 'About' }] },
      { key: 'academics', slug: 'academics', label: 'Academics', behaviour: 'page' as const, children: [] },
      { key: 'contact', slug: 'contact', label: 'Contact', behaviour: 'page' as const, children: [] },
    ];
    expect(validateNavConfig(config({ items }), few).ok).toBe(true);
  });
});
