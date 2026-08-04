/**
 * The arithmetic behind the availability grid, kept out of the component.
 *
 * All of it is pure: given the one payload `/manage/availability` returns, work
 * out which days the school actually teaches, who is free in a given hour, and
 * how heavily each teacher is already loaded. Separated from the page because
 * these are the rules worth testing directly — "Saturday is a school day here"
 * and "this teacher is free then" are facts, not rendering.
 */

export type PeriodKind = 'CLASS' | 'BREAK';

export interface AvailabilityTeacher {
  id: string;
  firstName: string;
  lastName: string;
}

export interface AvailabilityPeriod {
  id: string;
  order: number;
  label: string;
  kind: PeriodKind;
  /** "HH:MM", school-local. */
  startTime: string;
  endTime: string;
}

export interface BusyEntry {
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}

export interface AvailabilityResponse {
  teachers: AvailabilityTeacher[];
  periods: AvailabilityPeriod[];
  busy: BusyEntry[];
}

/** ISO weekday numbers, as the timetable stores them. */
export const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export interface AvailabilityModel {
  /** The weekdays this school actually teaches, ascending. */
  days: number[];
  periods: AvailabilityPeriod[];
  teachers: AvailabilityTeacher[];
  /** `${teacherId}-${dayOfWeek}-${periodId}` for O(1) lookup. */
  busySet: Set<string>;
  /** teacherId → periods taught across the whole week. */
  load: Map<string, number>;
  /** The middle of the load distribution, for calling a week light or busy. */
  medianLoad: number;
}

/**
 * THE DAYS COME FROM THE DATA.
 *
 * This replaced a hardcoded Monday–Friday constant, which is the bug that hid
 * Saturday from a six-day school: the API had always returned those 120 slots,
 * and the page discarded them without ever admitting the day existed. Deriving
 * the days from the timetable means a five-day school still sees five columns
 * and nobody has to maintain a list.
 */
export function teachingDays(busy: BusyEntry[]): number[] {
  return [...new Set(busy.map((b) => b.dayOfWeek))].sort((a, b) => a - b);
}

export function buildAvailability(data: AvailabilityResponse | undefined): AvailabilityModel {
  const teachers = data?.teachers ?? [];
  const periods = [...(data?.periods ?? [])].sort((a, b) => a.order - b.order);
  const busy = data?.busy ?? [];

  const busySet = new Set<string>();
  const load = new Map<string, number>();
  for (const b of busy) {
    busySet.add(`${b.teacherId}-${b.dayOfWeek}-${b.periodId}`);
    load.set(b.teacherId, (load.get(b.teacherId) ?? 0) + 1);
  }
  // A teacher with no slots at all is not absent from the load map — they are
  // the emptiest week there is, and leaving them out would sort them last.
  for (const t of teachers) if (!load.has(t.id)) load.set(t.id, 0);

  const loads = [...load.values()].sort((a, b) => a - b);
  const medianLoad = loads.length ? loads[Math.floor(loads.length / 2)] : 0;

  return { days: teachingDays(busy), periods, teachers, busySet, load, medianLoad };
}

/**
 * Who is free in one hour, least-loaded first.
 *
 * The ordering is the point. Sorting by name means the same handful of people
 * absorb every cover request, because whoever is at the top of the alphabet is
 * always the easiest to pick. Ties break on name so the list is stable between
 * renders rather than shuffling under the cursor.
 */
export function freeInCell(
  model: AvailabilityModel,
  day: number,
  periodId: string,
): AvailabilityTeacher[] {
  const period = model.periods.find((p) => p.id === periodId);
  if (!period || period.kind === 'BREAK') return [];
  return model.teachers
    .filter((t) => !model.busySet.has(`${t.id}-${day}-${periodId}`))
    .sort((a, b) => {
      const d = (model.load.get(a.id) ?? 0) - (model.load.get(b.id) ?? 0);
      if (d !== 0) return d;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
}

/** "HH:MM" → minutes since midnight. Returns null for anything unparseable. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The period running right now, if any, and today's weekday.
 *
 * Used only to choose what the page opens on. Outside school hours there is no
 * current period and the caller falls back to the first teaching one — the
 * honest answer to "which hour is running?" at 9pm is none, not Period 1.
 */
export function currentPeriodId(
  periods: AvailabilityPeriod[],
  now: Date,
): { day: number; periodId: string | null } {
  // getDay() is 0=Sunday; the timetable uses ISO 1=Monday…7=Sunday.
  const day = now.getDay() === 0 ? 7 : now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const hit = periods.find((p) => {
    const s = toMinutes(p.startTime);
    const e = toMinutes(p.endTime);
    return s !== null && e !== null && mins >= s && mins < e;
  });
  return { day, periodId: hit?.id ?? null };
}
