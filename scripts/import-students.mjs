#!/usr/bin/env node
/**
 * Launch-gate #1: getting 600 students in.
 *
 * Owner-run bulk student import — a tool you run BESIDE the product, using
 * only the product's own API (so RLS, validation, code allocation and the
 * invite flow all apply exactly as they would one-by-one in the console).
 *
 * Usage:
 *   node scripts/import-students.mjs \
 *     --file students.csv \
 *     --host beacon.sckools.com \
 *     --email admin@school.com \
 *     [--api https://api.sckools.com] [--commit] [--report out.json]
 *
 *   Password comes from SKOOLOS_ADMIN_PASSWORD (never a flag — flags land in
 *   shell history). DRY-RUN is the default: it validates the whole file,
 *   resolves every class section, and prints exactly what WOULD happen.
 *   Nothing is written until you pass --commit.
 *
 * CSV format (first row = headers; save the school's Excel as CSV):
 *   admission_no, first_name, last_name, class, section, roll_no,
 *   guardian_name, guardian_phone, email
 * - admission_no / first_name / last_name are required.
 * - class + section must NAME AN EXISTING section (e.g. class "Class 5",
 *   section "A" — or put "Class 5 A" in class and leave section empty).
 *   Create the class structure in the console first; the dry run lists any
 *   section the file needs that does not exist yet.
 * - email, when present, creates the login and sends the invite. Rows whose
 *   invite email FAILS to send are listed at the end — resend from the
 *   console (Students → Resend invite) once the mail path is healthy.
 */

import { readFileSync, writeFileSync } from 'node:fs';

// ── args ────────────────────────────────────────────────────────────────────
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--commit') args.commit = true;
  else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
}
const API = args.api ?? 'https://api.sckools.com';
const { file, host, email } = args;
const password = process.env.SKOOLOS_ADMIN_PASSWORD;
if (!file || !host || !email || !password) {
  console.error(
    'Required: --file <csv> --host <school host> --email <admin email>, plus SKOOLOS_ADMIN_PASSWORD in the environment.',
  );
  process.exit(1);
}

// ── tiny CSV parser (quotes, commas-in-quotes, CRLF) ───────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase().replace(/[\s_-]+/g, '');

// ── load + validate the file ────────────────────────────────────────────────
// Excel's "CSV UTF-8" option prepends a BOM, which would corrupt the first
// header into "﻿admission_no" and fail the required-column check.
const raw = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (raw.length < 2) {
  console.error('The file has no data rows.');
  process.exit(1);
}
const headers = raw[0].map(key);
const col = (name) => headers.indexOf(key(name));
const need = ['admission_no', 'first_name', 'last_name'];
for (const n of need) {
  if (col(n) === -1) {
    console.error(`Missing required column "${n}". Headers found: ${raw[0].join(', ')}`);
    process.exit(1);
  }
}
const students = raw.slice(1).map((r, i) => ({
  line: i + 2,
  admissionNo: norm(r[col('admission_no')]),
  firstName: norm(r[col('first_name')]),
  lastName: norm(r[col('last_name')]),
  klass: norm(col('class') >= 0 ? r[col('class')] : ''),
  section: norm(col('section') >= 0 ? r[col('section')] : ''),
  rollNo: norm(col('roll_no') >= 0 ? r[col('roll_no')] : ''),
  guardianName: norm(col('guardian_name') >= 0 ? r[col('guardian_name')] : ''),
  guardianPhone: norm(col('guardian_phone') >= 0 ? r[col('guardian_phone')] : ''),
  email: norm(col('email') >= 0 ? r[col('email')] : ''),
}));

const problems = [];
const seen = new Map();
for (const s of students) {
  if (!s.admissionNo || !s.firstName || !s.lastName)
    problems.push(`line ${s.line}: admission_no, first_name and last_name are required`);
  if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email))
    problems.push(`line ${s.line}: "${s.email}" does not look like an email`);
  if (seen.has(s.admissionNo))
    problems.push(`line ${s.line}: admission_no ${s.admissionNo} repeats line ${seen.get(s.admissionNo)}`);
  else seen.set(s.admissionNo, s.line);
}
if (problems.length) {
  console.error(`\n✕ ${problems.length} problem(s) in the file — nothing was sent:\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

// ── API helpers ─────────────────────────────────────────────────────────────
let token = '';
async function rawCall(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-skoolos-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.message ?? res.statusText;
    const err = new Error(`${method} ${path} → ${res.status} ${msg}`);
    err.status = res.status;
    err.code = json?.code;
    throw err;
  }
  return json;
}
async function signIn() {
  const r = await rawCall('POST', '/auth/login', { identifier: email, password });
  token = r.accessToken;
}
/** A 600-row commit outlives the ~15-minute access token — on the first 401,
 *  sign in again and retry the call once, so the run never dies mid-school. */
async function call(method, path, body) {
  try {
    return await rawCall(method, path, body);
  } catch (e) {
    if (e.status !== 401 || path === '/auth/login') throw e;
    await signIn();
    return rawCall(method, path, body);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── run ─────────────────────────────────────────────────────────────────────
await signIn();
console.log(`✓ Signed in to ${host} as ${email}`);

const [sections, existing] = await Promise.all([
  call('GET', '/manage/classes'),
  call('GET', '/manage/students'),
]);
// Only the COMPOSITE "grade name + section name" is indexed. A bare section
// name ("A") exists in every grade — matching it would silently drop a child
// into an arbitrary grade's section, which is worse than stopping.
const sectionByName = new Map();
for (const s of sections) {
  const grade = s.grade?.name ?? '';
  sectionByName.set(key(`${grade} ${s.name}`), s.id);
}
const existingRows = Array.isArray(existing) ? existing : (existing?.items ?? []);
const existingByAdmission = new Map(existingRows.map((s) => [s.admissionNo, s]));

const plan = { create: [], skip: [], reinvite: [], missingSection: new Map() };
for (const s of students) {
  const already = existingByAdmission.get(s.admissionNo);
  if (already) {
    // Re-run recovery: a previous run may have created the student but died
    // before (or failed at) the login/invite step. If this row has an email
    // and the existing student has NO login yet, finish the job.
    if (s.email && !already.userId) plan.reinvite.push({ ...s, id: already.id });
    else plan.skip.push(s);
    continue;
  }
  let classSectionId;
  const wanted = key(`${s.klass} ${s.section}`);
  if (wanted) {
    classSectionId = sectionByName.get(wanted);
    if (!classSectionId) {
      const label = `${s.klass}${s.section ? ' ' + s.section : ''}`;
      plan.missingSection.set(label, (plan.missingSection.get(label) ?? 0) + 1);
      continue;
    }
  }
  plan.create.push({ ...s, classSectionId });
}

console.log(`\nFile: ${students.length} students`);
console.log(`  will create: ${plan.create.length}`);
console.log(`  exist without a login — will create login + invite: ${plan.reinvite.length}`);
console.log(`  already exist with a login, skipped: ${plan.skip.length}`);
if (plan.missingSection.size) {
  console.log(`  BLOCKED — these class sections do not exist yet:`);
  for (const [label, n] of plan.missingSection) console.log(`    "${label}" (${n} students)`);
  console.log('  Create them in the console (Classes) and run again.');
  process.exit(1);
}

if (!args.commit) {
  console.log('\nDRY RUN — nothing was written. Re-run with --commit to import.');
  process.exit(0);
}

const results = [];
let n = 0;
for (const s of plan.reinvite) {
  n++;
  const label = `${s.admissionNo} ${s.firstName} ${s.lastName}`;
  try {
    const r = await call('POST', `/manage/students/${s.id}/login`, { email: s.email });
    results.push({ ...s, ok: true, invite: { emailSent: r.emailSent === true, loginName: r.loginName ?? null } });
    console.log(`  [reinvite] ${r.emailSent ? '✓' : '⚠ INVITE EMAIL FAILED'} ${label}`);
  } catch (e) {
    results.push({ ...s, ok: false, error: e.message });
    console.log(`  [reinvite] ✕ ${label} — ${e.message}`);
  }
  await sleep(750);
}
for (const s of plan.create) {
  n++;
  const label = `${s.admissionNo} ${s.firstName} ${s.lastName}`;
  try {
    const created = await call('POST', '/manage/students', {
      admissionNo: s.admissionNo,
      firstName: s.firstName,
      lastName: s.lastName,
      ...(s.classSectionId ? { classSectionId: s.classSectionId } : {}),
      ...(s.rollNo ? { rollNo: s.rollNo } : {}),
      ...(s.guardianName ? { guardianName: s.guardianName } : {}),
      ...(s.guardianPhone ? { guardianPhone: s.guardianPhone } : {}),
    });
    let invite = null;
    if (s.email) {
      const r = await call('POST', `/manage/students/${created.id}/login`, { email: s.email });
      invite = { emailSent: r.emailSent === true, loginName: r.loginName ?? null };
    }
    results.push({ ...s, id: created.id, ok: true, invite });
    console.log(
      `  [${n}/${plan.create.length}] ✓ ${label}` +
        (invite ? (invite.emailSent ? ' · invited' : ' · INVITE EMAIL FAILED') : ''),
    );
  } catch (e) {
    results.push({ ...s, ok: false, error: e.message });
    console.log(`  [${n}/${plan.create.length}] ✕ ${label} — ${e.message}`);
  }
  // Be a polite API client: stay far under the global 100 req/min limit.
  await sleep(750);
}

const failed = results.filter((r) => !r.ok);
const inviteFailed = results.filter((r) => r.ok && r.invite && !r.invite.emailSent);
console.log(`\nDone: ${results.length - failed.length} created, ${failed.length} failed.`);
if (inviteFailed.length) {
  console.log(`\n⚠ ${inviteFailed.length} invite email(s) DID NOT SEND — resend from the console once mail is healthy:`);
  for (const r of inviteFailed) console.log(`  ${r.admissionNo} ${r.firstName} ${r.lastName} <${r.email}>`);
}
if (failed.length) {
  console.log('\nFailed rows:');
  for (const r of failed) console.log(`  line ${r.line}: ${r.admissionNo} — ${r.error}`);
}
const reportPath = args.report ?? `import-report-${Date.now()}.json`;
writeFileSync(reportPath, JSON.stringify({ host, file, results }, null, 2));
console.log(`\nFull report: ${reportPath}`);
process.exit(failed.length ? 2 : 0);
