import { inkLit, toOklch, type InkLitOptions, type InkLitRoles } from './inklit';

/**
 * THE COLOUR CHOICE (Appearance → Colour), on the INK & LIT system
 * (theme/inklit.ts; user, 19 Oct 2026). Each named colour is a hue plus a few
 * choices; the generator builds both schemes from it, and the user's own four
 * saved palettes (Black, Blue, Green, Pink) keep the exact colours they picked
 * where those passed the checks. `school` builds the same system from the
 * school's own brand colour.
 */
export type AccentName =
  | 'school' | 'green' | 'blue' | 'black' | 'pink' | 'navy' | 'peacock'
  | 'teal' | 'aubergine' | 'oxblood' | 'espresso' | 'mehndi' | 'graphite' | 'indigo';

export interface Accent {
  label: string;
  hint: string;
  /** `null` = build from the school's own colour. */
  opts: InkLitOptions | null;
  /** Exact colours the user chose in the studio, laid over the generated ones. */
  light?: Partial<InkLitRoles>;
  dark?: Partial<InkLitRoles>;
}

export const ACCENTS: Record<AccentName, Accent> = {
  school: { label: 'My school', hint: 'Built from your school’s own colour', opts: null },
  // The user's four (19 Oct 2026), refined only where a pair failed.
  green: {
    label: 'Green', hint: 'Forest ink, mid-green in dark', opts: { h: 149, inkC: 0.065, dark: 'mid' },
    // Mint tiles became solid forest ink: the mint was ΔE 0.9 from the green "yours" tile (audit, 19 Oct 2026).
    light: { band: '#042A0F', band2: '#042A0F', fill: '#042A0F', accentText: '#042A0F', bar: '#042A0F', tile: '#042A0F' },
    dark: { band: '#24703B', band2: '#24703B', fill: '#24703B', fillfg: '#FFFFFF', onBand: '#FFFFFF', barOn: '#24703B', barOnFg: '#FFFFFF', tile: '#185A2B', glyph: '#FFFFFF' },
  },
  blue: {
    label: 'Blue', hint: 'Royal ink, lit periwinkle in dark', opts: { h: 277, inkC: 0.14 },
    light: { band: '#030057', band2: '#030057', fill: '#1A1961', accentText: '#1A1961', tile: '#D8DEFE', glyph: '#36339F', bar: '#030057', barOn: '#D8DEFE', barOnFg: '#36339F' },
  },
  black: {
    label: 'Black', hint: 'Monochrome ink, AMOLED black in dark', opts: { h: 256, inkC: 0.02, tile: 'neutral', dark: 'black' },
    light: { band: '#070E18', band2: '#070E18', fill: '#0D141C', accentText: '#0D141C', glyph: '#05070B', bar: '#070E18' },
    // The grey dark "waiting" tile read as a plain tool; amber never goes neutral (audit, 19 Oct 2026).
  },
  pink: {
    label: 'Pink', hint: 'Wine ink, solid tiles, lit pink in dark', opts: { h: 349, inkC: 0.105, tile: 'solid' },
    light: { band: '#48052E', band2: '#48052E', fill: '#48052E', accentText: '#48052E', tile: '#48052E', bar: '#48052E', amberInk: '#131210' },
    // #EE8DBD lifted to #F7B2D3: wine ink on it was APCA Lc 58 (audit, 19 Oct 2026).
    dark: { band: '#F7B2D3', band2: '#F7B2D3', fill: '#F7B2D3', tile: '#F7B2D3', barOn: '#F7B2D3' },
  },
  // New, in the same style.
  navy: { label: 'Midnight navy', hint: 'Uniform navy, sky tiles', opts: { h: 255, inkC: 0.1 } },
  peacock: { label: 'Peacock', hint: 'Indian peacock blue-green', opts: { h: 218, inkC: 0.11, tileH: 230 } },
  teal: { label: 'Deep teal', hint: 'Calm ink teal, solid tiles', opts: { h: 196, inkC: 0.08, tile: 'solid' } },
  aubergine: { label: 'Aubergine', hint: 'Deep purple, lilac tiles', opts: { h: 312, inkC: 0.12 } },
  oxblood: { label: 'Oxblood', hint: 'Heritage red-brown, solid tiles', opts: { h: 22, inkC: 0.11, tile: 'solid' } },
  espresso: { label: 'Espresso', hint: 'Warm brown ink, cream tiles', opts: { h: 52, inkC: 0.06, tileC: 0.06 } },
  mehndi: { label: 'Mehndi', hint: 'Olive ink, leaf tiles', opts: { h: 118, inkC: 0.07 } },
  graphite: { label: 'Graphite & sky', hint: 'Neutral ink, sky tiles, AMOLED dark', opts: { h: 260, inkC: 0.02, tileH: 235, tileC: 0.09, darkBase: 'black' } },
  indigo: { label: 'Sckools indigo', hint: 'The app’s own colour', opts: { h: 277, inkC: 0.15 } },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

/** Colours people may have chosen before 19 Oct 2026, mapped to their nearest palette. */
const LEGACY: Record<string, AccentName> = {
  ocean: 'peacock', leaf: 'green', plum: 'aubergine', saffron: 'espresso', rose: 'pink',
  charcoal: 'graphite', terracotta: 'oxblood',
};

export function isAccentName(v: string | null | undefined): v is AccentName {
  return typeof v === 'string' && v in ACCENTS;
}

/** A stored choice (old or new) → today's palette name; null when unknown. */
export function readAccent(v: string | null | undefined): AccentName | null {
  if (isAccentName(v)) return v;
  return typeof v === 'string' && v in LEGACY ? LEGACY[v] : null;
}

/**
 * Built palettes, remembered. `inkLit` does colour-space maths for every role,
 * and Appearance → Colour asks for every palette in both schemes on every
 * render (28 builds a tap). A named palette never changes, so it is keyed by
 * name + scheme; `school` is keyed by the brand colour too, so a school that
 * changes its colour gets a fresh build. Treat the result as read-only: it is
 * shared by every caller.
 */
const ROLES_CACHE = new Map<string, InkLitRoles>();

/** What a palette paints in one scheme. `brand` feeds `school`. */
export function rolesFor(name: AccentName, scheme: 'light' | 'dark', brand?: string | null): InkLitRoles {
  const key = name === 'school' ? `school|${scheme}|${brand ?? ''}` : `${name}|${scheme}`;
  const hit = ROLES_CACHE.get(key);
  if (hit) return hit;
  const roles = buildRoles(name, scheme, brand);
  ROLES_CACHE.set(key, roles);
  return roles;
}

function buildRoles(name: AccentName, scheme: 'light' | 'dark', brand?: string | null): InkLitRoles {
  const a = ACCENTS[name];
  const opts = a.opts ?? (brand ? { h: toOklch(brand).H, inkC: Math.min(0.14, Math.max(0.05, toOklch(brand).C)) } : ACCENTS.indigo.opts!);
  const built = inkLit(opts)[scheme];
  return { ...built, ...(scheme === 'light' ? a.light : a.dark) };
}
