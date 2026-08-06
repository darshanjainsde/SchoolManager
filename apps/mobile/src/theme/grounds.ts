import type { ColorPalette } from './tokens';

/**
 * THE PAPER THE APP IS PRINTED ON.
 *
 * A ground is the set of neutrals a screen is built from — the page, the card
 * that sits on it, the muted fill, and the two hairline weights. They move
 * TOGETHER, which is the whole point: swapping only the background is what
 * makes a palette fall apart, because the hairlines and the card stop having
 * the right contrast against the new page.
 *
 * The accent is deliberately NOT part of a ground. The accent is the school's
 * own brand colour (see `brandedLight`), and a pupil choosing their own would
 * mean their app stopped looking like their school. Ground is texture; accent
 * is identity.
 */
export type GroundName = 'classic' | 'cream' | 'sand' | 'oat' | 'linen' | 'sage' | 'blue';

export interface GroundTones {
  appBg: string;
  surface: string;
  surfaceMuted: string;
  line: string;
  line2: string;
}

export interface Ground {
  label: string;
  /** One-line description, shown under the label in Settings. */
  hint: string;
  light: GroundTones;
  dark: GroundTones;
}

/**
 * `classic` reproduces the palette shipped today, byte for byte, and is the
 * default. Adding grounds must not silently restyle every existing install —
 * a person opts in, or a later release changes the default deliberately.
 */
export const GROUNDS: Record<GroundName, Ground> = {
  classic: {
    label: 'Classic',
    hint: 'What the app ships with',
    light: { appBg: '#FBF9F4', surface: '#FFFDF8', surfaceMuted: '#F3F0E7', line: '#E7E3D6', line2: '#D9D4C4' },
    dark: { appBg: '#141224', surface: '#1B1830', surfaceMuted: '#100E1E', line: '#2B2847', line2: '#37335A' },
  },
  cream: {
    label: 'Warm cream',
    hint: 'Deeper paper — cards separate properly',
    light: { appBg: '#F2EDE3', surface: '#FCF9F1', surfaceMuted: '#EBE5D8', line: '#E2DACB', line2: '#CBC1AE' },
    dark: { appBg: '#12100E', surface: '#1B1815', surfaceMuted: '#221E1A', line: '#2A2622', line2: '#3A342E' },
  },
  sand: {
    label: 'Sand',
    hint: 'Warmest. Reads like a workbook',
    light: { appBg: '#EDE5D6', surface: '#F9F3E7', surfaceMuted: '#E5DCC9', line: '#DACFB9', line2: '#C2B49A' },
    dark: { appBg: '#14120E', surface: '#1E1B15', surfaceMuted: '#26221B', line: '#2E2922', line2: '#3E3830' },
  },
  oat: {
    label: 'Oat',
    hint: 'Between cream and neutral',
    light: { appBg: '#EFEBE2', surface: '#FBF8F1', surfaceMuted: '#E8E3D8', line: '#DFD8CA', line2: '#C8C0AE' },
    dark: { appBg: '#15140F', surface: '#1F1D17', surfaceMuted: '#26241C', line: '#2E2C24', line2: '#3D3A31' },
  },
  linen: {
    label: 'Linen',
    hint: 'Neutral without going cold',
    light: { appBg: '#EFEEEA', surface: '#FBFAF7', surfaceMuted: '#E7E6E1', line: '#DEDCD5', line2: '#C6C3BA' },
    dark: { appBg: '#131312', surface: '#1C1C1A', surfaceMuted: '#232322', line: '#2A2A27', line2: '#393936' },
  },
  sage: {
    label: 'Sage grey',
    hint: 'Cool and quiet',
    light: { appBg: '#EAEEE9', surface: '#F7FAF6', surfaceMuted: '#E1E7DF', line: '#D8DED6', line2: '#BFC6BC' },
    dark: { appBg: '#101311', surface: '#181C19', surfaceMuted: '#1F2420', line: '#262B27', line2: '#343A35' },
  },
  blue: {
    label: 'Blue paper',
    hint: 'Coolest. Suits a navy school',
    light: { appBg: '#E9EDF3', surface: '#F7FAFD', surfaceMuted: '#DFE5EE', line: '#D5DCE6', line2: '#BAC4D2' },
    dark: { appBg: '#0F1216', surface: '#181C22', surfaceMuted: '#1F242B', line: '#262C34', line2: '#39414A' },
  },
};

export const GROUND_NAMES = Object.keys(GROUNDS) as GroundName[];

export function isGroundName(v: string | null | undefined): v is GroundName {
  return typeof v === 'string' && v in GROUNDS;
}


/**
 * Lays a ground over a palette, leaving every other token — the accent, the
 * semantic greens and reds, the ink — exactly as it was. That is what keeps a
 * school's brand colour and the present/absent states intact whichever paper
 * somebody picks.
 */
export function applyGround(base: ColorPalette, ground: GroundTones): ColorPalette {
  return { ...base, ...ground };
}
