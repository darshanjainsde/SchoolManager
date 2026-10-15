/**
 * AN OFFLINE REPLAY NEVER OVERWRITES A NEWER REGISTER — on real Postgres.
 *
 * The app queues a register marked without signal and replays it later with
 * `markedOfflineAt`. If the office saved the register after that moment (a
 * correction on the web), the replay is refused with REGISTER_CHANGED and the
 * office's marks stand. A replay of a register nobody touched since, and an
 * ordinary save from an older app (no field), still go through.
 */
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AttendanceService } from '../src/modules/management/attendance.service';
import { seedMinimalSchool } from './integration/helpers';

describe('attendance: offline replay vs a newer register', () => {
  const db = () => getPlatformPrisma();
  const svc = new AttendanceService({ notify: jest.fn() } as never, { record: jest.fn() } as never);
  const D = '2030-02-04';

  async function seed() {
    const base = await seedMinimalSchool();
    const S = base.schoolId;
    const year = await db().academicYear.create({ data: { schoolId: S, name: '2029-30', startDate: new Date('2029-04-01'), endDate: new Date('2031-03-31') } });
    const grade = await db().grade.create({ data: { schoolId: S, name: '7' } });
    const section = await db().classSection.create({ data: { schoolId: S, gradeId: grade.id, academicYearId: year.id, name: 'B' } });
    const kids: { id: string }[] = [];
    for (const [i, n] of ['Aarav', 'Diya'].entries()) kids.push(await db().student.create({ data: { schoolId: S, admissionNo: `ADM-${i}-${Date.now()}`, firstName: n, lastName: 'Rao', classSectionId: section.id } }));
    // SCHOOL_ADMIN: past/future and class-access rules are not what this proves.
    const save = (status: 'PRESENT' | 'ABSENT' | 'LATE', markedOfflineAt?: string) =>
      svc.save(S, base.adminUserId, { classSectionId: section.id, date: D, marks: kids.map((k) => ({ studentId: k.id, status })), ...(markedOfflineAt ? { markedOfflineAt } : {}) }, 'SCHOOL_ADMIN');
    const statuses = async () => (await db().attendance.findMany({ where: { schoolId: S, classSectionId: section.id, date: new Date(D) }, select: { status: true } })).map((a) => a.status);
    return { save, statuses };
  }

  afterAll(async () => { await disconnectAll(); });

  it('the office corrected it after it was marked offline: the replay is refused, and the correction stands', async () => {
    const { save, statuses } = await seed();
    const markedOffline = new Date(Date.now() - 60_000).toISOString(); // marked a minute ago, no signal
    await save('LATE'); // the office saves now, on the web
    await expect(save('PRESENT', markedOffline)).rejects.toMatchObject({ response: { code: 'REGISTER_CHANGED', message: expect.stringMatching(/^This register was saved again at \d{1,2}:\d{2} (am|pm), after you marked it without signal\./) } });
    expect(await statuses()).toEqual(['LATE', 'LATE']);
  });

  it('nobody touched it since it was marked: the replay goes through', async () => {
    const { save, statuses } = await seed();
    await save('LATE');
    await save('PRESENT', new Date(Date.now() + 1_000).toISOString());
    expect(await statuses()).toEqual(['PRESENT', 'PRESENT']);
  });

  it('a first save, offline or not, and an older app sending no time, all go through as before', async () => {
    const first = await seed();
    await first.save('PRESENT', new Date(Date.now() - 3_600_000).toISOString());
    expect(await first.statuses()).toEqual(['PRESENT', 'PRESENT']);
    const old = await seed();
    await old.save('LATE');
    await old.save('PRESENT');
    expect(await old.statuses()).toEqual(['PRESENT', 'PRESENT']);
  });
});
