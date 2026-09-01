'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer, ScrollText, Search } from 'lucide-react';
import type { CertificatePrepare, CertificateSnapshot, PressCertificateType } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { PRESS_TYPE_LABEL, pressDateLabel, printPressSheets } from '@/lib/press';
import { CertificateSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * The certificate desk: find the student, choose the certificate, check the
 * wording, issue, print.
 *
 * Issuing and printing are ONE gesture here — a certificate exists to be
 * handed over, and the serial is allocated on issue (never on print), so the
 * print that follows carries the register's own number.
 */

type StudentHit = { id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean };
type IssueResult = { id: string; serial: string; issuedAt: string };

const CERT_TYPES: PressCertificateType[] = ['TC', 'BONAFIDE', 'CHARACTER'];

const EMPTY_FORM = { conduct: '', reason: '', fromDate: '', toDate: '', classLabel: '', purpose: '', note: '' };

export default function CertificateDeskPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [certType, setCertType] = useState<PressCertificateType>('TC');
  const [form, setForm] = useState(EMPTY_FORM);
  const [duesOverride, setDuesOverride] = useState(false);
  /** The just-issued certificate, rendered into the print container. */
  const [printed, setPrinted] = useState<{ snapshot: CertificateSnapshot; serial: string; issuedAt: string; duplicate: boolean } | null>(null);
  const printedSerialRef = useRef<string | null>(null);

  /**
   * Print AFTER the portal committed — a timer raced React and could open the
   * dialog on an empty container, printing blank pages for a serial already
   * burned into the register. The effect runs after the DOM holds the sheet.
   * The first print is the original; the sheet in the container then flips to
   * DUPLICATE so "Print again" says what it is.
   */
  useEffect(() => {
    if (!printed || printed.duplicate || printedSerialRef.current === printed.serial) return;
    printedSerialRef.current = printed.serial;
    printPressSheets();
    setPrinted({ ...printed, duplicate: true });
  }, [printed]);

  const hits = useQuery({
    queryKey: ['press-student-search', host, q], enabled: !!host && q.trim().length >= 2,
    queryFn: () => api.get<StudentHit[]>(`/manage/press/students?q=${encodeURIComponent(q.trim())}`),
  });

  const prepare = useQuery({
    queryKey: ['press-cert-prepare', host, studentId], enabled: !!host && !!studentId,
    queryFn: () => api.get<CertificatePrepare>(`/manage/press/certificates/prepare/${studentId}`),
  });

  const issue = useMutation({
    mutationFn: () =>
      api.post<IssueResult>('/manage/press/certificates/issue', {
        studentId: studentId!,
        type: certType,
        duesOverride,
        ...(form.conduct.trim() ? { conduct: form.conduct.trim() } : {}),
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
        ...(form.fromDate ? { fromDate: form.fromDate } : {}),
        ...(form.toDate ? { toDate: form.toDate } : {}),
        ...(form.classLabel.trim() ? { classLabel: form.classLabel.trim() } : {}),
        ...(form.purpose.trim() ? { purpose: form.purpose.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      }),
    onSuccess: async (out) => {
      // The register row's snapshot is the truth — fetch it rather than
      // trusting the locally assembled copy, then print THAT.
      const row = await api.get<{ snapshot: CertificateSnapshot; serial: string; issuedAt: string }>(
        `/manage/press/register/${out.id}`,
      );
      setPrinted({ snapshot: row.snapshot, serial: row.serial, issuedAt: row.issuedAt, duplicate: false });
      qc.invalidateQueries({ queryKey: ['press-cert-prepare', host, studentId] });
      toast.success(`${PRESS_TYPE_LABEL[certType]} ${out.serial} entered in the register.`);
    },
    onError: (e) => {
      const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
      if (code === 'DUES_OUTSTANDING') {
        toast.error(e.message);
        setDuesOverride(false);
        return;
      }
      toast.error(e instanceof ApiError ? e.message : 'Issuing failed — nothing was recorded.');
    },
  });

  const p = prepare.data;
  const duesBlock = certType === 'TC' && (p?.duesMinor ?? 0) > 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="sk-pagehead">
        <Link href="/app/press" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowLeft size={13} aria-hidden="true" /> The Press
        </Link>
        <h1>Certificates</h1>
        <p>TC, bonafide and character — each one serial-numbered into the register as it prints.</p>
      </header>

      {/* ── find the student ─────────────────────────────────────────────── */}
      <div className="sk-card">
        <div className="sk-card-b">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} style={{ color: 'var(--sk-ink-3)', flex: 'none' }} aria-hidden="true" />
            <input
              className="sk-input" style={{ flex: 1 }}
              placeholder="Search by name or admission number…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setStudentId(null); }}
            />
          </label>
          {hits.data && hits.data.length > 0 && !studentId && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {hits.data.map((h) => (
                <button
                  key={h.id}
                  className="sk-btn"
                  style={{ justifyContent: 'flex-start', border: 'none', borderRadius: 8 }}
                  onClick={() => { setStudentId(h.id); setForm(EMPTY_FORM); setDuesOverride(false); setPrinted(null); }}
                >
                  <b>{h.name}</b>
                  <span style={{ color: 'var(--sk-ink-3)', fontWeight: 500 }}>
                    {h.classLabel ?? 'no class'} · Adm {h.admissionNo}{h.isActive ? '' : ' · left'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {hits.data && hits.data.length === 0 && q.trim().length >= 2 && (
            <p className="sk-state">Nobody matches — try a shorter part of the name, or the admission number.</p>
          )}
        </div>
      </div>

      {/* ── the certificate ─────────────────────────────────────────────── */}
      {studentId && prepare.isLoading && <p className="sk-state">Reading the record and the fee ledger…</p>}
      {p && (
        <div className="sk-card">
          <div className="sk-card-b">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{p.student.name}</b>
              <span style={{ color: 'var(--sk-ink-3)', fontSize: 13 }}>
                {p.student.classLabel ?? 'no class'} · Adm {p.student.admissionNo}
                {p.student.dob ? ` · DOB ${pressDateLabel(p.student.dob)}` : ''}
              </span>
            </div>

            {p.existing.length > 0 && (
              <p className="sk-state">
                Already in the register: {p.existing.map((e) => `${PRESS_TYPE_LABEL[e.type]} ${e.serial}`).join(' · ')} —
                reprint from <Link href="/app/press/register" style={{ color: 'var(--sk-brand-2)' }}>the register</Link> instead
                of issuing twice.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CERT_TYPES.map((t) => (
                <button key={t} className="sk-btn" aria-pressed={certType === t} onClick={() => setCertType(t)}>
                  {PRESS_TYPE_LABEL[t]}
                </button>
              ))}
            </div>

            {duesBlock && (
              <div style={{ border: '1px solid var(--sk-bad)', background: 'var(--sk-bad-tint)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
                <b style={{ color: 'var(--sk-bad)' }}>
                  Fees of ₹{((p.duesMinor) / 100).toLocaleString('en-IN')} are outstanding on the ledger.
                </b>{' '}
                A TC certifies dues are cleared. Collect first — or issue over it, and the register records the override.
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, fontWeight: 600 }}>
                  <input type="checkbox" checked={duesOverride} onChange={(e) => setDuesOverride(e.target.checked)} />
                  Issue anyway — recorded in the register
                </label>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                Conduct
                <input className="sk-input" placeholder="good" maxLength={60} value={form.conduct}
                  onChange={(e) => setForm({ ...form, conduct: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                Class on the certificate
                <input className="sk-input" placeholder={p.student.classLabel ?? 'Class'} maxLength={60} value={form.classLabel}
                  onChange={(e) => setForm({ ...form, classLabel: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                Attended from
                <input type="date" className="sk-input" value={form.fromDate || p.student.onRollSince}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                To {certType === 'BONAFIDE' ? '(leave empty for "to date")' : ''}
                <input type="date" className="sk-input" value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
              </label>
              {certType === 'TC' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                  Reason for leaving
                  <input className="sk-input" placeholder="Parent's transfer" maxLength={200} value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </label>
              )}
              {certType === 'BONAFIDE' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                  Purpose
                  <input className="sk-input" placeholder="bank account opening" maxLength={200} value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, gridColumn: '1 / -1' }}>
                Extra line (optional, printed verbatim)
                <input className="sk-input" maxLength={300} value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="sk-btn" data-variant="primary"
                disabled={issue.isPending || (duesBlock && !duesOverride)}
                onClick={() => issue.mutate()}
              >
                <ScrollText size={15} aria-hidden="true" />
                {issue.isPending ? 'Entering register…' : `Issue ${PRESS_TYPE_LABEL[certType].toLowerCase()} & print`}
              </button>
              {printed && (
                <button className="sk-btn" onClick={printPressSheets}>
                  <Printer size={15} aria-hidden="true" /> Print again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {printed && (
        <PressPrintPortal>
          <CertificateSheet
            snapshot={printed.snapshot}
            serial={printed.serial}
            issuedAt={printed.issuedAt}
            stamp={printed.duplicate ? 'DUPLICATE' : undefined}
          />
        </PressPrintPortal>
      )}
    </div>
  );
}
