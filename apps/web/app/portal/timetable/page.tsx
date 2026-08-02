'use client';
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

  const slots = data ?? [];
  const today = todayDayOfWeek();
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

  // Only days the school actually teaches get a card — a school that never
  // runs Sunday should not be shown an empty one.
  const activeDays = DAY_LABELS.filter((d) => slotsByDay.has(d.value));

  // "now"/"finished" are facts about the clock, so they are only ever true of
  // TODAY's card. Friday's card must never paint a period amber as though it
  // were happening while you are reading it on a Tuesday.
  const todaySlots = slotsByDay.get(today) ?? [];
  const liveSlot = todaySlots.find(
    (s) => nowMin >= minutesOfDay(s.period.startTime) && nowMin < minutesOfDay(s.period.endTime),
  );
  const nextSlot = todaySlots.find((s) => minutesOfDay(s.period.startTime) > nowMin);
  const liveElapsed = liveSlot
    ? (nowMin - minutesOfDay(liveSlot.period.startTime)) /
      Math.max(1, minutesOfDay(liveSlot.period.endTime) - minutesOfDay(liveSlot.period.startTime))
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Timetable</h1>
        <p>Your weekly class schedule.</p>
      </header>

      {isLoading && <p className="sk-state">Loading timetable…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {!isLoading && !error && slots.length === 0 && (
        <p className="sk-state">No timetable slots found for your class.</p>
      )}

      {/* ── The week, a card to a day ─────────────────────────────────────
          THE WHOLE WEEK IS ON THE PAGE. A design pass replaced these stacked
          day cards with a day-chip strip showing one day at a time; a weekly
          timetable is a thing you scan — "when is the double Physics" is a
          question about the week, and answering it should not cost five taps.

          What the pass got right and is kept: each period is the ruled rail
          (`.sk-rowln`) rather than a bordered box — the time in the margin
          column, the red rule, the entry written to the right of it, and the
          past/now/next reading on today's card. That is row paint, not
          navigation, so it costs the reader nothing. */}
      {!isLoading && !error && slots.length > 0 && (
        <div className="flex flex-col gap-4">
          {activeDays.map(({ value, label }) => {
            const daySlots = slotsByDay.get(value) ?? [];
            const isToday = value === today;
            return (
              <div className="sk-card" key={value}>
                <div className="sk-card-h">
                  <h3>{label}</h3>
                </div>
                <div className="sk-card-b">
                  <div>
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
                          {/* THE MARGIN RULE — decorative; the times either
                              side of it already say where the row sits. */}
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
                          {/* THE INK LINE under the period happening right
                              now: how far through the class it is. Drawn to
                              its real width, so with the animation switched
                              off (as reduced motion does) the bar is true. */}
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
