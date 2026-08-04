import { Platform } from 'react-native';
// The paper-and-ink diary palette from the approved Phase 5 pitches
// (both artifacts share one `:root` block — warm paper, indigo-black ink,
// pencil rules). Every KEY here kept its original name through the Phase 5·4
// repaint so no consumer had to change; only the hexes moved.
//
// Palette shape shared by both colour schemes. Every consumer (component or
// test) can assume every key below exists in BOTH `light` and `dark` — see
// `apps/mobile/src/theme/__tests__/tokens.test.ts`, which fails the build if
// a dark-mode key silently falls back to its light value (the web's
// `sk-theme.css` had exactly this class of bug: a token declared in one
// `@media`/`html[data-theme]` block and forgotten in another).
export interface ColorPalette {
  indigo: string;
  // Brand-on-dark-background accents (NOT the app-wide dark scheme) — used by
  // `SckoolsLogo`'s own `theme="dark"` prop when the logo sits on the fixed
  // indigo hero gradient in `AuthScaffold`, regardless of the device's colour
  // scheme. Intentionally the same value in both palettes.
  indigoDark: string;
  indigo50: string;
  amber: string;
  amberDark: string;
  amber50: string;
  // Distinct from `amber` (the brand accent) — mirrors the web's `--sk-late`,
  // which exists specifically so a "late" status never collapses into the
  // brand accent when the accent itself shifts colour in dark mode.
  late: string;
  ink: string;
  sub: string;
  line: string;
  green: string;
  green50: string;
  red: string;
  red50: string;
  appBg: string;
  surface: string;
  // Recessed control background (segmented controls, neutral pills) — one
  // step off `surface`, same direction of contrast in both schemes.
  surfaceMuted: string;
  // Text/icon colour for content drawn on a solid `indigo`-filled surface
  // (primary buttons, active segmented-control pills). White works in light
  // mode; in dark mode `indigo` itself is a light lavender (#8b87ff-family —
  // full-saturation indigo fails contrast on near-black), so white-on-white
  // fails. Mirrors the web's `.sk-btn[data-variant="primary"]` dark-mode
  // override to `#07130e`.
  onBrand: string;
  // Placeholder text — deliberately dimmer than `sub` in both schemes.
  placeholder: string;
  // ── Paper/ink diary skin (Phase 5·4, from the approved pitches) ───────────
  // `ink2` is body-secondary (the pitch's --ink-2); `sub` is the dimmer meta
  // tone (--ink-3). `line2` is the heavier pencil rule (--rule-2), used for
  // grab handles and checkbox borders where `line` is too faint.
  ink2: string;
  line2: string;
  // The deep indigo the pitch uses for text ON a tint (--indigo-deep).
  indigoDeep: string;
  // The red of a margin rule / unread dot / notice pin (--margin-red). Warmer
  // and lighter than `red`, which is reserved for remark ink itself.
  marginRed: string;
}

const light: ColorPalette = {
  indigo: '#4F46E5',
  indigoDark: '#818CF8',
  indigo50: '#EEF0FF',
  amber: '#F59E0B',
  amberDark: '#FBBF24',
  amber50: '#FDE9C8',
  late: '#7A4E06',
  ink: '#211D45',
  sub: '#8A87A0',
  line: '#E7E3D6',
  green: '#178A5B',
  green50: '#E3F4EC',
  red: '#C4453F',
  red50: '#FBE9E8',
  appBg: '#FBF9F4',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F0E7',
  onBrand: '#FFFFFF',
  placeholder: '#A6A3B8',
  ink2: '#4B4768',
  line2: '#D9D4C4',
  indigoDeep: '#3730A3',
  marginRed: '#E86A6A',
};

// Values lifted from apps/web/app/sk-theme.css's `@media (prefers-color-scheme:
// dark)` / `html[data-theme='dark']` block — the design reference so a
// teacher moving between the web portal and this app in dark mode sees one
// product, not two.
const dark: ColorPalette = {
  indigo: '#8B87FF',
  indigoDark: '#818CF8',
  indigo50: '#232052',
  amber: '#F5B23C',
  amberDark: '#FBBF24',
  amber50: '#3D2E14',
  late: '#F5CE8A',
  ink: '#EDEBFA',
  sub: '#807DA0',
  line: '#2B2847',
  green: '#4CC08E',
  green50: '#173327',
  red: '#E0656F',
  red50: '#3A1B1E',
  appBg: '#141224',
  surface: '#1B1830',
  surfaceMuted: '#100E1E',
  onBrand: '#07130E',
  placeholder: '#7A789E',
  ink2: '#B9B6D0',
  line2: '#37335A',
  indigoDeep: '#A5A1FF',
  marginRed: '#E86A6A',
};

export const palette = { light, dark } as const;
export type ColorScheme = keyof typeof palette;

/**
 * Typography from the pitches. The diary voice is a SERIF — every heading,
 * diary entry, remark, stamp and empty state is set in it; the sans is for
 * UI chrome (labels, buttons, meta) and the mono for figures that must line
 * up (percentages, roll numbers, times).
 *
 * These are platform system faces, deliberately NOT a bundled font file:
 * the pitch's own stack ("Iowan Old Style", Palatino, Georgia, serif) is all
 * system fonts, and shipping a webfont would add an asset the EAS build has
 * to resolve for no visual gain. iOS resolves Palatino; Android's `serif`
 * alias is Noto Serif.
 */
export const font = {
  serif: Platform.select({ ios: 'Palatino', android: 'serif', default: 'serif' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
  /** The UI face — RN's platform default, named here so callers never guess. */
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
} as const;

export const GAP = 11; // vertical rhythm between containers (mockup system)
export const RADIUS = { card: 16, chip: 999, sheet: 22 } as const;

/**
 * Fixed brand constants that intentionally do NOT vary with the device's
 * colour scheme — the branded indigo hero gradient behind auth screens is a
 * full-bleed brand moment (like the web's own coloured marketing surfaces),
 * not a themed surface. Kept here (rather than inline hex in components) so
 * the hex sweep has nowhere left to hide, without pretending these should
 * flip in dark mode.
 */
export const brand = {
  authGradientStart: '#6366F1',
  authGradientMid: '#4F46E5',
  authGradientEnd: '#312E81',
  authGlowAmber: '#F59E0B',
  authGlowIndigo: '#818CF8',
  authCardShadow: '#1E1B4B',
  onHero: '#FFFFFF',
  // The teacher-home "Right now" hero is a full-bleed brand moment (white text
  // on a saturated gradient), like the auth hero — so its gradient stops are
  // fixed brand hues that do NOT flip with the device colour scheme, matching
  // the approved design pitch. One accent per home state: indigo = a live
  // class, green = a free period, done = a slate→indigo wrap-up. `ctaInk` /
  // `ctaInkGreen` are the on-white CTA label colours for each. The FREE-period
  // green in the day-rail tiles reuses the theme-aware `green`/`green50` tokens
  // (which already exist and adapt to dark mode) — only the hero gradient needs
  // these exact pitch hues.
  hero: {
    /**
     * `.nowcard` — `linear-gradient(135deg, var(--indigo), #6D5CF0)`, the
     * teacher pitch's live-class hero, exactly two stops. Kept separate from
     * `indigo` below (three stops, ending in violet) because the pitch draws
     * this one card and only this one card with the short ramp.
     */
    now: ['#4F46E5', '#6D5CF0'] as const,
    indigo: ['#4F46E5', '#6D5CF0', '#8B5CF6'] as const,
    green: ['#10B981', '#0EA5A4', '#22C55E'] as const,
    done: ['#334155', '#4338CA', '#6D5CF0'] as const,
    ctaInk: '#4338CA',
    ctaInkGreen: '#047857',
    shadow: '#181648',
  },
} as const;

/**
 * Emergency/error-boundary palette. `ErrorBoundary` in `app/_layout.tsx`
 * renders in place of the whole route tree (including `ThemeProvider`) when
 * a child throws, so it cannot depend on theme context being alive — it gets
 * its own small, fixed, always-legible dark palette instead.
 */
export const emergency = {
  bg: '#0B1220',
  ink: '#FFFFFF',
  sub: '#9FB3C8',
  panel: '#111A2B',
  danger: '#FF8F8F',
  cta: '#4F46E5',
} as const;

/**
 * Static, light-only export for non-component code paths (none currently
 * exist, but this keeps the door open without forcing plain modules to
 * depend on React context). Every COMPONENT must read theme-aware colours
 * via `useTokens()` from `@/theme/theme-context` instead.
 */
export const tokens = {
  color: light,
  gap: GAP,
  radius: RADIUS,
} as const;
