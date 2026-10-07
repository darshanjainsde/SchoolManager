'use client';
import { useEffect, useMemo, useState } from 'react';
import { Overlay } from '@/components/ui/kit';

/**
 * ONE PERIOD, OR EVERY PERIOD OF THE SUBJECT.
 *
 * The office changes a class's English teacher and used to redo every English
 * period of the week, one by one (2026-10-07). This drawer assigns the period
 * that was clicked, and — ticked — the subject's other periods in the class.
 *
 * Every row the change would touch is listed, with who has it now. A period
 * where the new teacher already teaches another class cannot be ticked and
 * says which class; dated things the swap disturbs (approved leave, a cover
 * already arranged) are shown in amber and never block. The server re-checks
 * all of it when saving.
 *
 * Past weeks are never changed: the change starts today (or on the viewed
 * future week's Monday). "Keep this change for the coming weeks" decides
 * whether it runs on, or covers the viewed week only and then goes back.
 */
export interface PreviewRow {
  dayOfWeek: number;
  periodId: string;
  periodLabel: string;
  periodOrder: number;
  clicked: boolean;
  current: { subjectId: string; teacherId: string; teacherName: string } | null;
  clash: { classLabel: string; from: string | null } | null;
  warnings: string[];
}
export interface SubjectTeacherPreview {
  teacher: { id: string; name: string; active: boolean };
  subject: { id: string; name: string };
  from: string;
  until: string | null;
  rows: PreviewRow[];
  alreadyTheirs: number;
  load: { now: number };
}
export interface PeriodDialogSave {
  subjectId: string;
  teacherId: string;
  cells: { dayOfWeek: number; periodId: string }[];
  keep: boolean;
  /** For the message after saving: rows that will stay as they are, with why. */
  leftAsIs: { label: string; reason: string }[];
}

interface Option { id: string; label: string }

export interface PeriodDialogProps {
  mode: 'assign' | 'change';
  /** "Thu Oct 8" */
  dayLabel: string;
  dayOfWeek: number;
  periodId: string;
  periodLabel: string;
  /** "V-B" */
  classLabel: string;
  /** The viewed week, "Oct 5–11". */
  weekLabel: string;
  /** "today" or "Mon Oct 12" — where the change starts. */
  fromLabel: string;
  /** "Mon Oct 12" — where a this-week-only change ends. */
  nextWeekLabel: string;
  subjects: Option[];
  /** Active teachers only (the page filters out those who have left), plus the current one in change mode. */
  teachers: Option[];
  initial?: { subjectId: string; teacherId: string; teacherName: string } | null;
  preview: (q: { subjectId: string; teacherId: string; keep: boolean }) => Promise<SubjectTeacherPreview>;
  onSave: (s: PeriodDialogSave) => void;
  isSaving: boolean;
  onClose: () => void;
  /** Change mode: take the period off the timetable (from the same date the change would start). */
  onRemove?: () => void;
}

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const rowKey = (r: { dayOfWeek: number; periodId: string }) => `${r.dayOfWeek}:${r.periodId}`;
const rowLabel = (r: PreviewRow) => `${DAYS[r.dayOfWeek]} ${r.periodLabel}`;

export function PeriodDialog(props: PeriodDialogProps) {
  const { mode, dayLabel, periodLabel, classLabel, weekLabel, fromLabel, nextWeekLabel, subjects, teachers, initial, preview, onSave, isSaving, onClose, onRemove } = props;
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? subjects[0]?.id ?? '');
  // No silent default: the first teacher in the list is nobody's choice.
  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? '');
  const [keep, setKeep] = useState(true);
  const [alsoOthers, setAlsoOthers] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<{ data: SubjectTeacherPreview | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });

  const unchanged = mode === 'change' && initial && subjectId === initial.subjectId && teacherId === initial.teacherId;

  useEffect(() => {
    if (!subjectId || !teacherId) { setPlan({ data: null, loading: false, error: null }); return; }
    let live = true;
    setPlan((p) => ({ ...p, loading: true, error: null }));
    const t = setTimeout(() => {
      preview({ subjectId, teacherId, keep })
        .then((data) => {
          if (!live) return;
          setPlan({ data, loading: false, error: null });
          // Every free period starts ticked; a clash can never be.
          setTicked(new Set(data.rows.filter((r) => !r.clicked && !r.clash).map(rowKey)));
        })
        .catch((e: Error) => { if (live) setPlan({ data: null, loading: false, error: e.message }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [preview, subjectId, teacherId, keep]);

  const rows = plan.data?.rows ?? [];
  const clicked = rows.find((r) => r.clicked) ?? null;
  const others = rows.filter((r) => !r.clicked);
  const free = others.filter((r) => !r.clash);
  const clashing = others.filter((r) => r.clash);
  const subjectName = subjects.find((s) => s.id === subjectId)?.label.replace(/\s*\(.*\)$/, '') ?? 'this subject';
  const teacherName = plan.data?.teacher.name ?? teachers.find((t) => t.id === teacherId)?.label ?? '';

  const chosen = useMemo(() => {
    const cells: { dayOfWeek: number; periodId: string }[] = [];
    if (clicked && !clicked.clash) cells.push({ dayOfWeek: clicked.dayOfWeek, periodId: clicked.periodId });
    if (alsoOthers) for (const r of free) if (ticked.has(rowKey(r))) cells.push({ dayOfWeek: r.dayOfWeek, periodId: r.periodId });
    return cells;
  }, [clicked, alsoOthers, free, ticked]);

  const clickedBlocked = !!clicked?.clash;
  // "Unchanged" only blocks when nothing else is being handed over either.
  const canSave = !!plan.data && !plan.loading && chosen.length > 0 && !clickedBlocked;
  const save = () => {
    if (!canSave) return;
    const leftAsIs = [
      ...clashing.map((r) => ({ label: rowLabel(r), reason: `${teacherName} teaches ${r.clash!.classLabel} then` })),
      ...(alsoOthers ? free.filter((r) => !ticked.has(rowKey(r))).map((r) => ({ label: rowLabel(r), reason: 'unticked' })) : []),
    ];
    onSave({ subjectId, teacherId, cells: chosen, keep, leftAsIs });
  };

  const toggle = (k: string) => setTicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const willHave = (plan.data?.load.now ?? 0) + chosen.length;

  return (
    <Overlay
      title={`${mode === 'change' ? 'Change period' : 'Assign period'} — ${dayLabel}, ${periodLabel}`}
      subtitle={`${classLabel} · week of ${weekLabel}`}
      onClose={onClose}
      footer={
        <>
          <span style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button type="button" className="sk-btn sk-press" onClick={onClose}>Cancel</button>
            {mode === 'change' && onRemove && (
              <button type="button" className="sk-btn sk-press" style={{ color: 'var(--sk-bad)' }} onClick={onRemove}>Remove period</button>
            )}
          </span>
          <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!canSave || isSaving} onClick={save}>
            {isSaving ? 'Saving…' : chosen.length > 1 ? `Save ${chosen.length} periods` : mode === 'change' ? 'Save' : 'Assign'}
          </button>
        </>
      }
    >
      <div className="sk-pd">
        <div className="sk-pd-field">
          <label htmlFor="pd-subject" className="sk-lab">Subject</label>
          <select id="pd-subject" className="sk-input" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setAlsoOthers(false); }}>
            {subjects.length === 0 && <option value="">No subjects — add one in Classes</option>}
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="sk-pd-field">
          <label htmlFor="pd-teacher" className="sk-lab">Teacher</label>
          <select id="pd-teacher" className="sk-input" value={teacherId} aria-invalid={clickedBlocked || undefined} aria-describedby={clickedBlocked ? 'pd-teacher-err' : undefined} onChange={(e) => { setTeacherId(e.target.value); setAlsoOthers(false); }}>
            <option value="">— Choose a teacher —</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {clickedBlocked && clicked?.clash && (
            <span id="pd-teacher-err" className="sk-pd-err" role="alert">
              {teacherName} teaches {clicked.clash.classLabel} in this period{clicked.clash.from ? ` from ${clicked.clash.from}` : ''}. Choose someone else, or free them there first.
            </span>
          )}
          {clicked && clicked.warnings.map((w) => <span key={w} className="sk-pd-warn">{w}</span>)}
          {mode === 'change' && initial && teacherId && teacherId !== initial.teacherId && !clickedBlocked && (
            <span className="sk-pd-hint">Now {initial.teacherName}.</span>
          )}
        </div>

        {/* ── the subject's other periods in this class ── */}
        {plan.data && others.length > 0 && (
          <fieldset className="sk-pd-others">
            <legend className="sr-only">Other {subjectName} periods of {classLabel}</legend>
            <label className="sk-pd-check">
              <input type="checkbox" checked={alsoOthers} disabled={free.length === 0} onChange={(e) => setAlsoOthers(e.target.checked)} />
              <span>
                <b>Also give {teacherName} the other {others.length === 1 ? `${subjectName} period` : `${others.length} ${subjectName} periods`} of {classLabel}</b>
                <span className="sk-pd-sub">{free.length === others.length ? `${teacherName} is free in all of them.` : `${free.length} free · ${clashing.length} busy with another class`}</span>
              </span>
            </label>
            <ul className="sk-pd-rows" data-off={!alsoOthers || undefined}>
              {others.map((r) => {
                const k = rowKey(r);
                return (
                  <li key={k} data-clash={r.clash ? '' : undefined}>
                    <label className="sk-pd-row">
                      <input type="checkbox" checked={!r.clash && alsoOthers && ticked.has(k)} disabled={!!r.clash || !alsoOthers} onChange={() => toggle(k)} aria-label={`${rowLabel(r)}, now ${r.current?.teacherName ?? 'empty'}`} />
                      <span className="when">{rowLabel(r)}</span>
                      <span className="now">{r.current ? `now ${r.current.teacherName}` : 'empty'}</span>
                    </label>
                    {r.clash && <span className="sk-pd-err">{teacherName} teaches {r.clash.classLabel} then{r.clash.from ? ` (from ${r.clash.from})` : ''} — stays as it is.</span>}
                    {r.warnings.map((w) => <span key={w} className="sk-pd-warn">{w}</span>)}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        {plan.data && plan.data.alreadyTheirs > 0 && (
          <p className="sk-pd-hint">{plan.data.alreadyTheirs === 1 ? '1 other' : `${plan.data.alreadyTheirs} other`} {subjectName} period{plan.data.alreadyTheirs === 1 ? ' is' : 's are'} already with {teacherName}.</p>
        )}

        {/* ── how long the change lasts ── */}
        <label className="sk-pd-check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>
            <b>Keep this change for the coming weeks</b>
            <span className="sk-pd-sub">
              {keep
                ? `From ${fromLabel} on. Earlier weeks keep the teacher they had.`
                : `Only the week of ${weekLabel}, from ${fromLabel}. From ${nextWeekLabel} it goes back to how it was.`}
            </span>
          </span>
        </label>

        {plan.loading && <p className="sk-pd-hint" aria-live="polite">Checking {teacherName || 'the teacher'}’s timetable…</p>}
        {plan.error && <p className="sk-pd-err" role="alert">{plan.error}</p>}
        {plan.data && !plan.loading && chosen.length > 0 && (
          <p className="sk-pd-load">{teacherName}: {plan.data.load.now} periods a week → <b>{willHave}</b></p>
        )}
        {unchanged && chosen.length === 0 && <p className="sk-pd-hint">This is what the period already has.</p>}
      </div>
    </Overlay>
  );
}
