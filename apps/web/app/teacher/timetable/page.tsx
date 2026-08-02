'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TimetableSlot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { buildGrid, type GridSlot, type GridPeriodRow } from '@/lib/timetable-grid';
import { minutesOfDay } from '@/lib/teacher-day';
import { WeekGrid } from '@/components/timetable/WeekGrid';

/** Full weekday names, indexed by TimetableSlot.dayOfWeek (1 = Mon … 7 = Sun). */
const DAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

// `TimetableSlot` (`@skoolos/types`) is what GET /manage/timetable/mine
// returns — TimetableService.SLOT_INCLUDE, the SAME wire contract the
// student portal's timetable pages read via GET /me/timetable. One include,
// one shared type, both callers.

function toGridSlot(s: TimetableSlot): GridSlot {
  return {
    id: s.id,
    dayOfWeek: s.dayOfWeek,
    periodId: s.period.id,
    periodLabel: s.period.label,
    startTime: s.period.startTime,
    endTime: s.period.endTime,
    periodOrder: s.period.order,
    className: `${s.classSection.grade.name}-${s.classSection.name}`,
    subjectName: s.subject.name,
  };
}

// ── Clock ────────────────────────────────────────────────────────────────────
// WeekGrid itself never reads Date — this page computes "what day/period is
// it" from the browser's own local clock (getDay/getHours/getMinutes, not
// toISOString/getUTCDay, which would read the wrong calendar day whenever
// local and UTC disagree — see teacher/page.tsx's todayIso() for the same
// convention) and passes plain numbers/ids down.

/** ISO weekday matching TimetableSlot.dayOfWeek: 1 = Mon … 7 = Sun. */
function todayDayOfWeek(): number {
  const js = new Date().getDay(); // 0 = Sun … 6 = Sat
  return js === 0 ? 7 : js;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The period whose [startTime, endTime) window contains `now`, or null.
 * Mirrors `currentEntry`'s "a period owns its start minute, not its end
 * minute" rule (lib/teacher-day.ts) — reusing `minutesOfDay` for the HH:MM
 * math — but written against `GridPeriodRow` rather than `currentEntry`
 * directly: unlike `TeacherDayEntry`, a period row's start/end time are
 * optional (a period the school never gave clock times still gets a grid
 * row), so a period with no times can never be "current" rather than
 * crashing on undefined.
 */
function findCurrentPeriodId(periods: GridPeriodRow[], now: number): string | null {
  const found = periods.find(
    (p) => p.startTime && p.endTime && now >= minutesOfDay(p.startTime) && now < minutesOfDay(p.endTime),
  );
  return found?.id ?? null;
}

/**
 * The calendar date this weekday falls on in the week containing `from`,
 * Monday-first. The strip shows a real numeral rather than a bare weekday
 * because "Thursday" alone does not tell you whether you are looking at this
 * week; "18" does. Same helper, same reasoning, as the family portal's strip.
 */
function dateOfWeekday(dayOfWeek: number, from: Date): number {
  const d = new Date(from);
  d.setDate(from.getDate() + (dayOfWeek - (from.getDay() || 7)));
  return d.getDate();
}

/**
 * Where a period sits relative to the clock. A period owns its start minute
 * but not its end minute — the same rule `currentEntry` and the family rail
 * use — so two back-to-back periods can never both be "now". A period the
 * school never gave clock times to is always 'future': it has no window to be
 * inside of, and guessing one would paint the wrong row amber.
 */
function railState(period: GridPeriodRow, now: number): 'past' | 'now' | 'future' {
  if (!period.startTime || !period.endTime) return 'future';
  if (now >= minutesOfDay(period.endTime)) return 'past';
  if (now >= minutesOfDay(period.startTime)) return 'now';
  return 'future';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TeacherTimetablePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const week = useQuery({
    queryKey: ['t-my-week'],
    enabled: !!host,
    queryFn: () => api.get<TimetableSlot[]>('/manage/timetable/mine'),
  });

  // Null until the teacher picks a day themselves, so the strip keeps
  // defaulting to today as the week rolls over rather than sticking on
  // whichever day happened to be current when the page first mounted.
  const [picked, setPicked] = useState<number | null>(null);

  const slots = (week.data ?? []).map(toGridSlot);
  const shape = buildGrid(slots);

  const dow = todayDayOfWeek();
  // null when today isn't a day this teacher is taught at all (e.g. a school
  // that doesn't run Sunday) — WeekGrid then tints nothing, which is correct:
  // there is no "today" column to point at.
  const todayColumn = shape.days.includes(dow) ? dow : null;
  const nowMin = nowMinutes();
  const currentPeriodId = todayColumn !== null ? findCurrentPeriodId(shape.periods, nowMin) : null;

  const selectedDay = picked ?? todayColumn ?? shape.days[0] ?? dow;
  const selectedLabel = DAY_NAMES[selectedDay] ?? `Day ${selectedDay}`;
  // "now" and "finished" are facts about the clock, so they are only ever true
  // of the day the clock is on. Reading Friday's page on a Tuesday must not
  // paint a period amber as though it were happening.
  const selectedIsToday = selectedDay === todayColumn;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Timetable</h1>
        <p>One day to a page, and the whole week underneath it.</p>
      </header>

      {week.isLoading && <p className="sk-state">Loading your timetable…</p>}
      {week.error && <p className="sk-state err">{(week.error as Error).message}</p>}

      {!week.isLoading && !week.error && slots.length === 0 && (
        <p className="sk-state">No timetable has been set up for you yet — ask your school admin.</p>
      )}

      {!week.isLoading && !week.error && slots.length > 0 && (
        <>
          {/* ── The week strip ──────────────────────────────────────────────
              The pitch's `.dstrip`: the whole week stays on screen while you
              read one day of it, which a dropdown cannot do. Today is amber
              and the day you are reading is indigo — two different facts, so
              two different colours; you can be reading Friday on a Tuesday. */}
          <div className="sk-dstrip" role="group" aria-label="Day of the week">
            {shape.days.map((day) => {
              const label = DAY_NAMES[day] ?? `Day ${day}`;
              return (
                <button
                  key={day}
                  type="button"
                  // sk-press: the chip shrinks under the finger, so a tap that
                  // lands on the day already open still reads as a tap.
                  className="sk-day sk-press"
                  aria-pressed={day === selectedDay}
                  data-today={day === todayColumn}
                  aria-label={label}
                  onClick={() => setPicked(day)}
                >
                  <div className="dw" aria-hidden="true">
                    {label.slice(0, 3)}
                  </div>
                  <div className="dn" aria-hidden="true">
                    {dateOfWeekday(day, new Date())}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── The day's ruled rail ────────────────────────────────────────
              A school exercise book has a red rule down the left margin and
              the day's entries written to the right of it. That is literally
              this component — the time in the margin column, `.sk-rail-ml` as
              the rule, then the class — and it is the same rail the family
              portal reads its own day from. */}
          <div className="sk-card" style={{ marginBottom: 18 }}>
            <div className="sk-card-h">
              <h3>{selectedLabel}</h3>
            </div>
            <div className="sk-card-b">
              {/* Keyed on the day so `sk-wfade` REPLAYS on every switch: two
                  weekdays can look nearly identical, and without the page
                  visibly turning, changing day is indistinguishable from
                  nothing having happened. */}
              <div key={selectedDay} className="sk-wfade">
                {shape.periods.map((period) => {
                  const slot = shape.cells.get(`${selectedDay}:${period.id}`);
                  const state = selectedIsToday ? railState(period, nowMin) : 'future';
                  return (
                    <div className="sk-rowln" data-state={state} key={period.id}>
                      <span className="time">
                        {period.startTime ?? period.label}
                        {period.startTime && period.endTime && (
                          <>
                            <br />
                            {period.endTime}
                          </>
                        )}
                      </span>
                      {/* THE MARGIN RULE — decorative; the times either side of
                          it already say where the row sits in the day. */}
                      <span className="sk-rail-ml" aria-hidden="true" />
                      <div className="bd">
                        <div className="sub">
                          {slot ? `${slot.className} · ${slot.subjectName}` : 'Free period'}
                        </div>
                        <div className="tch">{period.label}</div>
                      </div>
                      <span className="st">
                        {state === 'past' ? 'done' : state === 'now' ? 'now' : slot ? '' : 'free'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* The overview under the day: the rail answers "what am I doing
              next", the grid answers "when am I free on Thursday". Same serif
              register as every other heading here. */}
          <h2
            style={{
              fontFamily: 'var(--sk-serif)',
              fontSize: 15.5,
              fontWeight: 650,
              letterSpacing: '-0.005em',
              marginBottom: 10,
            }}
          >
            The whole week
          </h2>
          <WeekGrid shape={shape} todayDayOfWeek={todayColumn} currentPeriodId={currentPeriodId} />
        </>
      )}
    </>
  );
}
