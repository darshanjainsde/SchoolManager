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
