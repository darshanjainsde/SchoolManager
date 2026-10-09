import type { ColorPalette, ColorScheme } from './tokens';
import { useMemo } from 'react';
import { contrastRatio, mix } from './school-brand';
import { useTheme } from './theme-context';

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

// ── FAMILIES THAT FOLLOW THE ACCENT (9 Oct 2026) ─────────────────────────
// The user picks an accent in Appearance (or the school's colour applies);
// every decorative colour — tool tiles, empty pictures, profile squares, the
// home hero — is a SHADE of that one colour, so a navy school gets a navy
// app, not navy buttons beside indigo tiles. Each ink is pushed until it
// clears 4.5:1 on its own tint in both schemes.

function legible(ink: string, bg: string, toward: string): string {
  let out = ink;
  for (let i = 0; i < 24 && contrastRatio(out, bg) < 4.5; i++) out = mix(out, toward, 0.12);
  return out;
}

export function deriveFamilies(c: ColorPalette, scheme: ColorScheme): Record<Family, FamilyTone> {
  const F = c.indigo;
  const D = c.indigoDeep;
  if (scheme === 'dark') {
    const base = c.surface;
    const tone = (ink: string, softFrom: string, k: number): FamilyTone => {
      const soft = mix(softFrom, base, k);
      return { ink: legible(ink, soft, '#FFFFFF'), soft };
    };
    // ONE tint for every tile (user, 9 Oct 2026: the Fees tile read greyer
    // than its neighbours — it was mixed from the deep shade). Families now
    // differ only in the glyph's ink, never in the tile.
    return {
      learn: tone(F, F, 0.78),
      money: tone(mix(F, '#FFFFFF', 0.25), F, 0.78),
      care: tone(mix(F, D, 0.3), F, 0.78),
      people: tone(mix(F, '#FFFFFF', 0.15), F, 0.78),
      sport: tone(F, F, 0.78),
      school: tone(mix(F, '#FFFFFF', 0.3), F, 0.78),
    };
  }
  const W = '#FFFFFF';
  const tone = (ink: string, softFrom: string, k: number): FamilyTone => {
    const soft = mix(softFrom, W, k);
    return { ink: legible(ink, soft, '#000000'), soft };
  };
  return {
    learn: tone(F, F, 0.9),
    money: tone(D, F, 0.9),
    care: tone(mix(F, D, 0.5), F, 0.9),
    people: tone(D, F, 0.9),
    sport: tone(F, F, 0.9),
    school: tone(mix(D, '#000000', 0.2), F, 0.9),
  };
}

/** Gradient stops for a hero card that always carries WHITE text. */
export function heroStops(c: ColorPalette, scheme: ColorScheme, kind: 'live' | 'quiet' = 'live'): readonly [string, string] {
  // In dark the accent tokens are light (made for dark paper), so the hero
  // takes them down toward night; a "quiet" hero (free period, holiday) is
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
