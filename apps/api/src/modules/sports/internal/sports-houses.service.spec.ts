import 'reflect-metadata';

const txMock = {
  house: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  housePoint: { groupBy: jest.fn(), count: jest.fn(), create: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
  student: { groupBy: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { Prisma } from '@skoolos/db';
import { SportsHousesService } from './sports-houses.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const H1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const H2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

beforeEach(() => {
  jest.clearAllMocks();
  txMock.house.findFirst.mockResolvedValue({ id: H1 });
});

describe('SportsHousesService', () => {
  it('the table sums point rows and counts active members per house, zero when nothing yet', async () => {
    txMock.house.findMany.mockResolvedValue([{ id: H1, name: 'Red', color: '#f00', order: 0 }, { id: H2, name: 'Blue', color: '#00f', order: 1 }]);
    txMock.housePoint.groupBy.mockResolvedValue([{ houseId: H1, _sum: { points: 17 } }]);
    txMock.student.groupBy.mockResolvedValue([{ houseId: H2, _count: { _all: 40 } }]);
    const rows = await new SportsHousesService().list(SCHOOL);
    expect(rows).toEqual([
      { id: H1, name: 'Red', color: '#f00', order: 0, members: 0, points: 17 },
      { id: H2, name: 'Blue', color: '#00f', order: 1, members: 40, points: 0 },
    ]);
    expect(txMock.student.groupBy.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, status: 'ACTIVE', houseId: { not: null } });
  });

  it('a duplicate name is a 409 on create and on rename', async () => {
    txMock.house.count.mockResolvedValue(2);
    txMock.house.create.mockRejectedValue(dup);
    await expect(new SportsHousesService().create(SCHOOL, { name: ' Red ' })).rejects.toMatchObject({ response: { code: 'HOUSE_EXISTS', field: 'name' } });
    txMock.house.update.mockRejectedValue(dup);
    await expect(new SportsHousesService().update(SCHOOL, H1, { name: 'Blue' })).rejects.toMatchObject({ response: { code: 'HOUSE_EXISTS' } });
  });

  it('create trims the name, takes the next order and the default colour', async () => {
    txMock.house.count.mockResolvedValue(2);
    txMock.house.create.mockResolvedValue({ id: H1 });
    await new SportsHousesService().create(SCHOOL, { name: ' Red ' });
    expect(txMock.house.create.mock.calls[0][0].data).toEqual({ schoolId: SCHOOL, name: 'Red', color: '#4F46E5', order: 2 });
  });

  it('a house with points cannot be deleted; one without can', async () => {
    txMock.housePoint.count.mockResolvedValue(3);
    await expect(new SportsHousesService().remove(SCHOOL, H1)).rejects.toMatchObject({ response: { code: 'HOUSE_IN_USE' } });
    txMock.housePoint.count.mockResolvedValue(0);
    await new SportsHousesService().remove(SCHOOL, H1);
    expect(txMock.house.delete).toHaveBeenCalledWith({ where: { id: H1 } });
  });

  it('a house from another school is 404 everywhere', async () => {
    txMock.house.findFirst.mockResolvedValue(null);
    await expect(new SportsHousesService().members(SCHOOL, H2)).rejects.toMatchObject({ response: { code: 'HOUSE_NOT_FOUND' } });
    await expect(new SportsHousesService().assign(SCHOOL, { houseId: H2, studentIds: ['cccccccc-cccc-cccc-cccc-cccccccccccc'] })).rejects.toMatchObject({ response: { code: 'HOUSE_NOT_FOUND' } });
  });

  it('assign moves only this school’s students and can clear the house with null', async () => {
    txMock.student.updateMany.mockResolvedValue({ count: 2 });
    const r = await new SportsHousesService().assign(SCHOOL, { houseId: null, studentIds: ['s1', 's2'] });
    expect(r).toEqual({ moved: 2 });
    expect(txMock.student.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, id: { in: ['s1', 's2'] } }, data: { houseId: null } });
    expect(txMock.house.findFirst).not.toHaveBeenCalled();
  });

  it('an award needs a non-zero number and a reason; a correction is a negative row', async () => {
    const svc = new SportsHousesService();
    await expect(svc.award(SCHOOL, H1, { points: 0, reason: 'x' })).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    txMock.housePoint.create.mockResolvedValue({ id: 'p1' });
    await svc.award(SCHOOL, H1, { points: -5, reason: ' Wrongly credited ' });
    expect(txMock.housePoint.create.mock.calls[0][0].data).toEqual({ schoolId: SCHOOL, houseId: H1, points: -5, reason: 'Wrongly credited' });
  });

  it('awardMany skips zero rows and writes the rest in one createMany', async () => {
    txMock.housePoint.createMany.mockResolvedValue({ count: 2 });
    const n = await new SportsHousesService().awardMany(txMock as never, SCHOOL, [
      { houseId: H1, points: 10, reason: '1st · 100 m', eventId: 'e1' }, { houseId: H2, points: 0, reason: '7th', eventId: 'e1' }, { houseId: H2, points: 7, reason: '2nd · 100 m', eventId: 'e1' },
    ]);
    expect(n).toBe(2);
    expect(txMock.housePoint.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(await new SportsHousesService().awardMany(txMock as never, SCHOOL, [])).toBe(0);
  });
});
