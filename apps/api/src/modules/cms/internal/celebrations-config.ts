/**
 * Birthdays & Celebrations settings (Active Roster, Track B).
 *
 * Stored as ONE JSON blob on `SchoolProfile.celebrationsConfig`, normalised
 * here on every write and every read, so the renderer, the admin tab and the
 * public projection can never disagree about a default. Null in the database
 * means "every default below" — which is deliberately the quietest setting:
 * families only, no photos, first name and an initial.
 */
export type CelebrationsSource = 'STUDENTS' | 'MANUAL';
export type CelebrationsWindow = 'TODAY' | 'WEEK' | 'MONTH';
export type CelebrationsNameFormat = 'FIRST' | 'FIRST_INITIAL' | 'FULL';
export type CelebrationsAudience = 'FAMILIES' | 'PUBLIC' | 'BOTH';
export type CelebrationsPlacement = 'TEASER_AND_PAGE' | 'PAGE_ONLY';
export type CelebrationsTeaser = 'CAKE_BADGE' | 'RIBBON';
export type CelebrationsPage = 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD';

export interface ManualCelebration {
  name: string;
  day: number;
  month: number;
  classLabel: string | null;
}

export interface CelebrationsConfig {
  source: CelebrationsSource;
  window: CelebrationsWindow;
  nameFormat: CelebrationsNameFormat;
  showClass: boolean;
  showPhotos: boolean;
  audience: CelebrationsAudience;
  placement: CelebrationsPlacement;
  teaser: CelebrationsTeaser;
  page: CelebrationsPage;
  wishLine: string;
  /** Must be true before `audience` may be PUBLIC or BOTH (D3). */
  consentConfirmed: boolean;
  manual: ManualCelebration[];
}

export const DEFAULT_CELEBRATIONS: CelebrationsConfig = {
  source: 'STUDENTS',
  window: 'WEEK',
  nameFormat: 'FIRST_INITIAL',
  showClass: true,
  showPhotos: false,
  audience: 'FAMILIES',
  placement: 'TEASER_AND_PAGE',
  teaser: 'CAKE_BADGE',
  page: 'PARTY_WALL',
  wishLine: 'Happy birthday, {first name}! From all of us at {school}.',
  consentConfirmed: false,
  manual: [],
};

export const CELEBRATIONS_SOURCES: readonly CelebrationsSource[] = ['STUDENTS', 'MANUAL'];
export const CELEBRATIONS_WINDOWS: readonly CelebrationsWindow[] = ['TODAY', 'WEEK', 'MONTH'];
export const CELEBRATIONS_NAME_FORMATS: readonly CelebrationsNameFormat[] = ['FIRST', 'FIRST_INITIAL', 'FULL'];
export const CELEBRATIONS_AUDIENCES: readonly CelebrationsAudience[] = ['FAMILIES', 'PUBLIC', 'BOTH'];
export const CELEBRATIONS_PLACEMENTS: readonly CelebrationsPlacement[] = ['TEASER_AND_PAGE', 'PAGE_ONLY'];
export const CELEBRATIONS_TEASERS: readonly CelebrationsTeaser[] = ['CAKE_BADGE', 'RIBBON'];
export const CELEBRATIONS_PAGES: readonly CelebrationsPage[] = ['PARTY_WALL', 'MONTH_PLANNER', 'NOTICE_BOARD'];

const WISH_MAX = 160;
const MANUAL_MAX = 500;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function manualEntry(raw: unknown): ManualCelebration | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const name = typeof e.name === 'string' ? e.name.trim().slice(0, 80) : '';
  const day = Number(e.day);
  const month = Number(e.month);
  if (!name || !Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  const classLabel =
    typeof e.classLabel === 'string' && e.classLabel.trim() ? e.classLabel.trim().slice(0, 20) : null;
  return { name, day, month, classLabel };
}

/** Anything → a complete, valid config. Unknown values fall back; nothing throws. */
export function normalizeCelebrationsConfig(raw: unknown): CelebrationsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const consentConfirmed = bool(r.consentConfirmed, false);
  const audienceWanted = pick(r.audience, CELEBRATIONS_AUDIENCES, 'FAMILIES');
  const manual: ManualCelebration[] = Array.isArray(r.manual)
    ? r.manual
        .map(manualEntry)
        .filter((m): m is ManualCelebration => m !== null)
        .slice(0, MANUAL_MAX)
        .sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name))
    : [];
  const wish = typeof r.wishLine === 'string' && r.wishLine.trim() ? r.wishLine.trim() : DEFAULT_CELEBRATIONS.wishLine;
  return {
    source: pick(r.source, CELEBRATIONS_SOURCES, 'STUDENTS'),
    window: pick(r.window, CELEBRATIONS_WINDOWS, 'WEEK'),
    nameFormat: pick(r.nameFormat, CELEBRATIONS_NAME_FORMATS, 'FIRST_INITIAL'),
    showClass: bool(r.showClass, true),
    showPhotos: bool(r.showPhotos, false),
    // A public wall without the consent box ticked is not a config, it is a
    // mistake — it quietly falls back to families only (D3).
    audience: audienceWanted === 'FAMILIES' || consentConfirmed ? audienceWanted : 'FAMILIES',
    placement: pick(r.placement, CELEBRATIONS_PLACEMENTS, 'TEASER_AND_PAGE'),
    teaser: pick(r.teaser, CELEBRATIONS_TEASERS, 'CAKE_BADGE'),
    page: pick(r.page, CELEBRATIONS_PAGES, 'PARTY_WALL'),
    wishLine: wish.slice(0, WISH_MAX),
    consentConfirmed,
    manual,
  };
}
