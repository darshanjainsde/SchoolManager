import 'reflect-metadata';

const txMock = {
  holiday: { create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { HolidaysService } from './holidays.service';
import type { CreateHolidayDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const HOLIDAY_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('HolidaysService', () => {
  const svc = new HolidaysService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
  });

  describe('create', () => {
    const dto: CreateHolidayDto = { name: 'Diwali', type: 'FESTIVAL', startDate: '2026-08-15' };

    it('creates a holiday row scoped to the school', async () => {
      txMock.holiday.create.mockResolvedValue({
        id: HOLIDAY_ID,
        schoolId: SCHOOL,
        name: 'Diwali',
        type: 'FESTIVAL',
        startDate: new Date('2026-08-15'),
        endDate: null,
      });

      const result = await svc.create(SCHOOL, dto);

      expect(txMock.holiday.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          name: 'Diwali',
          type: 'FESTIVAL',
          startDate: new Date('2026-08-15'),
          endDate: null,
        },
      });
      expect(result.id).toBe(HOLIDAY_ID);
    });

    it('passes endDate through when supplied', async () => {
      txMock.holiday.create.mockResolvedValue({});

      await svc.create(SCHOOL, { ...dto, endDate: '2026-08-16' });

      expect(txMock.holiday.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ endDate: new Date('2026-08-16') }),
      });
    });

    it('rejects a type outside PUBLIC/FESTIVAL/SCHOOL without opening a transaction', async () => {
      await expect(
        svc.create(SCHOOL, { ...dto, type: 'BOGUS' as CreateHolidayDto['type'] }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    // "Now" is 2026-07-21T03:00Z = 2026-07-21T08:30 IST, so IST "today" is
    // 2026-07-21 — 07-20 is past, 07-21/07-25 are today/future.
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries only startDate >= today (IST), ordered ascending', async () => {
      txMock.holiday.findMany.mockResolvedValue([
        { id: '1', name: 'Today', type: 'SCHOOL', startDate: new Date('2026-07-21'), endDate: null },
        { id: '2', name: 'Later', type: 'PUBLIC', startDate: new Date('2026-07-25'), endDate: null },
      ]);

      const result = await svc.list(SCHOOL);

      expect(txMock.holiday.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, startDate: { gte: new Date('2026-07-21T00:00:00.000Z') } },
        orderBy: { startDate: 'asc' },
      });
      expect(result.map((h) => h.id)).toEqual(['1', '2']);
    });

    it('never returns a past holiday (excluded at the query, not filtered client-side)', async () => {
      // The mock only ever returns what the (correctly-scoped) query would —
      // asserting the where-clause above is what actually proves the
      // exclusion; this test guards against a future refactor accidentally
      // widening the query and then filtering in JS instead.
      txMock.holiday.findMany.mockResolvedValue([]);

      const result = await svc.list(SCHOOL);

      const [[query]] = txMock.holiday.findMany.mock.calls;
      expect(query.where.startDate.gte.toISOString().slice(0, 10)).toBe('2026-07-21');
      expect(result).toEqual([]);
    });
  });

  describe('remove', () => {
    it('deletes the holiday by id', async () => {
      txMock.holiday.delete.mockResolvedValue({ id: HOLIDAY_ID });

      const result = await svc.remove(SCHOOL, HOLIDAY_ID);

      expect(txMock.holiday.delete).toHaveBeenCalledWith({ where: { id: HOLIDAY_ID } });
      expect(result).toEqual({ ok: true });
    });

    it('throws NotFoundException when the row does not exist (P2025)', async () => {
      const { Prisma } = jest.requireActual('@skoolos/db');
      txMock.holiday.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Not found', { code: 'P2025', clientVersion: 'test' }),
      );

      await expect(svc.remove(SCHOOL, 'missing-id')).rejects.toThrow('Holiday not found');
    });
  });
});
