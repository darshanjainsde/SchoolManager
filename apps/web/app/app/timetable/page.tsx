'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SchoolClass {
  id: string;
  name: string;
  academicYearId: string;
  grade: { name: string };
}

interface Period {
  id: string;
  label: string;
  order: number;
  startTime: string;
  endTime: string;
}

interface Subject {
  id: string;
  name: string;
  code?: string | null;
}

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface TimetableSlot {
  id: string;
  classSectionId: string;
  dayOfWeek: number;
  periodId: string;
  subjectId: string;
  teacherId: string;
  academicYearId: string;
  period: { order: number; label: string; startTime: string; endTime: string };
  subject: { name: string; code?: string | null };
  teacher: { firstName: string; lastName: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS: { label: string; value: number }[] = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
];

// ── Assign Modal ──────────────────────────────────────────────────────────────

interface AssignModalProps {
  periodLabel: string;
  dayLabel: string;
  subjects: Subject[];
  teachers: Teacher[];
  onAssign: (subjectId: string, teacherId: string) => void;
  isAssigning: boolean;
  onClose: () => void;
}

function AssignModal({
  periodLabel,
  dayLabel,
  subjects,
  teachers,
  onAssign,
  isAssigning,
  onClose,
}: AssignModalProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
          <CardTitle className="text-base">
            Assign period — {dayLabel}, {periodLabel}
          </CardTitle>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="tt-subject">Subject</Label>
            <Select
              id="tt-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              {subjects.length === 0 && <option value="">No subjects — add one in Classes</option>}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.code ? ` (${s.code})` : ''}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tt-teacher">Teacher</Label>
            <Select
              id="tt-teacher"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              {teachers.length === 0 && <option value="">No teachers found</option>}
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>

        <CardFooter className="gap-2 border-t pt-3">
          <Button
            onClick={() => onAssign(subjectId, teacherId)}
            disabled={isAssigning || !subjectId || !teacherId}
          >
            {isAssigning ? 'Assigning…' : 'Assign'}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PendingCell {
  dayOfWeek: number;
  periodId: string;
  dayLabel: string;
  periodLabel: string;
}

export default function TimetablePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // ── Local state ──────────────────────────────────────────────────────────
  const [classSectionId, setClassSectionId] = useState('');
  const [pendingCell, setPendingCell] = useState<PendingCell | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const periodsQuery = useQuery({
    queryKey: ['mng-periods'],
    queryFn: () => api.get<Period[]>('/manage/periods'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const subjectsQuery = useQuery({
    queryKey: ['mng-subjects'],
    queryFn: () => api.get<Subject[]>('/manage/subjects'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const teachersQuery = useQuery({
    queryKey: ['mng-teachers'],
    queryFn: () => api.get<Teacher[]>('/manage/teachers'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const timetableQuery = useQuery({
    queryKey: ['timetable', classSectionId],
    queryFn: () =>
      api.get<TimetableSlot[]>(`/manage/timetable?classSectionId=${encodeURIComponent(classSectionId)}`),
    enabled: !!host && !!classSectionId,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const sortedPeriods = useMemo(
    () => [...(periodsQuery.data ?? [])].sort((a, b) => a.order - b.order),
    [periodsQuery.data],
  );

  // O(1) lookup: `${dayOfWeek}-${periodId}` → slot
  const slotMap = useMemo(() => {
    const map = new Map<string, TimetableSlot>();
    for (const slot of timetableQuery.data ?? []) {
      map.set(`${slot.dayOfWeek}-${slot.periodId}`, slot);
    }
    return map;
  }, [timetableQuery.data]);

  // academicYearId comes from the selected class object
  const selectedClass = useMemo(
    () => (classesQuery.data ?? []).find((c) => c.id === classSectionId),
    [classesQuery.data, classSectionId],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: (body: {
      classSectionId: string;
      dayOfWeek: number;
      periodId: string;
      subjectId: string;
      teacherId: string;
      academicYearId: string;
    }) => api.post<TimetableSlot>('/manage/timetable', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['timetable', classSectionId] });
      setPendingCell(null);
      toast.success('Slot assigned');
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(`Clash: ${err.message}`);
      } else if (err instanceof ApiError && err.status === 400) {
        toast.error(`Invalid reference: ${err.message}`);
      } else {
        toast.error(`Failed to assign slot: ${err.message}`);
      }
      // Do NOT fill the cell; query cache is unchanged
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slotId: string) => api.del<{ ok: boolean }>(`/manage/timetable/${slotId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['timetable', classSectionId] });
      toast.success('Slot removed');
    },
    onError: (err: Error) => toast.error(`Failed to remove slot: ${err.message}`),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Timetable builder</h1>
        <p className="mt-1 text-sm text-slate-500">
          Assign teacher + subject to each period. Clashes are flagged automatically.
        </p>
      </header>

      {/* Class selector */}
      <div className="flex items-center gap-3">
        <Label htmlFor="tt-class" className="shrink-0 text-sm font-medium text-slate-700">
          Class:
        </Label>
        <Select
          id="tt-class"
          value={classSectionId}
          onChange={(e) => setClassSectionId(e.target.value)}
          className="max-w-xs"
        >
          <option value="">— Select a class —</option>
          {(classesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade.name} — {c.name}
            </option>
          ))}
        </Select>
        {classesQuery.isLoading && (
          <span className="text-sm text-slate-400">Loading classes…</span>
        )}
      </div>

      {/* Prompt when no class selected */}
      {!classSectionId && (
        <p className="text-sm text-slate-400">Select a class above to view and edit its timetable.</p>
      )}

      {/* Loading timetable */}
      {classSectionId && timetableQuery.isLoading && (
        <p className="text-sm text-slate-500">Loading timetable…</p>
      )}

      {/* Error */}
      {classSectionId && timetableQuery.error && (
        <p className="text-sm text-rose-600">{(timetableQuery.error as Error).message}</p>
      )}

      {/* Grid */}
      {classSectionId && !timetableQuery.isLoading && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="border-b border-r border-slate-200 p-3 text-left whitespace-nowrap">
                  Period
                </th>
                {DAYS.map((d) => (
                  <th
                    key={d.value}
                    className="border-b border-slate-200 p-3 text-center font-medium"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPeriods.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-4 text-center text-sm text-slate-400"
                  >
                    No periods configured. Add periods via the API or settings.
                  </td>
                </tr>
              )}
              {sortedPeriods.map((period) => (
                <tr key={period.id} className="hover:bg-slate-50/50">
                  {/* Period label */}
                  <td className="border-b border-r border-slate-200 p-3 whitespace-nowrap text-slate-500">
                    <div className="font-medium text-slate-700">{period.label}</div>
                    <div className="text-xs text-slate-400">
                      {period.startTime} – {period.endTime}
                    </div>
                  </td>

                  {/* Day columns */}
                  {DAYS.map((day) => {
                    const key = `${day.value}-${period.id}`;
                    const slot = slotMap.get(key);

                    if (slot) {
                      return (
                        <td key={day.value} className="border-b border-slate-200 p-2">
                          <div className="group relative rounded-lg bg-teal-50 px-2 py-2 text-xs">
                            <div className="font-semibold text-teal-800">
                              {slot.subject.name}
                            </div>
                            <div className="text-teal-600">
                              {slot.teacher.firstName} {slot.teacher.lastName}
                            </div>
                            {/* Delete action */}
                            <button
                              onClick={() => deleteMutation.mutate(slot.id)}
                              disabled={deleteMutation.isPending}
                              className="absolute right-1 top-1 hidden rounded p-0.5 text-teal-400 hover:bg-teal-100 hover:text-rose-500 group-hover:block disabled:opacity-50"
                              aria-label={`Remove ${slot.subject.name} from ${day.label} ${period.label}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={day.value} className="border-b border-slate-200 p-2">
                        <button
                          onClick={() =>
                            setPendingCell({
                              dayOfWeek: day.value,
                              periodId: period.id,
                              dayLabel: day.label,
                              periodLabel: period.label,
                            })
                          }
                          className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-200 py-3 text-slate-300 hover:border-teal-300 hover:text-teal-400 transition-colors"
                          aria-label={`Assign ${day.label} ${period.label}`}
                        >
                          ＋
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign modal */}
      {pendingCell && (
        <AssignModal
          periodLabel={pendingCell.periodLabel}
          dayLabel={pendingCell.dayLabel}
          subjects={subjectsQuery.data ?? []}
          teachers={teachersQuery.data ?? []}
          onAssign={(subjectId, teacherId) => {
            if (!selectedClass) return;
            assignMutation.mutate({
              classSectionId,
              dayOfWeek: pendingCell.dayOfWeek,
              periodId: pendingCell.periodId,
              subjectId,
              teacherId,
              academicYearId: selectedClass.academicYearId,
            });
          }}
          isAssigning={assignMutation.isPending}
          onClose={() => {
            setPendingCell(null);
            assignMutation.reset();
          }}
        />
      )}
    </div>
  );
}
