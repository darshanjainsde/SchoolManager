import { NAV_CAP } from './nav-model';

/**
 * A school's own arrangement of its navigation.
 *
 * Null/absent means "use the default model" — which is what every school has
 * today, and what they keep until an admin touches the editor.
 *
 * The four refusals below are correctness, not taste, which is why they live
 * here and are tested rather than living in the editor's event handlers. The
 * one that matters most is the last: a page a school published and can no
 * longer reach is worse than any layout mistake.
 */
export interface NavConfigChild {
  /** Stable page id — `about`, `gallery`, `connect`… Never renamed. */
  key: string;
  label: string;
}

export interface NavConfigItem {
  key: string;
  /**
   * FROZEN at creation. The label above is editable; this is not. Renaming
   * "Our school" to "Discover us" must not break shared links or drop the page
   * from results it already ranks for.
   */
  slug: string;
  label: string;
  /**
   * menu     — opens the list, navigates nowhere. Correct when every child is
   *            already a real page.
   * page     — the item IS a page (a top-level link, or a parent that is one of
   *            its own children).
   * overview — a generated page listing the children. The only behaviour that
   *            gives a search engine somewhere to land.
   */
  behaviour: 'menu' | 'page' | 'overview';
  children: NavConfigChild[];
}

export interface NavConfig {
  items: NavConfigItem[];
}

/** Lower-case, hyphenated, no punctuation — a slug that survives being shared. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The five-control model already shipped, expressed as a config. */
export function defaultNavConfig(): NavConfig {
  return {
    items: [
      {
        key: 'our-school',
        slug: 'our-school',
        label: 'Our school',
        behaviour: 'menu',
        children: [
          { key: 'about', label: 'About' },
          { key: 'hof', label: 'Hall of Fame' },
          { key: 'gallery', label: 'Gallery' },
        ],
      },
      { key: 'academics', slug: 'academics', label: 'Academics', behaviour: 'page', children: [] },
      { key: 'admissions', slug: 'admissions', label: 'Admissions', behaviour: 'page', children: [] },
      {
        key: 'news',
        slug: 'news-events',
        label: 'News & events',
        behaviour: 'menu',
        children: [
          { key: 'connect', label: 'Connect' },
          { key: 'blog', label: 'Blog' },
        ],
      },
      { key: 'contact', slug: 'contact', label: 'Contact', behaviour: 'page', children: [] },
    ],
  };
}

export interface NavConfigCheck {
  ok: boolean;
  errors: string[];
}

/**
 * @param available the pages this school actually has. A BASIC school with no
 *        blog must not be told it lost one.
 */
export function validateNavConfig(config: NavConfig, available: string[]): NavConfigCheck {
  const errors: string[] = [];
  const items = config.items ?? [];

  if (items.length > NAV_CAP) {
    errors.push(
      `A school name starts truncating past six controls — there are ${items.length}. Group some of them together.`,
    );
  }

  const seenSlugs = new Set<string>();
  const placements = new Map<string, number>();

  for (const item of items) {
    if (item.behaviour === 'menu' && item.children.length === 0) {
      errors.push(`“${item.label}” is a menu with nothing in it. Make it a page, or put something under it.`);
    }
    if (seenSlugs.has(item.slug)) {
      errors.push(`Two groups share the address /${item.slug}. A slug has to be unique.`);
    }
    seenSlugs.add(item.slug);

    // A top-level item that is itself a page counts as that page's placement.
    if (item.children.length === 0 && available.includes(item.key)) {
      placements.set(item.key, (placements.get(item.key) ?? 0) + 1);
    }

    for (const child of item.children) {
      if ((child as { children?: unknown[] }).children?.length) {
        errors.push(
          `“${child.label}” is a group inside “${item.label}”. Two levels is a school website; three is a filing system.`,
        );
      }
      placements.set(child.key, (placements.get(child.key) ?? 0) + 1);
    }
  }

  for (const [key, count] of placements) {
    if (count > 1) errors.push(`“${key}” appears more than once. A page belongs in one place.`);
  }

  // The rule that matters most, checked last so its message is the one an
  // admin reads at the end.
  for (const page of available) {
    if (!placements.has(page)) {
      errors.push(`“${page}” is published but appears nowhere in the menu. Every page needs a way in.`);
    }
  }

  return { ok: errors.length === 0, errors };
}
