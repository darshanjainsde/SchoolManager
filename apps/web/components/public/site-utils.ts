import type { PublicCourse, PublicSiteData } from '@/lib/public-api';

// Shared (server + client) helper: whether the Admissions section/page has
// anything to show. Lives here, NOT in a 'use client' module — client-module
// exports become non-callable reference proxies inside server components.
export function admissionsHasContent(
  admissions: PublicSiteData['admissions'],
  courses: PublicCourse[],
): boolean {
  return admissions.steps.length > 0 || (admissions.showFees && courses.some((c) => c.fee));
}

// ── Brand-colour helpers (shared by PublicSite + hero/nav sections) ─────────
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function isNearWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb.every((c) => c >= 235);
}
/** Blend a hex colour toward white by `amt` (0..1). */
export function lighten(hex: string, amt: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
/** Blend one hex toward another by `amt` (0..1). */
export function mix(hex: string, target: string, amt: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  if (!a || !b) return hex;
  const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}
/**
 * Relative luminance (WCAG 2.1), 0 = black, 1 = white.
 */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The label colour to put ON a brand fill.
 *
 * A school picks its own brand colour, and plenty of them are light — Beacon's
 * is a mint (#3ee6b0). White text on that measures 1.6:1, which is not a near
 * miss: it is unreadable, and it was every primary button on their site.
 * Hardcoding `#fff` assumes a dark brand, and about half of them are not.
 *
 * So the label is CHOSEN: whichever of white or a deep ink has more contrast
 * against the fill. Returns the winner, never a compromise between them.
 */
export function labelOn(fill: string): string {
  // Near-black, not merely "dark". A softer ink (#10241c) looked right and
  // still failed the mid-tones — a periwinkle brand reached only 4.12:1 with
  // the better of the two options, because neither end was far enough away.
  // The worst case across realistic brands is 4.70:1 at this value.
  const DARK = '#0a1410';
  return contrastRatio(fill, '#ffffff') >= contrastRatio(fill, DARK) ? '#ffffff' : DARK;
}

/** `rgba()` string from hex + alpha, for overlay gradients. */
export function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

// Admin-controlled URLs are rendered into href/src. React only warns on
// `javascript:` — it does not block it — so validate the scheme ourselves.
export function safeHttpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}
export function safeHttpsUrl(u: string | null | undefined): string | null {
  return u && /^https:\/\//i.test(u) ? u : null;
}

/**
 * The same instant, split into the pieces a date BLOCK needs rather than one
 * sentence. Formatted per-part by Intl — never by slicing `formatEventDate`'s
 * output, which would break the first time a locale or zone reorders it.
 */
export interface EventDateParts {
  day: string;
  month: string;
  weekday: string;
  time: string;
}
export function eventDateParts(iso: string, timeZone: string): EventDateParts {
  const at = new Date(iso);
  const fmt = (opts: Intl.DateTimeFormatOptions): string => {
    try {
      return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone }).format(at);
    } catch {
      // Bad/unknown School.timezone → UTC, so a misconfigured school still
      // gets a readable card instead of a thrown RangeError.
      return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(at);
    }
  };
  return {
    day: fmt({ day: 'numeric' }),
    month: fmt({ month: 'short' }),
    weekday: fmt({ weekday: 'short' }),
    time: fmt({ hour: 'numeric', minute: '2-digit', hour12: true }),
  };
}

// Format an event's start in the SCHOOL's timezone with a fixed locale, so the
// server (often UTC) and the client produce identical strings — otherwise
// `toLocale*` with the runtime locale/zone causes a hydration mismatch.
export function formatEventDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  } catch {
    // Bad/unknown timezone → fall back to UTC (still deterministic).
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    }).format(new Date(iso));
  }
}
