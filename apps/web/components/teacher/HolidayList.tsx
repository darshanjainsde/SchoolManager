import type { Holiday, HolidayType } from '@skoolos/types';

export interface HolidayListProps {
  holidays: Holiday[];
}

type Tone = 'good' | 'warn' | 'info' | 'neutral';

const TYPE_TONE: Partial<Record<HolidayType, Tone>> = {
  PUBLIC: 'good',
  FESTIVAL: 'warn',
  SCHOOL: 'info',
};

/**
 * `Holiday.type` has no DB-level enum, only `@IsIn`-validated at write time
 * (packages/db/prisma/schema.prisma) — an unexpected value is defensible,
 * not impossible, so it falls back to a neutral pill instead of crashing on
 * an unmapped lookup or, worse, rendering nothing.
 */
function typeTone(type: string): Tone {
  return TYPE_TONE[type as HolidayType] ?? 'neutral';
}

/**
 * `startDate`/`endDate` are UTC-midnight calendar dates (`@db.Date`) — read
 * with `getUTCDate()`/`timeZone: 'UTC'`, matching `holidayDateParts` in
 * apps/mobile/src/lib/portal.ts. `new Date(iso).getDate()` in the browser's
 * LOCAL zone rolls the day backward for any negative UTC offset (e.g.
 * America/New_York), which is a real bug for a product that won't always
 * run in IST.
 */
function dayAndWeekday(iso: string): { day: string; weekday: string } {
  const d = new Date(iso);
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
  };
}

function formatUTCDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A single date for a one-day holiday; a range when `endDate` is set — never "to null". */
function dateLabel(h: Holiday): string {
  const start = formatUTCDate(h.startDate);
  return h.endDate ? `${start} – ${formatUTCDate(h.endDate)}` : start;
}

/**
 * Renders whatever `holidays` it is given, in the order given — the page
 * owns fetching `GET /me/holidays`. No hooks here on purpose: Phase 3's
 * student portal renders the exact same school-wide list from the same
 * endpoint, so this stays props-only and reusable as-is.
 */
export function HolidayList({ holidays }: HolidayListProps): React.JSX.Element {
  if (holidays.length === 0) {
    return <p className="sk-state">No upcoming holidays.</p>;
  }

  return (
    <div>
      {holidays.map((h) => {
        const { day, weekday } = dayAndWeekday(h.startDate);
        return (
          // A holiday is a row in a term calendar the teacher SCANS: day tile,
          // name over date, type pill flush right. `.sk-row` already sizes all
          // four of those (`.sk-row .badge`, `.nm`, `.meta`, `.sp`), so the row
          // carries no inline geometry of its own — the one thing set here is
          // the tile's colour, which the class deliberately leaves open.
          <div className="sk-row" key={h.id}>
            <span className="badge" style={{ background: 'var(--sk-brand)' }}>
              {day}
            </span>
            <div>
              <div className="nm">{h.name}</div>
              <div className="meta">
                {weekday} · {dateLabel(h)}
              </div>
            </div>
            <span className="sp" />
            <span className="sk-pill" data-tone={typeTone(h.type)}>
              {h.type}
            </span>
          </div>
        );
      })}
    </div>
  );
}
