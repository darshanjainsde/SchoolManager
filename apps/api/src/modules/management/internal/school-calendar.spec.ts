import { holidayDates, workingDates } from './school-calendar';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tx = (workingDays: number[] | null, holidays: { startDate: Date; endDate: Date | null; name?: string }[] = []) => ({
  school: { findUnique: jest.fn().mockResolvedValue(workingDays ? { workingDays } : null) },
  holiday: { findMany: jest.fn().mockResolvedValue(holidays.map((h) => ({ name: 'Holiday', ...h }))) },
});

describe('workingDates — the calendar a leave is counted and covered on', () => {
  it('drops the days the school does not work and every holiday day, ranges expanded', async () => {
    // Sat 7 – Fri 13 Nov 2026; a Mon–Fri school; Diwali break Mon 9 – Tue 10.
    const t = tx([1, 2, 3, 4, 5], [{ startDate: new Date('2026-11-09'), endDate: new Date('2026-11-10') }]);
    expect(await workingDates(t as never, SCHOOL, '2026-11-07', '2026-11-13')).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    expect(t.holiday.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL });
    expect(t.school.findUnique).toHaveBeenCalledWith({ where: { id: SCHOOL }, select: { workingDays: true } });
  });

  it('a school with no row yet works Monday to Saturday', async () => {
    expect(await workingDates(tx(null) as never, SCHOOL, '2026-11-14', '2026-11-15')).toEqual(['2026-11-14']); // Sat yes, Sun no
  });

  it('a single-day holiday (no end date) drops just that day; a span that is all holiday has no working day', async () => {
    const t = tx([1, 2, 3, 4, 5, 6], [{ startDate: new Date('2026-11-11'), endDate: null }]);
    expect(await workingDates(t as never, SCHOOL, '2026-11-10', '2026-11-12')).toEqual(['2026-11-10', '2026-11-12']);
    expect(await workingDates(t as never, SCHOOL, '2026-11-11', '2026-11-11')).toEqual([]);
  });

  it('asks only for holidays overlapping the span', async () => {
    const t = tx([1, 2, 3, 4, 5, 6]);
    await workingDates(t as never, SCHOOL, '2026-11-09', '2026-11-11');
    expect(t.holiday.findMany.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL,
      startDate: { lte: new Date('2026-11-11') },
      OR: [{ endDate: null }, { endDate: { gte: new Date('2026-11-09') } }],
    });
  });
});

describe('holidayDates — what the leave balance skips', () => {
  it('expands every holiday overlapping the window, for this school only', async () => {
    const t = tx([1], [
      { startDate: new Date('2026-11-09'), endDate: new Date('2026-11-10') },
      { startDate: new Date('2026-11-14'), endDate: null },
    ]);
    const set = await holidayDates(t as never, SCHOOL, new Date('2026-11-01'), new Date('2026-11-30'));
    expect([...set].sort()).toEqual(['2026-11-09', '2026-11-10', '2026-11-14']);
    expect(t.holiday.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL });
    expect(t.holiday.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });
});
