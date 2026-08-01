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
}

const light: ColorPalette = {
  indigo: '#4F46E5',
  indigoDark: '#818CF8',
  indigo50: '#EEF0FF',
  amber: '#F59E0B',
  amberDark: '#FBBF24',
  amber50: '#FFF6E6',
  late: '#9A6B12',
  ink: '#0F172A',
  sub: '#64748B',
  line: '#E9E9F2',
  green: '#16B364',
  green50: '#E7F7EF',
  red: '#EF4444',
  red50: '#FDECEC',
  appBg: '#F4F5FB',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F7',
  onBrand: '#FFFFFF',
  placeholder: '#9AA4B2',
};

// Values lifted from apps/web/app/sk-theme.css's `@media (prefers-color-scheme:
// dark)` / `html[data-theme='dark']` block — the design reference so a
// teacher moving between the web portal and this app in dark mode sees one
// product, not two.
const dark: ColorPalette = {
  indigo: '#8B87FF',
  indigoDark: '#818CF8',
  indigo50: '#232050',
  amber: '#F3B547',
  amberDark: '#FBBF24',
  amber50: '#3B2D11',
  late: '#D9A43A',
  ink: '#EFEEFC',
  sub: '#ABA9CE',
  line: '#262545',
  green: '#35B57E',
  green50: '#122720',
  red: '#E0694A',
  red50: '#2A1712',
  appBg: '#0A0917',
  surface: '#14132A',
  surfaceMuted: '#1E1D3C',
  onBrand: '#07130E',
  placeholder: '#7A789E',
};

export const palette = { light, dark } as const;
export type ColorScheme = keyof typeof palette;

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
