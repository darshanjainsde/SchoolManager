'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BookMarked, ExternalLink, Layers, Printer, ScrollText, Search, Shield } from 'lucide-react';
import type {
  BulkCertificateResult, CertificatePrepare, CertificateSnapshot, PressCertificateType,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { PRESS_TYPE_LABEL, pressDateLabel, printPressSheets } from '@/lib/press';
import { CertificateSheet } from '@/components/press/press-sheets';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import { PrintRoom } from '@/components/press/print-room';
import '@/components/press/press-print.css';

/**
 * The certificate desk: find the student, choose the certificate, check the
 * wording, issue, print.
 *
 * Two modes, one register:
 *   - ONE child (the daily case) — the TC form is the statutory Annexure-I,
 *     so the drawer asks the Annexure's questions. File facts (parentage,
 *     nationality, category, first admission, PEN) are asked ONCE: the API
 *     saves them back to the student row, and the next certificate prefills.
 *   - A WHOLE CLASS (the season case: the passing-out class's TCs, the
 *     scholarship bonafides) — one run, per-child skips with reasons, one
 *     print of everything issued.
 *
 * Issuing and printing are ONE gesture — a certificate exists to be handed
 * over, and the serial is allocated on issue (never on print), so the print
 * that follows carries the register's own number.
 */

type StudentHit = { id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean };
type ClassRow = { id: string; label: string; studentCount: number };
type IssueResult = { id: string; serial: string; issuedAt: string };

const CERT_TYPES: PressCertificateType[] = ['TC', 'BONAFIDE', 'CHARACTER'];
const CATEGORIES = ['', 'GENERAL', 'SC', 'ST', 'OBC', 'EWS'];

const EMPTY_FORM = {
  conduct: '', reason: '', fromDate: '', toDate: '', classLabel: '', purpose: '', note: '',
  // Annexure answers
  examLastTaken: '', failedBefore: '', subjects: '', qualifiedForPromotion: '', promotedToClass: '',
  feesPaidUpto: '', feeConcession: '', workingDays: '', presentDays: '', nccScout: '', games: '',
  dateOfApplication: '', indexNo: '', yearOfPassing: '',
  // file facts (saved back)
  fatherName: '', motherName: '', nationality: '', category: '', firstAdmissionDate: '',
  firstAdmissionClass: '', previousSchool: '', penId: '',
};

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--sk-ink-3)', textTransform: 'uppercase', marginTop: 4 }}>
      {children}
    </div>
  );
}

/**
 * The school's statutory face — CBSE (default) · CISCE · STATE. Saved on the
 * school profile (the same row the website studio edits), so it is set once
 * and every future certificate snapshot freezes it. Admin-only: the profile
 * route is SCHOOL_ADMIN, so STAFF just see the current face.
 */
function VariantPicker() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const role = useAuthStore((st) => st.role);

  const content = useQuery({
    queryKey: ['site-content', host], enabled: !!host && role === 'SCHOOL_ADMIN',
    queryFn: () => api.get<{ profile: { certVariant?: string | null } | null }>('/site/content'),
  });
  const save = useMutation({
    mutationFn: (certVariant: string) => api.put('/site/profile', { certVariant }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['site-content', host] });
      toast.success('Certificate face saved — every certificate from now prints it.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  if (role !== 'SCHOOL_ADMIN') return null;
  const current = content.data?.profile?.certVariant ?? 'CBSE';
  return (
    <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600 }}>
      Certificate face
      <select className="sk-input" style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }} value={current}
        disabled={save.isPending} onChange={(e) => save.mutate(e.target.value)}>
        <option value="CBSE">CBSE · Annexure-I</option>
        <option value="CISCE">CISCE · + Index No.</option>
        <option value="STATE">State · Leaving Certificate</option>
      </select>
    </label>
  );
}

export default function CertificateDeskPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);

  // The Press counter links here as /certificates?q=ADM-NO — seed the search
  // once, after mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('q');
    if (fromUrl) setQ(fromUrl);
    const t = params.get('type');
    if (t === 'TC' || t === 'BONAFIDE' || t === 'CHARACTER') setCertType(t);
    if (params.get('mode') === 'bulk') setBulkOpen(true);
  }, []);
  const [certType, setCertType] = useState<PressCertificateType>('TC');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [duesOverride, setDuesOverride] = useState(false);
  /** The just-issued certificate(s), rendered into the print container. */
  const [printed, setPrinted] = useState<{
    sheets: { snapshot: CertificateSnapshot; serial: string; issuedAt: string }[];
    duplicate: boolean;
  } | null>(null);
  const printedKeyRef = useRef<string | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Print AFTER the portal committed — a timer raced React and could open the
   * dialog on an empty container, printing blank pages for a serial already
   * burned into the register. The effect runs after the DOM holds the sheet.
   * The first print is the original; the sheets in the container then flip to
   * DUPLICATE so "Print again" says what it is.
   */
  useEffect(() => {
    if (!printed || printed.duplicate) return;
    const key = printed.sheets.map((s) => s.serial).join('|');
    if (printedKeyRef.current === key) return;
    printedKeyRef.current = key;
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

  // The asked-once prefill: when the child's file arrives, whatever it
  // already knows lands in the form; blanks stay blank for the office to
  // answer, and the API saves those answers back to the file on issue.
  const p = prepare.data;
  useEffect(() => {
    if (!p) return;
    setForm((f) => ({
      ...f,
      fatherName: p.student.fatherName ?? '',
      motherName: p.student.motherName ?? '',
      nationality: p.student.nationality ?? 'Indian',
      category: p.student.category ?? '',
      firstAdmissionDate: p.student.firstAdmissionDate ?? '',
      firstAdmissionClass: p.student.firstAdmissionClass ?? '',
      previousSchool: p.student.previousSchool ?? '',
      penId: p.student.penId ?? '',
      workingDays: p.attendance ? String(p.attendance.workingDays) : '',
      presentDays: p.attendance ? String(p.attendance.presentDays) : '',
      dateOfApplication: new Date().toISOString().slice(0, 10),
    }));
  }, [p]);

  const issueBody = () => {
    const val = (k: keyof typeof EMPTY_FORM) => form[k].trim();
    const opt = (k: keyof typeof EMPTY_FORM) => (val(k) ? { [k]: val(k) } : {});
    return {
      studentId: studentId!,
      type: certType,
      duesOverride,
      ...opt('conduct'), ...opt('reason'), ...opt('classLabel'), ...opt('purpose'), ...opt('note'),
      ...(form.fromDate ? { fromDate: form.fromDate } : {}),
      ...(form.toDate ? { toDate: form.toDate } : {}),
      ...(certType === 'TC'
        ? {
            ...opt('examLastTaken'), ...opt('failedBefore'), ...opt('subjects'),
            ...opt('qualifiedForPromotion'), ...opt('promotedToClass'), ...opt('feesPaidUpto'),
            ...opt('feeConcession'), ...opt('workingDays'), ...opt('presentDays'),
            ...opt('nccScout'), ...opt('games'), ...opt('indexNo'), ...opt('yearOfPassing'),
            ...(form.dateOfApplication ? { dateOfApplication: form.dateOfApplication } : {}),
          }
        : {}),
      // File facts save back on EVERY type — a bonafide is as good a moment
      // to complete the file as a TC.
      ...opt('fatherName'), ...opt('motherName'), ...opt('nationality'), ...opt('category'),
      ...opt('firstAdmissionClass'), ...opt('previousSchool'), ...opt('penId'),
      ...(form.firstAdmissionDate ? { firstAdmissionDate: form.firstAdmissionDate } : {}),
    };
  };

  const issue = useMutation({
    mutationFn: () => api.post<IssueResult>('/manage/press/certificates/issue', issueBody()),
    onSuccess: async (out) => {
      // The register row's snapshot is the truth — fetch it rather than
      // trusting the locally assembled copy, then print THAT.
      const row = await api.get<{ snapshot: CertificateSnapshot; serial: string; issuedAt: string }>(
        `/manage/press/register/${out.id}`,
      );
      setPrinted({ sheets: [{ snapshot: row.snapshot, serial: row.serial, issuedAt: row.issuedAt }], duplicate: false });
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

  const duesBlock = certType === 'TC' && (p?.duesMinor ?? 0) > 0;
  const isTC = certType === 'TC';

  // ── bulk mode ─────────────────────────────────────────────────────────────
  const [bulkType, setBulkType] = useState<PressCertificateType>('BONAFIDE');
  const [bulkClass, setBulkClass] = useState('');
  const [bulkCommon, setBulkCommon] = useState({ reason: '', purpose: '', conduct: '' });
  const [bulkDues, setBulkDues] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkCertificateResult | null>(null);

  const classes = useQuery({
    queryKey: ['press-classes', host], enabled: !!host && bulkOpen,
    queryFn: () => api.get<ClassRow[]>('/manage/press/classes'),
  });

  const bulk = useMutation({
    mutationFn: () =>
      api.post<BulkCertificateResult>('/manage/press/certificates/bulk', {
        type: bulkType,
        classSectionId: bulkClass,
        ...(bulkType === 'TC' && bulkDues ? { duesOverride: true } : {}),
        ...(bulkCommon.reason.trim() ? { reason: bulkCommon.reason.trim() } : {}),
        ...(bulkCommon.purpose.trim() ? { purpose: bulkCommon.purpose.trim() } : {}),
        ...(bulkCommon.conduct.trim() ? { conduct: bulkCommon.conduct.trim() } : {}),
      }),
    onSuccess: (out) => {
      setBulkResult(out);
      if (out.issued.length) {
        toast.success(`${out.issued.length} ${PRESS_TYPE_LABEL[bulkType].toLowerCase()}${out.issued.length === 1 ? '' : 's'} entered in the register.`);
      } else {
        toast.info('Nothing issued — every child in the class was skipped (reasons below).');
      }
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'The run failed — nothing was recorded.'),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Link href="/app/press" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft size={13} aria-hidden="true" /> The Press
          </Link>
          <h1>Certificates</h1>
          <p>TC (statutory Annexure-I form), bonafide and character — serial-numbered into the register as they print.</p>
        </div>
        <button className="sk-btn" aria-pressed={bulkOpen} onClick={() => setBulkOpen((v) => !v)}>
          <Layers size={15} aria-hidden="true" /> Whole class at once
        </button>
      </header>

      {/* ── the desk's tiles — pick the document, the flow follows ───────── */}
      {!studentId && (
        <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          {([
            { t: 'TC' as const, hint: 'statutory Annexure form · dues-gated', bg: 'var(--sk-bad)' },
            { t: 'BONAFIDE' as const, hint: 'purpose-first · 20 seconds', bg: 'var(--sk-good)' },
            { t: 'CHARACTER' as const, hint: 'conduct + span · letterhead', bg: 'var(--sk-brand)' },
          ]).map(({ t, hint, bg }) => (
            <button key={t} className="sk-entity sk-press" aria-pressed={certType === t && !bulkOpen}
              style={{ textAlign: 'left', cursor: 'pointer', borderColor: certType === t && !bulkOpen ? 'var(--sk-brand)' : undefined }}
              onClick={() => { setCertType(t); setBulkOpen(false); searchRef.current?.focus(); }}>
              <span className="av" style={{ background: bg }}><ScrollText size={18} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="nm">{PRESS_TYPE_LABEL[t]}</div>
                <div className="meta">{hint}</div>
              </div>
            </button>
          ))}
          <button className="sk-entity sk-press" aria-pressed={bulkOpen}
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: bulkOpen ? 'var(--sk-brand)' : undefined }}
            onClick={() => setBulkOpen((v) => !v)}>
            <span className="av" style={{ background: 'var(--sk-amber)' }}><Layers size={18} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="nm">Whole-class runs</div>
              <div className="meta">TCs for XII · scholarship bonafides</div>
            </div>
          </button>
          <Link href="/app/press/register" className="sk-entity sk-press">
            <span className="av" style={{ background: 'var(--sk-ink-2)' }}><BookMarked size={18} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="nm">Issued documents</div>
              <div className="meta">view · reprint · void — the register</div>
            </div>
          </Link>
        </div>
      )}

      {/* ── bulk mode ────────────────────────────────────────────────────── */}
      {bulkOpen && (
        <div className="sk-card" style={{ borderColor: 'var(--sk-brand)' }}>
          <div className="sk-card-b">
            <b style={{ fontSize: 14 }}>One class · one type · one run</b>
            <p className="sk-muted" style={{ fontSize: 12.5, margin: 0 }}>
              TCs for the passing-out class, bonafides for the scholarship season. Each child prints from their file —
              a child with unpaid dues or a live TC is skipped with the reason, never silently.
            </p>
            <div style={grid}>
              <label style={field}>Certificate
                <select className="sk-input" value={bulkType} onChange={(e) => { setBulkType(e.target.value as PressCertificateType); setBulkResult(null); }}>
                  {CERT_TYPES.map((t) => <option key={t} value={t}>{PRESS_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label style={field}>Class
                <select className="sk-input" value={bulkClass} onChange={(e) => { setBulkClass(e.target.value); setBulkResult(null); }}>
                  <option value="">Pick a class…</option>
                  {(classes.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.label} · {c.studentCount} students</option>
                  ))}
                </select>
              </label>
              {bulkType === 'TC' && (
                <label style={field}>Reason for leaving (whole run)
                  <input className="sk-input" maxLength={200} placeholder="Completed Class XII"
                    value={bulkCommon.reason} onChange={(e) => setBulkCommon({ ...bulkCommon, reason: e.target.value })} />
                </label>
              )}
              {bulkType === 'BONAFIDE' && (
                <label style={field}>Purpose (whole run)
                  <input className="sk-input" maxLength={200} placeholder="scholarship application"
                    value={bulkCommon.purpose} onChange={(e) => setBulkCommon({ ...bulkCommon, purpose: e.target.value })} />
                </label>
              )}
              {bulkType !== 'BONAFIDE' && (
                <label style={field}>Conduct (whole run)
                  <input className="sk-input" maxLength={60} placeholder="good"
                    value={bulkCommon.conduct} onChange={(e) => setBulkCommon({ ...bulkCommon, conduct: e.target.value })} />
                </label>
              )}
            </div>
            {bulkType === 'TC' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 }}>
                <input type="checkbox" checked={bulkDues} onChange={(e) => setBulkDues(e.target.checked)} />
                Issue over outstanding dues — recorded per child in the register
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="sk-btn" data-variant="primary" disabled={!bulkClass || bulk.isPending}
                onClick={() => bulk.mutate()}>
                <Layers size={15} aria-hidden="true" />
                {bulk.isPending ? 'Issuing the class…' : `Issue for the whole class`}
              </button>
              {bulkResult && bulkResult.issued.length > 0 && (
                <>
                  <button className="sk-btn"
                    onClick={() => setPrinted({ sheets: bulkResult.issued.map((i) => ({ snapshot: i.snapshot, serial: i.serial, issuedAt: i.issuedAt })), duplicate: false })}>
                    <Printer size={15} aria-hidden="true" /> Print all {bulkResult.issued.length}
                  </button>
                  <button className="sk-btn"
                    onClick={() => {
                      setPrinted({ sheets: bulkResult.issued.map((i) => ({ snapshot: i.snapshot, serial: i.serial, issuedAt: i.issuedAt })), duplicate: true });
                      setRoomOpen(true);
                    }}>
                    View all
                  </button>
                </>
              )}
            </div>

            {bulkResult && (
              <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bulkResult.issued.map((i) => (
                  <div key={i.studentId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{i.name}</span>
                    <span className="sk-pill" data-tone="good">{i.serial}</span>
                  </div>
                ))}
                {bulkResult.skipped.map((sk) => (
                  <div key={sk.studentId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: 'var(--sk-ink-2)' }}>
                    <span>{sk.name}</span>
                    <span className="sk-pill" data-tone="warn">{sk.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── find the student ─────────────────────────────────────────────── */}
      <div className="sk-card">
        <div className="sk-card-b">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} style={{ color: 'var(--sk-ink-3)', flex: 'none' }} aria-hidden="true" />
            <input
              ref={searchRef}
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

            {/* The file — asked once, saved back on issue. */}
            <SectionLabel>The file · saved back when you fill a blank</SectionLabel>
            <div style={grid}>
              <label style={field}>Father&rsquo;s name
                <input className="sk-input" maxLength={120} value={form.fatherName}
                  onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
              </label>
              <label style={field}>Mother&rsquo;s name
                <input className="sk-input" maxLength={120} value={form.motherName}
                  onChange={(e) => setForm({ ...form, motherName: e.target.value })} />
              </label>
              <label style={field}>Nationality
                <input className="sk-input" maxLength={60} value={form.nationality}
                  onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
              </label>
              <label style={field}>Category
                <select className="sk-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c === '' ? '—' : c}</option>)}
                </select>
              </label>
              <label style={field}>First admission — date
                <input type="date" className="sk-input" value={form.firstAdmissionDate}
                  onChange={(e) => setForm({ ...form, firstAdmissionDate: e.target.value })} />
              </label>
              <label style={field}>First admission — class
                <input className="sk-input" maxLength={40} placeholder="Class I" value={form.firstAdmissionClass}
                  onChange={(e) => setForm({ ...form, firstAdmissionClass: e.target.value })} />
              </label>
              <label style={field}>PEN / APAAR id
                <input className="sk-input" maxLength={40} value={form.penId}
                  onChange={(e) => setForm({ ...form, penId: e.target.value })} />
              </label>
            </div>

            <SectionLabel>{isTC ? 'The Annexure-I answers · blank prints as a line to fill by hand' : 'This certificate'}</SectionLabel>
            <div style={grid}>
              <label style={field}>Conduct
                <input className="sk-input" placeholder="good" maxLength={60} value={form.conduct}
                  onChange={(e) => setForm({ ...form, conduct: e.target.value })} />
              </label>
              <label style={field}>Class on the certificate
                <input className="sk-input" placeholder={p.student.classLabel ?? 'Class'} maxLength={60} value={form.classLabel}
                  onChange={(e) => setForm({ ...form, classLabel: e.target.value })} />
              </label>
              <label style={field}>Attended from
                <input type="date" className="sk-input" value={form.fromDate || p.student.onRollSince}
                  onChange={(e) => setForm({ ...form, fromDate: e.target.value })} />
              </label>
              <label style={field}>To {certType === 'BONAFIDE' ? '(leave empty for "to date")' : ''}
                <input type="date" className="sk-input" value={form.toDate}
                  onChange={(e) => setForm({ ...form, toDate: e.target.value })} />
              </label>
              {isTC && (
                <label style={field}>Reason for leaving
                  <input className="sk-input" placeholder="Parent's transfer" maxLength={200} value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </label>
              )}
              {certType === 'BONAFIDE' && (
                <label style={field}>Purpose
                  <input className="sk-input" placeholder="bank account opening" maxLength={200} value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                </label>
              )}
            </div>

            {isTC && (
              <div style={grid}>
                <label style={field}>8 · Last examination taken, with result
                  <input className="sk-input" maxLength={120} placeholder="Term I, School — passed" value={form.examLastTaken}
                    onChange={(e) => setForm({ ...form, examLastTaken: e.target.value })} />
                </label>
                <label style={field}>9 · Failed before? (once / twice / no)
                  <input className="sk-input" maxLength={60} placeholder="No" value={form.failedBefore}
                    onChange={(e) => setForm({ ...form, failedBefore: e.target.value })} />
                </label>
                <label style={{ ...field, gridColumn: '1 / -1' }}>10 · Subjects studied
                  <input className="sk-input" maxLength={200} placeholder="English, Hindi, Mathematics, Science, Social Science" value={form.subjects}
                    onChange={(e) => setForm({ ...form, subjects: e.target.value })} />
                </label>
                <label style={field}>11 · Qualified for promotion?
                  <input className="sk-input" maxLength={60} placeholder="Yes" value={form.qualifiedForPromotion}
                    onChange={(e) => setForm({ ...form, qualifiedForPromotion: e.target.value })} />
                </label>
                <label style={field}>&hellip;to which class
                  <input className="sk-input" maxLength={40} placeholder="IX" value={form.promotedToClass}
                    onChange={(e) => setForm({ ...form, promotedToClass: e.target.value })} />
                </label>
                <label style={field}>12 · Dues paid up to
                  <input className="sk-input" maxLength={40} placeholder="September 2026" value={form.feesPaidUpto}
                    onChange={(e) => setForm({ ...form, feesPaidUpto: e.target.value })} />
                </label>
                <label style={field}>13 · Fee concession, if any
                  <input className="sk-input" maxLength={120} value={form.feeConcession}
                    onChange={(e) => setForm({ ...form, feeConcession: e.target.value })} />
                </label>
                <label style={field}>14 · Working days
                  <input className="sk-input" maxLength={12} value={form.workingDays}
                    onChange={(e) => setForm({ ...form, workingDays: e.target.value })} />
                </label>
                <label style={field}>15 · Days present
                  <input className="sk-input" maxLength={12} value={form.presentDays}
                    onChange={(e) => setForm({ ...form, presentDays: e.target.value })} />
                </label>
                <label style={field}>16 · NCC / Scout / Guide
                  <input className="sk-input" maxLength={120} value={form.nccScout}
                    onChange={(e) => setForm({ ...form, nccScout: e.target.value })} />
                </label>
                <label style={field}>17 · Games / activities
                  <input className="sk-input" maxLength={160} value={form.games}
                    onChange={(e) => setForm({ ...form, games: e.target.value })} />
                </label>
                <label style={field}>19 · Date of application
                  <input type="date" className="sk-input" value={form.dateOfApplication}
                    onChange={(e) => setForm({ ...form, dateOfApplication: e.target.value })} />
                </label>
                <label style={field}>Index No. (CISCE face only)
                  <input className="sk-input" maxLength={40} value={form.indexNo}
                    onChange={(e) => setForm({ ...form, indexNo: e.target.value })} />
                </label>
                <label style={field}>Year of Council exam (CISCE)
                  <input className="sk-input" maxLength={10} value={form.yearOfPassing}
                    onChange={(e) => setForm({ ...form, yearOfPassing: e.target.value })} />
                </label>
              </div>
            )}

            <label style={{ ...field, gridColumn: '1 / -1' }}>
              {isTC ? '22 · Any other remarks' : 'Extra line (optional, printed verbatim)'}
              <input className="sk-input" maxLength={300} value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>

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
                <>
                  <button className="sk-btn" onClick={() => setRoomOpen(true)}>
                    View
                  </button>
                  <button className="sk-btn" onClick={printPressSheets}>
                    <Printer size={15} aria-hidden="true" /> Print again
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── formats & references — shown so the office can verify the standard ── */}
      <div className="sk-card"><div className="sk-card-b">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={14} aria-hidden="true" style={{ color: 'var(--sk-good)' }} />
          <b style={{ fontSize: 12.5 }}>Formats &amp; official references</b>
          <VariantPicker />
        </div>
        <p className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
          The TC prints the CBSE Examination Bye-laws <b>Annexure-I</b> form field for field; the CISCE face adds the
          Council&rsquo;s Index No.; the State face uses Leaving-Certificate naming. Bonafide and character are
          school-letterhead documents. Verify us against the sources:
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          <a href="https://www.cbse.gov.in/Byelawsenglish.pdf" target="_blank" rel="noreferrer" style={{ color: 'var(--sk-brand-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            CBSE Examination Bye-laws — Annexure-I (cbse.gov.in) <ExternalLink size={11} aria-hidden="true" />
          </a>
          <a href="https://cbseacademic.nic.in/web_material/publication/archive/byelawsenglish.pdf" target="_blank" rel="noreferrer" style={{ color: 'var(--sk-brand-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            same document · cbseacademic.nic.in <ExternalLink size={11} aria-hidden="true" />
          </a>
          <a href="https://parakh.ncert.gov.in/hpc" target="_blank" rel="noreferrer" style={{ color: 'var(--sk-brand-2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            PARAKH (NCERT) — Holistic Progress Card <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      </div></div>

      {printed && roomOpen && (
        <PrintRoom
          title={printed.sheets.length === 1
            ? printed.sheets[0]!.serial
            : `${printed.sheets.length} certificates`}
          onClose={() => setRoomOpen(false)}
          sheets={printed.sheets.map((sh) => ({
            kind: 'CERTIFICATE' as const, snapshot: sh.snapshot, serial: sh.serial,
            issuedAt: sh.issuedAt, stamp: 'DUPLICATE' as const,
          }))}
        />
      )}

      {printed && !roomOpen && (
        <PressPrintPortal>
          {printed.sheets.map((sh) => (
            <CertificateSheet
              key={sh.serial}
              snapshot={sh.snapshot}
              serial={sh.serial}
              issuedAt={sh.issuedAt}
              stamp={printed.duplicate ? 'DUPLICATE' : undefined}
            />
          ))}
        </PressPrintPortal>
      )}
    </div>
  );
}
