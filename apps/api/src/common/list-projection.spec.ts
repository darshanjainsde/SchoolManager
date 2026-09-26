import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE BIGGEST RESPONSE IN THE PRODUCT MUST BE A DELIBERATE LIST.
 *
 * `include: { classSection: … }` narrows the RELATION and says nothing at all
 * about the columns, so every scalar on the model ships. On Student that is 36
 * fields — both parents' names, nationality, category, previous school, the
 * PEN id, the E.164 phone twin, who last changed the status and when — to draw
 * a table with seven columns.
 *
 * Roughly 1,082 B per row against 365 B for what the screen renders: a
 * two-thousand-child school was sending about 2.1 MB to list its roll, and the
 * admin-onboarding work is teaching schools to fill in precisely the fields
 * that were riding along, so it grew every term.
 *
 * The teachers service one file over already states the rule in a comment:
 * "the payload should be a deliberate list rather than whatever the model
 * happens to grow next." This is that rule, enforced.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the roster list ships a chosen set of fields', () => {
  const students = src('modules/management/students.service.ts');

  it('lists students with an explicit select, never a bare include', () => {
    const listFn = students.slice(students.indexOf('async list('), students.indexOf('async create('));
    expect(listFn).toMatch(/select: \{ \.\.\.LIST_SELECT \}/);
    // `include` here means "every column, plus this relation". If it comes
    // back, so do the other eighteen fields nothing renders.
    expect(listFn).not.toMatch(/include:/);
  });

  it('keeps every field the console roster and its edit form read', () => {
    // Derived from apps/web/app/app/students/page.tsx: the seven table columns,
    // the eleven the edit form fills, and the ids the rows key and link on.
    // Dropping one of these does not fail a type check — the screen simply
    // renders a blank cell — so the list is pinned here instead.
    for (const field of [
      'id', 'admissionNo', 'firstName', 'lastName', 'email', 'classSectionId',
      'rollNo', 'guardianName', 'guardianPhone', 'photoAssetId', 'userId',
      'status', 'leftOn', 'alumniBatch', 'dob', 'showOnWebsite', 'photoConsent',
    ]) {
      expect(students).toMatch(new RegExp(`^\\s*${field}: true,`, 'm'));
    }
    expect(students).toMatch(/classSection: \{\s*select: \{\s*name: true,\s*grade: \{ select: \{ name: true \} \},/);
  });

  it('does not send the transfer-certificate block to a list that never shows it', () => {
    const decl = students.slice(students.indexOf('export const LIST_SELECT'), students.indexOf('export type { RosterStudent }'));
    for (const field of [
      'fatherName', 'motherName', 'nationality', 'category', 'previousSchool',
      'penId', 'guardianPhoneE164', 'firstAdmissionDate', 'firstAdmissionClass',
      'statusChangedById', 'leftNote',
    ]) {
      expect(decl).not.toContain(`${field}:`);
    }
  });
});

describe('the public site is the one response a shared cache can serve', () => {
  const controller = src('modules/public/public-site.controller.ts');

  it('opts out of the API-wide no-store, like its two siblings', () => {
    // Every other response in this API is authenticated and per-person, so
    // no-store is the right blanket default (see configure-app.ts). This one
    // is byte-identical for every visitor to a school and had never opted out.
    const site = controller.slice(controller.indexOf("@Get('site')"), controller.indexOf("@Get('records')"));
    expect(site).toMatch(/Cache-Control.*public, max-age=60, s-maxage=60, stale-while-revalidate/);
  });
});
