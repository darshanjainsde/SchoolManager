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

function legible(ink: string, bg: string, toward: string, target = 4.5): string {
  let out = ink;
  // Finer steps for the 7:1 glyph target; the 4.5 callers keep their old step (and their old colours).
  const step = target > 4.5 ? 0.08 : 0.12;
  for (let i = 0; i < 40 && contrastRatio(out, bg) < target; i++) out = mix(out, toward, step);
  return out;
}

/**
 * A GLYPH ON ITS OWN TINT clears 7:1, not the 4.5 floor (user, 18 Oct 2026:
 * in dark the glyph was the accent itself on a tile made of the same accent —
 * 4.6:1 — and read "like a background colour"). In dark the glyph starts as a
 * pale tint of its colour and is lifted toward white; in light it is the deep
 * shade pushed toward black. Same depths for every hue, so no tile is louder.
 */
export const GLYPH_CONTRAST = 7;
function glyphOn(ink: string, tile: string, scheme: ColorScheme): string {
  return scheme === 'dark'
    ? legible(mix(ink, '#FFFFFF', 0.35), tile, '#FFFFFF', GLYPH_CONTRAST)
    : legible(ink, tile, '#000000', GLYPH_CONTRAST);
}

export function deriveFamilies(c: ColorPalette, scheme: ColorScheme): Record<Family, FamilyTone> {
  // INK & LIT (19 Oct 2026): one tile and one icon colour for every tool, from the palette.
  if (c.roles) {
    const t = { ink: c.roles.glyph, soft: c.roles.tile };
    return { learn: t, money: t, care: t, people: t, sport: t, school: t };
  }
  const F = c.indigo;
  const D = c.indigoDeep;
  if (scheme === 'dark') {
    const base = c.surface;
    const tone = (ink: string, softFrom: string, k: number): FamilyTone => {
      const soft = mix(softFrom, base, k);
      return { ink: glyphOn(ink, soft, 'dark'), soft };
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
    return { ink: glyphOn(ink, soft, 'light'), soft };
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
 * A rich shade of a colour at a given lightness: same hue, saturation lifted
 * to at least 60% (unless the colour is a deliberate grey, under 25%, like Charcoal).
 * Darkening a pale dark-mode accent toward black keeps its greyness; this
 * keeps the HUE and sets the depth, so deep indigo stays indigo, not slate.
 */
export function richShade(hex: string, lightness: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l0 = (max + min) / 2;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  let h = 0;
  if (d !== 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const sat = s0 < 0.25 ? s0 : Math.min(0.6, Math.max(s0, 0.5));
  const c = (1 - Math.abs(2 * lightness - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`.toUpperCase();
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
  if (c.roles) return { bg: c.roles.fill, fg: c.roles.fillfg };
  if (scheme !== 'dark') return { bg: c.indigo, fg: c.onBrand };
  // Mix the bright dark-mode accent toward true black, not a grey night:
  // the hue stays saturated and rich instead of turning to slate.
  return { bg: legible(richShade(c.indigo, 0.34), '#FFFFFF', '#000000'), fg: '#FFFFFF' };
}

/**
 * THE BAND (user, 16 Oct 2026: "the green part should be properly dark green
 * or chosen color"). The band behind the name is the DEEPEST shade of the
 * school's chosen colour, never a mid tone washed with white: light mode runs
 * deep → deeper, dark mode runs the same pair taken further toward night so
 * it sits in a dark app without glowing. White text clears 7:1 on both stops.
 */
export function bandStops(c: ColorPalette, scheme: ColorScheme): readonly [string, string] {
  if (c.roles) return [c.roles.band, c.roles.band2] as const;
  // Toward true black in both schemes, so the hue stays saturated (a grey
  // "night" turned the dark band to slate). Dark starts from the bright dark
  // accent and goes further down, so it sits in a dark app without glowing.
  const top = scheme === 'dark' ? richShade(c.indigo, 0.2) : mix(c.indigoDeep, '#000000', 0.12);
  const bottom = scheme === 'dark' ? richShade(c.indigo, 0.11) : mix(c.indigoDeep, '#000000', 0.38);
  const deep = (x: string) => {
    let out = x;
    for (let i = 0; i < 24 && contrastRatio(out, '#FFFFFF') < 7; i++) out = mix(out, '#000000', 0.1);
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
/**
 * MEANING COLOURS ON THE TOOL GRID (user, 18 Oct 2026: "re-include a few
 * different relevant colors in icons, as in vc24"). vc24 coloured a tool's
 * glyph by what it ASKS of you, using the theme's own semantic colours:
 * amber = something waits on you or someone is talking (Register, Messages,
 * Requests, Notices, Complaint Box, Diary, Fees, Decide, Fines); green = good
 * news (Holidays, My pay). Every other tool stays on the school's accent.
 * Only these two hues are added — the five-hue families of 16 Oct stay
 * rejected. Each ink clears 4.5:1 on its own tint in both schemes
 * (theme/__tests__/families.test.ts).
 */
/**
 * THE TWO MEANING COLOURS (18 Oct 2026) — and the only colours a tile may take
 * besides the school's own accent. Colour on a Home is a signal, so it is kept
 * for two things; spread wider, a colour stops meaning anything:
 *   amber — someone is WAITING ON YOU: a register to take, families' concerns,
 *           leave to decide, a bill or a fine to settle;
 *   green — something FOR YOU: your pay, days off.
 * Everything else (messages, notices, diary, homework…) is the accent. Never
 * colour alone: a waiting tile also carries its count as a badge. Guarded by
 * components/__tests__/HomeToolGrid.tone.test.tsx, which reads every Home.
 * The five decorative hues of 16 Oct were rejected ("way too bad").
 */
export type ToneName = 'amber' | 'green';

export function toneFamily(tone: ToneName, c: ColorPalette, scheme: ColorScheme): FamilyTone {
  if (c.roles) return tone === 'amber' ? { ink: c.roles.amberInk, soft: c.roles.amber } : { ink: c.roles.greenInk, soft: c.roles.green };
  const base = tone === 'amber' ? c.amber : c.green;
  const inkFrom = tone === 'amber' ? c.late : c.green;
  if (scheme === 'dark') {
    const soft = mix(base, c.surface, 0.82);
    return { ink: glyphOn(inkFrom, soft, 'dark'), soft };
  }
  const soft = mix(base, '#FFFFFF', 0.86);
  return { ink: glyphOn(inkFrom, soft, 'light'), soft };
}

/** Text and icons on the band: white on ink, dark ink on a lit band (Ink & Lit). */
export function onBand(c: ColorPalette): string {
  return c.roles?.onBand ?? '#FFFFFF';
}

/** True when the band is ink (white text on it), false when it is lit (dark text). */
export function bandIsInk(c: ColorPalette): boolean {
  return contrastRatio(onBand(c), '#000000') > contrastRatio(onBand(c), '#FFFFFF');
}

/** A count badge: a red white text reads on, in both schemes. */
export function badgeColours(c: ColorPalette): { bg: string; fg: string } {
  return c.roles ? { bg: c.roles.badge, fg: c.roles.badgeFg } : { bg: c.red, fg: '#FFFFFF' };
}

/** The filled (live) tile for a meaning colour — vc24's amber register tile. */
export function toneFill(tone: ToneName, c: ColorPalette): { bg: string; fg: string } {
  const base = tone === 'amber' ? c.amber : c.green;
  const dark = '#111827';
  // Dark ink when it reads (amber); otherwise white on the colour, deepened
  // just enough to clear 4.5:1 (the theme's green gives white only 4.35).
  if (contrastRatio(dark, base) >= 4.5) return { bg: base, fg: dark };
  return { bg: legible(base, '#FFFFFF', '#000000'), fg: '#FFFFFF' };
}

export function useFamilyTone(): (icon: string) => FamilyTone {
  const { scheme, tokens } = useTheme();
  const fam = useMemo(() => deriveFamilies(tokens.color, scheme), [tokens.color, scheme]);
  return (icon: string) => fam[familyOf(icon)];
}
