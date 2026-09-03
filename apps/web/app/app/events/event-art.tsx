'use client';
/**
 * Event cover art — eight archetypes, drawn as vector.
 *
 * WHY VECTOR, NOT A PHOTOGRAPH. The same artwork has to be a 268px card
 * thumbnail, a 16:9 banner on the school's public site, and a crisp A3 poster
 * on a school gate. One raster asset cannot be all three: sized for the poster
 * it is a megabyte on the card, sized for the card it is mush on the wall.
 * A vector is exact at every size and weighs nothing.
 *
 * WHY IT EXISTS AT ALL. Uploading a banner is optional and, on a school with
 * no photographer, never happens — so every event page looked like a database
 * row. Now an event has a cover from the moment it has a title.
 *
 * The palettes are FIXED, not themed. These print on white paper, where the
 * console's dark scheme is meaningless — a poster is not a screen. Tokens are
 * deliberately absent for that reason.
 *
 * Each archetype shares one grammar: a flat ground, a bold motif built from a
 * handful of primitives, and one warm accent. Abstract on purpose — it has to
 * read from across a corridor, and it must never look like a stock photo of
 * somebody else's school.
 */
import type { ReactNode } from 'react';

export type ArtKey =
  | 'sports' | 'science' | 'annual' | 'art' | 'music' | 'grad' | 'parents' | 'festival';

interface Palette {
  /** Shown in the picker. */
  name: string;
  /** The filename its SVG source would carry — see scripts/event-art/. */
  slug: string;
  bg: string;
  ink: string;
  accent: string;
  alt: string;
}

export const EVENT_ART: Record<ArtKey, Palette> = {
  sports:   { name: 'Sports day',        slug: 'sports-day',      bg: '#1d3f6e', ink: '#eaf2ff', accent: '#f59e0b', alt: '#4f9cf0' },
  science:  { name: 'Science exhibition', slug: 'science-fair',    bg: '#0f3b3a', ink: '#e6fffb', accent: '#f5b23c', alt: '#2dd4bf' },
  annual:   { name: 'Annual day',        slug: 'annual-day',      bg: '#3b1552', ink: '#fbeaff', accent: '#f5b23c', alt: '#c084fc' },
  art:      { name: 'Art & craft',       slug: 'art-craft',       bg: '#5a1533', ink: '#ffeaf3', accent: '#f5b23c', alt: '#f472b6' },
  music:    { name: 'Music & dance',     slug: 'music-dance',     bg: '#132a5c', ink: '#e8efff', accent: '#f59e0b', alt: '#818cf8' },
  grad:     { name: 'Graduation',        slug: 'graduation',      bg: '#123c2c', ink: '#e6fff2', accent: '#f5b23c', alt: '#4cc08e' },
  parents:  { name: 'Parents’ evening',  slug: 'parents-evening', bg: '#4a2410', ink: '#fff0e2', accent: '#f5b23c', alt: '#fb923c' },
  festival: { name: 'Festival',          slug: 'festival',        bg: '#5c1d0c', ink: '#fff2e6', accent: '#f5b23c', alt: '#fb7185' },
};

export const ART_KEYS = Object.keys(EVENT_ART) as ArtKey[];

/**
 * Title → archetype.
 *
 * Order matters: the specific patterns are tested before the broad ones, so
 * "Annual Sports Day" is a sports day rather than an annual day. `annual` is
 * last precisely because its words ("day", "fair", "celebration") appear
 * inside most other titles too.
 */
const RULES: [ArtKey, RegExp][] = [
  ['sports',   /sport|athlet|race|marathon|match|tournament|cricket|football/i],
  ['science',  /science|exhibit|stem|robot|olympiad/i],
  ['grad',     /graduat|farewell|valedict|convocation|send.?off/i],
  ['music',    /music|dance|concert|orchestra|choir|garba|recital|singing/i],
  ['art',      /\bart\b|craft|paint|draw|pottery|design|rangoli/i],
  ['parents',  /parent|ptm|open day|teacher meet|orientation|counsel/i],
  ['festival', /diwali|holi|eid|christmas|onam|pongal|independen|republic|festival|utsav|mela|navratri/i],
  ['annual',   /annual|day|fair|fest|celebration|prize|gathering|assembly/i],
];

export function guessArt(title: string): ArtKey {
  for (const [key, re] of RULES) if (re.test(title)) return key;
  return 'annual';
}

// ── The motifs ────────────────────────────────────────────────────────────
// Every motif is drawn inside a 256 × 144 box and centred by <EventArtGroup>,
// so one drawing serves every aspect ratio the product asks for.

function track(cx: number, cy: number, r: number, colour: string, w: number) {
  return <path d={`M${cx - r} ${cy} a${r} ${r} 0 0 1 ${r * 2} 0`} fill="none" stroke={colour} strokeWidth={w} opacity="0.85" />;
}

function soundWave(colour: string, opacity: number, dy: number) {
  let d = `M0 ${96 + dy}`;
  for (let x = 0; x <= 256; x += 32) d += ' q16 -22 32 0';
  return <path d={d} fill="none" stroke={colour} strokeWidth="5" opacity={opacity} />;
}

function motif(kind: ArtKey, p: Palette): ReactNode {
  switch (kind) {
    case 'sports':
      return (
        <>
          {track(80, 118, 62, p.alt, 13)}
          {track(80, 118, 44, p.accent, 13)}
          {track(80, 118, 26, p.alt, 13)}
          <circle cx="196" cy="40" r="17" fill={p.accent} />
          <path d="M150 118 q22-40 46-40 t46 40" fill="none" stroke={p.alt} strokeWidth="5" opacity="0.55" />
          <rect x="150" y="112" width="106" height="6" rx="3" fill={p.ink} opacity="0.8" />
        </>
      );
    case 'science':
      return (
        <>
          <ellipse cx="128" cy="72" rx="66" ry="26" fill="none" stroke={p.alt} strokeWidth="4" opacity="0.75" transform="rotate(-24 128 72)" />
          <ellipse cx="128" cy="72" rx="66" ry="26" fill="none" stroke={p.alt} strokeWidth="4" opacity="0.75" transform="rotate(36 128 72)" />
          <circle cx="128" cy="72" r="13" fill={p.accent} />
          <path d="M52 128 v-26 h-7 v-9 h27 v9 h-7 v26 z" fill={p.ink} opacity="0.9" />
          <circle cx="212" cy="112" r="7" fill={p.alt} />
          <circle cx="232" cy="96" r="4.5" fill={p.accent} />
        </>
      );
    case 'annual':
      return (
        <>
          <path d="M0 0 h74 q-10 62 -30 144 H0 z" fill={p.alt} opacity="0.55" />
          <path d="M256 0 h-74 q10 62 30 144 h44 z" fill={p.alt} opacity="0.55" />
          <circle cx="128" cy="52" r="21" fill={p.accent} />
          <path d="M128 74 L92 144 h72 z" fill={p.accent} opacity="0.33" />
          <rect x="86" y="132" width="84" height="7" rx="3.5" fill={p.ink} opacity="0.85" />
        </>
      );
    case 'art':
      return (
        <>
          <circle cx="92" cy="66" r="38" fill={p.alt} opacity="0.8" />
          <circle cx="140" cy="92" r="30" fill={p.accent} opacity="0.78" />
          <rect x="150" y="30" width="52" height="52" rx="9" fill={p.ink} opacity="0.22" transform="rotate(18 176 56)" />
          <path d="M40 138 l34-52 12 8 -34 52 z" fill={p.ink} opacity="0.85" />
          <path d="M40 138 l6-16 8 5 z" fill={p.accent} />
        </>
      );
    case 'music':
      return (
        <>
          {soundWave(p.alt, 0.8, 0)}
          {soundWave(p.accent, 0.55, 16)}
          <circle cx="76" cy="104" r="15" fill={p.accent} />
          <rect x="88" y="42" width="5.5" height="62" fill={p.accent} />
          <path d="M93 42 q26 6 26 22 q-8-12 -26-12 z" fill={p.accent} />
          <circle cx="182" cy="60" r="9" fill={p.ink} opacity="0.85" />
        </>
      );
    case 'grad':
      return (
        <>
          <path d="M128 34 L214 74 L128 114 L42 74 z" fill={p.alt} />
          <path d="M74 90 v26 q54 26 108 0 V90 L128 114 z" fill={p.ink} opacity="0.28" />
          <path d="M214 74 v34" stroke={p.accent} strokeWidth="4.5" fill="none" />
          <circle cx="214" cy="112" r="8" fill={p.accent} />
        </>
      );
    case 'parents':
      return (
        <>
          <rect x="34" y="44" width="96" height="62" rx="14" fill={p.alt} opacity="0.85" />
          <path d="M58 106 v20 l24-20 z" fill={p.alt} opacity="0.85" />
          <rect x="128" y="70" width="94" height="56" rx="13" fill={p.accent} />
          <path d="M198 126 v18 l-22-18 z" fill={p.accent} />
          <rect x="52" y="62" width="54" height="6" rx="3" fill={p.ink} opacity="0.6" />
          <rect x="52" y="76" width="38" height="6" rx="3" fill={p.ink} opacity="0.4" />
        </>
      );
    case 'festival':
      return (
        <>
          {Array.from({ length: 12 }, (_, i) => (
            <rect
              key={i}
              x="126" y="18" width="4.5" height="19" rx="2.2"
              fill={i % 2 ? p.accent : p.alt}
              transform={`rotate(${i * 30} 128 74)`}
            />
          ))}
          <circle cx="128" cy="74" r="26" fill="none" stroke={p.accent} strokeWidth="4" />
          <path d="M104 122 q24-20 48 0 q-24 12 -48 0z" fill={p.accent} />
          <path d="M122 108 q6-16 12 0 q-6 6 -12 0z" fill={p.ink} />
        </>
      );
  }
}

/**
 * The art as a nestable `<g>` plus its ground — for dropping inside a LARGER
 * svg, which is how every print sheet uses it. `height` is the box to fill;
 * the motif stays centred in it rather than stretching.
 */
export function EventArtGroup({ kind, width = 256, height = 144 }: { kind: ArtKey; width?: number; height?: number }) {
  const p = EVENT_ART[kind];
  const scale = width / 256;
  return (
    <g>
      <rect width={width} height={height} fill={p.bg} />
      <g transform={`translate(0 ${(height - 144 * scale) / 2}) scale(${scale})`}>{motif(kind, p)}</g>
    </g>
  );
}

/** The art as a standalone image — cards, the picker, the composer preview. */
export function EventArt({ kind, className }: { kind: ArtKey; className?: string }) {
  const p = EVENT_ART[kind];
  return (
    <svg
      viewBox="0 0 256 144"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label={`${p.name} cover art`}
    >
      <EventArtGroup kind={kind} />
    </svg>
  );
}
