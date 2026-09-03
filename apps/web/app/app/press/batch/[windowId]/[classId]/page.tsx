'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BookMarked, Package, Printer } from 'lucide-react';
import type { ReportCardBatch, ReportCardSnapshot, ReportCardStudent, IssueReportCardsResponse } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { fmtMarks, getPressTemplate, printPressSheets, setPressTemplate, type PressTemplate } from '@/lib/press';
import { OrderDrawer } from '@/components/press/order-drawer';
import { ReportCardSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * One class × one window: the compiled batch, the remarks, and the printer.
 *
 * The table is the office's checking pass — every number on it is computed the
 * same way the printed card computes it, because both come from the same
 * compile. "Issue" writes the register (serials + snapshots); printing without
 * issuing is a proof, watermark-free, for the teacher to red-pen first.
 */

/** The card needs snapshot shape; the batch carries the same data split in two. */
function toSnapshot(batch: ReportCardBatch, s: ReportCardStudent): ReportCardSnapshot {
  return {
    kind: 'REPORT_CARD',
    school: batch.school,
    windowName: batch.window.name,
    academicYearName: batch.window.academicYearName,
    classLabel: batch.classSection.label,
    classTeacherName: batch.classSection.classTeacherName,
    student: {
      name: s.studentName, rollNo: s.rollNo, admissionNo: s.admissionNo,
      // dob/guardian ride only on the server-issued snapshot; the office
      // preview and proof print don't show them.
      dob: null, guardianName: null,
    },
    subjects: s.subjects,
    overall: s.overall,
    attendance: s.attendance,
    remark: s.remark,
  };
}

function RemarkCell({ initial, onSave }: { initial: string | null; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial ?? '');
  return (
    <textarea
      className="sk-input"
      rows={1}
      maxLength={400}
      placeholder="Class teacher's remark…"
      value={text}
      style={{ width: '100%', minWidth: 220, resize: 'vertical', fontSize: 12.5 }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if ((initial ?? '') !== text.trim()) onSave(text.trim());
      }}
    />
  );
}

export default function PressBatchPage() {
  const { windowId, classId } = useParams<{ windowId: string; classId: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const batch = useQuery({
    queryKey: ['press-batch', host, windowId, classId], enabled: !!host,
    queryFn: () => api.get<ReportCardBatch>(`/manage/press/report-cards/${windowId}/${classId}`),
  });

  const saveRemark = useMutation({
    mutationFn: (body: { studentId: string; text: string }) =>
      api.put<{ saved: true }>('/manage/press/remarks', { windowId, ...body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['press-batch', host, windowId, classId] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'The remark did not save.'),
  });

  const issue = useMutation({
    mutationFn: () =>
      api.post<IssueReportCardsResponse>('/manage/press/report-cards/issue', { windowId, classSectionId: classId }),
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ['press-batch', host, windowId, classId] });
      if (out.issued.length) toast.success(`${out.issued.length} card${out.issued.length === 1 ? '' : 's'} entered in the register.`);
      if (out.skipped.length && !out.issued.length) toast.info('Every card in this batch is already in the register.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Issuing failed — nothing was recorded.'),
  });

  const b = batch.data;
  const students = b?.students ?? [];
  const unissued = students.filter((s) => !s.issued).length;
  const issuedCount = students.length - unissued;
  const [ordering, setOrdering] = useState(false);
  // The template is a per-browser preference (presentation only — both render
  // the same snapshot). Read after mount: the server can't know this browser.
  const [template, setTemplate] = useState<PressTemplate>('BOARD');
  useEffect(() => { setTemplate(getPressTemplate()); }, []);
  const pickTemplate = (t: PressTemplate) => { setTemplate(t); setPressTemplate(t); };
  const snapshots = useMemo(() => (b ? students.map((s) => toSnapshot(b, s)) : []), [b, students]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Link href="/app/press" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft size={13} aria-hidden="true" /> The Press
          </Link>
          <h1>{b ? `${b.classSection.label} · ${b.window.name}` : 'Report cards'}</h1>
          <p>
            {b
              ? `${students.length} students · ${b.window.startDate} to ${b.window.endDate}` +
                (b.classSection.classTeacherName ? ` · Class teacher ${b.classSection.classTeacherName}` : '')
              : 'Compiling…'}
          </p>
        </div>
        {b && students.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', border: '1px solid var(--sk-line)', borderRadius: 9, overflow: 'hidden' }}>
              {(['BOARD', 'CLASSIC'] as const).map((t) => (
                <button key={t} className="sk-btn" aria-pressed={template === t}
                  style={{ border: 'none', borderRadius: 0, padding: '6px 11px', fontSize: 12 }}
                  onClick={() => pickTemplate(t)}>
                  {t === 'BOARD' ? 'Board pattern' : 'Classic'}
                </button>
              ))}
            </span>
            <button className="sk-btn" onClick={printPressSheets}>
              <Printer size={15} aria-hidden="true" /> Print proofs
            </button>
            {issuedCount > 0 && (
              <button className="sk-btn" onClick={() => setOrdering(true)}>
                <Package size={15} aria-hidden="true" /> Print via Sckools
              </button>
            )}
            <button
              className="sk-btn" data-variant="primary"
              disabled={issue.isPending || unissued === 0}
              onClick={() => issue.mutate()}
            >
              <BookMarked size={15} aria-hidden="true" />
              {issue.isPending ? 'Entering register…' : unissued === 0 ? 'All in the register' : `Issue ${unissued} to the register`}
            </button>
          </div>
        )}
      </header>

      {batch.isLoading && <p className="sk-state">Compiling from the marks teachers entered…</p>}
      {batch.isError && (
        <p className="sk-state err">
          {batch.error instanceof ApiError ? batch.error.message : 'This batch could not compile. Refresh to try again.'}
        </p>
      )}

      {b && students.length === 0 && (
        <div className="sk-card"><div className="sk-card-b">
          <p className="sk-state">No active students in this class.</p>
        </div></div>
      )}

      {b && students.length > 0 && (
        <>
          {b.subjects.length === 0 && (
            <div className="sk-card"><div className="sk-card-b">
              <p className="sk-state">
                No tests fall between {b.window.startDate} and {b.window.endDate} for this class, so the cards carry
                attendance and remarks only. If that looks wrong, widen the window on the Press home.
              </p>
            </div></div>
          )}

          {b.unpublishedCount > 0 && (
            <div className="sk-card" style={{ borderColor: 'var(--sk-amber)' }}><div className="sk-card-b">
              <p className="sk-state" style={{ color: 'var(--sk-amber-ink)' }}>
                <b>{b.unpublishedCount} mark{b.unpublishedCount === 1 ? '' : 's'} in this window {b.unpublishedCount === 1 ? 'is' : 'are'} entered but not published.</b>{' '}
                Cards only carry published marks — the same rule the family portal follows — so those show as dashes
                here. Ask the teacher to publish from Tests &amp; Results, then this page recompiles itself.
              </p>
            </div></div>
          )}

          {/* The checking table — wide data scrolls INSIDE this card. */}
          <div className="sk-card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--sk-ink-3)', fontSize: 11.5 }}>
                    <th style={{ padding: '10px 8px 8px 16px' }}>Roll</th>
                    <th style={{ padding: '10px 8px 8px' }}>Student</th>
                    {b.subjects.map((sub) => (
                      <th key={sub.subjectId} style={{ padding: '10px 8px 8px', whiteSpace: 'nowrap' }}>{sub.subjectName}</th>
                    ))}
                    <th style={{ padding: '10px 8px 8px' }}>Overall</th>
                    <th style={{ padding: '10px 8px 8px' }}>Attend.</th>
                    <th style={{ padding: '10px 16px 8px 8px', minWidth: 240 }}>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.studentId} style={{ borderTop: '1px solid var(--sk-line)' }}>
                      <td style={{ padding: '8px 8px 8px 16px', color: 'var(--sk-ink-3)' }}>{s.rollNo ?? '—'}</td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        <b style={{ fontWeight: 650 }}>{s.studentName}</b>
                        {s.issued && (
                          <span className="sk-pill" data-tone="good" style={{ marginLeft: 8 }}>{s.issued.serial}</span>
                        )}
                      </td>
                      {s.subjects.map((line) => (
                        <td key={line.subjectId} style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                          {line.marks === null ? (
                            <span style={{ color: 'var(--sk-ink-3)' }}>—</span>
                          ) : (
                            <>
                              {fmtMarks(line.marks)}/{line.maxMarks}{' '}
                              <span style={{ color: 'var(--sk-ink-3)', fontSize: 11.5 }}>{line.grade}</span>
                            </>
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '8px', whiteSpace: 'nowrap', fontWeight: 650 }}>
                        {s.overall.pct === null ? '—' : `${s.overall.pct}% ${s.overall.grade}`}
                      </td>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        {s.attendance.pct === null ? '—' : `${s.attendance.pct}%`}
                      </td>
                      <td style={{ padding: '8px 16px 8px 8px' }}>
                        <RemarkCell
                          initial={s.remark}
                          onSave={(text) => saveRemark.mutate({ studentId: s.studentId, text })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {unissued === 0 ? (
            <p className="sk-state">
              This whole batch is in the register. If marks change now, the printed record does not — reprint official
              copies from <Link href="/app/press/register" style={{ color: 'var(--sk-brand-2)' }}>the register</Link>.
            </p>
          ) : (
            <p className="sk-state">
              Print proofs first — they come out stamped PROOF — red-pen them with the class teacher, then issue.
              Issuing freezes each card as it stands at that moment and gives it a register serial; official prints
              come from the register.
            </p>
          )}

          {/* On-screen preview of the first card, so nobody prints blind. */}
          {snapshots[0] && (
            <div className="pr-preview">
              <div className="pr-zoom">
                <ReportCardSheet snapshot={snapshots[0]} stamp="PROOF" template={template} />
              </div>
            </div>
          )}

          {/* The full batch, hidden on screen — this is what actually prints.
              Portaled to <body>: the print CSS hides every OTHER body child. */}
          <PressPrintPortal>
            {snapshots.map((snap, i) => (
              <ReportCardSheet key={students[i]!.studentId} snapshot={snap} stamp="PROOF" template={template} />
            ))}
          </PressPrintPortal>

          {ordering && b && (
            <OrderDrawer
              target={{
                kind: 'REPORT_CARDS', windowId, classSectionId: classId,
                issuedCount, batchLabel: `${b.classSection.label} · ${b.window.name}`,
              }}
              onClose={() => setOrdering(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
