import type { ColorPalette } from './tokens';

/**
 * THE HIGHLIGHT COLOUR, AS A CHOICE.
 *
 * By default this follows the school — `school` applies no override at all and
 * leaves `brandedLight` to do its work, so an app still looks like the place a
 * person actually goes. Someone who would rather read something else can pick
 * one of the named accents, and their choice then holds in BOTH schemes: an
 * explicit choice is deliberate, unlike a school brand, which is chosen against
 * a white website and can fail badly on a near-black screen.
 *
 * The four tokens below are exactly the four `brandedLight` replaces
 * (see school-brand.ts). Touching a different set here would let a named accent
 * and a school brand paint different parts of the same screen.
 */
export type AccentName = 'school' | 'navy' | 'green' | 'teal' | 'oxblood' | 'indigo';

export interface AccentTone {
  /** The fill itself — buttons, active tabs, the Now card. */
  fill: string;
  /** Pressed and emphasis states. */
  deep: string;
  /** The pale wash that sits behind text on paper. */
  tint: string;
  /** Text and glyphs ON the fill. */
  onFill: string;
}

export interface Accent {
  label: string;
  hint: string;
  /** `null` means "do not override" — the school's own colour stands. */
  light: AccentTone | null;
  dark: AccentTone | null;
}

export const ACCENTS: Record<AccentName, Accent> = {
  school: {
    label: 'My school',
    hint: 'Follows your school’s own colour',
    light: null,
    dark: null,
  },
  navy: {
    label: 'Ink navy',
    hint: 'Blazer navy',
    light: { fill: '#1C3B5A', deep: '#132B42', tint: '#E2E9F1', onFill: '#FFFFFF' },
    dark: { fill: '#7FA8D4', deep: '#5E8AB8', tint: '#1C2836', onFill: '#0E1114' },
  },
  green: {
    label: 'Bottle green',
    hint: 'Board green',
    light: { fill: '#14483E', deep: '#0D332C', tint: '#DFEAE6', onFill: '#FFFFFF' },
    dark: { fill: '#6FBBA6', deep: '#4E9A85', tint: '#17302A', onFill: '#0E1114' },
  },
  teal: {
    label: 'Deep teal',
    hint: 'Between navy and green',
    light: { fill: '#155E63', deep: '#0E4448', tint: '#DFECED', onFill: '#FFFFFF' },
    dark: { fill: '#5FB6BC', deep: '#3E969C', tint: '#16302F', onFill: '#0E1114' },
  },
  oxblood: {
    label: 'Oxblood',
    hint: 'Crest maroon',
    light: { fill: '#6B2233', deep: '#4E1725', tint: '#F0E1E4', onFill: '#FFFFFF' },
    dark: { fill: '#D98B9B', deep: '#B96A7B', tint: '#332026', onFill: '#0E1114' },
  },
  indigo: {
    label: 'Indigo',
    hint: 'What the app shipped with',
    light: { fill: '#4F46E5', deep: '#3730A3', tint: '#E7E5FB', onFill: '#FFFFFF' },
    dark: { fill: '#8B87FF', deep: '#6A64D6', tint: '#232052', onFill: '#0E1114' },
  },
};

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];

export function isAccentName(v: string | null | undefined): v is AccentName {
  return typeof v === 'string' && v in ACCENTS;
}

/**
 * Lays a chosen accent over a palette. `null` returns the palette untouched,
 * which is how `school` stays out of the way of `brandedLight`.
 *
 * Only the four accent tokens move — the ink, the neutrals, and the green and
 * red that mean present and absent are never an accent's business.
 */
export function applyAccent(base: ColorPalette, tone: AccentTone | null): ColorPalette {
  if (!tone) return base;
  return {
    ...base,
    indigo: tone.fill,
    indigoDeep: tone.deep,
    indigo50: tone.tint,
    onBrand: tone.onFill,
  };
}
