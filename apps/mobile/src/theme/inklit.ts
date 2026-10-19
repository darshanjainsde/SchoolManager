/**
 * INK & LIT — the app's colour system (user, 19 Oct 2026).
 *
 * Read from the four palettes the user saved in the Colour Studio artifact
 * (https://claude.ai/artifact/LLBi8mrQJZBMgCFBSTq3u9), where they edited every
 * palette the same way:
 *   - LIGHT is INK: the band and the one filled button are a single, very deep
 *     brand colour (OKLCH L ≈ 0.25), white text on it; the page carries a
 *     breath of the brand hue; cards are white.
 *   - DARK is LIT: the brand lights up (a bright band and button with dark
 *     text), or the screen is AMOLED black with white icons.
 *   - TILES ARE VISIBLE: a strong tint (≥ 1.3:1 on the card), a solid brand
 *     tile with a white icon, or a clean grey — never the near-white 1.16:1
 *     tiles of before ("low sounding").
 *   - MEANING STAYS LOUD: amber only for "waiting on you", green only for
 *     "yours", near-black ink on them in light.
 *
 * The generator is the SAME code the studio runs, so the app paints exactly
 * what the user picked. Every palette is checked in both schemes by
 * theme/__tests__/inklit.test.ts.
 */

export type TileStyle = 'tint' | 'solid' | 'neutral';
export type DarkStyle = 'lit' | 'mid' | 'black';

/** Every colour a screen paints, per scheme. */
export interface InkLitRoles {
  /** The band behind the greeting, and its deeper second stop. */
  band: string;
  band2: string;
  /** Text and icons on the band. */
  onBand: string;
  /** The one filled button, the open tab in dark. */
  fill: string;
  fillfg: string;
  /** A soft wash of the brand for selected chips and rows (never a tile). */
  wash: string;
  /** Text in the brand colour on a card (links, eyebrows). */
  accentText: string;
  /** Tool tiles and the icon on them. */
  tile: string;
  glyph: string;
  /** "Waiting on you" and "yours" tiles. */
  amber: string;
  amberInk: string;
  green: string;
  greenInk: string;
  page: string;
  card: string;
  line: string;
  ink: string;
  sub: string;
  /** Count badges: a red deep enough for white text in BOTH schemes (audit: the dark pastel red gave white 3.35:1). */
  badge: string;
  badgeFg: string;
  /** The floating tab bar, the open tab's pill and its label, the closed tabs' icons. */
  bar: string;
  barOn: string;
  barOnFg: string;
  barOff: string;
}

// ---------- colour maths: OKLCH ↔ sRGB, WCAG contrast ----------
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toLin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLin = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(clamp(v, 0, 1) * 255); };
const hex = (rgb: number[]) => '#' + rgb.map((v) => fromLin(v).toString(16).padStart(2, '0')).join('').toUpperCase();
function lum(h: string): number { const [r, g, b] = hexToRgb(h).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function oklchToLin(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** A colour from OKLCH, chroma lowered until it fits sRGB. */
export function oklch(L: number, C: number, H: number): string {
  let c = C;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToLin(L, c, H);
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return hex(rgb);
    c *= 0.92;
  }
  return hex(oklchToLin(L, 0, H));
}
export function toOklch(h: string): { L: number; C: number; H: number } {
  const [r, g, b] = hexToRgb(h).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}
/** Step a colour's lightness (same hue) until it reaches `target` contrast on `bg`. */
function legible(fg: string, bg: string, target: number, towardDark: boolean): string {
  let { L } = toOklch(fg); const { C, H } = toOklch(fg); let c = fg;
  for (let i = 0; i < 40 && contrast(c, bg) < target; i++) { L = clamp(L + (towardDark ? -0.02 : 0.02), 0, 1); c = oklch(L, C, H); }
  return c;
}
/** Step lightness until `colour` stands `target` apart from `against`. */
function ensure(colour: string, against: string, target: number, step: number): string {
  let { L } = toOklch(colour); const { C, H } = toOklch(colour); let c = colour;
  for (let i = 0; i < 40 && contrast(c, against) < target; i++) { L = clamp(L + step, 0, 1); c = oklch(L, C, H); }
  return c;
}

export interface InkLitOptions {
  /** The brand hue (OKLCH degrees). */
  h: number;
  /** How saturated the ink is. */
  inkC?: number;
  /** Tile hue when it differs from the brand (Graphite & Sky). */
  tileH?: number;
  tileC?: number;
  tile?: TileStyle;
  dark?: DarkStyle;
  /** Dark page in pure black (AMOLED) rather than a tinted near-black. */
  darkBase?: 'tinted' | 'black';
}

const WHITE = '#FFFFFF';

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** Amber and green MEAN something (waiting, yours); a brand this close to either hue would read as one. */
export const MEANING_HUES = { amber: 75, green: 150 } as const;
export function nearMeaning(h: number): boolean {
  return hueGap(h, MEANING_HUES.amber) < 40 || hueGap(h, MEANING_HUES.green) < 40;
}

/**
 * Builds both schemes from a hue and a few choices — the studio's generator,
 * plus the rules from the independent colour audit of 19 Oct 2026 (WCAG 2 +
 * APCA): lit dark surfaces at OKLCH L 0.84 (at 0.76 dark text topped out near
 * Lc 60); a brand within 40° of amber or green takes SOLID ink tiles, so a
 * pastel brand tile never looks like a meaning tile (Green's mint tile was
 * ΔE 0.9 from the "yours" tile); amber and green never go neutral; their dark
 * inks at L ≥ 0.92 (Lc ≥ 80); badges on a red white text can read.
 */
export function inkLit(o: InkLitOptions): { light: InkLitRoles; dark: InkLitRoles } {
  const h = o.h, th = o.tileH ?? h, C = o.inkC ?? 0.12, darkStyle = o.dark ?? 'lit';
  const style: TileStyle = (o.tile ?? 'tint') === 'tint' && nearMeaning(th) ? 'solid' : (o.tile ?? 'tint');
  const band = oklch(0.25, C, h);
  const L: InkLitRoles = {
    band, band2: oklch(0.2, C * 0.9, h + 4), onBand: WHITE, fill: band, fillfg: WHITE,
    wash: oklch(0.94, 0.04, th), accentText: band,
    tile: '', glyph: '',
    amber: oklch(0.895, 0.09, 78), amberInk: '', green: oklch(0.895, 0.08, 155), greenInk: '',
    page: oklch(0.955, 0.016, h), card: WHITE, line: oklch(0.9, 0.014, h), ink: oklch(0.22, 0.03, h), sub: oklch(0.47, 0.032, h),
    badge: '#C4453F', badgeFg: WHITE,
    bar: band, barOn: '', barOnFg: '', barOff: '',
  };
  if (style === 'solid') { L.tile = band; L.glyph = WHITE; }
  else if (style === 'neutral') { L.tile = ensure(oklch(0.93, 0.004, h), WHITE, 1.45, -0.01); L.glyph = L.ink; }
  else { L.tile = ensure(oklch(0.905, o.tileC ?? 0.085, th), WHITE, 1.32, -0.01); L.glyph = legible(oklch(0.37, 0.13, th), L.tile, 7, true); }
  L.amberInk = legible(oklch(0.3, 0.05, 62), L.amber, 7, true);
  L.greenInk = legible(oklch(0.36, 0.09, 155), L.green, 7, true);
  L.barOn = style === 'tint' ? L.tile : oklch(0.92, 0.04, th);
  L.barOnFg = style === 'tint' ? L.glyph : band;
  L.barOff = oklch(0.86, 0.02, h);

  const black = o.darkBase === 'black' || darkStyle === 'black';
  const D = { page: black ? '#000000' : oklch(0.145, 0.014, h), card: black ? oklch(0.215, 0.003, h) : oklch(0.215, 0.022, h) } as InkLitRoles;
  if (darkStyle === 'black') { D.band = '#000000'; D.band2 = '#000000'; D.onBand = WHITE; D.fill = WHITE; D.fillfg = '#000000'; }
  else if (darkStyle === 'mid') { D.band = oklch(0.5, 0.12, h); D.band2 = oklch(0.44, 0.11, h + 4); D.onBand = WHITE; D.fill = D.band; D.fillfg = WHITE; }
  else {
    D.band = oklch(0.84, Math.min(0.13, C + 0.02), h); D.band2 = oklch(0.79, Math.min(0.13, C + 0.02), h + 4);
    D.onBand = legible(oklch(0.2, 0.05, h), D.band, 7, true); D.fill = D.band; D.fillfg = D.onBand;
  }
  D.ink = oklch(0.95, 0.012, h); D.sub = oklch(0.78, 0.03, h); D.line = oklch(0.3, 0.025, h);
  D.wash = oklch(0.3, 0.05, th);
  D.accentText = darkStyle === 'black' ? WHITE : legible(oklch(0.8, 0.12, h), D.card, 4.5, false);
  if (style === 'solid' && darkStyle !== 'black') { D.tile = D.band; D.glyph = D.onBand; }
  else if (style === 'neutral' || darkStyle === 'black') { D.tile = ensure(oklch(0.31, 0.005, h), D.card, 1.3, 0.01); D.glyph = WHITE; }
  else { D.tile = ensure(oklch(0.31, 0.07, th), D.card, 1.3, 0.01); D.glyph = legible(oklch(0.86, 0.1, th), D.tile, 7, false); }
  D.amber = ensure(oklch(0.33, 0.07, 75), D.card, 1.3, 0.01); D.amberInk = legible(oklch(0.92, 0.11, 85), D.amber, 8, false);
  D.green = ensure(oklch(0.32, 0.065, 155), D.card, 1.3, 0.01); D.greenInk = legible(oklch(0.92, 0.1, 155), D.green, 8, false);
  D.badge = '#C93C48'; D.badgeFg = WHITE;
  // A mid band's pill needs a darker bar to stand 3:1 off it (dark Green measured 2.6:1).
  D.bar = black ? oklch(0.2, 0.003, h) : darkStyle === 'mid' ? oklch(0.17, 0.02, h) : oklch(0.25, 0.03, h);
  D.barOn = D.fill; D.barOnFg = D.fillfg; D.barOff = oklch(0.8, 0.02, h);
  return { light: L, dark: D };
}

/**
 * Lays a palette's roles over the app's tokens. The accent tokens the rest of
 * the app already reads move with it (indigo = the filled colour, indigoDeep =
 * brand text, indigo50 = the wash, onBrand = text on the fill, the bar); the
 * neutrals follow only when the person kept the default paper, so a paper
 * they chose in Appearance still wins.
 */
export function applyInkLit<T extends object>(c: T, r: InkLitRoles, ownNeutrals: boolean): T & { roles: InkLitRoles } {
  return {
    ...c,
    roles: r,
    indigo: r.fill,
    indigoDeep: r.accentText,
    indigo50: r.wash,
    onBrand: r.fillfg,
    barBg: r.bar,
    barIndicator: r.barOn,
    barActive: r.barOnFg,
    barInactive: r.barOff,
    ...(ownNeutrals ? { appBg: r.page, surface: r.card, line: r.line, ink: r.ink, sub: r.sub } : {}),
  };
}
