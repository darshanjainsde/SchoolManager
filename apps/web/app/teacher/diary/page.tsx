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

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Diary</h1>
        <p>
          What goes home today — homework, notices, and the remarks a family has to sign.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="sk-btn" data-testid="diary-prev" onClick={() => setDate((d) => shiftIso(d, -1))}>
          ‹ Prev day
        </button>
        <span className="text-[13px] font-bold text-[var(--sk-ink)]">{dayLabel(date)}</span>
        <button
          type="button"
          className="sk-btn"
          data-testid="diary-next"
          disabled={isToday}
          onClick={() => setDate((d) => (d < today ? shiftIso(d, 1) : d))}
        >
          Next day ›
        </button>
        {!isToday && (
          <button type="button" className="sk-btn" data-testid="diary-today" onClick={() => setDate(today)}>
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
              className="sk-btn"
              data-testid={`diary-class-${c.classSectionId}`}
              data-variant={c.classSectionId === activeId ? 'primary' : undefined}
              onClick={() => setClassId(c.classSectionId)}
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
            {entries.map((e) => (
              <div key={e.id} className="sk-row" data-testid={`diary-entry-${e.id}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="nm"
                    style={
                      e.kind === 'REMARK'
                        ? { color: 'var(--sk-bad)', fontStyle: 'italic' }
                        : undefined
                    }
                  >
                    {e.body}
                  </div>
                  <div className="meta">
                    {e.authorName}
                    {e.subjectName ? ` · ${e.subjectName}` : ''}
                    {' · '}
                    {e.kind === 'REMARK'
                      ? `${e.signedCount}/${e.recipientCount} signed`
                      : `${e.seenCount}/${e.recipientCount} opened`}
                    {e.students.length > 0 && ` · ${e.students.map((s) => s.name).join(', ')}`}
                  </div>
                </div>
                <span className="sp" />
                {e.kind === 'REMARK' && (
                  <span className="sk-pill" data-tone="bad">
                    Remark
                  </span>
                )}
                {e.editable && (
                  <button
                    type="button"
                    className="sk-btn"
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
              <div className="flex gap-2">
                {(['ITEM', 'REMARK'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="sk-btn"
                    style={{ flex: 1 }}
                    data-testid={`diary-kind-${k}`}
                    data-variant={kind === k ? 'primary' : undefined}
                    onClick={() => setKind(k)}
                  >
                    {k === 'ITEM' ? 'Diary entry' : 'Remark'}
                  </button>
                ))}
              </div>

              <Textarea
                data-testid="diary-body"
                rows={4}
                value={body}
                maxLength={MAX_BODY}
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
                className="sk-btn"
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
