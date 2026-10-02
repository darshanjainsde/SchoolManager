import { classroom, exams, notices } from './academics';
import { staffAttendance, studentAttendance } from './attendance';
import { Ctx } from './ctx';
import { ENQUIRIES } from './data';
import { fees } from './fees';
import { leave } from './leave';
import { events, library } from './life';
import { payroll } from './payroll';
import { roll, sections, staffAndTeachers, structure } from './people';

/** Every phase, in the order the data depends on itself. */
export async function buildSchool(c: Ctx, log: (m: string) => void): Promise<void> {
  const phases: [string, () => Promise<void>][] = [
    ['year, subjects, grades, houses, holidays', () => structure(c)],
    ['20 teachers and 9 staff with logins', () => staffAndTeachers(c)],
    ['45 sections, class teachers, subject teachers', () => sections(c)],
    ['the roll, with student logins', () => roll(c)],
    ['leave policy, allowances and applications', () => leave(c)],
    ['four months of student attendance', () => studentAttendance(c)],
    ['staff attendance (agreeing with approved leave)', () => staffAttendance(c)],
    ['exams, results and report-card remarks', () => exams(c)],
    ['homework, notes, diary and teacher remarks', () => classroom(c)],
    ['notices and enquiries', () => notices(c, ENQUIRIES)],
    ['fees: structure, bills, payments, ledger, receipts', () => fees(c)],
    ['salary: six months through the real pay engine', () => payroll(c)],
    ['library catalogue and loans', () => library(c)],
    ['events, registrations and house points', () => events(c)],
  ];
  for (const [what, run] of phases) {
    const t = Date.now();
    await run();
    log(`${what} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
}
