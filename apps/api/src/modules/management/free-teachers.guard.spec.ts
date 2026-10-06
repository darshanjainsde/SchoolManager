import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * "Who is free" has ONE answer (spec §7). The web page used to build its own
 * busySet from the week's timetable and the WhatsApp list ran its own five
 * queries; they disagreed about teachers on leave. Both now ask
 * freeTeachersFor through the service.
 */
const SRC = resolve(__dirname, '..', '..');
const WEB = resolve(SRC, '..', '..', 'web');

describe('freeTeachersFor is the only free-teacher computation', () => {
  it('the WhatsApp actions ask LeaveService.candidates and compute nothing themselves', () => {
    const src = readFileSync(join(SRC, 'modules/whatsapp/whatsapp-actions.service.ts'), 'utf8');
    expect(src).toMatch(/this\.leave\.candidates\(/);
    expect(src).not.toMatch(/staffAttendance\.findMany|timetableSlot\.findMany/);
  });

  it('LeaveService.assign checks freeTeachersFor, not its own clash queries', () => {
    const src = readFileSync(join(SRC, 'modules/management/leave.service.ts'), 'utf8');
    expect(src).toMatch(/freeTeachersFor\(tx, schoolId, sub\)/);
    expect(src).not.toMatch(/regularClash|substitutionClash/);
  });

  // RATCHET until Task 9 moves the console onto GET /manage/substitution/:id/candidates:
  // `it.failing` passes while the page still has its own busySet and FAILS the
  // moment it is gone — whoever removes it must turn this back into `it`.
  it.failing('the console leave page has no busySet of its own', () => {
    const page = readFileSync(join(WEB, 'app/app/leave/page.tsx'), 'utf8');
    expect(page).not.toMatch(/busySet/);
  });
});
