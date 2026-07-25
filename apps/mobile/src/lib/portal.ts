/** Mirrors PortalService.profile() (apps/api/.../portal/portal.service.ts). */
export interface StudentProfile {
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string | null;
  className: string | null;
  photoUrl: string | null;
}

/**
 * Mirrors the raw `Announcement` Prisma row returned by both
 * `PortalService.announcements()` and `AnnouncementsService.create()` — no
 * class NAME is embedded, only the id. `classSectionId === null` means
 * whole-school; a non-null id means "your class" (the /me/announcements
 * query already scopes rows to the caller's own section, so there's no
 * ambiguity about WHICH class it is on this screen).
 */
export interface Announcement {
  id: string;
  schoolId: string;
  classSectionId: string | null;
  title: string;
  body: string;
  createdByUserId: string | null;
  /** ISO timestamp (Date serialised over JSON). */
  createdAt: string;
}

/** Mirrors PortalService.AttendanceDay. */
export interface AttendanceDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE';
}

/** Mirrors PortalService.AttendanceSummary. */
export interface AttendanceSummary {
  /** `YYYY-MM` — echoes back the month actually queried. */
  month: string;
  /** present / (present + absent + late) * 100, rounded. 0 with no records. */
  percent: number;
  present: number;
  absent: number;
  late: number;
  days: AttendanceDay[];
}

/**
 * Mirrors the raw `Holiday` Prisma row returned by `PortalService.holidays()`
 * (`GET /me/holidays`) — the SAME upcoming-list query `manage/holidays`
 * (admin CRUD) reads, shared across both the family and staff portals since
 * the school holiday calendar is school-wide, not per-role.
 */
export interface Holiday {
  id: string;
  name: string;
  type: 'PUBLIC' | 'FESTIVAL' | 'SCHOOL';
  /** ISO timestamp at UTC midnight (`@db.Date`, serialised over JSON) — a plain calendar date. */
  startDate: string;
  endDate: string | null;
}

/**
 * Day-of-month + short weekday name for a `Holiday.startDate`, read in UTC.
 * `startDate` is a plain calendar date stored at UTC midnight (mirrors
 * `AttendanceDay.date` handling in `(family)/attendance.tsx`) — reading it
 * back in the device's LOCAL timezone could roll the day backward for any
 * timezone with a negative UTC offset, so both fields are pinned to UTC.
 */
export function holidayDateParts(iso: string): { day: string; weekday: string } {
  const d = new Date(iso);
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
  };
}

/**
 * Coarse "time ago" for a notice's `createdAt`. Good enough for a mobile
 * feed — falls back to a short date once it's more than a week old.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
