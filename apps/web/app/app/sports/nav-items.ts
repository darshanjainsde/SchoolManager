/**
 * The sports desk's sections. Own module, not a layout export (Next rejects
 * non-reserved exports from layout/page files — see app/app/library/nav-items.ts
 * and app/route-file-exports.test.ts).
 *
 * Two doors draw this strip: the admin console at `/app/sports` and the sports
 * teacher's own portal at `/sports` (STAFF with the SPORTS job cannot enter the
 * console — `lib/role-routes.ts`). Sections are SEGMENTS; each door prefixes
 * its base. `adminOnly` sections exist only behind the console door: the
 * Teachers tab is where the admin decides what each sports teacher may do, and
 * a teacher deciding their own rights would be no control at all.
 */
export interface SportsSection {
  seg: string;
  label: string;
  adminOnly?: boolean;
}

export const SPORTS_SECTIONS: SportsSection[] = [
  { seg: '', label: 'Tournaments' },
  { seg: 'records', label: 'Records' },
  { seg: 'houses', label: 'Houses' },
  { seg: 'rules', label: 'Rules' },
  { seg: 'settings', label: 'Settings' },
  { seg: 'teachers', label: 'Teachers', adminOnly: true },
];

export function sectionHref(base: string, seg: string): string {
  return seg ? `${base}/${seg}` : base;
}

/** The index route matches EXACTLY; `startsWith` would light Tournaments on every section. */
export function isSectionActive(pathname: string, base: string, href: string): boolean {
  if (href === base) return pathname === base || pathname.startsWith(`${base}/tournaments/`);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function sectionsFor(base: string): SportsSection[] {
  return base === '/app/sports' ? SPORTS_SECTIONS : SPORTS_SECTIONS.filter((s) => !s.adminOnly);
}
