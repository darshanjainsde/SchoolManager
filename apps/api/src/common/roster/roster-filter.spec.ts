import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every query that LISTS students for a roster or a recipient list must carry a
 * status filter (Active Roster, Track A).
 *
 * Before this, `Student.isActive` existed but nothing set it and nothing but the
 * Library read it — a child who had left kept getting attendance rows, diary
 * entries and pushes. Rather than trust every future author to remember, this
 * test reads the source of each file that lists students and fails when a
 * `student.findMany(` call, taken together with the function body it sits in,
 * mentions neither `status` nor `activeStudentsWhere`.
 *
 * Single-row lookups (`findFirst` by id or by userId — "the student behind this
 * login") are deliberately not covered: they are not rosters, and a closed
 * login already refuses at the gate.
 */
const API = join(__dirname, '..', '..');

const FILES = [
  'modules/management/students.service.ts',
  'modules/management/attendance.service.ts',
  'modules/management/attendance-bar.service.ts',
  'modules/management/diary.service.ts',
  'modules/management/exams.service.ts',
  'common/notifications/recipients.ts',
  'common/notifications/notification-inbox.ts',
  'modules/auth/internal/school-resolve.service.ts',
];

interface Site {
  /** The `student.findMany(` call text up to its closing paren. */
  call: string;
  /** From the start of the enclosing function (or file) to the end of the call. */
  scope: string;
  line: number;
}

function findManySites(src: string): Site[] {
  const out: Site[] = [];
  const re = /student\.findMany\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      if (src[i] === ')') depth--;
      i++;
    }
    const before = src.slice(0, m.index);
    // The nearest function opener above the call bounds the scope: a `where`
    // built in a local variable a few lines up still counts.
    const opener = Math.max(before.lastIndexOf('async '), before.lastIndexOf('function '));
    out.push({
      call: src.slice(m.index, i),
      scope: src.slice(opener < 0 ? 0 : opener, i),
      line: before.split('\n').length,
    });
  }
  return out;
}

describe('roster queries filter on student status', () => {
  for (const rel of FILES) {
    it(rel, () => {
      const src = readFileSync(join(API, rel), 'utf8');
      const sites = findManySites(src);
      expect(sites.length).toBeGreaterThan(0);
      // A bare `status` is not enough: school-resolve filters on the SCHOOL's
      // status (`school: { status: { not: 'SUSPENDED' } }`) and passed a looser
      // version of this check while still listing left children. The student
      // filter is spelled one of these ways, and only these.
      const filtered = /activeStudentsWhere|LEFT_STATUSES|status: 'ACTIVE'|status: \{ in:/;
      const missing = sites
        .filter((s) => !filtered.test(s.scope))
        .map((s) => `line ${s.line}: ${s.call.split('\n')[0]}`);
      expect(missing).toEqual([]);
    });
  }
});
