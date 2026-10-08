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

export const FAMILIES: Record<Family, Record<ColorScheme, FamilyTone>> = {
  learn: { light: { ink: '#4338CA', soft: '#EEF0FF' }, dark: { ink: '#A5A8FF', soft: '#2A2A5C' } },
  money: { light: { ink: '#0369A1', soft: '#E3F1FB' }, dark: { ink: '#7CC4F2', soft: '#0E2E44' } },
  care: { light: { ink: '#B45309', soft: '#FFF4E0' }, dark: { ink: '#F7C774', soft: '#3B2A10' } },
  people: { light: { ink: '#0F766E', soft: '#E3F6F3' }, dark: { ink: '#6EE0CF', soft: '#0D3330' } },
  sport: { light: { ink: '#166534', soft: '#E6F5EA' }, dark: { ink: '#86E3A2', soft: '#12331C' } },
  school: { light: { ink: '#6D28D9', soft: '#F1EAFE' }, dark: { ink: '#C4A8FF', soft: '#2E1F52' } },
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
