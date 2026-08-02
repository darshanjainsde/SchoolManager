'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TimetableSlot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JS getDay() → 1-7 (Mon=1, Sun=7), matching TimetableSlot.dayOfWeek. */
function todayDayOfWeek(): number {
  return new Date().getDay() || 7;
}

/** Minutes since midnight for a "HH:MM" time string. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since midnight on the device's own clock. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The calendar date this weekday falls on in the week containing today,
 * Monday-first. The strip shows a real numeral rather than a bare weekday
 * because "Thursday" alone does not tell you whether you are looking at
 * this week; "18" does.
 */
function dateOfWeekday(dayOfWeek: number, from: Date): number {
  const d = new Date(from);
  d.setDate(from.getDate() + (dayOfWeek - (from.getDay() || 7)));
  return d.getDate();
}

/**
 * Where a period sits relative to the clock — the same rule the portal home
 * rail uses. A period owns its start minute but not its end minute, so two
 * back-to-back periods can never both be "now".
 */
function railState(startTime: string, endTime: string, now: number): 'past' | 'now' | 'future' {
  if (now >= minutesOfDay(endTime)) return 'past';
  if (now >= minutesOfDay(startTime)) return 'now';
  return 'future';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalTimetablePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-timetable'],
    queryFn: () => api.get<TimetableSlot[]>('/me/timetable'),
    enabled: !!host,
    staleTime: 60_000,
  });

  // Null until the reader picks a day themselves, so the strip keeps
  // defaulting to today as the week rolls over rather than sticking on
  // whichever day happened to be current when the page first mounted.
  const [picked, setPicked] = useState<number | null>(null);

  const slots = data ?? [];
  const today = todayDayOfWeek();
  const now = new Date();
  const nowMin = nowMinutes();

  // Group by dayOfWeek, each day in period order.
  const slotsByDay = new Map<number, TimetableSlot[]>();
  for (const slot of slots) {
    const existing = slotsByDay.get(slot.dayOfWeek) ?? [];
    slotsByDay.set(slot.dayOfWeek, [...existing, slot]);
  }
  for (const [day, daySlots] of slotsByDay.entries()) {
    slotsByDay.set(day, [...daySlots].sort((a, b) => a.period.order - b.period.order));
  }

  // Only days the school actually teaches get a chip — a school that never
  // runs Sunday should not be offered one.
  const activeDays = DAY_LABELS.filter((d) => slotsByDay.has(d.value));
  const fallbackDay = slotsByDay.has(today) ? today : activeDays[0]?.value ?? today;
  const selectedDay = picked ?? fallbackDay;
  const daySlots = slotsByDay.get(selectedDay) ?? [];
  const selectedLabel = DAY_LABELS.find((d) => d.value === selectedDay)?.label ?? '';

  // "now"/"finished" are facts about the clock, so they are only true of the
  // day the clock is on. Reading Friday's page on a Tuesday must not paint a
  // period amber as though it were happening.
  const isToday = selectedDay === today;
  const liveSlot = isToday
    ? daySlots.find(
        (s) => nowMin >= minutesOfDay(s.period.startTime) && nowMin < minutesOfDay(s.period.endTime),
      )
    : undefined;
  const nextSlot = isToday ? daySlots.find((s) => minutesOfDay(s.period.startTime) > nowMin) : undefined;
  const liveElapsed = liveSlot
    ? (nowMin - minutesOfDay(liveSlot.period.startTime)) /
      Math.max(1, minutesOfDay(liveSlot.period.endTime) - minutesOfDay(liveSlot.period.startTime))
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Timetable</h1>
        <p>Your week, one day to a page.</p>
      </header>

      {isLoading && <p className="sk-state">Loading timetable…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {!isLoading && !error && slots.length === 0 && (
        <p className="sk-state">No timetable slots found for your class.</p>
      )}

      {!isLoading && !error && slots.length > 0 && (
        <>
          {/* ── The week strip ─────────────────────────────────────────────
              The pitch's `.dstrip`: the whole week stays on screen while you
              read one day of it, which a dropdown cannot do. Today is amber
              and the day you are reading is indigo — two different facts, so
              two different colours; you can be reading Friday on a Tuesday. */}
          <div className="sk-dstrip" role="group" aria-label="Day of the week">
            {activeDays.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                // sk-press: the chip shrinks under the finger, so a tap that
                // lands on a day already selected still reads as a tap.
                className="sk-day sk-press"
                aria-pressed={value === selectedDay}
                data-today={value === today}
                aria-label={label}
                onClick={() => setPicked(value)}
              >
                <div className="dw" aria-hidden="true">{label.slice(0, 3)}</div>
                <div className="dn" aria-hidden="true">{dateOfWeekday(value, now)}</div>
              </button>
            ))}
          </div>

          {/* ── The day's ruled rail ───────────────────────────────────────
              Times in the margin column, the red rule, the entry written to
              the right of it — a page out of an exercise book, the same
              component the portal home uses for today's classes. */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>{selectedLabel}</h3>
            </div>
            <div className="sk-card-b">
              {daySlots.length === 0 ? (
                <p className="sk-state">No classes scheduled for {selectedLabel}.</p>
              ) : (
                // keyed on the day so `sk-wfade` REPLAYS on every switch: two
                // weekdays can look nearly identical, and without the page
                // visibly turning, changing day is indistinguishable from
                // nothing having happened.
                <div key={selectedDay} className="sk-wfade">
                  {daySlots.map((slot) => {
                    const state = isToday
                      ? railState(slot.period.startTime, slot.period.endTime, nowMin)
                      : 'future';
                    return (
                      <div className="sk-rowln" data-state={state} key={slot.id}>
                        <span className="time">
                          {slot.period.startTime}
                          <br />
                          {slot.period.endTime}
                        </span>
                        {/* THE MARGIN RULE — decorative; the times either side
                            of it already say where the row sits in the day. */}
                        <span className="sk-rail-ml" aria-hidden="true" />
                        <div className="bd">
                          <div className="sub">{slot.subject.name}</div>
                          <div className="tch">
                            {slot.teacher.firstName} {slot.teacher.lastName} · {slot.period.label}
                          </div>
                        </div>
                        <span className="st">
                          {state === 'past'
                            ? '✓'
                            : state === 'now'
                              ? 'now'
                              : slot.id === nextSlot?.id
                                ? 'next'
                                : ''}
                        </span>
                        {/* THE INK LINE under the period happening right now:
                            how far through the class it is. Drawn to its real
                            width, so with the animation switched off (as
                            reduced motion does) the bar is still true. */}
                        {state === 'now' && (
                          <span
                            className="sk-liveink sk-inkline"
                            style={{ width: `${Math.round(liveElapsed * 100)}%` }}
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
