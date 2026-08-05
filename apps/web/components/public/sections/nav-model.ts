import type { NavFlags } from './SiteNav';

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

export function navModel({ flags, base, courses, onAcademicsPage }: NavModelInput): NavNode[] {
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
