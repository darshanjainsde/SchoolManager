'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AttendanceMark,
  AttendanceStatusValue,
  ClassDayStatus,
  RegisterChangeRow,
  SaveAttendanceResponse,
} from '@skoolos/types';
import { ATTENDANCE_STATUSES } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { RetakeDialog } from '@/components/teacher/RetakeDialog';
import { LockedDay } from '@/components/teacher/LockedDay';

const STATUS_LABEL: Record<AttendanceStatusValue, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late' };
// Traffic-light tones from the theme: green/red/amber.
const STATUS_COLOR: Record<AttendanceStatusValue, string> = {
  PRESENT: 'var(--sk-good)',
  ABSENT: 'var(--sk-bad)',
  LATE: 'var(--sk-amber)',
};

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

function initials(firstName: string, lastName: string): string {
  return `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase();
}

/** A sensible fallback for the school-admin/unknown marker case — never "Taken by null". */
function markedByLabel(status: ClassDayStatus): string {
  return status.markedBy ? `Taken by ${status.markedBy}` : 'Already taken today';
}

interface ClassSection {
  id: string;
  name: string;
  grade: { name: string };
}

interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function TeacherAttendancePage() {
  return (
    <Suspense fallback={<p className="sk-state">Loading…</p>}>
      <TeacherAttendanceInner />
    </Suspense>
  );
}

function TeacherAttendanceInner() {
  const host = useHost();
  const params = useSearchParams();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // `classId` is the legacy param name still used by links from /teacher.
  const [classSectionId, setClassSectionId] = useState(
    params.get('classSectionId') ?? params.get('classId') ?? '',
  );
  const [date, setDate] = useState(todayIso());

  // Past days close on the server (see AttendanceService.save's REGISTER_LOCKED
  // 409) — comparing the YYYY-MM-DD strings lexicographically matches
  // chronological order and mirrors the server's own `dto.date < today` check.
  const isPastDate = !!date && date < todayIso();

  // Retaking a class the moment a new class/date is chosen would carry over a
  // stale confirmation from whatever was selected before.
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    setRetakeOpen(false);
    setUnlocked(false);
  }, [classSectionId, date]);

  // Confirming the dialog unmounts it and the roster mounts in the same
  // render, so RetakeDialog's own focus-restore targets a detached node and
  // silently no-ops (see RetakeDialog's `previouslyFocused?.focus()`). Move
  // focus to the newly-rendered roster ourselves so keyboard/screen-reader
  // users don't lose their place.
  const rosterHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (unlocked) rosterHeadingRef.current?.focus();
  }, [unlocked]);

  const classes = useQuery({
    queryKey: ['t-attn-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassSection[]>('/manage/classes'),
    staleTime: 30_000,
  });

  // The taken/pending source for every one of the caller's classes on `date`
  // — used both to decide whether to show the roster or the "already taken"
  // summary, and to fill in who marked it for the retake dialog.
  const dayStatus = useQuery({
    queryKey: ['t-attn-status', date],
    enabled: !!host && !!date,
    queryFn: () => api.get<ClassDayStatus[]>(`/manage/attendance/status?date=${encodeURIComponent(date)}`),
  });

  const selectedStatus = useMemo(
    () => dayStatus.data?.find((s) => s.classSectionId === classSectionId) ?? null,
    [dayStatus.data, classSectionId],
  );
  // Whether the status query has settled — gates showing the roster so a
  // taken class never flashes as editable before its summary swaps in.
  const statusKnown = !dayStatus.isLoading && !dayStatus.error;
  const taken = !!selectedStatus?.taken;
  const editable = !isPastDate && statusKnown && (!taken || unlocked);

  // Only needed once a past date is on screen — no point asking every time.
  const myRequests = useQuery({
    queryKey: ['t-attn-register-changes-mine'],
    enabled: !!host && isPastDate,
    queryFn: () => api.get<RegisterChangeRow[]>('/manage/register-changes/mine'),
  });
  const openRequest = useMemo(
    () =>
      myRequests.data?.find(
        (r) => r.classSectionId === classSectionId && r.date === date && r.status === 'PENDING',
      ) ?? null,
    [myRequests.data, classSectionId, date],
  );

  const roster = useQuery({
    queryKey: ['t-attn-roster', classSectionId],
    enabled: !!host && !!classSectionId && editable,
    queryFn: () =>
      api.get<RosterStudent[]>(
        `/manage/students?classSectionId=${encodeURIComponent(classSectionId)}`,
      ),
  });

  const existing = useQuery({
    queryKey: ['t-attn-marks', classSectionId, date],
    enabled: !!host && !!classSectionId && !!date && editable,
    queryFn: () =>
      api.get<AttendanceMark[]>(
        `/manage/attendance?classSectionId=${encodeURIComponent(classSectionId)}&date=${encodeURIComponent(date)}`,
      ),
  });

  // Server marks are the source of truth whenever the class/date changes; local
  // edits layer on top until the next successful fetch.
  const [marks, setMarks] = useState<Record<string, AttendanceStatusValue>>({});
  useEffect(() => {
    if (!existing.data) return;
    setMarks(Object.fromEntries(existing.data.map((m) => [m.studentId, m.status])));
  }, [existing.data]);

  const students = useMemo(() => roster.data ?? [], [roster.data]);

  const counts = useMemo(() => {
    const tally: Record<AttendanceStatusValue, number> = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const s of students) tally[marks[s.id] ?? 'PRESENT'] += 1;
    return tally;
  }, [students, marks]);

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveAttendanceResponse>('/manage/attendance', {
        classSectionId,
        date,
        marks: students.map((s) => ({ studentId: s.id, status: marks[s.id] ?? 'PRESENT' })),
      }),
    onSuccess: (result) => {
      toast.success(
        result.absentees === 0
          ? `Attendance saved — ${result.saved} students, nobody absent.`
          : `Attendance saved — ${result.saved} students, ${result.absentees} absent. Guardians of absentees are being notified.`,
      );
      void qc.invalidateQueries({ queryKey: ['t-attn-marks', classSectionId, date] });
      void qc.invalidateQueries({ queryKey: ['t-attn-status', date] });
    },
    // The API returns a { code, message } envelope; surface message verbatim.
    onError: (e: Error) => toast.error(e.message),
  });

  const requestChange = useMutation({
    mutationFn: (reason: string) => api.post('/manage/register-changes', { classSectionId, date, reason }),
    onSuccess: () => {
      toast.success('Request sent — your admin will review it from Requests.');
      void qc.invalidateQueries({ queryKey: ['t-attn-register-changes-mine'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const listError = (roster.error ?? existing.error) as Error | undefined;
  const listLoading = editable && (roster.isLoading || existing.isLoading);

  const selectedClass = classes.data?.find((c) => c.id === classSectionId);
  const selectedClassLabel = selectedClass
    ? `${selectedClass.grade.name} · ${selectedClass.name}`
    : (selectedStatus?.name ?? '');

  return (
    <>
      <header className="sk-pagehead">
        <h1>Attendance</h1>
        <p>
          Re-saving the same day just updates statuses. Only guardians of students newly
          marked absent are emailed, so correcting a mark won&apos;t re-notify the rest.
        </p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Class &amp; date</h3>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="attn-class" className="sk-lab">
                Class
              </label>
              <Select
                id="attn-class"
                className={`${fieldCls} w-full`}
                value={classSectionId}
                onChange={(e) => setClassSectionId(e.target.value)}
              >
                <option value="">Pick a class…</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.grade.name} · {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="attn-date" className="sk-lab">
                Date
              </label>
              <Input
                id="attn-date"
                type="date"
                className={`${fieldCls} w-full`}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {editable && (
              <button
                type="button"
                className="sk-btn"
                data-variant="primary"
                disabled={!classSectionId || !date || students.length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save attendance'}
              </button>
            )}
          </div>

          {classes.error && <p className="sk-state err">{(classes.error as Error).message}</p>}
          {editable && listError && <p className="sk-state err">{listError.message}</p>}

          {editable && students.length > 0 && (
            <div>
              <button
                type="button"
                className="sk-btn"
                onClick={() =>
                  setMarks(
                    Object.fromEntries(students.map((s) => [s.id, 'PRESENT' as AttendanceStatusValue])),
                  )
                }
              >
                Mark all present
              </button>
            </div>
          )}
        </div>
      </div>

      {classSectionId && isPastDate ? (
        <LockedDay
          className={selectedClassLabel}
          date={date}
          status={selectedStatus}
          requestPending={!!openRequest}
          requestsLoading={myRequests.isLoading}
          isSubmitting={requestChange.isPending}
          onRequestChange={(reason) => requestChange.mutate(reason)}
        />
      ) : classSectionId && statusKnown && taken && !unlocked && selectedStatus ? (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Roster</h3>
          </div>
          <div className="sk-card-b">
            <p className="sk-state">
              ✓ {selectedStatus.present} of {selectedStatus.total} present
            </p>
            <p className="sk-muted">{markedByLabel(selectedStatus)}</p>
            <div>
              <button type="button" className="sk-btn" onClick={() => setRetakeOpen(true)}>
                Re-take attendance
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3 ref={rosterHeadingRef} tabIndex={-1}>
              Roster
            </h3>
            <p className="sk-muted" style={{ marginTop: 4 }}>
              {classSectionId
                ? `${students.length} students · ${counts.PRESENT} present · ${counts.ABSENT} absent · ${counts.LATE} late`
                : 'Pick a class and a date to begin.'}
            </p>
          </div>
          <div className="sk-card-b">
            {classSectionId && dayStatus.error && (
              <p className="sk-state err">{(dayStatus.error as Error).message}</p>
            )}

            {classSectionId && !statusKnown && !dayStatus.error && (
              <p className="sk-state">Loading…</p>
            )}

            {classSectionId && listLoading && <p className="sk-state">Loading roster…</p>}

            {classSectionId && statusKnown && !listLoading && !listError && students.length === 0 && (
              <p className="sk-state">No students in this class yet — your admin needs to enrol them.</p>
            )}

            {students.length > 0 && (
              <div>
                {students.map((s, i) => {
                  const status = marks[s.id] ?? 'PRESENT';
                  return (
                    <div className="sk-row" key={s.id}>
                      <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                        {initials(s.firstName, s.lastName)}
                      </span>
                      <div>
                        <div className="nm">
                          {s.firstName} {s.lastName}
                        </div>
                        <div className="meta">Roll {s.rollNo ?? '—'}</div>
                      </div>
                      <span className="sp" />
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {ATTENDANCE_STATUSES.map((option) => {
                          const active = status === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setMarks((m) => ({ ...m, [s.id]: option }))}
                              style={{
                                borderRadius: 8,
                                padding: '6px 11px',
                                fontSize: 11.5,
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: `1.5px solid ${active ? STATUS_COLOR[option] : 'var(--sk-line-2)'}`,
                                background: active ? STATUS_COLOR[option] : 'var(--sk-card)',
                                color: active ? '#fff' : 'var(--sk-ink-2)',
                                transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
                              }}
                            >
                              {STATUS_LABEL[option]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {retakeOpen && selectedStatus && (
        <RetakeDialog
          className={selectedClassLabel}
          status={selectedStatus}
          // Confirm only flips local `unlocked` state — no network call happens
          // until the teacher edits and presses "Save attendance" below, so
          // there is no in-flight request for this dialog to guard against.
          isPending={false}
          onConfirm={() => {
            setUnlocked(true);
            setRetakeOpen(false);
          }}
          onCancel={() => setRetakeOpen(false)}
        />
      )}
    </>
  );
}
