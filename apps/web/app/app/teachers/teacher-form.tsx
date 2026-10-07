'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import {
  BLOOD_GROUPS,
  EMPLOYMENT_TYPES,
  GENDERS,
  POLICE_VERIFICATION,
  PROFESSIONAL_QUALIFICATIONS,
  TEACHER_DESIGNATIONS,
  TET_STATUSES,
} from '@skoolos/types';
import { EmailHint } from '@/components/use-email-check';
import { DateField } from '@/components/ui/date-field';
import { ApiError } from '@/lib/api';
import { optimised } from '@/lib/img';

/**
 * THE TEACHER RECORD, AS A FORM.
 *
 * What a school keeps on file — and what an inspection asks to see — is the
 * post and the qualification it requires (CBSE Affiliation Bye-laws), TET for
 * anyone teaching classes I–VIII (RTE s.23 / NCTE), when they joined and on
 * what terms, the safety checks (police verification, POCSO awareness), an
 * emergency contact, and the WhatsApp number that updates and actions go to.
 *
 * Three things are required (2026-10-07): a first name, the email that becomes
 * their login, and the mobile that WhatsApp, the phone login and leave
 * approvals hang on. Everything else can be filled at hiring or later, and the
 * side panel says what an inspection would still find missing.
 *
 * Save is never greyed out. Pressing it checks the form: each problem field
 * turns red with its reason under it, a summary at the top names them, and
 * focus goes to the first — inside a folded section, that section opens. An
 * error from the server lands on its field the same way, never only in a toast.
 */
export interface TeacherRecordInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoAssetId: string | null;
  gender: string;
  dob: string;
  bloodGroup: string;
  whatsappPhone: string;
  whatsappOptIn: boolean;
  employeeCode: string;
  designation: string;
  department: string;
  employmentType: string;
  joinedOn: string;
  highestQualification: string;
  professionalQualification: string;
  tetStatus: string;
  tetCertificateNo: string;
  tetValidTill: string;
  specialisation: string;
  experienceYears: string;
  previousSchool: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  policeVerification: string;
  policeVerifiedOn: string;
  medicalFitnessOn: string;
  pocsoTrainedOn: string;
}

/** Field names the form owns, in the order the sections show them. */
export const TEACHER_RECORD_FIELDS = Object.keys({
  firstName: 1, lastName: 1, email: 1, phone: 1, photoAssetId: 1, gender: 1, dob: 1, bloodGroup: 1, whatsappPhone: 1, whatsappOptIn: 1,
  employeeCode: 1, designation: 1, department: 1, employmentType: 1, joinedOn: 1, highestQualification: 1, professionalQualification: 1,
  tetStatus: 1, tetCertificateNo: 1, tetValidTill: 1, specialisation: 1, experienceYears: 1, previousSchool: 1, addressLine1: 1,
  addressLine2: 1, city: 1, region: 1, postalCode: 1, emergencyContactName: 1, emergencyContactPhone: 1, emergencyContactRelation: 1,
  policeVerification: 1, policeVerifiedOn: 1, medicalFitnessOn: 1, pocsoTrainedOn: 1,
} satisfies Record<keyof TeacherRecordInput, 1>) as (keyof TeacherRecordInput)[];

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : '');

/** A stored teacher (or nothing) → the form's string-valued state. */
export function toRecordInput(t: Partial<Record<string, unknown>> = {}): TeacherRecordInput {
  return {
    firstName: s(t.firstName), lastName: s(t.lastName), email: s(t.email), phone: s(t.phone),
    photoAssetId: (t.photoAssetId as string | null | undefined) ?? null,
    gender: s(t.gender), dob: day(t.dob), bloodGroup: s(t.bloodGroup),
    whatsappPhone: s(t.whatsappPhone), whatsappOptIn: !!t.whatsappOptIn,
    employeeCode: s(t.employeeCode), designation: s(t.designation), department: s(t.department),
    employmentType: s(t.employmentType), joinedOn: day(t.joinedOn),
    highestQualification: s(t.highestQualification), professionalQualification: s(t.professionalQualification),
    tetStatus: s(t.tetStatus), tetCertificateNo: s(t.tetCertificateNo), tetValidTill: day(t.tetValidTill),
    specialisation: s(t.specialisation), experienceYears: s(t.experienceYears), previousSchool: s(t.previousSchool),
    addressLine1: s(t.addressLine1), addressLine2: s(t.addressLine2), city: s(t.city), region: s(t.region), postalCode: s(t.postalCode),
    emergencyContactName: s(t.emergencyContactName), emergencyContactPhone: s(t.emergencyContactPhone), emergencyContactRelation: s(t.emergencyContactRelation),
    policeVerification: s(t.policeVerification), policeVerifiedOn: day(t.policeVerifiedOn),
    medicalFitnessOn: day(t.medicalFitnessOn), pocsoTrainedOn: day(t.pocsoTrainedOn),
  };
}

/**
 * The form's state → the API body. Text fields are trimmed; an EMPTY string
 * is sent as '' on purpose (the API reads a blank as "not given" and clears
 * the column — `@BlankAsNull` in the DTO), except email, which is omitted
 * when blank so an edit never tries to clear a login address.
 */
export function toRecordBody(f: TeacherRecordInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of TEACHER_RECORD_FIELDS) {
    const v = f[k];
    if (k === 'photoAssetId') { body[k] = v; continue; }
    if (k === 'whatsappOptIn') { body[k] = !!v; continue; }
    if (k === 'experienceYears') { const n = String(v).trim(); if (n) body[k] = Number(n); continue; }
    const t = String(v ?? '').trim();
    if (k === 'email') { if (t) body[k] = t; continue; }
    body[k] = t;
  }
  return body;
}

// ── checking ─────────────────────────────────────────────────────────────────

/** The same rule as the API's `toE164`: 10 digits starting 6–9, with or without +91, spaces, dashes or a leading 0. */
export function isMobile(raw: string): boolean {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d);
  return d.length >= 11 && d.length <= 15;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FieldErrors = Partial<Record<keyof TeacherRecordInput | 'form', string>>;

/** What Save checks before anything is sent. The order is the order the summary and the focus follow. */
export function validateRecord(f: TeacherRecordInput): FieldErrors {
  const e: FieldErrors = {};
  if (!f.firstName.trim()) e.firstName = 'Enter their first name.';
  if (!f.email.trim()) e.email = 'Enter their email. It becomes their login.';
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'That is not an email address. Check for a missing @ or a typo.';
  if (!f.phone.trim()) e.phone = 'Enter their mobile number. WhatsApp updates and the phone login use it.';
  else if (!isMobile(f.phone)) e.phone = 'Enter a 10-digit mobile number.';
  if (f.whatsappPhone.trim() && !isMobile(f.whatsappPhone)) e.whatsappPhone = 'Enter a 10-digit WhatsApp number, or leave it blank to use the mobile.';
  const exp = f.experienceYears.trim();
  if (exp && !(/^\d{1,2}$/.test(exp) && +exp <= 60)) e.experienceYears = 'Whole years, 0 to 60.';
  return e;
}

/** An API refusal → the field it belongs on. Codes first (they carry `field`), then the DTO's own sentences. */
export function serverFieldErrors(err: unknown): FieldErrors {
  if (!(err instanceof ApiError)) return err instanceof Error ? { form: err.message } : {};
  const body = (err.body ?? {}) as { field?: string; message?: unknown };
  if (body.field && typeof body.message === 'string') {
    const k = body.field === 'phone' ? 'phone' : body.field === 'email' ? 'email' : null;
    return k ? { [k]: body.message } : { form: body.message };
  }
  const msgs = Array.isArray(body.message) ? body.message.map(String) : [err.message];
  const out: FieldErrors = {};
  for (const m of msgs) {
    const k: keyof FieldErrors =
      /first name/i.test(m) ? 'firstName'
        : /whatsapp/i.test(m) ? 'whatsappPhone'
          : /email/i.test(m) ? 'email'
            : /mobile|phone/i.test(m) ? 'phone'
              : /experience/i.test(m) ? 'experienceYears'
                : 'form';
    out[k] ??= m;
  }
  return out;
}

/** What GET /manage/teachers/identity-check answers. */
export interface IdentityCheck {
  teacherHere: { id: string; name: string; field: 'email' | 'phone'; left: boolean } | null;
  activeElsewhere: 'email' | 'phone' | null;
  familyHere: string[];
  phoneValid: boolean | null;
}

/** Where each checkable field lives, so a folded section opens to show its error. */
const SECTION_OF: Partial<Record<keyof TeacherRecordInput, string>> = { whatsappPhone: 'contact', experienceYears: 'qualifications' };
const ID_OF: Partial<Record<keyof FieldErrors, string>> = {
  firstName: 'tf-first', lastName: 'tf-last', email: 'tf-email', phone: 'tf-phone', whatsappPhone: 'tf-wa', experienceYears: 'tf-exp',
};
const LABEL_OF: Partial<Record<keyof FieldErrors, string>> = {
  firstName: 'First name', email: 'Email', phone: 'Mobile', whatsappPhone: 'WhatsApp number', experienceYears: 'Years of experience',
};
const ORDER: (keyof FieldErrors)[] = ['firstName', 'email', 'phone', 'whatsappPhone', 'experienceYears'];

/** The details an inspection asks for — what the side panel counts. */
const RECORD_CHECKLIST: [string, (f: TeacherRecordInput) => boolean][] = [
  ['Name, email and mobile', (f) => !!(f.firstName.trim() && f.email.trim() && f.phone.trim())],
  ['Post (PRT / TGT / PGT)', (f) => !!f.designation],
  ['Date of joining', (f) => !!f.joinedOn],
  ['B.Ed / D.El.Ed', (f) => !!f.professionalQualification],
  ['TET status', (f) => !!f.tetStatus],
  ['Police verification', (f) => !!f.policeVerification],
  ['POCSO training', (f) => !!f.pocsoTrainedOn],
  ['Medical fitness', (f) => !!f.medicalFitnessOn],
  ['Emergency contact', (f) => !!(f.emergencyContactName.trim() && f.emergencyContactPhone.trim())],
];

// ── primitives ───────────────────────────────────────────────────────────────

function Field({ label, htmlFor, hint, error, required, wide, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`sk-tf-field${wide ? ' wide' : ''}`}>
      {/* The asterisk is drawn by CSS, so the field's name stays "First name"; the input says aria-required. */}
      <label htmlFor={htmlFor} className="sk-lab" data-req={required || undefined}>{label}</label>
      {children}
      {error ? <span id={`${htmlFor}-err`} className="sk-tf-err" role="alert">{error}</span> : hint ? <span className="sk-tf-hint">{hint}</span> : null}
    </div>
  );
}

function Section({ title, summary, open, onToggle, problems, children }: { title: string; summary: string; open: boolean; onToggle: () => void; problems: number; children: ReactNode }) {
  return (
    <section className="sk-tf-sect">
      <button type="button" onClick={onToggle} aria-expanded={open} className="sk-press">
        <span className="t">{title}</span>
        {problems > 0 ? <span className="bad">{problems === 1 ? '1 field needs attention' : `${problems} fields need attention`}</span> : <span className="s">{summary}</span>}
        <ChevronDown className="h-4 w-4" style={{ flex: 'none', transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true" />
      </button>
      {open && <div className="body">{children}</div>}
    </section>
  );
}

type Opt = readonly [string, string];

// ── the form ─────────────────────────────────────────────────────────────────

export interface TeacherFormProps {
  title: string;
  /** A stored teacher, or nothing. Typed loosely on purpose: the page's Teacher interface has no index signature. */
  initial?: object;
  photoUrl?: string | null;
  onSave: (data: TeacherRecordInput) => void;
  isSaving: boolean;
  onCancel: () => void;
  onPhotoUpload: (file: File) => void;
  isUploadingPhoto: boolean;
  uploadedPhotoUrl: string | null;
  /** The last save's refusal, if any — put on its field. */
  serverError?: unknown;
  /** The live "who is this?" lookup. Absent → the panel shows only the record checklist. */
  checkIdentity?: (q: { email?: string; phone?: string; excludeId?: string }) => Promise<IdentityCheck>;
}

const label = (list: readonly Opt[], code: string) => list.find(([c]) => c === code)?.[1] ?? '';
const count = (vals: unknown[]) => vals.filter((v) => v !== '' && v !== null && v !== undefined && v !== false).length;

function isoToday(offsetYears = 0): string {
  const d = new Date();
  return `${d.getFullYear() + offsetYears}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TeacherForm({ title, initial = {}, photoUrl, onSave, isSaving, onCancel, onPhotoUpload, isUploadingPhoto, uploadedPhotoUrl, serverError, checkIdentity }: TeacherFormProps) {
  const init = initial as Record<string, unknown>;
  const selfId = typeof init.id === 'string' ? init.id : undefined;
  const [f, setF] = useState<TeacherRecordInput>(() => toRecordInput(init));
  const set = <K extends keyof TeacherRecordInput>(k: K) => (v: TeacherRecordInput[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const [open, setOpen] = useState<Record<string, boolean>>({ contact: false, employment: false, qualifications: false, compliance: false });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const photoInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = uploadedPhotoUrl ?? photoUrl;

  // ── errors: shown once Save has been pressed, then kept live as fields are fixed ──
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<FieldErrors>({});
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fe = serverFieldErrors(serverError);
    setServer(fe);
    const first = ORDER.find((k) => fe[k]);
    if (first) { const sec = SECTION_OF[first as keyof TeacherRecordInput]; if (sec) setOpen((o) => ({ ...o, [sec]: true })); setFocusTo(ID_OF[first] ?? null); }
  }, [serverError]);

  // A server error belongs to the value it was about: editing the field clears it.
  const edit = <K extends keyof TeacherRecordInput>(k: K) => (v: TeacherRecordInput[K]) => {
    set(k)(v);
    setServer((e) => (e[k] || e.form ? { ...e, [k]: undefined, form: undefined } : e));
  };

  // ── who is this? — debounced as the email and mobile are typed ──
  const [who, setWho] = useState<{ result: IdentityCheck | null; checking: boolean }>({ result: null, checking: false });
  const emailQ = EMAIL_RE.test(f.email.trim()) ? f.email.trim().toLowerCase() : '';
  const phoneQ = f.phone.trim() && isMobile(f.phone) ? f.phone.trim() : '';
  useEffect(() => {
    if (!checkIdentity || (!emailQ && !phoneQ)) { setWho({ result: null, checking: false }); return; }
    let live = true;
    // A result is only good for the values it was asked about.
    setWho({ result: null, checking: true });
    const t = setTimeout(() => {
      checkIdentity({ ...(emailQ ? { email: emailQ } : {}), ...(phoneQ ? { phone: phoneQ } : {}), ...(selfId ? { excludeId: selfId } : {}) })
        .then((result) => { if (live) setWho({ result, checking: false }); })
        .catch(() => { if (live) setWho({ result: null, checking: false }); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [checkIdentity, emailQ, phoneQ, selfId]);

  /** A clash the check found blocks Save on its field, before the server is even asked. */
  const clash: FieldErrors = {};
  const r = who.result;
  if (r?.teacherHere) {
    clash[r.teacherHere.field] = r.teacherHere.left
      ? `${r.teacherHere.name} already has a record here, marked as left. Reactivate it instead of adding a second one.`
      : `${r.teacherHere.name} is already a teacher here with this ${r.teacherHere.field === 'email' ? 'email' : 'number'}.`;
  } else if (r?.activeElsewhere) {
    clash[r.activeElsewhere] = 'Active as a teacher at another school on Sckools. That school must release them first.';
  }

  const local = attempted ? validateRecord(f) : {};
  const errors: FieldErrors = { ...clash, ...server, ...local };
  for (const k of Object.keys(errors) as (keyof FieldErrors)[]) if (!errors[k]) delete errors[k];
  const listed = ORDER.filter((k) => errors[k]);

  const save = () => {
    setAttempted(true);
    const all: FieldErrors = { ...clash, ...validateRecord(f) };
    const first = ORDER.find((k) => all[k]);
    if (first) {
      const sec = SECTION_OF[first as keyof TeacherRecordInput];
      if (sec) setOpen((o) => ({ ...o, [sec]: true }));
      setFocusTo(ID_OF[first] ?? null);
      return;
    }
    setServer({});
    onSave({ ...f, photoAssetId: (init.photoAssetId as string | null | undefined) ?? f.photoAssetId ?? null });
  };

  // Focus after the render that opened the section the field lives in.
  useEffect(() => {
    if (!focusTo) return;
    const el = document.getElementById(focusTo);
    if (el) { el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
    setFocusTo(null);
  }, [focusTo]);

  const err = (k: keyof FieldErrors) => errors[k];
  const inProps = (k: keyof TeacherRecordInput) => ({
    className: 'sk-tf-in',
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] ? `${ID_OF[k]}-err` : undefined,
  });
  const text = (id: string, k: keyof TeacherRecordInput, extra: { placeholder?: string; inputMode?: 'tel' | 'numeric' | 'email'; type?: string; autoComplete?: string; required?: boolean } = {}) => (
    <input id={id} type={extra.type ?? 'text'} inputMode={extra.inputMode} autoComplete={extra.autoComplete ?? 'off'} placeholder={extra.placeholder} aria-required={extra.required || undefined} value={f[k] as string} onChange={(e) => edit(k)(e.target.value as never)} {...inProps(k)} />
  );
  const select = (id: string, k: keyof TeacherRecordInput, options: readonly Opt[] | readonly string[]) => (
    <select id={id} className="sk-tf-in" value={f[k] as string} onChange={(e) => set(k)(e.target.value as never)}>
      <option value="">—</option>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o[0]} value={o[0]}>{o[1]}</option>))}
    </select>
  );
  const date = (id: string, k: keyof TeacherRecordInput, opts: { min?: string; max?: string; openTo?: string } = {}) => (
    <DateField id={id} className="sk-tf-in" value={f[k] as string} onChange={(v) => set(k)(v as never)} {...opts} />
  );

  const contactSummary = [f.whatsappPhone && `WhatsApp ${f.whatsappPhone}`, f.city].filter(Boolean).join(' · ') || 'WhatsApp, address, emergency contact';
  const employmentSummary = [label(TEACHER_DESIGNATIONS, f.designation), f.employeeCode, label(EMPLOYMENT_TYPES, f.employmentType), f.joinedOn && `joined ${f.joinedOn}`].filter(Boolean).join(' · ') || 'Post, code, type, joining date';
  const qualSummary = [f.highestQualification, f.professionalQualification, label(TET_STATUSES, f.tetStatus)].filter(Boolean).join(' · ') || 'Degrees, B.Ed, TET, experience';
  const complianceSummary = [f.policeVerification && `Police: ${label(POLICE_VERIFICATION, f.policeVerification)}`, f.pocsoTrainedOn && 'POCSO trained'].filter(Boolean).join(' · ') || 'Police verification, medical, POCSO';
  const filled = count(Object.values(f));
  const checklist = useMemo(() => RECORD_CHECKLIST.map(([name, done]) => [name, done(f)] as const), [f]);
  const done = checklist.filter(([, d]) => d).length;
  const today = isoToday();

  return (
    <div className="sk-tform">
      <div className="sk-card">
        <div className="sk-card-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <h3>{title}</h3>
          <span className="sk-muted" style={{ fontSize: 12 }}>{filled > 0 ? `${filled} details on file` : 'First name, email and mobile to start'}</span>
        </div>
        <div className="sk-card-b sk-tform-main">
          {(listed.length > 0 || errors.form) && (
            <div ref={summaryRef} className="sk-tf-sum" role="alert">
              {listed.length > 0 ? (
                <>
                  <span>{listed.length === 1 ? '1 field needs attention:' : `${listed.length} fields need attention:`}</span>
                  {listed.map((k, i) => (
                    <button key={k} type="button" onClick={() => { const sec = SECTION_OF[k as keyof TeacherRecordInput]; if (sec) setOpen((o) => ({ ...o, [sec]: true })); setFocusTo(ID_OF[k] ?? null); }}>
                      {LABEL_OF[k]}{i < listed.length - 1 ? ',' : ''}
                    </button>
                  ))}
                </>
              ) : (
                <span>{errors.form}</span>
              )}
            </div>
          )}

          {/* ── Basics — always open ── */}
          <div className="sk-tform-grid">
            <Field label="First name" htmlFor="tf-first" required error={err('firstName')}>{text('tf-first', 'firstName', { placeholder: 'e.g. Rajeshwari', autoComplete: 'given-name', required: true })}</Field>
            <Field label="Last name" htmlFor="tf-last" hint="Optional — leave blank if they use one name.">{text('tf-last', 'lastName', { placeholder: 'e.g. Balasubramanian', autoComplete: 'family-name' })}</Field>
            <Field label="Email" htmlFor="tf-email" required error={err('email')} hint={!err('email') && <EmailHint value={f.email} onFix={edit('email')} />}>
              {text('tf-email', 'email', { type: 'email', inputMode: 'email', placeholder: 'e.g. r.bala@school.edu.in', required: true })}
            </Field>
            <Field label="Mobile" htmlFor="tf-phone" required error={err('phone')} hint="WhatsApp updates and the phone login use this number.">
              {text('tf-phone', 'phone', { inputMode: 'tel', placeholder: '10-digit mobile', autoComplete: 'tel-national', required: true })}
            </Field>
            <Field label="Gender" htmlFor="tf-gender">{select('tf-gender', 'gender', GENDERS)}</Field>
            <Field label="Date of birth" htmlFor="tf-dob">{date('tf-dob', 'dob', { min: '1940-01-01', max: isoToday(-17), openTo: '1990-01' })}</Field>
            <div className="sk-tf-field wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {previewUrl ? (
                <img src={optimised(previewUrl, 112)} alt="Teacher photo" style={{ height: 56, width: 56, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--sk-line)' }} />
              ) : (
                <span className="sk-muted" style={{ fontSize: 12.5 }}>{init.photoAssetId ? 'Photo set — upload to replace.' : 'No photo yet.'}</span>
              )}
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onPhotoUpload(file); e.target.value = ''; }} />
              <button type="button" className="sk-btn sk-press" disabled={isUploadingPhoto} onClick={() => photoInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                {isUploadingPhoto ? 'Uploading…' : previewUrl || init.photoAssetId ? 'Replace photo' : 'Upload photo'}
              </button>
            </div>
          </div>

          {/* ── Contact ── */}
          <Section title="Contact" summary={contactSummary} open={open.contact} onToggle={() => toggle('contact')} problems={errors.whatsappPhone ? 1 : 0}>
            <div className="sk-tform-grid">
              <Field label="WhatsApp number" htmlFor="tf-wa" error={err('whatsappPhone')} hint="Only if it is different from the mobile. Updates and announcements go here.">
                {text('tf-wa', 'whatsappPhone', { inputMode: 'tel', placeholder: 'Same as mobile' })}
              </Field>
              <label className="wide" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={f.whatsappOptIn} onChange={(e) => set('whatsappOptIn')(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ fontWeight: 600 }}>They agreed to school messages on WhatsApp</span>
                  <span className="sk-muted" style={{ display: 'block', fontSize: 12 }}>Also lets them act from that number — apply for leave, mark attendance — once those actions are switched on.</span>
                </span>
              </label>
              <Field label="Address" htmlFor="tf-addr1">{text('tf-addr1', 'addressLine1', { placeholder: 'House, street' })}</Field>
              <Field label="Address, line 2" htmlFor="tf-addr2">{text('tf-addr2', 'addressLine2', { placeholder: 'Area, landmark' })}</Field>
              <Field label="City" htmlFor="tf-city">{text('tf-city', 'city', { placeholder: 'Jaipur' })}</Field>
              <Field label="State" htmlFor="tf-region">{text('tf-region', 'region', { placeholder: 'Rajasthan' })}</Field>
              <Field label="PIN code" htmlFor="tf-pin">{text('tf-pin', 'postalCode', { inputMode: 'numeric', placeholder: '302021' })}</Field>
              <Field label="Emergency contact" htmlFor="tf-ec-name">{text('tf-ec-name', 'emergencyContactName', { placeholder: 'Name' })}</Field>
              <Field label="Their phone" htmlFor="tf-ec-phone">{text('tf-ec-phone', 'emergencyContactPhone', { inputMode: 'tel', placeholder: '98765 43210' })}</Field>
              <Field label="Relation" htmlFor="tf-ec-rel">{text('tf-ec-rel', 'emergencyContactRelation', { placeholder: 'Spouse, parent…' })}</Field>
            </div>
          </Section>

          {/* ── Employment ── */}
          <Section title="Employment" summary={employmentSummary} open={open.employment} onToggle={() => toggle('employment')} problems={0}>
            <div className="sk-tform-grid">
              <Field label="Post" htmlFor="tf-desig" hint="PRT / TGT / PGT as the board registers them.">{select('tf-desig', 'designation', TEACHER_DESIGNATIONS)}</Field>
              <Field label="Employee code" htmlFor="tf-code">{text('tf-code', 'employeeCode', { placeholder: 'RPS-T-042' })}</Field>
              <Field label="Department" htmlFor="tf-dept">{text('tf-dept', 'department', { placeholder: 'Science' })}</Field>
              <Field label="Employment type" htmlFor="tf-etype">{select('tf-etype', 'employmentType', EMPLOYMENT_TYPES)}</Field>
              <Field label="Date of joining" htmlFor="tf-joined">{date('tf-joined', 'joinedOn', { min: '1960-01-01', max: isoToday(1) })}</Field>
              <Field label="Blood group" htmlFor="tf-blood">{select('tf-blood', 'bloodGroup', BLOOD_GROUPS)}</Field>
            </div>
          </Section>

          {/* ── Qualifications ── */}
          <Section title="Qualifications" summary={qualSummary} open={open.qualifications} onToggle={() => toggle('qualifications')} problems={errors.experienceYears ? 1 : 0}>
            <div className="sk-tform-grid">
              <Field label="Highest qualification" htmlFor="tf-hq">{text('tf-hq', 'highestQualification', { placeholder: 'M.Sc Physics' })}</Field>
              <Field label="Professional qualification" htmlFor="tf-pq" hint="B.Ed for TGT/PGT, D.El.Ed or B.El.Ed for PRT.">{select('tf-pq', 'professionalQualification', PROFESSIONAL_QUALIFICATIONS)}</Field>
              <Field label="Subject specialisation" htmlFor="tf-spec">{text('tf-spec', 'specialisation', { placeholder: 'Physics' })}</Field>
              <Field label="Years of experience" htmlFor="tf-exp" error={err('experienceYears')}>{text('tf-exp', 'experienceYears', { inputMode: 'numeric', placeholder: '11' })}</Field>
              <Field label="Previous school" htmlFor="tf-prev">{text('tf-prev', 'previousSchool', { placeholder: 'DPS Jaipur' })}</Field>
              <Field label="TET status" htmlFor="tf-tet" hint="Required to teach classes I–VIII (RTE). Not required for PGTs and non-teaching posts.">{select('tf-tet', 'tetStatus', TET_STATUSES)}</Field>
              <Field label="TET certificate no." htmlFor="tf-tetno">{text('tf-tetno', 'tetCertificateNo', { placeholder: 'Roll / certificate number' })}</Field>
              <Field label="TET valid till" htmlFor="tf-tetvalid">{date('tf-tetvalid', 'tetValidTill', { min: '2011-01-01', max: '2075-12-31' })}</Field>
            </div>
          </Section>

          {/* ── Compliance ── */}
          <Section title="Safety & compliance" summary={complianceSummary} open={open.compliance} onToggle={() => toggle('compliance')} problems={0}>
            <div className="sk-tform-grid">
              <Field label="Police verification" htmlFor="tf-pv" hint="Asked for before a teacher meets children.">{select('tf-pv', 'policeVerification', POLICE_VERIFICATION)}</Field>
              <Field label="Verified on" htmlFor="tf-pvon">{date('tf-pvon', 'policeVerifiedOn', { min: '1990-01-01', max: today })}</Field>
              <Field label="Medical fitness certificate on" htmlFor="tf-med">{date('tf-med', 'medicalFitnessOn', { min: '1990-01-01', max: today })}</Field>
              <Field label="POCSO awareness training on" htmlFor="tf-pocso">{date('tf-pocso', 'pocsoTrainedOn', { min: '2012-01-01', max: today })}</Field>
            </div>
          </Section>

          <div className="sk-actions" style={{ marginTop: 4 }}>
            <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={save} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="sk-btn sk-press" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>

      {/* ── The side panel: who this is, and what the record still lacks ── */}
      <aside className="sk-tf-side" aria-label="About this teacher">
        {checkIdentity && (
          <div className="sk-card">
            <div className="sk-card-h"><h3 style={{ fontSize: 15 }}>Who is this?</h3></div>
            <div className="sk-card-b" aria-live="polite">
              {!emailQ && !phoneQ ? (
                <div className="sk-tf-who" data-tone="idle"><span className="dot" /><span>Type their email and mobile. We check whether they are already a teacher here or at another school.</span></div>
              ) : who.checking && !r ? (
                <div className="sk-tf-who" data-tone="idle"><span className="dot" /><span>Checking…</span></div>
              ) : r ? (
                <>
                  {r.teacherHere ? (
                    <div className="sk-tf-who" data-tone="bad"><span className="dot" /><span><b>Already a teacher here.</b> {r.teacherHere.name}{r.teacherHere.left ? ' (marked as left — reactivate that record)' : ''}.</span></div>
                  ) : (
                    <div className="sk-tf-who"><span className="dot" /><span><b>Not a teacher here yet.</b> No teacher at this school has this {emailQ && phoneQ ? 'email or number' : emailQ ? 'email' : 'number'}.</span></div>
                  )}
                  {!r.teacherHere && (r.activeElsewhere ? (
                    <div className="sk-tf-who" data-tone="bad"><span className="dot" /><span><b>Active at another school.</b> That school must release them before they can join here.</span></div>
                  ) : (
                    <div className="sk-tf-who"><span className="dot" /><span><b>Free to join.</b> Not an active teacher at any other school.</span></div>
                  ))}
                  {r.familyHere.length > 0 && (
                    <div className="sk-tf-who" data-tone="warn"><span className="dot" /><span><b>Also a parent here.</b> This number is on {r.familyHere.slice(0, 3).join(', ')}{r.familyHere.length > 3 ? ' and more' : ''}. That is fine: one login opens both.</span></div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="sk-card">
          <div className="sk-card-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h3 style={{ fontSize: 15 }}>Record for inspection</h3>
            <span className="sk-muted sk-num" style={{ fontSize: 12 }}>{done} of {checklist.length}</span>
          </div>
          <div className="sk-card-b">
            <div className="sk-tf-meter" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={done} aria-label="Record completeness"><i style={{ width: `${(done / checklist.length) * 100}%` }} /></div>
            <ul className="sk-tf-list">
              {checklist.map(([name, d]) => <li key={name} data-done={d || undefined}>{name}</li>)}
            </ul>
            <span className="sk-muted" style={{ fontSize: 12 }}>None of these block saving. Fill them in now or later.</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
