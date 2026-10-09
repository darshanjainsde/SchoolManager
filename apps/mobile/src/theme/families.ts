import type { ColorScheme } from './tokens';

/**
 * ICON FAMILIES (UI v2, 2026-10-08). A tool's tint says which part of school
 * life it belongs to, so a person who reads little English finds Fees by its
 * colour and shape: learning is indigo, money blue, presence and care amber,
 * people teal, sports and the library green, school life violet. Each tint
 * passes 4.5:1 for its ink on its own soft fill (theme/__tests__/families.test.ts).
 */
export type Family = 'learn' | 'money' | 'care' | 'people' | 'sport' | 'school';

export interface FamilyTone {
  ink: string;
  soft: string;
}

// ONE COLOUR FAMILY (user, 9 Oct 2026: "follow one theme where you can vary
// shade & designs but only limited color family"). The six families stay as
// NAMES (so a tool keeps its place and its tests) but all are shades of the
// app's indigo: deep, core and violet-leaning, each on its own pale tint.
// Red and green remain only for meaning (absent/overdue, present/done).
export const FAMILIES: Record<Family, Record<ColorScheme, FamilyTone>> = {
  learn: { light: { ink: '#4338CA', soft: '#EEF0FF' }, dark: { ink: '#A5A8FF', soft: '#2A2A5C' } },
  money: { light: { ink: '#312E81', soft: '#E7E8FA' }, dark: { ink: '#C7C9FF', soft: '#23244D' } },
  care: { light: { ink: '#4F46E5', soft: '#ECEBFF' }, dark: { ink: '#B4B2FF', soft: '#2B2960' } },
  people: { light: { ink: '#3730A3', soft: '#EAEBFC' }, dark: { ink: '#B9BCFF', soft: '#262856' } },
  sport: { light: { ink: '#3B3BB3', soft: '#EDEEFB' }, dark: { ink: '#AEB2FF', soft: '#25285A' } },
  school: { light: { ink: '#5B21B6', soft: '#F0EBFE' }, dark: { ink: '#C9B6FF', soft: '#2E2456' } },
};

const BY_ICON: Record<string, Family> = {
  diary: 'learn', assignments: 'learn', timetable: 'learn', results: 'learn', notes: 'learn', report: 'learn',
  fees: 'money',
  take: 'care', requests: 'care', concern: 'care',
  messages: 'people', person: 'people',
  sports: 'sport', library: 'sport',
  notices: 'school', holidays: 'school', cake: 'school', bell: 'school',
};

/** The family an icon belongs to; unknown icons are "learning". */
export function familyOf(icon: string): Family {
  return BY_ICON[icon] ?? 'learn';
}

export function familyTone(icon: string, scheme: ColorScheme): FamilyTone {
  return FAMILIES[familyOf(icon)][scheme];
}
