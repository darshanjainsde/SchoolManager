/**
 * The Salary section's five tabs.
 *
 * Own module, not a layout export — Next rejects non-reserved exports from a
 * layout or page file (see app/app/library/nav-items.ts and
 * app/route-file-exports.test.ts).
 *
 * The order is the order of use, not the order they were built: an admin opens
 * Salary to run the month, so the pay run is the index.
 */
export interface SalarySection {
  /** Path segment under the base. Empty string = the index route. */
  seg: string;
  label: string;
}

export const SALARY_SECTIONS: SalarySection[] = [
  { seg: '', label: 'Pay run' },
  { seg: 'people', label: 'People' },
  { seg: 'payslips', label: 'Payslips' },
  { seg: 'statutory', label: 'Statutory' },
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
