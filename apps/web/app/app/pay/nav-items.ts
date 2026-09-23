/**
 * The Pay section's six tabs.
 *
 * Own module, not a layout export — Next rejects non-reserved exports from a
 * layout or page file (see app/app/library/nav-items.ts and
 * app/route-file-exports.test.ts).
 *
 * The order is the order of use. "This month" is the index because that is
 * what an admin opens Pay to do; Grades sits next to People because the two
 * are read together — a grade is where a person's money comes from.
 */
export interface PaySection {
  /** Path segment under the base. Empty string = the index route. */
  seg: string;
  label: string;
}

export const PAY_SECTIONS: PaySection[] = [
  { seg: '', label: 'This month' },
  { seg: 'people', label: 'People' },
  { seg: 'grades', label: 'Grades' },
  { seg: 'payslips', label: 'Payslips' },
  { seg: 'filings', label: 'Filings' },
  { seg: 'settings', label: 'Settings' },
];

export function sectionHref(base: string, seg: string): string {
  return seg ? `${base}/${seg}` : base;
}

/** The index must match EXACTLY, or it lights up on every section. */
export function isSectionActive(pathname: string, base: string, href: string): boolean {
  if (href === base) return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}
