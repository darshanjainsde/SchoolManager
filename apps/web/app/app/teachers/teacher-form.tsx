'use client';
import { useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
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

/**
 * THE TEACHER RECORD, AS A FORM.
 *
 * Creating a teacher used to take two names and an email. What a school keeps
 * on file — and what an inspection asks to see — is the post and the
 * qualification it requires (CBSE Affiliation Bye-laws), TET for anyone
 * teaching classes I–VIII (RTE s.23 / NCTE), when they joined and on what
 * terms, the safety checks (police verification, POCSO awareness), an
 * emergency contact, and the WhatsApp number that updates and actions go to.
 *
 * Quick-add stays quick: Basics is open, the four record sections are
 * collapsed, and the only required fields are still the two names. A school
 * that fills everything in at hiring time never has to come back; one that
 * does not is never blocked.
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
 * is sent as '' on purpose (the API clears the column), except email which
 * the API validates as an address and so is omitted when blank.
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

// ── themed primitives (the page's own recipe: inline fields, brand focus ring) ──
const fieldStyle: CSSProperties = {
  display: 'block', width: '100%', border: '1px solid var(--sk-line-2)', borderRadius: 10, padding: '9px 11px',
  background: 'var(--sk-card)', color: 'var(--sk-ink)', fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};
function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}
function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}
function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <label htmlFor={htmlFor} className="sk-lab">{label}</label>
      {children}
      {hint && <span className="sk-muted" style={{ fontSize: 11.5 }}>{hint}</span>}
    </div>
  );
}
/** Two columns on a laptop, one on a phone — never a fixed pixel track. */
const twoUp: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 };

function Section({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section style={{ borderTop: '1px solid var(--sk-line)', paddingTop: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="sk-press"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 0, padding: '6px 0', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}
      >
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</span>
        <span className="sk-muted" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <ChevronDown className="h-4 w-4" style={{ flex: 'none', transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} aria-hidden="true" />
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6, paddingBottom: 4 }}>{children}</div>}
    </section>
  );
}

type Opt = readonly [string, string];
function Select({ id, value, onChange, options, placeholder = '—' }: { id: string; value: string; onChange: (v: string) => void; options: readonly Opt[] | readonly string[]; placeholder?: string }) {
  return (
    <select id={id} style={fieldStyle} onFocus={ringFocus} onBlur={ringBlur} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o[0]} value={o[0]}>{o[1]}</option>))}
    </select>
  );
}
function Text({ id, value, onChange, type = 'text', placeholder, inputMode }: { id: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; inputMode?: 'tel' | 'numeric' }) {
  return <input id={id} type={type} inputMode={inputMode} style={fieldStyle} onFocus={ringFocus} onBlur={ringBlur} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

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
}

const label = (list: readonly Opt[], code: string) => list.find(([c]) => c === code)?.[1] ?? '';
const count = (vals: unknown[]) => vals.filter((v) => v !== '' && v !== null && v !== undefined && v !== false).length;

export default function TeacherForm({ title, initial = {}, photoUrl, onSave, isSaving, onCancel, onPhotoUpload, isUploadingPhoto, uploadedPhotoUrl }: TeacherFormProps) {
  const init = initial as Record<string, unknown>;
  const [f, setF] = useState<TeacherRecordInput>(() => toRecordInput(init));
  const set = <K extends keyof TeacherRecordInput>(k: K) => (v: TeacherRecordInput[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const [open, setOpen] = useState<Record<string, boolean>>({ contact: false, employment: false, qualifications: false, compliance: false });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const photoInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = uploadedPhotoUrl ?? photoUrl;
  const canSave = f.firstName.trim() && f.lastName.trim();

  const contactSummary = [f.whatsappPhone && `WhatsApp ${f.whatsappPhone}`, f.city].filter(Boolean).join(' · ') || 'Phone, WhatsApp, address, emergency contact';
  const employmentSummary = [label(TEACHER_DESIGNATIONS, f.designation), f.employeeCode, label(EMPLOYMENT_TYPES, f.employmentType), f.joinedOn && `joined ${f.joinedOn}`].filter(Boolean).join(' · ') || 'Post, code, type, joining date';
  const qualSummary = [f.highestQualification, f.professionalQualification, label(TET_STATUSES, f.tetStatus)].filter(Boolean).join(' · ') || 'Degrees, B.Ed, TET, experience';
  const complianceSummary = [f.policeVerification && `Police: ${label(POLICE_VERIFICATION, f.policeVerification)}`, f.pocsoTrainedOn && 'POCSO trained'].filter(Boolean).join(' · ') || 'Police verification, medical, POCSO';
  const filled = count(Object.values(f)) - 2; // the two names are always there

  return (
    <div className="sk-card" style={{ maxWidth: 640 }}>
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <h3>{title}</h3>
        <span className="sk-muted" style={{ fontSize: 12 }}>{filled > 0 ? `${filled} details on file` : 'Only the names are needed to start'}</span>
      </div>
      <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Basics — always open ── */}
        <div style={twoUp}>
          <Field label="First name" htmlFor="tf-first"><Text id="tf-first" value={f.firstName} onChange={set('firstName')} placeholder="Rajeshwari" /></Field>
          <Field label="Last name" htmlFor="tf-last"><Text id="tf-last" value={f.lastName} onChange={set('lastName')} placeholder="Balasubramanian" /></Field>
        </div>
        <Field label="Email (optional — needed to create their login)" htmlFor="tf-email">
          <Text id="tf-email" type="email" value={f.email} onChange={set('email')} placeholder="r.balasubramanian@school.edu.in" />
          <EmailHint value={f.email} onFix={set('email')} />
        </Field>
        <div style={twoUp}>
          <Field label="Gender" htmlFor="tf-gender"><Select id="tf-gender" value={f.gender} onChange={set('gender')} options={GENDERS} /></Field>
          <Field label="Date of birth" htmlFor="tf-dob"><Text id="tf-dob" type="date" value={f.dob} onChange={set('dob')} /></Field>
        </div>

        {/* Photo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {previewUrl ? (
            <img src={previewUrl} alt="Teacher photo" style={{ height: 56, width: 56, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--sk-line)' }} />
          ) : (
            <span className="sk-muted" style={{ fontSize: 12.5 }}>{init.photoAssetId ? 'Photo set — upload to replace.' : 'No photo yet.'}</span>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onPhotoUpload(file); e.target.value = ''; }} />
          <button type="button" className="sk-btn sk-press" disabled={isUploadingPhoto} onClick={() => photoInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {isUploadingPhoto ? 'Uploading…' : previewUrl || init.photoAssetId ? 'Replace photo' : 'Upload photo'}
          </button>
        </div>

        {/* ── Contact ── */}
        <Section title="Contact" summary={contactSummary} open={open.contact} onToggle={() => toggle('contact')}>
          <div style={twoUp}>
            <Field label="Phone" htmlFor="tf-phone" hint="The number on the school's records."><Text id="tf-phone" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" /></Field>
            <Field label="WhatsApp number" htmlFor="tf-wa" hint="Updates and announcements go here. Leave blank if it is the same as the phone."><Text id="tf-wa" inputMode="tel" value={f.whatsappPhone} onChange={set('whatsappPhone')} placeholder="98765 43210" /></Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.whatsappOptIn} onChange={(e) => set('whatsappOptIn')(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontWeight: 600 }}>They agreed to school messages on WhatsApp</span>
              <span className="sk-muted" style={{ display: 'block', fontSize: 12 }}>Also lets them act from that number — apply for leave, mark attendance — once those actions are switched on.</span>
            </span>
          </label>
          <Field label="Address" htmlFor="tf-addr1"><Text id="tf-addr1" value={f.addressLine1} onChange={set('addressLine1')} placeholder="House, street" /></Field>
          <Field label="Address, line 2" htmlFor="tf-addr2"><Text id="tf-addr2" value={f.addressLine2} onChange={set('addressLine2')} placeholder="Area, landmark" /></Field>
          <div style={twoUp}>
            <Field label="City" htmlFor="tf-city"><Text id="tf-city" value={f.city} onChange={set('city')} placeholder="Jaipur" /></Field>
            <Field label="State" htmlFor="tf-region"><Text id="tf-region" value={f.region} onChange={set('region')} placeholder="Rajasthan" /></Field>
            <Field label="PIN code" htmlFor="tf-pin"><Text id="tf-pin" inputMode="numeric" value={f.postalCode} onChange={set('postalCode')} placeholder="302021" /></Field>
          </div>
          <div style={twoUp}>
            <Field label="Emergency contact" htmlFor="tf-ec-name"><Text id="tf-ec-name" value={f.emergencyContactName} onChange={set('emergencyContactName')} placeholder="Name" /></Field>
            <Field label="Their phone" htmlFor="tf-ec-phone"><Text id="tf-ec-phone" inputMode="tel" value={f.emergencyContactPhone} onChange={set('emergencyContactPhone')} placeholder="98765 43210" /></Field>
            <Field label="Relation" htmlFor="tf-ec-rel"><Text id="tf-ec-rel" value={f.emergencyContactRelation} onChange={set('emergencyContactRelation')} placeholder="Spouse, parent…" /></Field>
          </div>
        </Section>

        {/* ── Employment ── */}
        <Section title="Employment" summary={employmentSummary} open={open.employment} onToggle={() => toggle('employment')}>
          <div style={twoUp}>
            <Field label="Post" htmlFor="tf-desig" hint="PRT / TGT / PGT as the board registers them."><Select id="tf-desig" value={f.designation} onChange={set('designation')} options={TEACHER_DESIGNATIONS} /></Field>
            <Field label="Employee code" htmlFor="tf-code"><Text id="tf-code" value={f.employeeCode} onChange={set('employeeCode')} placeholder="RPS-T-042" /></Field>
            <Field label="Department" htmlFor="tf-dept"><Text id="tf-dept" value={f.department} onChange={set('department')} placeholder="Science" /></Field>
            <Field label="Employment type" htmlFor="tf-etype"><Select id="tf-etype" value={f.employmentType} onChange={set('employmentType')} options={EMPLOYMENT_TYPES} /></Field>
            <Field label="Date of joining" htmlFor="tf-joined"><Text id="tf-joined" type="date" value={f.joinedOn} onChange={set('joinedOn')} /></Field>
            <Field label="Blood group" htmlFor="tf-blood"><Select id="tf-blood" value={f.bloodGroup} onChange={set('bloodGroup')} options={BLOOD_GROUPS} /></Field>
          </div>
        </Section>

        {/* ── Qualifications ── */}
        <Section title="Qualifications" summary={qualSummary} open={open.qualifications} onToggle={() => toggle('qualifications')}>
          <div style={twoUp}>
            <Field label="Highest qualification" htmlFor="tf-hq"><Text id="tf-hq" value={f.highestQualification} onChange={set('highestQualification')} placeholder="M.Sc Physics" /></Field>
            <Field label="Professional qualification" htmlFor="tf-pq" hint="B.Ed for TGT/PGT, D.El.Ed or B.El.Ed for PRT."><Select id="tf-pq" value={f.professionalQualification} onChange={set('professionalQualification')} options={PROFESSIONAL_QUALIFICATIONS} /></Field>
            <Field label="Subject specialisation" htmlFor="tf-spec"><Text id="tf-spec" value={f.specialisation} onChange={set('specialisation')} placeholder="Physics" /></Field>
            <Field label="Years of experience" htmlFor="tf-exp"><Text id="tf-exp" inputMode="numeric" value={f.experienceYears} onChange={set('experienceYears')} placeholder="11" /></Field>
            <Field label="Previous school" htmlFor="tf-prev"><Text id="tf-prev" value={f.previousSchool} onChange={set('previousSchool')} placeholder="DPS Jaipur" /></Field>
          </div>
          <div style={twoUp}>
            <Field label="TET status" htmlFor="tf-tet" hint="Required to teach classes I–VIII (RTE). Not required for PGTs and non-teaching posts."><Select id="tf-tet" value={f.tetStatus} onChange={set('tetStatus')} options={TET_STATUSES} /></Field>
            <Field label="TET certificate no." htmlFor="tf-tetno"><Text id="tf-tetno" value={f.tetCertificateNo} onChange={set('tetCertificateNo')} placeholder="Roll / certificate number" /></Field>
            <Field label="TET valid till" htmlFor="tf-tetvalid"><Text id="tf-tetvalid" type="date" value={f.tetValidTill} onChange={set('tetValidTill')} /></Field>
          </div>
        </Section>

        {/* ── Compliance ── */}
        <Section title="Safety & compliance" summary={complianceSummary} open={open.compliance} onToggle={() => toggle('compliance')}>
          <div style={twoUp}>
            <Field label="Police verification" htmlFor="tf-pv" hint="Asked for before a teacher meets children."><Select id="tf-pv" value={f.policeVerification} onChange={set('policeVerification')} options={POLICE_VERIFICATION} /></Field>
            <Field label="Verified on" htmlFor="tf-pvon"><Text id="tf-pvon" type="date" value={f.policeVerifiedOn} onChange={set('policeVerifiedOn')} /></Field>
            <Field label="Medical fitness certificate on" htmlFor="tf-med"><Text id="tf-med" type="date" value={f.medicalFitnessOn} onChange={set('medicalFitnessOn')} /></Field>
            <Field label="POCSO awareness training on" htmlFor="tf-pocso"><Text id="tf-pocso" type="date" value={f.pocsoTrainedOn} onChange={set('pocsoTrainedOn')} /></Field>
          </div>
        </Section>

        <div className="sk-actions" style={{ marginTop: 4 }}>
          <button className="sk-btn sk-press" data-variant="primary" onClick={() => onSave({ ...f, photoAssetId: (init.photoAssetId as string | null | undefined) ?? f.photoAssetId ?? null })} disabled={isSaving || !canSave}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button className="sk-btn sk-press" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
