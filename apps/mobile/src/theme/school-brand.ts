import type { ColorPalette } from './tokens';

/**
 * Wearing the school's colour in the app's LIGHT theme.
 *
 * A school picks its colours for a website on warm paper. The app's light
 * theme is the same paper, so the colour travels; the DARK theme is not, and a
 * brand chosen against white can fail badly on a near-black surface. So dark
 * keeps its own indigo ink and only light follows the school.
 *
 * Two rules make this safe rather than merely colourful:
 *
 *   1. SEMANTIC COLOURS NEVER MOVE. Green, red and amber mean present, absent
 *      and late. A school with a red brand must not turn "present" into an
 *      alarm, and no amount of brand fidelity is worth a register that reads
 *      wrong at a glance.
 *   2. THE FILL MUST STAY READABLE. A pale brand behind white text is
 *      unreadable, so the accent is darkened until it clears WCAG AA against
 *      the label that sits on it. The school's hue is kept; only its lightness
 *      moves, and only as far as it has to.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1).toUpperCase()}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(hex: string, toward: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  if (!a || !b) return hex;
  return toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/**
 * Darken a colour until white text on it clears AA (4.5:1), keeping its hue.
 * A brand already dark enough is returned untouched.
 */
export function readableFill(brand: string, label = '#FFFFFF', min = 4.5): string {
  if (!hexToRgb(brand)) return brand;
  let out = brand;
  for (let step = 0; step < 20 && contrastRatio(out, label) < min; step++) {
    out = mix(out, '#000000', 0.06);
  }
  return out;
}

/**
 * The school's light palette.
 *
 * Only the accent family moves: the chrome the app draws in indigo becomes the
 * school's colour. Paper, ink, lines and every semantic colour are the base
 * palette's, untouched.
 */
export function brandedLight(base: ColorPalette, brandPrimary?: string | null): ColorPalette {
  if (!brandPrimary || !hexToRgb(brandPrimary)) return base;

  const fill = readableFill(brandPrimary, '#FFFFFF');
  return {
    ...base,
    indigo: fill,
    // The deep variant is used for pressed/emphasis states.
    indigoDeep: mix(fill, '#000000', 0.18),
    // The tint sits behind text on paper, so it is mixed toward the app's own
    // background rather than pure white — it has to belong to this palette.
    indigo50: mix(fill, base.appBg, 0.88),
    onBrand: '#FFFFFF',
  };
}
