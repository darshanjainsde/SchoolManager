'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { DecisionKind, SessionStudentRow, Target } from './types';

interface Draft {
  decision: DecisionKind;
  toSectionId: string | null;
  leaveStatus: 'TRANSFERRED' | 'LEFT';
  leaveReason: string;
  note: string;
}

const DECISIONS: { value: DecisionKind; label: string }[] = [
  { value: 'PROMOTE', label: 'Promote' },
  { value: 'STAY', label: 'Stay in grade' },
  { value: 'PASS_OUT', label: 'Pass out' },
  { value: 'LEAVE', label: 'Leaving' },
];

function seedOne(r: SessionStudentRow): Draft {
  return {
    decision: r.decision ?? r.defaultDecision,
    toSectionId: r.toSectionId,
    leaveStatus: r.leaveStatus ?? 'TRANSFERRED',
    leaveReason: r.leaveReason ?? '',
    note: r.note ?? '',
  };
}

function seed(rows: SessionStudentRow[]): Map<string, Draft> {
  return new Map(rows.map((r) => [r.studentId, seedOne(r)]));
}

/** The wire shape: only the keys the API needs for each decision. */
export function toWire(studentId: string, d: Draft) {
  if (d.decision === 'PROMOTE' || d.decision === 'STAY') return { studentId, decision: d.decision, toSectionId: d.toSectionId };
  if (d.decision === 'LEAVE') {
    return { studentId, decision: d.decision, leaveStatus: d.leaveStatus, ...(d.leaveReason.trim() ? { leaveReason: d.leaveReason.trim() } : {}), ...(d.note.trim() ? { note: d.note.trim() } : {}) };
  }
  return { studentId, decision: d.decision };
}

function weeksAgo(iso: string | null): string {
  if (!iso) return '';
  const w = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / (7 * 86_400_000)));
  return `Joined ${w} week${w === 1 ? '' : 's'} ago`;
}

/**
 * One closing class, one row per child, the numbers beside the name and four
 * buttons. The pass mark FLAGS (an amber Review chip); it never decides. Every
 * row is saved together — the office finishes a class, not a child.
 */
export default function DecideTable({
  rows, targets, passMarkPct, fromYearName, finalGrade, joinedSince, onSaved, saveLabel = 'Save and next class',
}: {
  rows: SessionStudentRow[];
  targets: Target[];
  passMarkPct: number;
  fromYearName: string;
  /** Every child in this class passes out by default: the "Goes to" column reads Alumni. */
  finalGrade?: boolean;
  joinedSince?: string | null;
  onSaved: (version: number) => void;
  saveLabel?: string;
}) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => seed(rows));
  // Rows can be refetched under the office's hands (a pass-mark change, a
  // newly admitted child): keep every edit, seed only the newcomers.
  useEffect(() => {
    setDrafts((m) => {
      const next = new Map(m);
      for (const r of rows) if (!next.has(r.studentId)) next.set(r.studentId, seedOne(r));
      return next;
    });
  }, [rows]);
  const draftOf = (r: SessionStudentRow): Draft => drafts.get(r.studentId) ?? seedOne(r);
  const [onlyReview, setOnlyReview] = useState(false);
  const [onlyLowAttendance, setOnlyLowAttendance] = useState(false);

  const edit = (id: string, patch: Partial<Draft>) =>
    setDrafts((m) => {
      const next = new Map(m);
      const base = next.get(id) ?? seedOne(rows.find((r) => r.studentId === id)!);
      next.set(id, { ...base, ...patch });
      return next;
    });

  const pick = (r: SessionStudentRow, decision: DecisionKind) => {
    const d = draftOf(r);
    // No guessed class: a final-grade child pressed to Promote has nowhere to go until the office picks.
    const toSectionId = decision === 'STAY' ? (r.stayToSectionId ?? d.toSectionId) : decision === 'PROMOTE' ? (r.toSectionId ?? d.toSectionId) : null;
    edit(r.studentId, { decision, toSectionId });
  };

  const save = useMutation({
    mutationFn: () => api.put<{ saved: number; version: number }>('/manage/sessions/plan/decisions', { rows: rows.map((r) => toWire(r.studentId, draftOf(r))) }),
    onSuccess: (r) => {
      toast.success(`${r.saved} decisions saved`);
      onSaved(r.version);
    },
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });

  const visible = useMemo(
    () => rows.filter((r) => (!onlyReview || r.review) && (!onlyLowAttendance || (r.attendancePct !== null && r.attendancePct < 75))),
    [rows, onlyReview, onlyLowAttendance],
  );
  const missingTarget = rows.filter((r) => {
    const d = draftOf(r);
    return (d.decision === 'PROMOTE' || d.decision === 'STAY') && !d.toSectionId;
  }).length;

  return (
    <div className="sk-ses-decide">
      <div className="sk-toolbar sk-ses-toolbar">
        <button type="button" className="sk-btn sk-press" onClick={() => rows.forEach((r) => pick(r, r.defaultDecision))}>
          Select all → {finalGrade ? 'Pass out' : 'Promote'}
        </button>
        <button type="button" className="sk-chip sk-press" aria-pressed={onlyReview} onClick={() => setOnlyReview((v) => !v)}>
          Show: below pass mark ({passMarkPct}%)
        </button>
        <button type="button" className="sk-chip sk-press" aria-pressed={onlyLowAttendance} onClick={() => setOnlyLowAttendance((v) => !v)}>
          Show: attendance under 75%
        </button>
      </div>
      <div className="sk-tblwrap">
        <table className="sk-tbl">
          <thead>
            <tr>
              <th>Roll</th>
              <th>Student</th>
              <th>Attendance</th>
              <th>Results</th>
              <th>Decision</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="sk-muted" data-wrap="true">
                  {rows.length === 0 ? 'No active students in this class.' : 'Nobody matches that filter.'}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const d = draftOf(r);
              return (
                <tr key={r.studentId} aria-label={r.name}>
                  <td className="sk-num">{r.rollNo ?? '—'}</td>
                  <td data-wrap="true">
                    <div className="sk-ses-name">
                      <b>{r.name}</b>
                      <span className="sk-muted">{r.admissionNo}</span>
                      {r.review && (
                        <span className="sk-pill" data-tone="warn">
                          Review
                        </span>
                      )}
                      {r.joinedSincePlan && (
                        <span className="sk-pill" data-tone="info">
                          {weeksAgo(joinedSince ?? null) || 'Joined since the plan'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="sk-num">{r.attendancePct === null ? '—' : `${r.attendancePct}%`}</td>
                  <td className="sk-num" data-tone={r.review ? 'warn' : undefined}>
                    {r.resultsPct === null ? '—' : `${r.resultsPct}%`}
                  </td>
                  <td>
                    <div className="sk-ses-buttons" role="group" aria-label={`Decision for ${r.name}`}>
                      {DECISIONS.map((o) => (
                        <button key={o.value} type="button" className="sk-chip sk-press" aria-pressed={d.decision === o.value} onClick={() => pick(r, o.value)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    {(d.decision === 'PROMOTE' || d.decision === 'STAY') && (
                      <select className="sk-input" aria-label={`${r.name} goes to`} value={d.toSectionId ?? ''} onChange={(e) => edit(r.studentId, { toSectionId: e.target.value || null })}>
                        <option value="">— Pick a class —</option>
                        {targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {d.decision === 'PASS_OUT' && <span className="sk-muted">Alumni · Class of {fromYearName}</span>}
                    {d.decision === 'LEAVE' && (
                      <div className="sk-ses-leave">
                        <select className="sk-input" aria-label={`${r.name} leaving as`} value={d.leaveStatus} onChange={(e) => edit(r.studentId, { leaveStatus: e.target.value as 'TRANSFERRED' | 'LEFT' })}>
                          <option value="TRANSFERRED">Transferred</option>
                          <option value="LEFT">Left</option>
                        </select>
                        <input className="sk-input" aria-label={`Reason for ${r.name}`} placeholder="Reason (optional)" value={d.leaveReason} onChange={(e) => edit(r.studentId, { leaveReason: e.target.value })} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sk-cel-actions">
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={save.isPending || rows.length === 0 || missingTarget > 0} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : saveLabel}
        </button>
        {missingTarget > 0 && <span className="sk-muted">{missingTarget} promoted {missingTarget === 1 ? 'child needs' : 'children need'} a class.</span>}
      </div>
    </div>
  );
}
