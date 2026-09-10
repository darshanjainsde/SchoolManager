/**
 * The Book of Records on the public website — the school's switch and
 * choices, stored on `SchoolProfile.recordsConfig` and normalised on read so a
 * half-written or old row never breaks the site. The homepage LAYOUT is not
 * here: it is a Studio band (`sectionVariants.records.layout`) like every
 * other band; this holds what is content and policy, not styling.
 */
export type RecordsNameFormat = 'FIRST' | 'FIRST_INITIAL' | 'FULL';
export type RecordsPageLayout = 'SCOREBOARD' | 'REGISTER' | 'CABINET' | 'PROGRESSION';
export type RecordsHomeScope = 'RECENT' | 'PINNED' | 'ALL';

export interface RecordsSiteConfig {
  /** Show the book on the website at all (the page and the homepage band). */
  enabled: boolean;
  /** The office confirms it holds consent to name children publicly. */
  consentConfirmed: boolean;
  nameFormat: RecordsNameFormat;
  pageLayout: RecordsPageLayout;
  /** Which lines the homepage shows: the newest records, hand-picked lines, or every line. */
  homeScope: RecordsHomeScope;
  homeCount: 4 | 6 | 8;
  /** Line keys (`sportKey|groupKey|category`) when homeScope is PINNED. */
  pinned: string[];
  /** All-time top five under each record; off = the record and its history only. */
  showTopFive: boolean;
  /** Group keys shown anywhere on the site; empty = every group. */
  groups: string[];
}

export const DEFAULT_RECORDS_SITE: RecordsSiteConfig = {
  enabled: false,
  consentConfirmed: false,
  nameFormat: 'FIRST_INITIAL',
  pageLayout: 'CABINET',
  homeScope: 'RECENT',
  homeCount: 4,
  pinned: [],
  showTopFive: true,
  groups: [],
};

export const RECORDS_NAME_FORMATS: readonly RecordsNameFormat[] = ['FIRST', 'FIRST_INITIAL', 'FULL'];
export const RECORDS_PAGE_LAYOUTS: readonly RecordsPageLayout[] = ['SCOREBOARD', 'REGISTER', 'CABINET', 'PROGRESSION'];
export const RECORDS_HOME_SCOPES: readonly RecordsHomeScope[] = ['RECENT', 'PINNED', 'ALL'];
const HOME_COUNTS = [4, 6, 8] as const;
const KEY = /^[a-z0-9:-]{1,80}\|[a-z0-9-]{1,20}\|(Boys|Girls|Mixed)$/;

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function normalizeRecordsConfig(raw: unknown): RecordsSiteConfig {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const count = Number(r.homeCount);
  return {
    enabled: bool(r.enabled, false),
    consentConfirmed: bool(r.consentConfirmed, false),
    nameFormat: pick(r.nameFormat, RECORDS_NAME_FORMATS, DEFAULT_RECORDS_SITE.nameFormat),
    pageLayout: pick(r.pageLayout, RECORDS_PAGE_LAYOUTS, DEFAULT_RECORDS_SITE.pageLayout),
    homeScope: pick(r.homeScope, RECORDS_HOME_SCOPES, DEFAULT_RECORDS_SITE.homeScope),
    homeCount: (HOME_COUNTS as readonly number[]).includes(count) ? (count as 4 | 6 | 8) : DEFAULT_RECORDS_SITE.homeCount,
    pinned: Array.isArray(r.pinned) ? [...new Set(r.pinned.filter((k): k is string => typeof k === 'string' && KEY.test(k)))].slice(0, 200) : [],
    showTopFive: bool(r.showTopFive, true),
    groups: Array.isArray(r.groups) ? [...new Set(r.groups.filter((g): g is string => typeof g === 'string' && /^[a-z0-9-]{1,20}$/.test(g)))].slice(0, 12) : [],
  };
}

/** "Rohan Iyer" → "Rohan I." / "Rohan" / "Rohan Iyer". A one-word name is left alone. */
export function formatPublicName(full: string, format: RecordsNameFormat): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (format === 'FULL' || parts.length === 1) return parts.join(' ');
  if (format === 'FIRST') return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
