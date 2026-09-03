'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Bell, CalendarClock, ChevronDown, Printer, UserX } from 'lucide-react';
import type { IssueReportCardsResponse, NudgeResultsResponse, ResultRoomBoard, ResultRoomClass, ResultRoomSubject } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { pressDateLabel } from '@/lib/press';

/**
 * The Result Room — report-card generation's cockpit.
 *
 * One screen answers, per class per subject: has the teacher entered marks,
 * has she published them, who is still unmarked, who was absent — three
 * states, never two. Nudges go to the exact teacher (the exam's creator) over
 * the bell rail and are logged so nobody nags twice. A class generates when
 * everything is published-or-excused; an unready class needs a WRITTEN
 * reason, which the API records in the audit log.
 */

const STATE_META: Record<ResultRoomSubject['state'], { label: string; tone: string }> = {
  PUBLISHED: { label: 'Published', tone: 'good' },
  ENTERED: { label: 'Entered · not published', tone: 'warn' },
  MISSING: { label: 'Missing', tone: 'bad' },
};

function daysTo(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

function SubjectRow({ s, onNudge, nudging }: {
  s: ResultRoomSubject;
  onNudge: (subjectId: string, kind: 'ENTER' | 'PUBLISH') => void;
  nudging: boolean;
}) {
  const meta = STATE_META[s.state];
  const nudgeKind = s.state === 'ENTERED' ? 'PUBLISH' : 'ENTER';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px dotted var(--sk-line)', fontSize: 12.5, flexWrap: 'wrap' }}>
      <b style={{ width: 120, flex: 'none' }}>{s.subjectName}</b>
      <span className="sk-muted" style={{ width: 110, flex: 'none', fontSize: 12 }}>{s.teacherName ?? '—'}</span>
      <span className="sk-pill" data-tone={meta.tone}>
        {meta.label}
        {s.state !== 'MISSING' ? ` · ${s.published}/${s.expected}` : ` · ${s.expected - s.entered} unmarked`}
      </span>
      {s.abCount > 0 && <span className="sk-pill" data-tone="bad">{s.abCount} AB</span>}
      {s.exCount > 0 && <span className="sk-pill" data-tone="info">{s.exCount} EX</span>}
      {s.state === 'MISSING' && s.missingStudents.length > 0 && (
        <span className="sk-muted" style={{ fontSize: 11.5 }}>
          {s.missingStudents.slice(0, 3).join(', ')}{s.missingStudents.length > 3 ? '…' : ''}
        </span>
      )}
      {s.state !== 'PUBLISHED' && (
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {s.lastNudge && (
            <span className="sk-muted" style={{ fontSize: 10.5 }}>nudged {pressDateLabel(s.lastNudge.at)}</span>
          )}
          <button className="sk-btn" style={{ padding: '4px 10px', fontSize: 11.5 }} disabled={nudging}
            onClick={() => onNudge(s.subjectId, nudgeKind)}>
            <Bell size={12} aria-hidden="true" /> {nudgeKind === 'PUBLISH' ? 'Nudge to publish' : 'Nudge'}
          </button>
        </span>
      )}
    </div>
  );
}

function ClassCard({ c, windowId, onGenerated }: { c: ResultRoomClass; windowId: string; onGenerated: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [open, setOpen] = useState(!c.ready && !c.noExams && c.students > 0);
  const [overrideAsk, setOverrideAsk] = useState(false);
  const [note, setNote] = useState('');

  const nudge = useMutation({
    mutationFn: (input: { subjectId: string; kind: 'ENTER' | 'PUBLISH' }) =>
      api.post<NudgeResultsResponse>('/manage/press/results/nudge', {
        windowId, classSectionId: c.id, ...input,
      }),
    onSuccess: (out) => {
      const who = out.notified.map((n) => n.teacherName ?? 'the teacher').join(', ');
      toast.success(`Nudged ${who} — it is on their bell and email.`);
      qc.invalidateQueries({ queryKey: ['result-room', host] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'The nudge did not send.'),
  });

  const generate = useMutation({
    mutationFn: (overrideNote?: string) =>
      api.post<IssueReportCardsResponse>('/manage/press/results/generate', {
        windowId, classSectionId: c.id, ...(overrideNote ? { overrideNote } : {}),
      }),
    onSuccess: (out) => {
      setOverrideAsk(false);
      setNote('');
      toast.success(out.issued.length
        ? `${c.label}: ${out.issued.length} card${out.issued.length === 1 ? '' : 's'} entered in the register.`
        : `${c.label}: every card was already in the register.`);
      onGenerated();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
      if (code === 'RESULTS_NOT_READY') {
        setOverrideAsk(true);
        toast.error(e.message);
        return;
      }
      toast.error(e instanceof ApiError ? e.message : 'Generation failed — nothing was recorded.');
    },
  });

  const done = c.students > 0 && c.issued >= c.students;
  const pendingSubjects = c.subjects.filter((s) => s.state !== 'PUBLISHED').length;

  return (
    <div className="sk-card">
      <div className="sk-card-b" style={{ gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, flex: 1, minWidth: 200, textAlign: 'left' }}
          >
            <ChevronDown size={14} aria-hidden="true"
              style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s', color: 'var(--sk-ink-3)' }} />
            <b style={{ fontSize: 14 }}>{c.label}</b>
            <span className="sk-muted" style={{ fontSize: 12 }}>
              {c.students} children · {c.subjects.length} subject{c.subjects.length === 1 ? '' : 's'}
            </span>
          </button>

          {done ? (
            <span className="sk-pill" data-tone="good">issued ✓ {c.issued}/{c.students}</span>
          ) : c.noExams ? (
            <span className="sk-pill" data-tone="neutral">no tests in this window</span>
          ) : c.ready ? (
            <span className="sk-pill" data-tone="good">READY</span>
          ) : (
            <span className="sk-pill" data-tone="warn">{pendingSubjects} subject{pendingSubjects === 1 ? '' : 's'} pending</span>
          )}

          {!done && c.students > 0 && !c.noExams && (
            <button className="sk-btn" data-variant={c.ready ? 'primary' : undefined}
              disabled={generate.isPending}
              onClick={() => (c.ready ? generate.mutate(undefined) : setOverrideAsk(true))}>
              <Printer size={14} aria-hidden="true" />
              {generate.isPending ? 'Generating…' : c.ready ? 'Generate' : 'Generate anyway…'}
            </button>
          )}
          <Link href={`/app/press/batch/${windowId}/${c.id}`} className="sk-seelink" style={{ fontSize: 12 }}>
            open batch →
          </Link>
        </div>

        {overrideAsk && !c.ready && (
          <div style={{ border: '1px solid var(--sk-bad)', background: 'var(--sk-bad-tint)', borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b style={{ fontSize: 12.5 }}>Generate {c.label} with gaps? The reason goes on the record (audit log).</b>
            <input className="sk-input" maxLength={300} placeholder="e.g. principal ordered — Hindi teacher on medical leave"
              value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="sk-btn" data-variant="danger" disabled={note.trim().length < 5 || generate.isPending}
                onClick={() => generate.mutate(note.trim())}>
                Generate with gaps
              </button>
              <button className="sk-btn" onClick={() => { setOverrideAsk(false); setNote(''); }}>Keep chasing</button>
            </div>
          </div>
        )}

        {open && c.subjects.length > 0 && (
          <div>
            {c.subjects.map((s) => (
              <SubjectRow key={s.subjectId} s={s} nudging={nudge.isPending}
                onNudge={(subjectId, kind) => nudge.mutate({ subjectId, kind })} />
            ))}
          </div>
        )}
        {open && c.noExams && (
          <p className="sk-state" style={{ margin: 0 }}>
            No tests are scheduled inside this window for {c.label} — subjects appear here the moment a teacher
            schedules one. If this class genuinely sat no tests, &ldquo;Generate anyway&rdquo; prints attendance-and-remarks cards.
          </p>
        )}
      </div>
    </div>
  );
}

export default function ResultRoomPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [windowId, setWindowId] = useState<string | null>(null);
  const [dayDraft, setDayDraft] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ['result-room', host, windowId], enabled: !!host,
    queryFn: () => api.get<ResultRoomBoard>(`/manage/press/results${windowId ? `?windowId=${windowId}` : ''}`),
  });

  const windows = useQuery({
    queryKey: ['press-windows', host], enabled: !!host,
    queryFn: () => api.get<import('@skoolos/types').ReportWindowRow[]>('/manage/press/windows'),
  });

  const saveDay = useMutation({
    mutationFn: (resultDay: string) => {
      const w = board.data?.window;
      return api.put('/manage/press/windows', {
        id: w!.id, academicYearId: w!.academicYearId, name: w!.name,
        startDate: w!.startDate, endDate: w!.endDate, resultDay,
      });
    },
    onSuccess: () => {
      setDayDraft(null);
      qc.invalidateQueries({ queryKey: ['result-room', host] });
      qc.invalidateQueries({ queryKey: ['press-windows', host] });
      toast.success('Result day set — teachers now see it next to their pending marks.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the date.'),
  });

  const b = board.data;
  const w = b?.window ?? null;
  const withKids = (b?.classes ?? []).filter((c) => c.students > 0);
  const readyCount = withKids.filter((c) => c.ready && c.issued < c.students).length;
  const dueIn = w?.resultDay ? daysTo(w.resultDay) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <Link href="/app/press" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowLeft size={13} aria-hidden="true" /> The Press
        </Link>
        <h1>The Result Room</h1>
        <p>Every class turns green when every subject is published for every child — green classes generate.</p>
      </header>

      {board.isLoading && <p className="sk-state">Reading every register…</p>}
      {board.isError && <p className="sk-state err">The room could not load. Refresh to try again.</p>}

      {b && !w && (
        <div className="sk-card"><div className="sk-card-b">
          <p className="sk-state">No report window yet — create one on <Link href="/app/press" style={{ color: 'var(--sk-brand-2)' }}>the Press home</Link> and the room fills itself.</p>
        </div></div>
      )}

      {w && (
        <>
          <div className="sk-card"><div className="sk-card-b">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <select className="sk-input" style={{ width: 'auto', fontWeight: 650 }} value={w.id}
                onChange={(e) => setWindowId(e.target.value)}>
                {(windows.data ?? [{ ...w, issuedCount: 0 }]).map((row) => (
                  <option key={row.id} value={row.id}>{row.name} · {row.academicYearName}</option>
                ))}
              </select>

              {/* ── result day — the promise teachers see ── */}
              {dayDraft === null ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--sk-line)', borderRadius: 10, padding: '7px 12px', fontSize: 12.5, background: w.resultDay ? 'var(--sk-amber-tint)' : undefined }}>
                  <CalendarClock size={14} aria-hidden="true" style={{ color: 'var(--sk-amber)' }} />
                  {w.resultDay ? (
                    <>
                      <b>Result day {pressDateLabel(w.resultDay)}</b>
                      {dueIn !== null && (
                        <span className="sk-muted">
                          {dueIn > 0 ? `· ${dueIn} day${dueIn === 1 ? '' : 's'} away` : dueIn === 0 ? '· today' : `· ${-dueIn} day${dueIn === -1 ? '' : 's'} past`}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="sk-muted">No result day set</span>
                  )}
                  <button className="sk-seelink" style={{ fontSize: 11.5, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setDayDraft(w.resultDay ?? '')}>
                    {w.resultDay ? 'change' : 'set it'}
                  </button>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="date" className="sk-input" style={{ width: 'auto' }} value={dayDraft}
                    onChange={(e) => setDayDraft(e.target.value)} />
                  <button className="sk-btn" data-variant="primary" style={{ padding: '6px 12px', fontSize: 12 }}
                    disabled={!dayDraft || saveDay.isPending} onClick={() => saveDay.mutate(dayDraft)}>
                    Save
                  </button>
                  <button className="sk-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setDayDraft(null)}>Cancel</button>
                </span>
              )}

              <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--sk-ink-2)' }}>
                {readyCount > 0
                  ? <><b style={{ color: 'var(--sk-good)' }}>{readyCount}</b> class{readyCount === 1 ? '' : 'es'} ready to generate</>
                  : 'no class fully ready yet'}
              </span>
            </div>
          </div></div>

          {withKids.map((c) => (
            <ClassCard key={c.id} c={c} windowId={w.id}
              onGenerated={() => qc.invalidateQueries({ queryKey: ['result-room', host] })} />
          ))}
          {withKids.length === 0 && (
            <p className="sk-state">No classes with active students yet.</p>
          )}

          {/* ── the absentee register ── */}
          {b && b.absentees.length > 0 && (
            <div className="sk-card"><div className="sk-card-b">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserX size={15} aria-hidden="true" style={{ color: 'var(--sk-bad)' }} />
                <b style={{ fontSize: 13 }}>The absentee register · {b!.absentees.length}</b>
              </div>
              <p className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
                Every AB in {w.name}. A re-test just replaces the AB with marks before the card is issued —
                the compile picks it up by itself.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {b!.absentees.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
                    <b style={{ minWidth: 140 }}>{a.studentName}</b>
                    <span className="sk-muted">{a.classLabel} · {a.subjectName} · {a.examTitle}</span>
                  </div>
                ))}
              </div>
            </div></div>
          )}
        </>
      )}
    </div>
  );
}
