import { freeTeachersFor } from './free-teachers';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GAP = { id: 'g1', date: new Date('2026-10-12'), periodId: 'p3', classSectionId: 'cs-9a', originalTeacherId: 't-priya' }; // a Monday
const T = (id: string, firstName: string) => ({ id, firstName, lastName: 'K' });
const AS_OF = new Date('2026-10-12T00:00:00+05:30');

function db() {
  return {
    timetableSlot: {
      findFirst: jest.fn().mockResolvedValue({ subjectId: 'maths' }),
      // Busy that period: Arun. Teaches maths: Kavya.
      findMany: jest.fn(async ({ where }: { where: { subjectId?: string } }) => (where.subjectId ? [{ teacherId: 't-kavya' }] : [{ teacherId: 't-arun' }])),
    },
    substitution: {
      findMany: jest.fn().mockResolvedValue([{ substituteTeacherId: 't-ramesh' }]), // already covering p3 elsewhere
      groupBy: jest.fn().mockResolvedValue([{ substituteTeacherId: 't-mohan', _count: { _all: 2 } }]),
    },
    staffAttendance: { findMany: jest.fn().mockResolvedValue([{ teacherId: 't-sunita' }]) }, // ON_LEAVE that day
    teacher: { findMany: jest.fn().mockResolvedValue([T('t-priya', 'Priya'), T('t-arun', 'Arun'), T('t-ramesh', 'Ramesh'), T('t-sunita', 'Sunita'), T('t-mohan', 'Mohan'), T('t-kavya', 'Kavya'), T('t-anil', 'Anil')]) },
  };
}

describe('freeTeachersFor — the one definition of "free for this period"', () => {
  it('leaves out the teacher on leave, anyone teaching then, anyone already covering then, anyone ON_LEAVE that day', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r.map((c) => c.id).sort()).toEqual(['t-anil', 't-kavya', 't-mohan']);
  });

  it('puts whoever teaches the subject first, then whoever covers least that day, then by name', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r).toEqual([
      { id: 't-kavya', name: 'Kavya K', teachesSubject: true, coversThatDay: 0 },
      { id: 't-anil', name: 'Anil K', teachesSubject: false, coversThatDay: 0 },
      { id: 't-mohan', name: 'Mohan K', teachesSubject: false, coversThatDay: 2 },
    ]);
  });

  it('reads only slots live that day, only active teachers, and only this school', async () => {
    const d = db();
    await freeTeachersFor(d as never, SCHOOL, GAP);
    const live = { effectiveFrom: { lte: AS_OF }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: AS_OF } }] };
    expect(d.timetableSlot.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, dayOfWeek: 1, periodId: 'p3', ...live });
    expect(d.timetableSlot.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, classSectionId: 'cs-9a', periodId: 'p3', dayOfWeek: 1, ...live });
    expect(d.timetableSlot.findMany.mock.calls[1][0].where).toEqual({ schoolId: SCHOOL, subjectId: 'maths', teacherId: { in: ['t-mohan', 't-kavya', 't-anil'] }, ...live });
    expect(d.teacher.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, isActive: true });
    expect(d.substitution.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: GAP.date, periodId: 'p3', substituteTeacherId: { not: null }, NOT: { id: 'g1' } });
    expect(d.substitution.groupBy.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: GAP.date, substituteTeacherId: { not: null } });
    expect(d.staffAttendance.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: GAP.date, status: 'ON_LEAVE', teacherId: { not: null } });
    // Every list is capped.
    for (const c of [...d.timetableSlot.findMany.mock.calls, ...d.substitution.findMany.mock.calls, ...d.staffAttendance.findMany.mock.calls, ...d.teacher.findMany.mock.calls]) {
      expect(c[0].take).toBeGreaterThan(0);
    }
  });

  it('a gap whose class has no live slot that day still gets a list, just without subject ranking', async () => {
    const d = db();
    d.timetableSlot.findFirst.mockResolvedValue(null);
    const r = await freeTeachersFor(d as never, SCHOOL, GAP);
    expect(r.every((c) => !c.teachesSubject)).toBe(true);
    expect(r.map((c) => c.id)).toEqual(['t-anil', 't-kavya', 't-mohan']);
    expect(d.timetableSlot.findMany).toHaveBeenCalledTimes(1);
  });

  it('two teachers on leave in the same period: neither is offered to cover the other', async () => {
    const d = db();
    // Sunita is away too (ON_LEAVE) and has her own class this period (a live slot).
    d.timetableSlot.findMany.mockImplementation(async ({ where }: { where: { subjectId?: string } }) => (where.subjectId ? [] : [{ teacherId: 't-arun' }, { teacherId: 't-sunita' }]));
    const forPriya = await freeTeachersFor(d as never, SCHOOL, GAP);
    expect(forPriya.map((c) => c.id)).not.toContain('t-sunita');
    expect(forPriya.map((c) => c.id)).not.toContain('t-priya');
    // …and for Sunita's own gap, Priya (ON_LEAVE too) is not offered either.
    d.staffAttendance.findMany.mockResolvedValue([{ teacherId: 't-sunita' }, { teacherId: 't-priya' }]);
    const forSunita = await freeTeachersFor(d as never, SCHOOL, { ...GAP, id: 'g2', classSectionId: 'cs-8b', originalTeacherId: 't-sunita' });
    expect(forSunita.map((c) => c.id)).not.toContain('t-priya');
    expect(forSunita.map((c) => c.id)).not.toContain('t-sunita');
  });

  it('ON_LEAVE keeps a teacher out even on a day they have no class at all', async () => {
    const d = db();
    d.timetableSlot.findMany.mockResolvedValue([]); // nobody teaches this period
    d.staffAttendance.findMany.mockResolvedValue([{ teacherId: 't-anil' }]);
    const r = await freeTeachersFor(d as never, SCHOOL, GAP);
    expect(r.map((c) => c.id)).not.toContain('t-anil');
  });

  it('a teacher with no slots that day is free', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r.find((c) => c.id === 't-anil')).toEqual({ id: 't-anil', name: 'Anil K', teachesSubject: false, coversThatDay: 0 });
  });

  it('someone already covering another class in that period is out; this gap\'s own substitute is not excluded by its own row', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r.map((c) => c.id)).not.toContain('t-ramesh');
    // The query skips THIS gap, so re-picking its current substitute is not a clash with itself.
    const d = db();
    d.substitution.findMany.mockResolvedValue([]);
    d.substitution.groupBy.mockResolvedValue([{ substituteTeacherId: 't-ramesh', _count: { _all: 1 } }]);
    const again = await freeTeachersFor(d as never, SCHOOL, GAP);
    expect(again.find((c) => c.id === 't-ramesh')).toEqual({ id: 't-ramesh', name: 'Ramesh K', teachesSubject: false, coversThatDay: 1 });
  });

  it('nobody free: an empty list, and no subject query', async () => {
    const d = db();
    d.teacher.findMany.mockResolvedValue([T('t-priya', 'Priya'), T('t-arun', 'Arun')]);
    expect(await freeTeachersFor(d as never, SCHOOL, GAP)).toEqual([]);
    expect(d.timetableSlot.findMany).toHaveBeenCalledTimes(1);
  });

  it('a teacher with no last name is named by the first alone', async () => {
    const d = db();
    d.teacher.findMany.mockResolvedValue([{ id: 't-x', firstName: 'Lakshmi', lastName: '' }]);
    expect((await freeTeachersFor(d as never, SCHOOL, GAP))[0].name).toBe('Lakshmi');
  });
});
