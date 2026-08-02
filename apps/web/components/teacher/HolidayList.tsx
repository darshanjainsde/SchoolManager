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
      {holidays.map((h, i) => {
        const { day, weekday } = dayAndWeekday(h.startDate);
        return (
          // A term calendar is a NOTICEBOARD, not a data table: each holiday is
          // an amber slip with a red pin bead through its top edge
          // (`.sk-notice`'s ::before). `.sk-row` stays underneath it because
          // the flex behaviour — day badge, body, spacer, type pill — is
          // exactly right and HolidayList's own test reads `.sk-row`; only the
          // framing changes. The slip draws its own edge, so the rule `.sk-row`
          // puts between siblings is cancelled.
          //
          // THE PIN: the slips DROP onto the board one after another rather
          // than appearing already there — the gesture is what says "this was
          // put up", which a static amber box cannot. Staggered so they land as
          // a sequence; every slip's text is complete without it, and reduced
          // motion collapses the whole thing to the end state.
          <div
            className="sk-row sk-notice sk-pinin sk-in"
            key={h.id}
            style={{ borderTop: 0, animationDelay: `${i * 0.06}s` }}
          >
            <span
              className="badge"
              style={{
                background: 'var(--sk-amber)',
                color: 'var(--sk-amber-ink)',
                fontFamily: 'var(--sk-serif)',
                fontSize: 17,
              }}
            >
              {day}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="nt">{h.name}</div>
              <div className="nd">
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
