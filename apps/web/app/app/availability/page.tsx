'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AvailabilityTeacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface AvailabilityPeriod {
  id: string;
  order: number;
  label: string;
}

interface BusyEntry {
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}

interface AvailabilityResponse {
  teachers: AvailabilityTeacher[];
  periods: AvailabilityPeriod[];
  busy: BusyEntry[];
}

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AvailabilityPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [day, setDay] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['availability'],
    queryFn: () => api.get<AvailabilityResponse>('/manage/availability'),
    enabled: !!host,
  });

  // O(1) busy lookup: `${teacherId}-${dayOfWeek}-${periodId}`
  const busySet = useMemo(() => {
    const s = new Set<string>();
    for (const b of data?.busy ?? []) s.add(`${b.teacherId}-${b.dayOfWeek}-${b.periodId}`);
    return s;
  }, [data]);

  const teachers = data?.teachers ?? [];
  const periods = [...(data?.periods ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Teacher availability</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who is free and who is teaching, per period. Green = free.
          </p>
        </div>
        <div>
          <Label htmlFor="day">Day</Label>
          <Select id="day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{DAYS.find((d) => d.value === day)?.label}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
          {error && <div className="text-sm text-rose-600">{(error as Error).message}</div>}

          {!isLoading && !error && teachers.length === 0 && (
            <div className="text-sm text-slate-500">No teachers yet — add teachers first.</div>
          )}
          {!isLoading && !error && teachers.length > 0 && periods.length === 0 && (
            <div className="text-sm text-slate-500">No periods defined yet.</div>
          )}

          {!isLoading && !error && teachers.length > 0 && periods.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="border-b p-3 text-left font-medium">Teacher</th>
                    {periods.map((p) => (
                      <th key={p.id} className="border-b p-3 text-center font-medium">
                        {p.label}
                      </th>
                    ))}
                    <th className="border-b p-3 text-center font-medium">Load</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => {
                    const busyCount = periods.filter((p) =>
                      busySet.has(`${t.id}-${day}-${p.id}`),
                    ).length;
                    return (
                      <tr key={t.id} className="border-b">
                        <td className="p-3 font-medium text-slate-800">
                          {t.firstName} {t.lastName}
                        </td>
                        {periods.map((p) => {
                          const busy = busySet.has(`${t.id}-${day}-${p.id}`);
                          return (
                            <td key={p.id} className="p-2">
                              <div
                                className={`h-8 rounded ${busy ? 'bg-slate-200' : 'bg-teal-400'}`}
                                title={busy ? 'Teaching' : 'Free'}
                              />
                            </td>
                          );
                        })}
                        <td className="p-3 text-center text-slate-500">
                          {busyCount}/{periods.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-4 flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded bg-teal-400" /> Free
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded bg-slate-200" /> Teaching
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
