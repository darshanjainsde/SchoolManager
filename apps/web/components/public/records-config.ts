/**
 * Web mirror of the API's records-site config (apps/api/src/modules/cms/
 * internal/records-config.ts) — the web app cannot import API types. Labels
 * here are what the Records tab shows; values are what it saves. The homepage
 * LAYOUT is a Studio band (site-variants.ts `records`), not part of this.
 */
import type { StyleOption } from './celebrations-config';

export type RecordsNameFormat = 'FIRST' | 'FIRST_INITIAL' | 'FULL';
export type RecordsPageLayout = 'SCOREBOARD' | 'REGISTER' | 'CABINET' | 'PROGRESSION';
export type RecordsHomeScope = 'RECENT' | 'PINNED' | 'ALL';
export type RecordsHomeLayout = 'BOARD' | 'CABINET' | 'STRIP' | 'TILES';

export interface RecordsSiteConfig {
  enabled: boolean;
  consentConfirmed: boolean;
  nameFormat: RecordsNameFormat;
  pageLayout: RecordsPageLayout;
  homeScope: RecordsHomeScope;
  homeCount: 4 | 6 | 8;
  pinned: string[];
  showTopFive: boolean;
  groups: string[];
}

export interface RecordsLineIndexRow { key: string; label: string; groupKey: string; hasRecord: boolean; marks: number }

export const RECORDS_PAGE_STYLES: StyleOption<RecordsPageLayout>[] = [
  { value: 'CABINET', label: 'Medal cabinet', hint: 'One card per line: the holder on a gold plaque, the next four on silver, bronze and plain discs.' },
  { value: 'SCOREBOARD', label: 'Scoreboard', hint: 'A dark stadium board: sport tabs, one row per line, the top five as bars.' },
  { value: 'REGISTER', label: 'The Register', hint: 'Ruled paper, a chapter per sport, the record’s history written out.' },
  { value: 'PROGRESSION', label: 'Progression', hint: 'A small chart of each record over the years, the top five beside it.' },
];

export const RECORDS_NAME_FORMATS: StyleOption<RecordsNameFormat>[] = [
  { value: 'FIRST_INITIAL', label: 'First name + initial', hint: '“Rohan I.” — tells two Rohans apart, keeps the surname off the page.' },
  { value: 'FIRST', label: 'First name only', hint: '“Rohan”' },
  { value: 'FULL', label: 'Full name', hint: '“Rohan Iyer”' },
];

export const RECORDS_HOME_SCOPES: StyleOption<RecordsHomeScope>[] = [
  { value: 'RECENT', label: 'Newest records', hint: 'The most recently set records, a few at a time.' },
  { value: 'PINNED', label: 'Lines I pick', hint: 'Tick the lines the homepage shows, in your order.' },
  { value: 'ALL', label: 'Every record', hint: 'Every line with a verified record. Long for a big school.' },
];

export const RECORDS_HOME_LAYOUTS: StyleOption<RecordsHomeLayout>[] = [
  { value: 'TILES', label: 'Podium tiles', hint: 'Tiles in the site’s own card shape: the number, the holder, a “since” chip.' },
  { value: 'BOARD', label: 'Stadium board', hint: 'A dark band with the marks in big accent numerals.' },
  { value: 'CABINET', label: 'Trophy cabinet', hint: 'Brass plaques on a wooden shelf behind glass.' },
  { value: 'STRIP', label: 'Honours strip', hint: 'A single line under the menu that reads the records out.' },
];
