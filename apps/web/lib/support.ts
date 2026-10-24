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
/**
 * Every photo in one send, together. The API is one Vercel function, which
 * refuses request bodies over 4.5 MB before the app sees them; 4 MB leaves room
 * for the form fields. Mirrors SUPPORT_MAX_REQUEST_BYTES in @skoolos/types.
 */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
/** A phone screenshot is ~3 MB; at this edge it is ~300 KB and still readable. */
const SHRINK_EDGE = 1600;

/**
 * Shrink a photo in the browser so five of them fit the budget. Re-encodes as
 * JPEG at most SHRINK_EDGE on the long side. Keeps the original when it is
 * already small, is a GIF (an animation would lose its frames), or the browser
 * cannot decode it (the server still checks the bytes).
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 400 * 1024 || file.type === 'image/gif') return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Keep what fits: at most five, all together under 4 MB. Returns what was dropped, so the form can say so. */
export function acceptFiles(current: File[], incoming: File[]): { kept: File[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = [...current];
  let total = kept.reduce((n, f) => n + f.size, 0);
  for (const f of incoming) {
    if (kept.length >= MAX_FILES) { dropped.push(`${f.name} — only ${MAX_FILES} photos fit`); continue; }
    if (total + f.size > MAX_TOTAL_BYTES) { dropped.push(`${f.name} — the photos together must be under 4 MB`); continue; }
    kept.push(f);
    total += f.size;
  }
  return { kept, dropped };
}

/**
 * Open a link in a new tab without the popup blocker eating it. The tab must
 * open in the click itself; the link arrives after an await, so open a blank
 * tab now and point it at the link when it lands — or close it on failure.
 */
export async function openInNewTab(get: () => Promise<string>): Promise<void> {
  const w = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  try {
    const url = await get();
    if (w) { w.opener = null; w.location.href = url; } else window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    w?.close();
    throw e;
  }
}
