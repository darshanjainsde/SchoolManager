'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  DiaryEntryRow,
  DiaryPageResult,
  MyClassSection,
  RosterStudent,
} from '@skoolos/types';
import { Textarea } from '@/components/ui/textarea';
import { StudentPicker, type PickableStudent } from '@/components/student-picker';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/** Mirrors the API's `@Length(1, 2000)` so a long entry fails in the box, not after a round-trip. */
const MAX_BODY = 2000;

/** Today in the browser's own timezone — `toISOString()` would give the UTC day. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function dayLabel(iso: string): string {
  if (iso === todayIso()) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** What the family actually received, kept so the teacher can read it back. */
interface EmailReceipt {
  /** The remark verbatim — quoted into the preview exactly as it was emailed. */
  body: string;
  /** Named children; empty when the API answered without expanding them. */
  names: string[];
  subject: string | null;
}

/**
 * The teacher's Daily Diary on the web (Phase 5·3) — the same page the app
 * writes, with the room a desktop has: the day's entries and the composer side
 * by side, so a teacher writing tomorrow's homework can see what they already
 * set today without navigating away.
 *
 * The two rules the API enforces are stated in the UI rather than discovered
 * through errors: a remark says up front that the parents are emailed, and a
 * past day replaces the composer with one sentence about why.
 */
export default function TeacherDiaryPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [date, setDate] = useState(todayIso());
  const [classId, setClassId] = useState<string | null>(null);
  const [kind, setKind] = useState<'ITEM' | 'REMARK'>('ITEM');
  const [body, setBody] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  /**
   * The receipt for the last remark written in this sitting. It is not a
   * toast: the commonest question a teacher has after writing a remark is
   * "what exactly did the family get?", and the only honest answer is to show
   * them the email. Cleared whenever the page they are looking at changes,
   * because a receipt pinned under a different day's diary would read as if it
   * belonged to that day.
   */
  const [receipt, setReceipt] = useState<EmailReceipt | null>(null);

  const today = todayIso();
  const isToday = date === today;

  const classesQuery = useQuery({
    queryKey: ['t-diary-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
  });
  const classes = classesQuery.data ?? [];
  const activeId = classId ?? classes[0]?.classSectionId ?? null;

  const pageKey = ['t-diary', activeId, date];
  const pageQuery = useQuery({
    queryKey: pageKey,
    enabled: !!host && !!activeId,
    queryFn: () =>
      api.get<DiaryPageResult>(
        `/manage/diary?classSectionId=${encodeURIComponent(activeId as string)}&date=${date}`,
      ),
  });

  const rosterQuery = useQuery({
    queryKey: ['t-diary-roster', activeId],
    enabled: !!host && !!activeId,
    queryFn: () =>
      api.get<RosterStudent[]>(
        `/manage/students?classSectionId=${encodeURIComponent(activeId as string)}`,
      ),
  });

  const pickable: PickableStudent[] = useMemo(
    () =>
      (rosterQuery.data ?? []).map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        rollNo: s.rollNo,
      })),
    [rosterQuery.data],
  );

  const trimmed = body.trim();
  const isRemark = kind === 'REMARK';
  const canSend = !!activeId && trimmed.length > 0 && trimmed.length <= MAX_BODY && (!isRemark || chosen.length > 0);

  const add = useMutation({
    mutationFn: () =>
      api.post<DiaryEntryRow>('/manage/diary', {
        classSectionId: activeId,
        date,
        kind,
        audience: chosen.length > 0 ? 'SELECTED' : 'ALL',
        body: trimmed,
        ...(chosen.length > 0 ? { studentIds: chosen } : {}),
      }),
    onSuccess: (created) => {
      toast.success(
        created.kind === 'REMARK'
          ? `Remark written — ${created.students.length === 1 ? 'that family has' : 'those families have'} been emailed.`
          : 'Added to today’s diary.',
      );
      // Capture the receipt from the row the server echoed back, not from the
      // local draft: what went out is whatever the API stored.
      setReceipt(
        created.kind === 'REMARK'
          ? {
              body: created.body,
              names: created.students.map((s) => s.name),
              subject: created.subjectName,
            }
          : null,
      );
      setBody('');
      setChosen([]);
      setKind('ITEM');
      void qc.invalidateQueries({ queryKey: pageKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const strike = useMutation({
    mutationFn: (id: string) => api.del(`/manage/diary/${id}`),
    onSuccess: () => {
      toast.success('Struck out.');
      void qc.invalidateQueries({ queryKey: pageKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = pageQuery.data?.entries ?? [];

  /** Any move to a different page drops the receipt — see the state comment. */
  function goTo(next: string) {
    setDate(next);
    setReceipt(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Diary</h1>
        <p>
          What goes home today — homework, notices, and the remarks a family has to sign.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="sk-btn sk-press"
          data-testid="diary-prev"
          onClick={() => goTo(shiftIso(date, -1))}
        >
          ‹ Prev day
        </button>
        <span className="text-[13px] font-bold text-[var(--sk-ink)]">{dayLabel(date)}</span>
        <button
          type="button"
          className="sk-btn sk-press"
          data-testid="diary-next"
          disabled={isToday}
          onClick={() => goTo(date < today ? shiftIso(date, 1) : date)}
        >
          Next day ›
        </button>
        {!isToday && (
          <button type="button" className="sk-btn sk-press" data-testid="diary-today" onClick={() => goTo(today)}>
            Jump to today
          </button>
        )}
      </div>

      {classes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c.classSectionId}
              type="button"
              className="sk-btn sk-press"
              data-testid={`diary-class-${c.classSectionId}`}
              data-variant={c.classSectionId === activeId ? 'primary' : undefined}
              onClick={() => {
                setClassId(c.classSectionId);
                setReceipt(null);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>{pageQuery.data ? `${pageQuery.data.className} · ${dayLabel(date)}` : 'The page'}</h3>
          </div>
          <div className="sk-card-b">
            {pageQuery.isLoading && <p className="sk-state">Opening the diary…</p>}
            {pageQuery.error && <p className="sk-state err">{(pageQuery.error as Error).message}</p>}
            {!pageQuery.isLoading && !pageQuery.error && entries.length === 0 && (
              <p className="sk-state">
                {isToday ? 'Nothing written yet today.' : 'Nothing was written on this day.'}
              </p>
            )}
            {/* Entries land with `pinin` — dropped in rotated, settling
                square, like a slip pinned to the day's page. The animation is
                keyed to the entry id, so React only mounts (and therefore
                only animates) the row that is genuinely new; changing day or
                class remounts the whole list, which is exactly when the
                staggered drop is wanted. */}
            {entries.map((e, i) => (
              <div
                key={e.id}
                className="sk-diary-item sk-pinin sk-in"
                data-kind={e.kind}
                data-testid={`diary-entry-${e.id}`}
                style={{ animationDelay: `${Math.min(i, 8) * 0.06}s` }}
              >
                <span className="sdot" aria-hidden="true" />
                <div className="di-body">
                  <div className="di-sub">
                    {e.subjectName ?? 'Diary'}
                    {e.kind === 'REMARK' && <span className="sk-rem-tag">REMARK</span>}
                  </div>
                  <div className="di-txt">{e.body}</div>
                  {/* Subject already sits in the eyebrow above, so the byline
                      carries only who wrote it and how far it has got. */}
                  <div className="di-by">
                    {e.authorName}
                    {' · '}
                    {e.kind === 'REMARK'
                      ? `${e.signedCount}/${e.recipientCount} signed`
                      : `${e.seenCount}/${e.recipientCount} opened`}
                    {e.students.length > 0 && ` · ${e.students.map((s) => s.name).join(', ')}`}
                  </div>
                </div>
                {e.editable && (
                  <button
                    type="button"
                    className="sk-btn sk-press"
                    data-testid={`diary-strike-${e.id}`}
                    disabled={strike.isPending}
                    onClick={() => strike.mutate(e.id)}
                  >
                    Strike out
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {isToday ? (
          <div className="sk-card" data-testid="diary-compose">
            <div className="sk-card-h">
              <h3>Write</h3>
            </div>
            <div className="sk-card-b flex flex-col gap-3">
              {/* Segmented, not two buttons: the two modes are exclusive and
                  a teacher needs to see which ink they are about to write in.
                  `aria-pressed` carries the state for assistive tech; the red
                  half is styled through the `bad` tone so arming REMARK is
                  visible before the button below is read. */}
              <div className="sk-seg" role="group" aria-label="What are you writing?">
                {(['ITEM', 'REMARK'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="sk-press"
                    data-testid={`diary-kind-${k}`}
                    data-tone={k === 'REMARK' ? 'bad' : undefined}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {k === 'ITEM' ? 'Diary entry' : 'Remark ✍️'}
                  </button>
                ))}
              </div>

              <Textarea
                data-testid="diary-body"
                rows={4}
                value={body}
                maxLength={MAX_BODY}
                // Red ink, red field: the composer looks like what it produces,
                // so the mode can never be lost between arming it and typing.
                className={isRemark ? 'sk-compose-remark' : undefined}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  isRemark
                    ? 'What happened, in your words — the parent reads this verbatim.'
                    : 'Homework, what to bring tomorrow, a note home…'
                }
                style={isRemark ? { color: 'var(--sk-bad)' } : undefined}
              />

              <p className="sk-state" style={{ padding: 0 }}>
                {isRemark
                  ? 'A remark is always emailed to the parents of the children you name — signing it in the app does not replace that.'
                  : 'Leave the names empty and the whole class gets it. Name someone and only they do.'}
              </p>

              <StudentPicker
                students={pickable}
                selected={chosen}
                onChange={setChosen}
                placeholder={isRemark ? 'Who is this about?' : 'Only for… (optional)'}
              />

              <button
                type="button"
                className="sk-btn sk-press"
                data-variant="primary"
                data-testid="diary-send"
                disabled={!canSend || add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending
                  ? 'Saving…'
                  : isRemark
                    ? `Write remark${chosen.length ? ` · ${chosen.length}` : ''}`
                    : chosen.length > 0
                      ? `Add for ${chosen.length}`
                      : 'Add for the whole class'}
              </button>

              {/* The receipt. Keyed on the body so a second remark mounts a
                  fresh card and drops in again rather than silently swapping
                  its text — the drop IS the confirmation that a new email
                  went out. */}
              {receipt && (
                <div
                  key={receipt.body}
                  className="sk-emailcard sk-pinin sk-in"
                  data-testid="diary-email-preview"
                >
                  <div className="eh">
                    ✉️ EMAIL SENT
                    {receipt.names.length > 0 &&
                      ` · ${receipt.names.length} ${receipt.names.length === 1 ? 'family' : 'families'}`}
                  </div>
                  <div className="esub">
                    Subject: A remark in
                    {receipt.names.length > 0
                      ? ` ${receipt.names[0].split(' ')[0]}’s`
                      : ' your child’s'}{' '}
                    diary{receipt.subject ? ` — ${receipt.subject}` : ''}
                  </div>
                  <div className="ebody">
                    {/* The remark is highlighted because it is the only part
                        of the email the teacher wrote, and therefore the only
                        part they can still get wrong. */}
                    You wrote today: <mark>“{receipt.body}”</mark>
                    <br />
                    Open the diary to sign.
                  </div>
                  <div className="enote">
                    Sent the moment it was written — signing does not replace it. The bell and a
                    push went too.
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="sk-card" data-testid="diary-closed">
            <div className="sk-card-b">
              <p className="sk-state">
                This page is closed — a diary a family has already read cannot be rewritten. Jump to
                today to add anything new.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
