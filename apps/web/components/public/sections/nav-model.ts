import type { NavFlags } from './SiteNav';
import type { NavConfig } from './nav-config';

/**
 * The single nav model. Desktop CLASSIC/PILL, the CENTER split bar and the
 * mobile drawer all render THIS — they used to each hardcode their own list,
 * which is how CENTER quietly lost Hall of Fame.
 *
 * Six top-level controls is a hard cap, and it is not taste: seven is where a
 * school name of typical length starts truncating at 1280px. See docs/PHASE6.md.
 */
export const NAV_CAP = 6;

export interface NavLeaf {
  key: string;
  label: string;
  href: string;
  /** Secondary line in a menu row (a programme's age range). */
  hint?: string | null;
}

export type NavNode =
  | ({ kind: 'link' } & NavLeaf)
  | {
      kind: 'group';
      key: string;
      label: string;
      /** Set when the group is itself a page (Academics). Absent = menu only. */
      href?: string;
      children: NavLeaf[];
    };

export interface NavCourse {
  id: string;
  name: string;
  ageRange?: string | null;
}

export interface NavModelInput {
  flags: NavFlags;
  /** '' on the homepage, '/' elsewhere — section anchors need the prefix. */
  base: string;
  courses: NavCourse[];
  /** On /academics the programme anchors are same-page. */
  onAcademicsPage?: boolean;
  /**
   * The school's own arrangement. Absent — which is every school until an
   * admin touches the editor — means the default model below.
   */
  config?: NavConfig | null;
}

/**
 * Where each page lives and whether this school has it.
 *
 * One table, so the default model and a school's own arrangement resolve a
 * page the same way: a school that renames "Gallery" to "Photos" moves a label,
 * never a URL.
 */
function pageTable(flags: NavFlags, base: string): Record<string, { href: string; has: boolean; label: string }> {
  return {
    about: { href: `${base}#about`, has: flags.hasAbout, label: 'About' },
    hof: { href: `${base}#hall-of-fame`, has: flags.hasHof, label: 'Hall of Fame' },
    gallery: { href: '/gallery', has: flags.hasGallery, label: 'Gallery' },
    academics: { href: '/academics', has: flags.hasAcademics, label: 'Academics' },
    admissions: { href: '/admissions', has: flags.hasAdmissions, label: 'Admissions' },
    connect: { href: '/connect', has: flags.hasEvents, label: 'Connect' },
    blog: { href: '/blog', has: flags.hasBlog, label: 'Blog' },
    contact: { href: '/contact', has: flags.hasContact || flags.hasEnquiry, label: 'Contact' },
  };
}

/**
 * Build the menu from a school's own arrangement.
 *
 * Unpublished pages are dropped rather than linked into a 404 — the editor
 * refuses to LOSE a page, but a school can still turn a feature off after
 * arranging its menu, and the menu has to survive that.
 */
function fromConfig(config: NavConfig, input: NavModelInput): NavNode[] {
  const pages = pageTable(input.flags, input.base);
  const nodes: (NavNode | null)[] = config.items.map((item) => {
    const children: NavLeaf[] = item.children
      .filter((c) => pages[c.key]?.has)
      .map((c) => ({ key: c.key, label: c.label, href: pages[c.key].href }));

    const own = pages[item.key];
    if (item.children.length === 0) {
      // A flat item IS a page; if the school does not have it, it goes.
      if (!own?.has) return null;
      return { kind: 'link', key: item.key, label: item.label, href: own.href };
    }
    return collapse({
      kind: 'group',
      key: item.key,
      label: item.label,
      // `menu` deliberately navigates nowhere. `page` lands on the group's own
      // page. `overview` lands on the GENERATED page at /overview/<slug> — the
      // slug is frozen at creation, so this URL survives every rename.
      href:
        item.behaviour === 'menu'
          ? undefined
          : item.behaviour === 'overview'
            ? `/overview/${item.slug}`
            : own?.href,
      children,
    });
  });
  return nodes.filter((n): n is NavNode => n !== null);
}

/** A group earns its slot only if it opens onto more than one thing. */
function collapse(node: Extract<NavNode, { kind: 'group' }>): NavNode | null {
  if (node.children.length === 0) {
    // A menu onto nothing is dropped; a group that is also a page survives as
    // that page, because the page still exists and still has to be reachable.
    return node.href ? { kind: 'link', key: node.key, label: node.label, href: node.href } : null;
  }
  if (!node.href && node.children.length === 1) {
    const only = node.children[0];
    return { kind: 'link', key: only.key, label: only.label, href: only.href };
  }
  return node;
}

export function navModel(input: NavModelInput): NavNode[] {
  const { flags, base, courses, onAcademicsPage } = input;
  if (input.config?.items?.length) return fromConfig(input.config, input);

  const ourSchool: NavLeaf[] = [
    ...(flags.hasAbout ? [{ key: 'about', label: 'About', href: `${base}#about` }] : []),
    ...(flags.hasHof ? [{ key: 'hof', label: 'Hall of Fame', href: `${base}#hall-of-fame` }] : []),
    ...(flags.hasGallery ? [{ key: 'gallery', label: 'Gallery', href: '/gallery' }] : []),
  ];

  const news: NavLeaf[] = [
    ...(flags.hasEvents ? [{ key: 'connect', label: 'Connect', href: '/connect' }] : []),
    ...(flags.hasBlog ? [{ key: 'blog', label: 'Blog', href: '/blog' }] : []),
  ];

  const programmes: NavLeaf[] = flags.hasAcademics
    ? courses.map((c) => ({
        key: `course-${c.id}`,
        label: c.name,
        href: onAcademicsPage ? `#course-${c.id}` : `/academics#course-${c.id}`,
        hint: c.ageRange ?? null,
      }))
    : [];

  const nodes: (NavNode | null)[] = [
    collapse({ kind: 'group', key: 'our-school', label: 'Our school', children: ourSchool }),
    flags.hasAcademics
      ? collapse({ kind: 'group', key: 'academics', label: 'Academics', href: '/academics', children: programmes })
      : null,
    // Never grouped: it is the page a school most wants read.
    flags.hasAdmissions ? { kind: 'link' as const, key: 'admissions', label: 'Admissions', href: '/admissions' } : null,
    collapse({ kind: 'group', key: 'news', label: 'News & events', children: news }),
    flags.hasContact || flags.hasEnquiry
      ? { kind: 'link' as const, key: 'contact', label: 'Contact', href: '/contact' }
      : null,
  ];

  return nodes.filter((n): n is NavNode => n !== null);
}
