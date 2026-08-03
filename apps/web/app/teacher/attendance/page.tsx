'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AttendanceMark,
  AttendanceStatusValue,
  ClassDayStatus,
  MyClassSection,
  RegisterChangeRow,
  RosterStudent,
  SaveAttendanceResponse,
} from '@skoolos/types';
import { ATTENDANCE_STATUSES } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { RetakeDialog } from '@/components/teacher/RetakeDialog';
import { LockedDay } from '@/components/teacher/LockedDay';
import { WhoNeedsAWord } from '@/components/teacher/WhoNeedsAWord';

const STATUS_LABEL: Record<AttendanceStatusValue, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late' };

/**
 * One tap moves a cell on: present → absent → late → present. Absent comes
 * FIRST because it is overwhelmingly the common exception — a late arrival is
 * rarer than an absence, and putting it second costs one extra tap on the rarer
 * case rather than the frequent one.
 */
const CYCLE: Record<AttendanceStatusValue, AttendanceStatusValue> = {
  PRESENT: 'ABSENT',
  ABSENT: 'LATE',
  LATE: 'PRESENT',
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

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * True once an APPROVED register-change row's `expiresAt` is still in the
 * future — absolute epoch comparison, so it is correct regardless of the
 * browser's timezone (mirrors mobile's `isUnexpired` in
 * `(staff)/attendance.tsx` and the server's own `expiresAt > now()` unlock
 * check in AttendanceService.save). `expiresAt` is only ever null for
 * PENDING/REJECTED rows (see RegisterChangeService.review); guard it anyway
 * so a stray null can never reach `new Date(null)` and misbehave.
 */
function isUnexpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() > Date.now();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

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

  // A substitute covering a class for the day may still take its attendance
  // (AttendanceService.save allows `covering: true` sections) — unlike
  // tests/results, covering rows are kept here, just labelled so the
  // teacher understands why an unusual class is in the list.
  const classes = useQuery({
    queryKey: ['t-attn-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
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

  /**
   * The class rail's rows: the day's status per class, annotated with whether
   * this teacher merely covers it. Both halves are already on the page for
   * other reasons — this only joins them, so the rail adds no request.
   */
  const classDayRows = useMemo(
    () =>
      (dayStatus.data ?? []).map((s) => ({
        ...s,
        covering: classes.data?.find((c) => c.classSectionId === s.classSectionId)?.covering ?? false,
      })),
    [dayStatus.data, classes.data],
  );
  // Whether the status query has settled — gates showing the roster so a
  // taken class never flashes as editable before its summary swaps in.
  const statusKnown = !dayStatus.isLoading && !dayStatus.error;
  const taken = !!selectedStatus?.taken;

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
  // An admin can reopen a locked past day (RegisterChangeService.review sets
  // status APPROVED and expiresAt to end-of-approving-day IST); the server's
  // own unlock check on PUT /manage/attendance is `APPROVED AND expiresAt >
  // now()`, so the UI must honour the same row or a teacher who was granted
  // access can never actually use it. `myRequests.data` is undefined while
  // still loading, so this — and `unlockedPastDate` below — is correctly
  // `null`/`false` until the query settles.
  const unlockRequest = useMemo(
    () =>
      myRequests.data?.find(
        (r) =>
          r.classSectionId === classSectionId &&
          r.date === date &&
          r.status === 'APPROVED' &&
          isUnexpired(r.expiresAt),
      ) ?? null,
    [myRequests.data, classSectionId, date],
  );
  const unlockedPastDate = isPastDate && !!unlockRequest;
  const editable = statusKnown && (!isPastDate || unlockedPastDate) && (!taken || unlocked);

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
  /** The last cell tapped, so the caption under the grid can name it and offer
   *  the way back. Cleared whenever the class or date changes. */
  const [lastMark, setLastMark] = useState<
    { id: string; name: string; from: AttendanceStatusValue; to: AttendanceStatusValue } | null
  >(null);
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

  /**
   * Which register the stamp on screen belongs to, as `classSectionId|date`,
   * plus a counter so a second save of the SAME register still re-mounts the
   * stamp and lands it again. Stored rather than read off the mutation because
   * a mutation stays `isSuccess` after the teacher has moved to another class
   * — a stamp left over from the last register would claim work that has not
   * been done here.
   */
  const [stamped, setStamped] = useState<{ key: string; n: number } | null>(null);
  const stampKey = `${classSectionId}|${date}`;

  const save = useMutation({
    mutationFn: () =>
      api.put<SaveAttendanceResponse>('/manage/attendance', {
        classSectionId,
        date,
        marks: students.map((s) => ({ studentId: s.id, status: marks[s.id] ?? 'PRESENT' })),
      }),
    onSuccess: (result) => {
      setStamped((prev) => ({ key: stampKey, n: prev && prev.key === stampKey ? prev.n + 1 : 0 }));
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

  const selectedClass = classes.data?.find((c) => c.classSectionId === classSectionId);
  const selectedClassLabel = selectedClass ? selectedClass.name : (selectedStatus?.name ?? '');

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
          <div className="grid gap-3 sm:grid-cols-[200px_auto] sm:items-end">
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
                className="sk-btn sk-press"
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
                className="sk-btn sk-press"
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

          {/* THE CLASS RAIL. The select above is the control (and the thing a
              screen reader and the keyboard drive); this is the pitch's
              `.clsrow` list — the same classes, but showing at a glance which
              registers this date is still waiting on, which is the question a
              teacher actually opens this page with. Built entirely from the
              `status` payload the page already fetches for its own gating, so
              it costs no extra request. */}
          {classDayRows.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
                <p className="sk-lab" style={{ margin: 0 }}>
                  {classSectionId ? 'Taking' : 'Pick a class'}
                </p>
                {classSectionId && (
                  // Collapsed to the one class you picked, with the way back
                  // beside it. Leaving fifteen rows on screen after the choice
                  // pushes the roster — the thing you came to do — below the
                  // fold, so the page looks unchanged unless you scroll.
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    data-testid="change-class"
                    style={{ padding: '2px 10px', fontSize: 11.5 }}
                    onClick={() => setClassSectionId('')}
                  >
                    Change class
                  </button>
                )}
              </div>
              {classDayRows
                .filter((c) => !classSectionId || c.classSectionId === classSectionId)
                .map((c) => (
                <button
                  key={c.classSectionId}
                  type="button"
                  className="sk-clsrow sk-press"
                  aria-current={c.classSectionId === classSectionId ? 'true' : undefined}
                  onClick={() => setClassSectionId(c.classSectionId)}
                >
                  {/* The class's own name, set in the serif — it is a name,
                      not a code. Truncated to the grade+section so a long
                      label can never blow the tile out of its circle. */}
                  <span className="ic" aria-hidden="true">
                    {c.name.slice(0, 3)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="nm" style={{ display: 'block' }}>
                      {c.name}
                      {c.covering ? ' · covering' : ''}
                    </span>
                    {/* The pitch's `.clsrow .mt` sizes the job; the pill beside
                        it carries the verdict. Deliberately NOT the count or
                        the marker's name — the roster panel to the right
                        already states both for the selected class, and the
                        same fact printed twice on one screen makes neither of
                        them the thing you look at. */}
                    <span className="mt" style={{ display: 'block' }}>
                      {c.total} students{c.taken ? '' : ' · not taken yet'}
                    </span>
                  </span>
                  <span className="sk-pill" data-tone={c.taken ? 'good' : 'warn'}>
                    {c.taken ? `✓ ${c.present}/${c.total}` : 'due'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {classSectionId && isPastDate && !unlockedPastDate ? (
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
            {unlockedPastDate && unlockRequest?.expiresAt && (
              <p className="sk-pill" data-tone="info" style={{ alignSelf: 'flex-start' }}>
                This day was reopened by your admin — the unlock expires at{' '}
                {formatDateTime(unlockRequest.expiresAt)}.
              </p>
            )}
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
            {/* THE TALLY, in mono. The same three numbers as the sentence
                above, but as figures on a shared grid: while marking, a
                teacher is comparing a count against a class size, and a
                sentence has to be re-parsed on every change where a figure
                can simply be re-read. The sentence stays because it is what a
                screen reader announces well. */}
            {students.length > 0 && (
              <div className="sk-regstats" aria-hidden="true">
                <div className="sk-regstat" data-tone="good">
                  <div className="n">{counts.PRESENT}</div>
                  <div className="l">present</div>
                </div>
                <div className="sk-regstat" data-tone="bad">
                  <div className="n">{counts.ABSENT}</div>
                  <div className="l">absent</div>
                </div>
                <div className="sk-regstat" data-tone="warn">
                  <div className="n">{counts.LATE}</div>
                  <div className="l">late</div>
                </div>
              </div>
            )}

            {/* THE STAMP. A saved register is finished work, and the pitch's
                argument is that finished work should be STAMPED rather than
                announced — the toast is gone in four seconds, the stamp stays
                on the page you saved. Keyed on the save's own timestamp so a
                second save re-mounts it and it lands again; a stamp that only
                ever animated once would silently stop confirming. */}
            {stamped?.key === stampKey && (
              <div key={stamped.n} style={{ alignSelf: 'flex-start' }}>
                <span className="sk-bigstamp sk-stampin sk-in" data-testid="register-saved-stamp">
                  Register saved ✓
                </span>
              </div>
            )}

            {unlockedPastDate && unlockRequest?.expiresAt && (
              <p className="sk-pill" data-tone="info" style={{ alignSelf: 'flex-start' }}>
                This day was reopened by your admin — the unlock expires at{' '}
                {formatDateTime(unlockRequest.expiresAt)}.
              </p>
            )}

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
              <>
                {/* THE REGISTER GRID. Everyone starts present; the teacher taps
                    only the exceptions, and each tap cycles present → absent →
                    late → present. A cell shows the roll number while present
                    and swaps to a glyph once marked, so the exceptions are
                    findable without reading a single number.

                    The name is not on the cell — that is what makes the grid
                    fast — but it IS the accessible name of every button, so a
                    screen reader announces "Aarav Sharma, roll 1, present"
                    while a sighted teacher sees a compact block. */}
                <div className="sk-rgrid" data-testid="register-grid">
                  {students.map((s) => {
                    const status = marks[s.id] ?? 'PRESENT';
                    const label = `${s.firstName} ${s.lastName}`;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="sk-rcell"
                        data-status={status}
                        data-testid={`cell-${s.id}`}
                        title={`${label} · roll ${s.rollNo ?? '—'}`}
                        aria-label={`${label}, roll ${s.rollNo ?? 'none'}, ${STATUS_LABEL[status].toLowerCase()}`}
                        onClick={() => {
                          const next = CYCLE[status];
                          setMarks((m) => ({ ...m, [s.id]: next }));
                          setLastMark({ id: s.id, name: label, from: status, to: next });
                        }}
                      >
                        {status === 'ABSENT' ? '✕' : status === 'LATE' ? '⏱' : (s.rollNo ?? '·')}
                      </button>
                    );
                  })}
                </div>

                {/* What you just did, in words. The grid's speed comes from
                    dropping the names, so the one real risk is tapping the
                    wrong cell — this is the line that catches it, with the way
                    back beside it. Announced politely so it never interrupts a
                    teacher mid-flow. */}
                <p className="sk-regsaid" aria-live="polite" data-testid="register-said">
                  {lastMark ? (
                    <>
                      <span>
                        {lastMark.name} · {STATUS_LABEL[lastMark.to].toLowerCase()}
                      </span>
                      <button
                        type="button"
                        className="undo"
                        data-testid="register-undo"
                        onClick={() => {
                          setMarks((m) => ({ ...m, [lastMark.id]: lastMark.from }));
                          setLastMark(null);
                        }}
                      >
                        Undo
                      </button>
                    </>
                  ) : (
                    <span className="sk-muted">
                      Everyone starts present — tap the absentees. Tap again for late.
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Who is slipping in THIS class — the natural next question once the
          register is in front of you, so it sits under it rather than on a nav
          item of its own. It reads the term to date, not the selected day, so
          it does not change as the teacher steps through dates. */}
      {classSectionId && <WhoNeedsAWord classSectionId={classSectionId} className={selectedClassLabel} />}

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
