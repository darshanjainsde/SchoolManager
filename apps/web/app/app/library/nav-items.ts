/**
 * The library's six sections.
 *
 * Lives in its own module rather than being exported from `layout.tsx`,
 * because Next.js App Router rejects any named export from a layout/page/route
 * file that is not one of its own reserved fields — `next build` fails with
 * "LIBRARY_SECTIONS is not a valid Layout export field" while `tsc --noEmit`,
 * `next lint` and vitest all pass. Same reason `app/staff/nav-items.ts` and
 * `app/portal/nav-items.ts` exist; `app/route-file-exports.test.ts` reproduces
 * that gate cheaply.
 *
 * Two shells render this same list: the admin console at `/app/library` and
 * the librarian's own portal at `/library` (she has no console to enter — see
 * `lib/role-routes.ts`). Sections are therefore stored as SEGMENTS, and each
 * shell prefixes its own base.
 *
 * `seg: ''` is the section's index route. Order is the order of use, not the
 * order they were built: the counter is where a librarian spends the day.
 */
export interface LibrarySection {
  /** Path segment under the shell's base. Empty string = the index route. */
  seg: string;
  label: string;
}

export const LIBRARY_SECTIONS: LibrarySection[] = [
  { seg: '', label: 'Dashboard' },
  { seg: 'counter', label: 'Counter' },
  { seg: 'hall', label: 'Reading hall' },
  // The route segment stays `books` on purpose: it is what the librarian's
  // bookmarks already point at, and renaming it would 404 them for a label.
  { seg: 'books', label: 'Catalogue' },
  { seg: 'fines', label: 'Fines' },
  { seg: 'settings', label: 'Settings' },
];

/** `/app/library` + `counter` -> `/app/library/counter`; + `''` -> `/app/library`. */
export function sectionHref(base: string, seg: string): string {
  return seg ? `${base}/${seg}` : base;
}

/**
 * Whether `href` is the section the given pathname is on. The index route must
 * match EXACTLY — `startsWith` would light Dashboard up on every section.
 */
export function isSectionActive(pathname: string, base: string, href: string): boolean {
  if (href === base) return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}
