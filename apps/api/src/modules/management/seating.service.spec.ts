import 'reflect-metadata';

const txMock = {
  room: { findFirst: jest.fn() },
  classSection: { findMany: jest.fn() },
  seatingPlan: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { SeatingService } from './seating.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROOM = { id: 'r1', name: 'Hall A', rows: 6, cols: 9, seatsPerDesk: 1, removedDesks: [] as string[] };

function section(id: string, name: string, order: number, n: number) {
  return {
    id,
    name,
    grade: { name: `Class ${order}`, order },
    students: Array.from({ length: n }, (_, i) => ({
      id: `${id}-${i}`,
      firstName: 'Student',
      lastName: String(i),
      rollNo: String(i + 1),
    })),
  };
}

describe('SeatingService', () => {
  const svc = new SeatingService();
  const dto = { roomId: 'r1', classSectionIds: ['s1', 's2'], title: 'Half-Yearly' };

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.room.findFirst.mockResolvedValue(ROOM);
    txMock.classSection.findMany.mockResolvedValue([section('s1', 'A', 9, 12), section('s2', 'A', 10, 12)]);
  });

  describe('save', () => {
    /**
     * The bug this pins: `get` used to read the room through a live join, so
     * narrowing Hall A after saving redrew an already-printed chart into the
     * new grid and silently dropped every seat past the new width.
     */
    it('freezes the room shape onto the plan', async () => {
      txMock.seatingPlan.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'p1',
        createdAt: new Date('2026-08-26T00:00:00Z'),
        ...args.data,
      }));

      await svc.save(SCHOOL, dto);

      const written = txMock.seatingPlan.create.mock.calls[0][0].data;
      expect(written.roomShape).toEqual({ rows: 6, cols: 9, seatsPerDesk: 1, removedDesks: [] });
    });

    it('reads the room once, not once per code path', async () => {
      txMock.seatingPlan.create.mockResolvedValue({ id: 'p1', createdAt: new Date() });
      await svc.save(SCHOOL, dto);
      expect(txMock.room.findFirst).toHaveBeenCalledTimes(1);
    });

    it('regenerates from the seed instead of trusting seats off the wire', async () => {
      txMock.seatingPlan.create.mockResolvedValue({ id: 'p1', createdAt: new Date() });
      // A caller trying to smuggle in its own seats gets them ignored.
      await svc.save(SCHOOL, { ...dto, seats: [{ studentId: 'not-ours' }] } as never);
      const written = txMock.seatingPlan.create.mock.calls[0][0].data;
      const seats = written.seats as { studentId: string }[];
      expect(seats.length).toBeGreaterThan(0);
      expect(seats.every((s) => s.studentId !== 'not-ours')).toBe(true);
    });
  });

  describe('get', () => {
    const base = {
      id: 'p1',
      roomId: 'r1',
      title: 'Half-Yearly',
      classSectionIds: ['s1'],
      rules: { noClassmates: true, alternateCols: true, spreadRolls: true, backRowFree: true },
      seed: 11,
      seats: [],
      report: { capacity: 45, seated: 0, unseated: 0, clashes: 0, bent: 0, notes: [] },
      createdAt: new Date('2026-08-26T00:00:00Z'),
    };

    it('returns the room as SAVED, not as the room is now', async () => {
      txMock.seatingPlan.findFirst.mockResolvedValue({
        ...base,
        roomShape: { rows: 6, cols: 9, seatsPerDesk: 1, removedDesks: [] },
        // The room has since been narrowed to six desks.
        room: { ...ROOM, cols: 6 },
      });
      const out = await svc.get(SCHOOL, 'p1');
      expect(out.room.cols).toBe(9);
    });

    it('falls back to the live room for plans written before the snapshot existed', async () => {
      txMock.seatingPlan.findFirst.mockResolvedValue({ ...base, roomShape: null, room: { ...ROOM, cols: 7 } });
      const out = await svc.get(SCHOOL, 'p1');
      expect(out.room.cols).toBe(7);
    });

    it('fills in a rule the stored plan predates, rather than reading it as off', async () => {
      txMock.seatingPlan.findFirst.mockResolvedValue({
        ...base,
        rules: { noClassmates: true },
        roomShape: null,
        room: ROOM,
      });
      const out = await svc.get(SCHOOL, 'p1');
      expect(out.rules).toEqual({
        noClassmates: true,
        alternateCols: true,
        spreadRolls: true,
        backRowFree: true,
      });
    });
  });

  describe('tenancy', () => {
    it('refuses a class section that is not this school\'s', async () => {
      // The scoped query simply does not return it.
      txMock.classSection.findMany.mockResolvedValue([section('s1', 'A', 9, 12)]);
      await expect(svc.preview(SCHOOL, dto)).rejects.toThrow(/no longer exists/);
    });

    it('refuses a room that is not this school\'s', async () => {
      txMock.room.findFirst.mockResolvedValue(null);
      await expect(svc.preview(SCHOOL, dto)).rejects.toThrow(/Room not found/);
    });

    it('refuses an empty class list rather than seating an empty room', async () => {
      await expect(svc.preview(SCHOOL, { ...dto, classSectionIds: [] })).rejects.toThrow(/at least one class/);
    });

    it('scopes every read to the caller\'s school', async () => {
      txMock.seatingPlan.create.mockResolvedValue({ id: 'p1', createdAt: new Date() });
      await svc.save(SCHOOL, dto);
      for (const call of withTenantMock.mock.calls) expect(call[0]).toBe(SCHOOL);
      expect(txMock.classSection.findMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL);
      expect(txMock.room.findFirst.mock.calls[0][0].where.schoolId).toBe(SCHOOL);
    });
  });
});
