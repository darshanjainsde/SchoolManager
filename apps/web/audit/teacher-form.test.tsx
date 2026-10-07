// @vitest-environment jsdom
/**
 * Renders the REAL Add teacher form in the states an office meets it in, and
 * writes them for measure.html (2026-10-07):
 *  1. Save pressed with nothing filled — three red fields and the summary;
 *  2. a clash found by the live check, with the "also a parent here" line and
 *     every section open (the longest the form gets);
 *  3. the date field's calendar open.
 * The ledger entry this guards is `form-card-capped-on-a-wide-screen`: judge
 * the panel at 1440 and 1920, where the old 640px card left half the screen bare.
 *
 * <body> deliberately does NOT carry `.skosx` here (the app's doesn't): the
 * first version of this page put it there, so the portalled calendar borrowed
 * the theme from <body> and measured fine while on the real page it opened
 * see-through (2026-10-07). A portal must bring its own theme scope.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import TeacherForm, { type IdentityCheck } from '@/app/app/teachers/teacher-form';

vi.mock('@/components/use-email-check', () => ({ EmailHint: () => null }));

const base = { onSave: vi.fn(), isSaving: false, onCancel: vi.fn(), onPhotoUpload: vi.fn(), isUploadingPhoto: false, uploadedPhotoUrl: null };
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 60)); }); };

async function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  return { host, root };
}

describe('audit: the teacher form', () => {
  it('writes audit/teacher-form.html', async () => {
    // 1 — Save pressed empty.
    const one = await mount(<TeacherForm {...base} title="Add teacher" checkIdentity={vi.fn()} />);
    await act(async () => { (one.host.querySelector('button[data-variant="primary"]') as HTMLButtonElement).click(); });
    await settle();
    expect(one.host.querySelectorAll('[aria-invalid="true"]').length).toBe(3);

    // 2 — a long, full record with a clash, every section open.
    const clash: IdentityCheck = { teacherHere: null, activeElsewhere: 'phone', familyHere: ['Aarav Agarwal (III-B)', 'Meera Agarwal (VII-A)'], phoneValid: true };
    const two = await mount(
      <TeacherForm
        {...base}
        title="Edit teacher"
        checkIdentity={async () => clash}
        initial={{
          id: 't1', firstName: 'Mohammed Irfan', lastName: 'Venkataraghavan-Qureshi', email: 'mohammed.irfan.venkataraghavan@rafflesinternational.edu.in', phone: '+91 98765 43210',
          gender: 'MALE', dob: '1984-11-23', designation: 'PGT', employeeCode: 'RIS-T-2041', department: 'Physics and Electronics', employmentType: 'PERMANENT', joinedOn: '2011-06-01',
          professionalQualification: 'B.Ed', tetStatus: 'NOT_REQUIRED', experienceYears: 22, policeVerification: 'CLEARED', policeVerifiedOn: '2011-05-20',
          whatsappPhone: '98765 43210', addressLine1: '14, Shanti Niketan Colony, Near Ram Mandir', city: 'Sawai Madhopur', region: 'Rajasthan', postalCode: '322001',
        }}
      />,
    );
    for (const b of [...two.host.querySelectorAll<HTMLButtonElement>('.sk-tf-sect > button')]) await act(async () => { b.click(); });
    await settle();
    expect(two.host.textContent).toContain('Active at another school.');

    // 3 — the calendar open on a date of birth.
    const three = await mount(<TeacherForm {...base} title="Add teacher" initial={{ dob: '1990-03-14' }} />);
    await act(async () => { (three.host.querySelector('#tf-dob ~ .sk-dfield-btn') as HTMLButtonElement).click(); });
    await settle();
    // The calendar is portalled to <body>; it is written after </main>, where the app puts it.
    const pop = document.body.querySelector('.sk-dfield-pop');
    expect(pop).not.toBeNull();
    expect(three.host.querySelector('.sk-dfield-pop')).toBeNull();

    const panel = (h: string, html: string) => `<section class="audit-panel"><p class="audit-h">${h}</p>${html}</section>`;
    writeFileSync(resolve(process.cwd(), 'audit/teacher-form.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>body{margin:0;padding:10px;background:var(--sk-bg,#fff)} .audit-panel{margin-bottom:28px} .audit-panel:last-child{padding-bottom:380px}</style>
</head><body><main class="skosx">
${panel('Add teacher · Save pressed with nothing filled', one.host.innerHTML)}
${panel('Edit teacher · long record, clash found, every section open', two.host.innerHTML)}
${panel('Add teacher · date of birth calendar open', three.host.innerHTML)}
</main>${pop!.outerHTML}</body></html>`);
    for (const m of [one, two, three]) m.root.unmount();
  });
});
