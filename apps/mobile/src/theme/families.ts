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
  diary: 'learn', assignments: 'learn', timetable: 'learn', results: 'learn', notes: 'learn', report: 'learn', syllabus: 'learn',
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
    // Deeper tiles in dark (0.86 toward the surface, was 0.78): the tint is
    // a shadow of the accent, not a lighter patch on the card.
    return {
      learn: tone(F, F, 0.86),
      money: tone(mix(F, '#FFFFFF', 0.25), F, 0.86),
      care: tone(mix(F, D, 0.3), F, 0.86),
      people: tone(mix(F, '#FFFFFF', 0.15), F, 0.86),
      sport: tone(F, F, 0.86),
      school: tone(mix(F, '#FFFFFF', 0.3), F, 0.86),
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

/**
 * THE ONE FILLED SURFACE (user, 16 Oct 2026: "the dark of every color should
 * be proper dark like darkest shade to look classy"). In light it is the
 * accent with its on-fill ink. In dark it is the accent's DEEPEST shade with
 * white ink — never the pale dark-mode fill as a slab. Every filled button,
 * the band, the tab pill and the sheet's main action read from here, so the
 * app has one idea of "filled" per scheme.
 */
export function accentFill(c: ColorPalette, scheme: ColorScheme): { bg: string; fg: string } {
  if (scheme !== 'dark') return { bg: c.indigo, fg: c.onBrand };
  const night = '#0B0D14';
  // Deep shade, then pushed darker until white clears 4.5:1 on it.
  return { bg: legible(mix(c.indigoDeep, night, 0.28), '#FFFFFF', night), fg: '#FFFFFF' };
}

/**
 * THE BAND (user, 16 Oct 2026: "the green part should be properly dark green
 * or chosen color"). The band behind the name is the DEEPEST shade of the
 * school's chosen colour, never a mid tone washed with white: light mode runs
 * deep → deeper, dark mode runs the same pair taken further toward night so
 * it sits in a dark app without glowing. White text clears 7:1 on both stops.
 */
export function bandStops(c: ColorPalette, scheme: ColorScheme): readonly [string, string] {
  const night = '#0B0D14';
  const base = c.indigoDeep;
  const top = scheme === 'dark' ? mix(base, night, 0.55) : mix(base, '#000000', 0.12);
  const bottom = scheme === 'dark' ? mix(base, night, 0.72) : mix(base, '#000000', 0.38);
  const deep = (x: string) => {
    let out = x;
    for (let i = 0; i < 24 && contrastRatio(out, '#FFFFFF') < 7; i++) out = mix(out, night, 0.1);
    return out;
  };
  return [deep(top), deep(bottom)] as const;
}

/** Gradient stops for a hero card that always carries WHITE text. */
export function heroStops(c: ColorPalette, scheme: ColorScheme, kind: 'live' | 'quiet' = 'live'): readonly [string, string] {
  // In dark the accent tokens are light (made for dark paper), so the hero
  // takes them down toward night; a "quiet" hero (free period, holiday) is
  // the deep shade of the same colour.
  const night = '#0B0D14';
  // Dark = the deepest shade: the band is the accent's deep stop taken down
  // toward night, never the pale fill greyed out (which read as mud).
  const F = scheme === 'dark' ? mix(c.indigoDeep, night, 0.3) : c.indigo;
  const D = scheme === 'dark' ? mix(c.indigoDeep, night, 0.62) : c.indigoDeep;
  const pair: [string, string] = kind === 'quiet' ? [mix(D, night, 0.35), D] : [F, D];
  // Never let white fall under 4.5:1 on the lighter stop.
  return [legible(pair[0], '#FFFFFF', night), legible(pair[1], '#FFFFFF', night)] as const;
}

/** The tones themselves, for figure cells that name a family rather than an icon. */
export function useFamilies(): Record<Family, FamilyTone> {
  const { scheme, tokens } = useTheme();
  return useMemo(() => deriveFamilies(tokens.color, scheme), [tokens.color, scheme]);
}

/** The tone for a tool's glyph, from the ACTIVE accent. Use this, not the static FAMILIES. */
export function useFamilyTone(): (icon: string) => FamilyTone {
  const { scheme, tokens } = useTheme();
  const fam = useMemo(() => deriveFamilies(tokens.color, scheme), [tokens.color, scheme]);
  return (icon: string) => fam[familyOf(icon)];
}
