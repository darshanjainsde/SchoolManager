import {
  SUPPORT_MODULES, SUPPORT_MODULE_LABEL, SUPPORT_SEVERITIES, SUPPORT_SEVERITY_LABEL, SUPPORT_TICKET_TYPES, SUPPORT_TICKET_TYPE_LABEL,
  type SupportModule, type SupportSeverity, type SupportTicketType,
} from '@skoolos/types';

export { ago } from './concerns';

export const TYPE_OPTIONS: { value: SupportTicketType; label: string }[] =
  SUPPORT_TICKET_TYPES.map((value) => ({ value, label: SUPPORT_TICKET_TYPE_LABEL[value] }));
export const SEVERITY_OPTIONS: { value: SupportSeverity; label: string }[] =
  SUPPORT_SEVERITIES.map((value) => ({ value, label: SUPPORT_SEVERITY_LABEL[value] }));
export const MODULE_OPTIONS: { value: SupportModule; label: string }[] =
  SUPPORT_MODULES.map((value) => ({ value, label: SUPPORT_MODULE_LABEL[value] }));

/** The console route → the module the admin is most likely reporting about. The form preselects it; they can change it. */
const PATH_MODULE: [RegExp, SupportModule][] = [
  [/^\/app\/website/, 'WEBSITE'], [/^\/app\/blog/, 'BLOG'], [/^\/app\/events/, 'EVENTS'], [/^\/app\/enquiries/, 'ENQUIRIES'],
  [/^\/app\/concerns/, 'CONCERNS'], [/^\/app\/students/, 'STUDENTS'], [/^\/app\/(teachers|class-teachers)/, 'TEACHERS'],
  [/^\/app\/staff-attendance/, 'ATTENDANCE'], [/^\/app\/staff/, 'STAFF'], [/^\/app\/(classes|sessions|onboarding)/, 'CLASSES'],
  [/^\/app\/(leave|requests)/, 'LEAVE'], [/^\/app\/(timetable|availability)/, 'TIMETABLE'], [/^\/app\/syllabus/, 'SYLLABUS'],
  [/^\/app\/exam-hall/, 'EXAMS'], [/^\/app\/press/, 'PRESS'], [/^\/app\/fees/, 'FEES'], [/^\/app\/pay/, 'PAY'],
  [/^\/app\/library|^\/library/, 'LIBRARY'], [/^\/app\/sports/, 'SPORTS'], [/^\/app\/announcements/, 'ANNOUNCEMENTS'],
  [/^\/app\/alumni/, 'ALUMNI'], [/^\/app\/settings/, 'SETTINGS'], [/^\/login|^\/reset-password/, 'LOGIN'],
];
export function moduleForPath(pathname: string | null | undefined): SupportModule {
  if (!pathname) return 'OTHER';
  for (const [re, m] of PATH_MODULE) if (re.test(pathname)) return m;
  return 'OTHER';
}

/** "Chrome on Windows" from the browser's own string — for the captured-context box only; the server records its own reading. */
export function browserHint(ua: string | undefined): string {
  if (!ua) return 'this browser';
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'this browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${b} on ${os}` : b;
}

/** "Mon 9:12 am" this week, "21 Sept" beyond it. */
export function when(iso: string): string {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days < 6
    ? d.toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** "41 h left" / "expired" for the look-in clock. */
export function hoursLeft(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const h = Math.round((new Date(iso).getTime() - now) / 3_600_000);
  if (h <= 0) return null;
  return `${h} h left`;
}

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** Keep what fits: the first five, each under 5 MB. Returns what was dropped, so the form can say so. */
export function acceptFiles(current: File[], incoming: File[]): { kept: File[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = [...current];
  for (const f of incoming) {
    if (f.size > MAX_FILE_BYTES) { dropped.push(`${f.name} is over 5 MB`); continue; }
    if (kept.length >= MAX_FILES) { dropped.push(`${f.name} — only ${MAX_FILES} photos fit`); continue; }
    kept.push(f);
  }
  return { kept, dropped };
}
