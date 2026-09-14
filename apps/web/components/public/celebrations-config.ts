/**
 * Web mirror of the API's celebrations config (apps/api/src/modules/cms/
 * internal/celebrations-config.ts) — the web app cannot import API types.
 * Labels here are what the Celebrations tab shows; values are what it saves.
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
  consentConfirmed: boolean;
  manual: ManualCelebration[];
}

export interface StyleOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

export const TEASER_STYLES: StyleOption<CelebrationsTeaser>[] = [
  { value: 'CAKE_BADGE', label: 'Cake badge', hint: 'A small pill in the corner with a flickering candle — the homepage stays as it is.' },
  { value: 'RIBBON', label: 'Ribbon', hint: 'A thin strip under the menu; today’s names scroll past like an assembly notice.' },
];

export const PAGE_STYLES: StyleOption<CelebrationsPage>[] = [
  { value: 'PARTY_WALL', label: 'Party Wall', hint: 'Bright and playful: confetti, big round photos, a gold ring for today.' },
  { value: 'MONTH_PLANNER', label: 'Month Planner', hint: 'A real month grid, one dot per child, today outlined. Nothing moves.' },
  { value: 'NOTICE_BOARD', label: 'Notice Board', hint: 'Cork, pins and index cards at a slight tilt — the board outside the office.' },
];

export const WINDOW_OPTIONS: StyleOption<CelebrationsWindow>[] = [
  { value: 'TODAY', label: 'Today', hint: 'Only today’s birthdays.' },
  { value: 'WEEK', label: 'This week', hint: 'Today and the next six days.' },
  { value: 'MONTH', label: 'This month', hint: 'The whole calendar month.' },
];

export const NAME_FORMAT_OPTIONS: StyleOption<CelebrationsNameFormat>[] = [
  { value: 'FIRST_INITIAL', label: 'First name + initial', hint: '“Aarav M.” — tells twins apart, keeps the surname off the page.' },
  { value: 'FIRST', label: 'First name only', hint: '“Aarav”' },
  { value: 'FULL', label: 'Full name', hint: '“Aarav Mehta”' },
];

export const AUDIENCE_OPTIONS: StyleOption<CelebrationsAudience>[] = [
  { value: 'FAMILIES', label: 'Families only', hint: 'Shown after sign-in in the portal and the app.' },
  { value: 'PUBLIC', label: 'Public website', hint: 'Anyone who opens the school website. Needs parental consent.' },
  { value: 'BOTH', label: 'Both', hint: 'On the website and after sign-in.' },
];

/** The wish line with its two placeholders filled in. */
export function fillWish(line: string, firstName: string, school: string): string {
  return line.replace('{first name}', firstName).replace('{school}', school);
}
