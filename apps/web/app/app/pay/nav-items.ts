/**
 * The Pay section's seven tabs.
 *
 * Own module, not a layout export — Next rejects non-reserved exports from a
 * layout or page file (see app/app/library/nav-items.ts and
 * app/route-file-exports.test.ts).
 *
 * The index is HOME — the month at a glance, the guide, and the doors — like
 * every other section's front page. "This month" is the working screen a
 * run happens on; it used to be the index, which put the guide two screens
 * below a table and made Pay the only section that opened on a form. Grades
 * sits next to People because the two are read together — a grade is where
 * a person's money comes from.
 */
export interface PaySection {
  /** Path segment under the base. Empty string = the index route. */
  seg: string;
  label: string;
}

export const PAY_SECTIONS: PaySection[] = [
  { seg: '', label: 'Home' },
  { seg: 'month', label: 'This month' },
  { seg: 'people', label: 'People' },
  { seg: 'grades', label: 'Grades' },
  { seg: 'payslips', label: 'Payslips' },
  { seg: 'filings', label: 'Filings' },
  { seg: 'settings', label: 'Settings' },
];

export function sectionHref(base: string, seg: string): string {
  return seg ? `${base}/${seg}` : base;
}

export function isSectionActive(pathname: string | null, base: string, href: string): boolean {
  if (!pathname) return false;
  if (href === base) return pathname === base || pathname === `${base}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}
