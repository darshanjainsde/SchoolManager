/**
 * What a sports teacher may do on the desk. The admin sets the list per
 * teacher from Admin → Sports → Teachers; the school admin always holds all
 * of them. Stored on `Staff.sportsPerms`.
 */
export const SPORTS_PERMS = ['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES', 'SETTINGS'] as const;
export type SportsPerm = (typeof SPORTS_PERMS)[number];

export const SPORTS_PERM_LABELS: Record<SportsPerm, string> = {
  ENTER: 'Enter results and marks',
  VERIFY: 'Verify records',
  CREATE: 'Create and schedule tournaments',
  PUBLISH: 'Publish to students',
  HOUSES: 'Houses and points',
  SETTINGS: 'Sports settings',
};

/** A new sports teacher starts here; the admin can widen or narrow it. */
export const DEFAULT_SPORTS_PERMS: readonly SportsPerm[] = ['ENTER', 'VERIFY', 'CREATE', 'HOUSES'];

/**
 * Stored list → the list that counts. An empty column means "never set" and
 * takes the defaults; unknown strings (a renamed permission) are dropped. To
 * take every right away the admin changes the job or deactivates the staff row.
 */
export function effectiveSportsPerms(stored: readonly string[] | null | undefined): SportsPerm[] {
  const known = (stored ?? []).filter((p): p is SportsPerm => (SPORTS_PERMS as readonly string[]).includes(p));
  return known.length ? [...new Set(known)] : [...DEFAULT_SPORTS_PERMS];
}
