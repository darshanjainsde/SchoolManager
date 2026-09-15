import type { PublicHallOfFame } from '@/lib/public-api';

/**
 * Does the Hall of Fame have anything to show?
 *
 * Lives outside HallOfFame.tsx because that file is `'use client'`, and every
 * export of a client module is a client reference in the RSC graph — so a
 * server component calling this one throws at runtime. See hero-model.ts for
 * the full story; this is the same bug, one module over.
 */
export function hofHasEntries(hof: PublicHallOfFame | null | undefined): boolean {
  return !!hof && hof.groups.some((g) => g.entries.length > 0);
}
