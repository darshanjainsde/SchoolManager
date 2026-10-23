import type { Tier } from '@prisma/client';

export type FeatureKey =
  | 'PUBLIC_SITE' | 'GALLERY' | 'ENQUIRY' | 'SOCIAL' | 'ABOUT_CONTACT' | 'EVENTS'
  | 'EVENTS_HOST' | 'MANAGEMENT' | 'BLOG'
  | 'HIRING' | 'LIBRARY' | 'ALUMNI' | 'FEES' | 'PRESS' | 'SPORTS' | 'SALARY' | 'COURSE_MANAGEMENT' | 'EXAM_HALL' | 'WHATSAPP';

const ALL_KEYS: FeatureKey[] = ['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','EVENTS_HOST','MANAGEMENT','BLOG','HIRING','LIBRARY','ALUMNI','FEES','PRESS','SPORTS','SALARY','COURSE_MANAGEMENT','EXAM_HALL','WHATSAPP'];
const isFeatureKey = (k: string): k is FeatureKey => (ALL_KEYS as string[]).includes(k);

/**
 * The plan ladder (decided 2026-10-22, "Plan Ladder v2").
 *
 * BASIC — Be found: the website (with its about/contact pages), the admissions
 *   desk, and the Events Network as a reader: network events on the school's
 *   site, families register there (EVENTS).
 * STANDARD — Run the day: the whole ERP (MANAGEMENT gates the office, the staff
 *   room, the register, timetable, exams and results, and both apps), hosting
 *   the school's own events (EVENTS_HOST), the blog.
 * PRO — Run everything: money (FEES, SALARY), the exam hall and the press,
 *   the specialist desks (LIBRARY, SPORTS, ALUMNI, HIRING, the syllabus
 *   tracker) and the school on WhatsApp.
 *
 * Until this ladder, ALUMNI, PRESS, SPORTS, SALARY and COURSE_MANAGEMENT were in
 * no tier so a new module would not appear in every Pro school's sidebar the day
 * it deployed. They are Pro now. The same protection is kept by DATA, not by the
 * tier sets: `apps/api/scripts/plan-ladder-protect.ts` writes a disabled
 * override for each live Pro school before the deploy, and the owner lifts
 * them one school at a time.
 */
const BASIC: FeatureKey[] = ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS'];
const STANDARD: FeatureKey[] = [...BASIC, 'EVENTS_HOST', 'MANAGEMENT', 'BLOG'];
const PRO: FeatureKey[] = [...STANDARD, 'HIRING', 'LIBRARY', 'FEES', 'ALUMNI', 'PRESS', 'SPORTS', 'SALARY', 'COURSE_MANAGEMENT', 'EXAM_HALL', 'WHATSAPP'];

export const TIER_FEATURES: Record<Tier, FeatureKey[]> = {
  BASIC, STANDARD, PRO,
};

/** The lowest tier that includes a key, or null for a key no tier grants. */
export function tierOfFeature(key: FeatureKey): Tier | null {
  if (BASIC.includes(key)) return 'BASIC';
  if (STANDARD.includes(key)) return 'STANDARD';
  if (PRO.includes(key)) return 'PRO';
  return null;
}

export function resolveFeatures(
  tier: Tier,
  overrides: { featureKey: string; enabled: boolean }[],
): Set<FeatureKey> {
  const set = new Set<FeatureKey>(TIER_FEATURES[tier]);
  for (const o of overrides) {
    if (!isFeatureKey(o.featureKey)) continue;
    if (o.enabled) set.add(o.featureKey);
    else set.delete(o.featureKey);
  }
  return set;
}
