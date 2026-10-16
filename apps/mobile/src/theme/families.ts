import type { ColorPalette, ColorScheme } from './tokens';
import { useMemo } from 'react';
import { contrastRatio, mix } from './school-brand';
import { useTheme } from './theme-context';

/**
 * FIVE FAMILIES, FIVE REAL HUES (user, 16 Oct 2026: "monocolor with different
 * theme is too odd … create some color family"). A tool's tint says which kind
 * of work it is, so a person who reads little English finds Fees by its colour
 * and shape:
 *   learn  — the school's accent (indigo by default): timetable, syllabus,
 *            homework, tests, results, notes, diary
 *   care   — teal: attendance, leave, requests, the Complaint Box
 *   money  — gold: fees, pay, receipts
 *   people — coral: messages, families, profile
 *   school — sky: notices, holidays, events, birthdays, sports, the library
 * Each family has a `soft` tint (tiles, figure cells), an `ink` (text and
 * glyph on the tint) and a `fill` (the one filled button, rings, dots). Every
 * ink clears 4.5:1 on its soft in both schemes (theme/__tests__/families.test.ts).
 * Red and green stay reserved for meaning (absent/overdue, present/done).
 *
 * Only `learn` follows the school's accent (Appearance → Highlight or the
 * school's own colour); the other four are fixed, so a navy school still gets
 * teal attendance and coral messages — colour that means something is not
 * decoration, and must not change when the brand does.
 */
export type Family = 'learn' | 'care' | 'money' | 'people' | 'school';

export interface FamilyTone {
  ink: string;
  soft: string;
  fill: string;
}

const FIXED: Record<Exclude<Family, 'learn'>, Record<ColorScheme, FamilyTone>> = {
  care: { light: { fill: '#0F766E', soft: '#CCFBF1', ink: '#115E59' }, dark: { fill: '#2DD4BF', soft: '#042F2E', ink: '#5EEAD4' } },
  money: { light: { fill: '#A16207', soft: '#FEF9C3', ink: '#854D0E' }, dark: { fill: '#EAB308', soft: '#2A2306', ink: '#FDE047' } },
  people: { light: { fill: '#BE123C', soft: '#FFE4E6', ink: '#9F1239' }, dark: { fill: '#FB7185', soft: '#3B0A14', ink: '#FDA4AF' } },
  school: { light: { fill: '#0369A1', soft: '#E0F2FE', ink: '#075985' }, dark: { fill: '#38BDF8', soft: '#082F49', ink: '#7DD3FC' } },
};

/** The static set with the default (indigo) accent — tests and non-themed code. */
export const FAMILIES: Record<Family, Record<ColorScheme, FamilyTone>> = {
  learn: { light: { fill: '#4338CA', soft: '#EEF0FF', ink: '#3730A3' }, dark: { fill: '#A5A8FF', soft: '#2A2A5C', ink: '#C7C9FF' } },
  ...FIXED,
};

const BY_ICON: Record<string, Family> = {
  diary: 'learn', assignments: 'learn', timetable: 'learn', results: 'learn', notes: 'learn', report: 'learn', syllabus: 'learn', test: 'learn', books: 'learn', records: 'learn', rules: 'learn',
  fees: 'money', pay: 'money', fines: 'money',
  take: 'care', requests: 'care', concern: 'care', decide: 'care', cover: 'care', present: 'care',
  messages: 'people', person: 'people', ask: 'people', members: 'people', staff: 'people', key: 'people', phone: 'people',
  sports: 'school', library: 'school', notices: 'school', holidays: 'school', cake: 'school', bell: 'school', hall: 'school', meets: 'school', houses: 'school',
};

/** The family an icon belongs to; unknown icons are "learning". */
export function familyOf(icon: string): Family {
  return BY_ICON[icon] ?? 'learn';
}

export function familyTone(icon: string, scheme: ColorScheme): FamilyTone {
  return FAMILIES[familyOf(icon)][scheme];
}

function legible(ink: string, bg: string, toward: string): string {
  let out = ink;
  for (let i = 0; i < 24 && contrastRatio(out, bg) < 4.5; i++) out = mix(out, toward, 0.12);
  return out;
}

/** The five tones for the ACTIVE accent: `learn` from the accent, the rest fixed. */
export function deriveFamilies(c: ColorPalette, scheme: ColorScheme): Record<Family, FamilyTone> {
  const F = c.indigo;
  const learn: FamilyTone =
    scheme === 'dark'
      ? (() => {
          const soft = mix(F, c.surface, 0.78);
          return { fill: F, soft, ink: legible(F, soft, '#FFFFFF') };
        })()
      : (() => {
          const soft = mix(F, '#FFFFFF', 0.9);
          return { fill: F, soft, ink: legible(F, soft, '#000000') };
        })();
  return { learn, care: FIXED.care[scheme], money: FIXED.money[scheme], people: FIXED.people[scheme], school: FIXED.school[scheme] };
}

/** Gradient stops for a hero band that always carries WHITE text. */
export function heroStops(c: ColorPalette, scheme: ColorScheme, kind: 'live' | 'quiet' = 'live'): readonly [string, string] {
  // In dark the accent tokens are light (made for dark paper), so the band
  // takes them down toward night; a "quiet" band (free period, holiday) is
  // the deep shade of the same colour.
  const night = '#0B0D14';
  const F = scheme === 'dark' ? mix(c.indigo, night, 0.55) : c.indigo;
  const D = scheme === 'dark' ? mix(c.indigoDeep, night, 0.6) : c.indigoDeep;
  const pair: [string, string] = kind === 'quiet' ? [mix(D, night, 0.35), D] : [F, D];
  // Never let white fall under 4.5:1 on the lighter stop.
  return [legible(pair[0], '#FFFFFF', night), legible(pair[1], '#FFFFFF', night)] as const;
}

/** The tone for a tool's glyph, from the ACTIVE accent. Use this, not the static FAMILIES. */
export function useFamilyTone(): (icon: string) => FamilyTone {
  const { scheme, tokens } = useTheme();
  const fam = useMemo(() => deriveFamilies(tokens.color, scheme), [tokens.color, scheme]);
  return (icon: string) => fam[familyOf(icon)];
}

/** The five tones themselves, for figure cells and chips that name a family rather than an icon. */
export function useFamilies(): Record<Family, FamilyTone> {
  const { scheme, tokens } = useTheme();
  return useMemo(() => deriveFamilies(tokens.color, scheme), [tokens.color, scheme]);
}
