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
