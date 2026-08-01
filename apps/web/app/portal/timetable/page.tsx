'use client';
import { useQuery } from '@tanstack/react-query';
import type { TimetableSlot } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  // Group by dayOfWeek
  const slotsByDay = new Map<number, TimetableSlot[]>();
  for (const slot of slots) {
    const existing = slotsByDay.get(slot.dayOfWeek) ?? [];
    slotsByDay.set(slot.dayOfWeek, [...existing, slot]);
  }
  // Sort each day's slots by period order
  for (const [day, daySlots] of slotsByDay.entries()) {
    slotsByDay.set(day, [...daySlots].sort((a, b) => a.period.order - b.period.order));
  }

  // Only show days that have slots (or all weekdays if none)
  const activeDays = DAY_LABELS.filter((d) => slotsByDay.has(d.value));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--sk-ink)' }}>Timetable</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--sk-ink-3)' }}>Your weekly class schedule.</p>
      </header>

      {isLoading && <p className="sk-state">Loading timetable…</p>}
      {error && (
        <p className="sk-state err">{(error as Error).message}</p>
      )}

      {!isLoading && !error && slots.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center" style={{ borderColor: 'var(--sk-line-2)' }}>
          <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>No timetable slots found for your class.</p>
        </div>
      )}

      {!isLoading && !error && slots.length > 0 && (
        <div className="flex flex-col gap-4">
          {activeDays.length > 0 ? (
            activeDays.map(({ value, label }) => {
              const daySlots = slotsByDay.get(value) ?? [];
              return (
                <Card key={value}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2">
                      {daySlots.map((slot) => (
                        <li
                          key={slot.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                          style={{ borderColor: 'var(--sk-line)', background: 'var(--sk-paper)' }}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-medium"
                              style={{ background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' }}
                            >
                              {slot.period.label}
                            </span>
                            <div>
                              <p className="font-medium" style={{ color: 'var(--sk-ink)' }}>{slot.subject.name}</p>
                              <p className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                                {slot.teacher.firstName} {slot.teacher.lastName}
                              </p>
                            </div>
                          </div>
                          {(slot.period.startTime || slot.period.endTime) && (
                            <span className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                              {slot.period.startTime}
                              {slot.period.startTime && slot.period.endTime && ' – '}
                              {slot.period.endTime}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            DAY_LABELS.map(({ value, label }) => {
              const daySlots = slotsByDay.get(value) ?? [];
              if (daySlots.length === 0) return null;
              return (
                <Card key={value}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2">
                      {daySlots.map((slot) => (
                        <li
                          key={slot.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                          style={{ borderColor: 'var(--sk-line)', background: 'var(--sk-paper)' }}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-medium"
                              style={{ background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' }}
                            >
                              {slot.period.label}
                            </span>
                            <div>
                              <p className="font-medium" style={{ color: 'var(--sk-ink)' }}>{slot.subject.name}</p>
                              <p className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                                {slot.teacher.firstName} {slot.teacher.lastName}
                              </p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
