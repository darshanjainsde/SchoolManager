import type { StyleOption } from './site-style';

/**
 * The Website Studio increment: every NEW design axis in one pure module,
 * alongside [[site-style]] and [[section-shape]] which own the earlier axes.
 *
 * Same iron rule as its siblings: the DEFAULT emits no class. Every default
 * below is byte-for-byte what every existing school already renders, so
 * shipping this file repaints nobody.
 *
 * No component or font imports — this module is read by guard tests, the admin
 * console and the public renderer alike, and a component import would drag
 * next/font into all three (that trap has bitten this repo three times).
 */

/* ── Scroll feel ──────────────────────────────────────────────────────────
   How the PAGE moves under the visitor's finger — a fourth axis beside shape,
   gesture and texture. Distinct from motionGesture (what one section does as
   it arrives) and from animationLevel (the volume knob, which still silences
   everything at NONE). */
export type ScrollFeel = 'CLASSIC' | 'GLIDE' | 'SNAP' | 'DECK' | 'HORIZONTAL';
export const SCROLL_FEELS: StyleOption<ScrollFeel>[] = [
  { value: 'CLASSIC', label: 'Classic', hint: 'Sections scroll normally, one after another — today’s behaviour.' },
  { value: 'GLIDE', label: 'Glide', hint: 'Weighted, inertial scrolling. The page eases to a stop — a premium feel.' },
  { value: 'SNAP', label: 'Snap', hint: 'Each section clicks gently into place as you scroll.' },
  { value: 'DECK', label: 'Deck', hint: 'Sections stack over one another like a deck of cards.' },
  {
    value: 'HORIZONTAL',
    label: 'Side-scroll',
    hint: 'The homepage bands become full-screen panels you move through sideways. Reverts to a normal column on phones and for reduced-motion visitors.',
  },
];
export function scrollFeelClass(v: string | null | undefined): string {
  switch (v) {
    case 'SNAP':
      return 'ps-scroll-snap';
    case 'DECK':
      return 'ps-scroll-deck';
    // GLIDE is a JS behaviour, not a stylesheet — but it still marks the root
    // so the effect hook can find its own switch without re-reading the data.
    case 'GLIDE':
      return 'ps-scroll-glide';
    // HORIZONTAL: the class flips the home track to a horizontal panel row (CSS,
    // desktop + motion only); a small effect adds wheel-to-sideways on top.
    case 'HORIZONTAL':
      return 'ps-scroll-horizontal';
    default:
      return '';
  }
}

/* ── Nav menu open animation ──────────────────────────────────────────────
   FADE is the shipped ps-menu-in (a fade with a whisper of movement), so it
   maps to no class. */
export type NavDropdownAnim = 'FADE' | 'SLIDE' | 'SCALE';
export const NAV_DROPDOWN_ANIMS: StyleOption<NavDropdownAnim>[] = [
  { value: 'FADE', label: 'Fade', hint: 'The menu fades into place — today’s behaviour.' },
  { value: 'SLIDE', label: 'Slide down', hint: 'The menu drops in from its tab.' },
  { value: 'SCALE', label: 'Scale pop', hint: 'The menu grows out of its tab corner.' },
];
export function navDropdownAnimClass(v: string | null | undefined): string {
  return v === 'SLIDE' ? 'ps-menuanim-slide' : v === 'SCALE' ? 'ps-menuanim-scale' : '';
}

/* ── Hero background medium ─────────────────────────────────────────────── */
export type HeroMedia = 'IMAGE' | 'VIDEO';
export const HERO_MEDIA_OPTIONS: StyleOption<HeroMedia>[] = [
  { value: 'IMAGE', label: 'Photo', hint: 'The photo slots you already configured — today’s behaviour.' },
  {
    value: 'VIDEO',
    label: 'Video (muted loop)',
    hint: 'A background video, muted on loop. Your first photo slot stays the poster and the fallback for slow connections and reduced-motion visitors.',
  },
];

/* ── Per-section layout variants ──────────────────────────────────────────
   sectionVariants (SchoolProfile Json) = { [sectionKey]: { layout?, gesture? } }.
   Layout changes the arrangement of one band; gesture overrides the page-wide
   motionGesture for that one band. DEFAULT everywhere = today's page. */
export type SectionKey = 'stats' | 'about' | 'courses' | 'admissions' | 'gallery' | 'staff';
export const SECTION_KEYS: SectionKey[] = ['stats', 'about', 'courses', 'admissions', 'gallery', 'staff'];

export interface SectionVariantChoice {
  layout?: string;
  gesture?: string;
}
export type SectionVariants = Partial<Record<SectionKey, SectionVariantChoice>>;

export const SECTION_VARIANT_DEFS: Record<
  SectionKey,
  { label: string; hint: string; layouts: StyleOption<string>[] }
> = {
  stats: {
    label: 'Quick stats',
    hint: 'The count-up numbers under the first screen.',
    layouts: [
      { value: 'CARDS', label: 'Cards', hint: 'Four floating cards — today’s look.' },
      { value: 'STRIP', label: 'Inline strip', hint: 'One ruled row with dividers, no cards.' },
      { value: 'RINGS', label: 'Progress rings', hint: 'Each number sits inside a drawn ring.' },
      { value: 'ODOMETER', label: 'Odometer', hint: 'Numbers roll up on dark counter tiles.' },
      { value: 'BARS', label: 'Bar fill', hint: 'Each figure grows a coloured bar as it scrolls in.' },
      { value: 'BIGNUM', label: 'Big numerals', hint: 'Oversized bare numbers, no cards — quiet and confident.' },
    ],
  },
  about: {
    label: 'About & principal',
    hint: 'The story beside the campus photo.',
    layouts: [
      { value: 'SPLIT', label: 'Image left', hint: 'Photo beside the story — today’s look.' },
      { value: 'OVERLAP', label: 'Overlap frame', hint: 'An offset accent frame behind the photo.' },
      { value: 'CENTER', label: 'Narrative', hint: 'Centered story with the photo below it.' },
    ],
  },
  courses: {
    label: 'Programmes',
    hint: 'The featured course cards.',
    layouts: [
      { value: 'GRID', label: 'Flip-card grid', hint: 'Cards that flip to their highlights — today’s look.' },
      { value: 'CAROUSEL', label: 'Carousel', hint: 'One swipeable row that snaps card to card.' },
      { value: 'ROWS', label: 'Single column', hint: 'One full-width card per row.' },
    ],
  },
  admissions: {
    label: 'Admissions steps',
    hint: 'The joining-us journey on the homepage.',
    layouts: [
      { value: 'JOURNEY', label: 'Journey line', hint: 'Steps along a drawn path — today’s look.' },
      { value: 'STEPPER', label: 'Vertical steps', hint: 'A single column down a dashed line.' },
      { value: 'TILES', label: 'Numbered tiles', hint: 'A two-by-two grid of numbered tiles.' },
    ],
  },
  gallery: {
    label: 'Gallery',
    hint: 'Life-at-school photos on the homepage.',
    layouts: [
      { value: 'GRID', label: 'Grid', hint: 'Even photo grid — today’s look.' },
      { value: 'MASONRY', label: 'Masonry', hint: 'Staggered column heights, like a pinboard.' },
      { value: 'FILMSTRIP', label: 'Film strip', hint: 'A single swipeable row of photos.' },
    ],
  },
  staff: {
    label: 'Educators',
    hint: 'The featured-staff band.',
    layouts: [
      { value: 'GRID', label: 'Portrait grid', hint: 'Four-across portrait cards — today’s look.' },
      { value: 'LIST', label: 'List rows', hint: 'Compact rows, photo beside name and role.' },
    ],
  },
};

const SECTION_DEFAULT_LAYOUT: Record<SectionKey, string> = {
  stats: 'CARDS',
  about: 'SPLIT',
  courses: 'GRID',
  admissions: 'JOURNEY',
  gallery: 'GRID',
  staff: 'GRID',
};

export function sectionLayoutOf(variants: SectionVariants | null | undefined, key: SectionKey): string {
  const v = variants?.[key]?.layout;
  const allowed = SECTION_VARIANT_DEFS[key].layouts.some((l) => l.value === v);
  return v && allowed ? v : SECTION_DEFAULT_LAYOUT[key];
}

/** Default layout → no class; today's page must not change by one byte. */
export function sectionLayoutClass(key: SectionKey, layout: string | null | undefined): string {
  if (!layout || layout === SECTION_DEFAULT_LAYOUT[key]) return '';
  const allowed = SECTION_VARIANT_DEFS[key].layouts.some((l) => l.value === layout);
  return allowed ? `ps-v-${key}-${layout.toLowerCase()}` : '';
}

/** A one-band override of the page-wide motion gesture. DEFAULT → no class. */
export type SectionGesture = 'DEFAULT' | 'RISE' | 'FADE' | 'DRAW';
export function sectionGestureClass(gesture: string | null | undefined): string {
  switch (gesture) {
    case 'RISE':
      return 'ps-sg-rise';
    case 'FADE':
      return 'ps-sg-fade';
    case 'DRAW':
      return 'ps-sg-draw';
    default:
      return '';
  }
}

export function normalizeSectionVariants(raw: unknown): SectionVariants {
  if (!raw || typeof raw !== 'object') return {};
  const out: SectionVariants = {};
  for (const key of SECTION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (!v || typeof v !== 'object') continue;
    const layout = (v as Record<string, unknown>).layout;
    const gesture = (v as Record<string, unknown>).gesture;
    const entry: SectionVariantChoice = {};
    if (typeof layout === 'string' && SECTION_VARIANT_DEFS[key].layouts.some((l) => l.value === layout)) {
      entry.layout = layout;
    }
    if (typeof gesture === 'string' && ['DEFAULT', 'RISE', 'FADE', 'DRAW'].includes(gesture)) {
      entry.gesture = gesture;
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

/* ── Footer ───────────────────────────────────────────────────────────────
   footerConfig (SchoolProfile Json). Null = the shipped three-column footer.
   COLUMNS/PAPER with social off is therefore the no-class default. */
export type FooterLayout = 'COLUMNS' | 'SIMPLE' | 'CENTER';
export type FooterColor = 'PAPER' | 'DARK' | 'BRAND';
export interface FooterConfig {
  layout: FooterLayout;
  color: FooterColor;
  /** Show the school's social links as icons in the footer. */
  social: boolean;
  /** Show the contact column (phone/email/city from the Contact tab). */
  contact: boolean;
  /** Replaces the built-in one-line blurb; null keeps it. */
  tagline: string | null;
  /** Split the Explore link list into two columns when it grows long. */
  twoCols: boolean;
}
export const FOOTER_LAYOUTS: StyleOption<FooterLayout>[] = [
  { value: 'COLUMNS', label: 'Link columns', hint: 'Brand, Explore and Contact columns — today’s footer.' },
  { value: 'SIMPLE', label: 'Simple line', hint: 'One quiet line: name, tagline, copyright.' },
  { value: 'CENTER', label: 'Statement', hint: 'Centered crest and school name, links beneath.' },
];
export const FOOTER_COLORS: StyleOption<FooterColor>[] = [
  { value: 'PAPER', label: 'Paper', hint: 'On the page paper — today’s footer.' },
  { value: 'DARK', label: 'Dark', hint: 'A deep ink band that closes the page.' },
  { value: 'BRAND', label: 'School colour', hint: 'Your primary colour, white text.' },
];
export function normalizeFooterConfig(raw: unknown): FooterConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const layout = FOOTER_LAYOUTS.some((o) => o.value === r.layout) ? (r.layout as FooterLayout) : 'COLUMNS';
  const color = FOOTER_COLORS.some((o) => o.value === r.color) ? (r.color as FooterColor) : 'PAPER';
  return {
    layout,
    color,
    social: r.social === true,
    contact: r.contact !== false,
    tagline: typeof r.tagline === 'string' && r.tagline.trim() ? r.tagline.slice(0, 160) : null,
    twoCols: r.twoCols === true,
  };
}
export function footerClasses(cfg: FooterConfig): string {
  return [
    cfg.layout === 'SIMPLE' ? 'ps-foot-simple' : cfg.layout === 'CENTER' ? 'ps-foot-center' : '',
    cfg.color === 'DARK' ? 'ps-footc-dark' : cfg.color === 'BRAND' ? 'ps-footc-brand' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/* ── Festive overlay ──────────────────────────────────────────────────────
   festiveTheme (SchoolProfile Json). Null = none. A decoration LAYER over the
   base design (Google-doodle model); FULL intensity additionally retints the
   page with the festival palette. Decorations are CSS-only and every one of
   them answers to --motion and ps-motion-off. */
export type FestivalKey = 'DIWALI' | 'HOLI' | 'EID' | 'INDEPENDENCE' | 'CHRISTMAS';
export type FestiveIntensity = 'LAYER' | 'FULL';
export interface FestiveTheme {
  festival: FestivalKey;
  variant: string;
  intensity: FestiveIntensity;
  ribbon: boolean;
  recolor: boolean;
}
export interface FestivalDef {
  value: FestivalKey;
  label: string;
  emoji: string;
  /** Accent used when recolor is on (LAYER) — swaps --ps2 only. */
  accent: string;
  /** FULL palette: retints both brand stops for the takeover. */
  full: { ps1: string; ps2: string };
  /**
   * FULL surface for night festivals: the page paper and heading ink go dark.
   * Absent = the takeover keeps the light paper (Holi, Independence Day).
   * Presence also switches body text via the ps-fest-dark class.
   */
  fullSurface?: { paper: string; ink: string };
  greeting: string;
  variants: StyleOption<string>[];
  /** Decoration sets layered IN ADDITION to the chosen one at FULL. */
  fullExtras: string[];
}
export const FESTIVALS: FestivalDef[] = [
  {
    value: 'DIWALI',
    label: 'Diwali',
    emoji: '🪔',
    accent: '#e8a020',
    full: { ps1: '#e8a020', ps2: '#ff9d5c' },
    fullSurface: { paper: '#1b1129', ink: '#f6e9cd' },
    greeting: 'Happy Diwali from all of us — may the season glow bright',
    variants: [
      { value: 'DIYAS', label: 'Diyas & string lights', hint: 'Glowing lamps in the corners, lights along the top.' },
      { value: 'FIREWORKS', label: 'Night fireworks', hint: 'Slow celebratory bursts over the page.' },
      { value: 'RANGOLI', label: 'Rangoli corners', hint: 'Patterned rings tucked into the page corners.' },
    ],
    fullExtras: ['DIYAS', 'FIREWORKS'],
  },
  {
    value: 'HOLI',
    label: 'Holi',
    emoji: '🎨',
    accent: '#c2367f',
    full: { ps1: '#c2367f', ps2: '#26c281' },
    greeting: 'Happy Holi — may the year ahead be full of colour',
    variants: [
      { value: 'SPLASH', label: 'Colour splashes', hint: 'Soft gulal clouds washing the corners.' },
      { value: 'CONFETTI', label: 'Gulal drift', hint: 'Colour flecks drifting gently down the page.' },
    ],
    fullExtras: ['SPLASH', 'CONFETTI'],
  },
  {
    value: 'EID',
    label: 'Eid',
    emoji: '🌙',
    accent: '#2e9d6b',
    full: { ps1: '#3ecf8e', ps2: '#e8c76a' },
    fullSurface: { paper: '#0e2b26', ink: '#eaf5ef' },
    greeting: 'Eid Mubarak from our whole school family',
    variants: [
      { value: 'LANTERNS', label: 'Hanging lanterns', hint: 'Lanterns swinging gently from the top edge.' },
      { value: 'CRESCENT', label: 'Crescent & stars', hint: 'A glowing crescent with drifting stars.' },
    ],
    fullExtras: ['LANTERNS', 'CRESCENT'],
  },
  {
    value: 'INDEPENDENCE',
    label: 'Independence Day',
    emoji: '🇮🇳',
    accent: '#e8862a',
    full: { ps1: '#c26a1a', ps2: '#2e9d6b' },
    greeting: 'Happy Independence Day — Jai Hind',
    variants: [
      { value: 'BUNTING', label: 'Tricolour bunting', hint: 'A flag garland along the top of the page.' },
      { value: 'KITES', label: 'Kite sky', hint: 'Kites drifting across the page.' },
    ],
    fullExtras: ['BUNTING', 'KITES'],
  },
  {
    value: 'CHRISTMAS',
    label: 'Christmas',
    emoji: '🎄',
    accent: '#c0392b',
    full: { ps1: '#4cc38a', ps2: '#e46a5d' },
    fullSurface: { paper: '#12291d', ink: '#f2f7f0' },
    greeting: 'Merry Christmas and a joyful winter break',
    variants: [
      { value: 'SNOW', label: 'Snowfall', hint: 'Flakes drifting gently down the page.' },
      { value: 'LIGHTS', label: 'Fairy lights', hint: 'A multicolour light string along the top.' },
    ],
    fullExtras: ['SNOW', 'LIGHTS'],
  },
];
export function festivalDef(key: string | null | undefined): FestivalDef | null {
  return FESTIVALS.find((f) => f.value === key) ?? null;
}
export function normalizeFestiveTheme(raw: unknown): FestiveTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const def = festivalDef(typeof r.festival === 'string' ? r.festival : null);
  if (!def) return null;
  const variant =
    typeof r.variant === 'string' && def.variants.some((v) => v.value === r.variant)
      ? (r.variant as string)
      : def.variants[0].value;
  return {
    festival: def.value,
    variant,
    intensity: r.intensity === 'FULL' ? 'FULL' : 'LAYER',
    ribbon: r.ribbon !== false,
    recolor: r.recolor !== false,
  };
}
/** Which decoration sets to render — the chosen one, plus the festival's
 *  signature extras when the takeover is on. */
export function festiveDecorations(f: FestiveTheme): string[] {
  const def = festivalDef(f.festival);
  if (!def) return [];
  const sets = new Set<string>([f.variant]);
  if (f.intensity === 'FULL') for (const x of def.fullExtras) sets.add(x);
  return [...sets];
}
/** Root classes. LAYER decorates without touching the base palette classes. */
export function festiveClasses(f: FestiveTheme | null): string {
  if (!f) return '';
  return f.intensity === 'FULL' ? `ps-fest ps-fest-full ps-fest-${f.festival.toLowerCase()}` : 'ps-fest';
}

/* ── Custom code (the operator escape hatch) ──────────────────────────────
   Two layers of defence, both here so they are unit-tested as pure functions:
   sanitizeSectionCss strips everything that could reach outside a stylesheet
   (style-tag breakout, imports, external fetches); scopeSectionCss prefixes
   every selector so a snippet written for one section cannot restyle another.
   The API sanitizes ON WRITE with the same function; the renderer scopes on
   read — neither side trusts the stored value alone. */
export const CUSTOM_CSS_MAX = 20_000;

/**
 * Decode CSS escapes and drop comments before any keyword match — the browser
 * reads `@\69mport` as `@import` and `u\72l(` as `url(`, so a sanitizer that
 * regexes the literal words is matching a surface the browser never sees.
 * Kept in lockstep with the API's normalizeCssForScan (custom-code.ts).
 */
function normalizeCssForScan(css: string): string {
  let out = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');
  out = out.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g, (_m, hex, ch) => {
    if (hex) {
      const code = parseInt(hex, 16);
      if (code === 0 || code > 0x10ffff) return '';
      return String.fromCodePoint(code);
    }
    return ch;
  });
  return out;
}

export function sanitizeSectionCss(css: string): string {
  return (
    normalizeCssForScan(css.slice(0, CUSTOM_CSS_MAX))
      // No markup of any kind inside a stylesheet — this is what makes a
      // literal style-tag breakout impossible rather than merely unlikely.
      .replace(/</g, ' ')
      .replace(/@import[^;{]*(;|$)/gi, '')
      .replace(/@charset[^;]*;/gi, '')
      // Legacy IE expression() executed JS from CSS; nothing modern needs it.
      .replace(/expression\s*\(/gi, 'no-expression(')
      .replace(/javascript\s*:/gi, 'blocked:')
      .replace(/-moz-binding\s*:/gi, 'blocked:')
      // External fetches (tracking pixels, remote fonts) are not what a
      // per-section override is for. data: URIs stay — gradients and inline
      // SVG backgrounds are legitimate design material.
      .replace(/url\(\s*(['"]?)(?!\s*data:)/gi, 'url($1about:invalid#')
  );
}

/**
 * Prefix every top-level selector with the section scope, recursing into
 * conditional at-rules (@media/@supports/@container). @keyframes bodies pass
 * through untouched — their inner "selectors" are percentages, and the page
 * only ever renders one school, so name collisions are the author's own.
 */
export function scopeSectionCss(scope: string, css: string): string {
  const clean = sanitizeSectionCss(css);
  return scopeBlock(scope, clean);
}

function scopeBlock(scope: string, css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    // Stray closers in a header are unbalanced-brace debris; scrubbing them
    // means the rule that follows still gets SCOPED instead of riding out
    // behind a selector the browser would misparse.
    const header = css.slice(i, brace).replace(/\}/g, ' ').trim();
    const end = matchBrace(css, brace);
    if (end === -1) break;
    const body = css.slice(brace + 1, end);
    if (header.startsWith('@')) {
      if (/^@(media|supports|container)/i.test(header)) {
        out += `${header}{${scopeBlock(scope, body)}}`;
      } else {
        // @keyframes and friends: emitted whole, never selector-prefixed.
        out += `${header}{${body}}`;
      }
    } else if (header) {
      const scoped = header
        .split(',')
        .map((sel) => {
          const s = sel.trim();
          if (!s) return '';
          // A selector aimed at the page root means "this section's root".
          if (/^(:root|html|body)$/i.test(s)) return scope;
          return `${scope} ${s}`;
        })
        .filter(Boolean)
        .join(', ');
      out += `${scoped}{${body}}`;
    }
    i = end + 1;
  }
  return out;
}

function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Data attribute each themed band carries so scoped CSS can reach it. */
export function sectionScopeSelector(key: string): string {
  return `.ps-root [data-sec="${key.replace(/[^a-z-]/gi, '')}"]`;
}

/** All stored per-section overrides, sanitized and scoped into one stylesheet. */
export function buildCustomCss(map: unknown): string {
  if (!map || typeof map !== 'object') return '';
  const KEYS: string[] = [...SECTION_KEYS, 'hero', 'footer', 'page'];
  let out = '';
  for (const key of KEYS) {
    const css = (map as Record<string, unknown>)[key];
    if (typeof css === 'string' && css.trim()) {
      out += `\n/* section:${key} */\n` + scopeSectionCss(sectionScopeSelector(key), css);
    }
  }
  return out;
}

/* ── Custom pages: typed blocks, never raw HTML ─────────────────────────── */
export type PageBlock =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'img'; url: string; caption: string | null }
  | { t: 'imgtext'; url: string | null; text: string }
  | { t: 'cta'; label: string; href: string | null };

export const PAGE_BLOCK_MAX = 40;

export function normalizePageBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlock[] = [];
  for (const b of raw.slice(0, PAGE_BLOCK_MAX)) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.slice(0, 4000) : '';
    switch (r.t) {
      case 'h':
        if (text.trim()) out.push({ t: 'h', text: text.slice(0, 200) });
        break;
      case 'p':
        if (text.trim()) out.push({ t: 'p', text });
        break;
      case 'img':
        if (typeof r.url === 'string' && safeUrl(r.url))
          out.push({ t: 'img', url: r.url, caption: typeof r.caption === 'string' ? r.caption.slice(0, 200) : null });
        break;
      case 'imgtext':
        if (text.trim())
          out.push({
            t: 'imgtext',
            url: typeof r.url === 'string' && safeUrl(r.url) ? r.url : null,
            text,
          });
        break;
      case 'cta':
        if (typeof r.label === 'string' && r.label.trim())
          out.push({
            t: 'cta',
            label: r.label.slice(0, 80),
            href: typeof r.href === 'string' && safeHref(r.href) ? r.href : null,
          });
        break;
    }
  }
  return out;
}

function safeUrl(u: string): boolean {
  return /^(https?:)?\/\//i.test(u) || u.startsWith('/');
}
/** CTA links: same-site paths, web URLs, tel and mailto. Nothing scriptable. */
function safeHref(u: string): boolean {
  return safeUrl(u) || /^(tel|mailto):/i.test(u) || u.startsWith('#');
}
