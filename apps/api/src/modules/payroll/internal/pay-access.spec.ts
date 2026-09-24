import 'reflect-metadata';

const userMock = { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn() };
const staffMock = { findMany: jest.fn(), count: jest.fn() };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn({}),
  getPlatformPrisma: () => ({ user: userMock, staff: staffMock }),
}));

import { PayrollController } from './payroll.controller';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001';
const OFFICER = 'ffffffff-0000-0000-0000-000000000002';

const audit = { record: jest.fn() };
const controller = () =>
  new PayrollController(
    null as never, null as never, null as never, null as never, null as never,
    null as never, null as never,
    { requireTenant: () => ({ schoolId: SCHOOL }) } as never,
    audit as never,
  );

beforeEach(() => {
  jest.clearAllMocks();
  userMock.findMany.mockResolvedValue([]);
  staffMock.findMany.mockResolvedValue([]);
  staffMock.count.mockResolvedValue(0);
});

/**
 * THE DOOR WITH NO KEY.
 *
 * `SalaryGuard` lets an ACCOUNTS staff member reach Pay and then asks for
 * `canSeeSalary` by name, telling them to ask an admin. If this list held
 * only admins, the admin would open the grant screen and find nobody to
 * click — the officer's own name would not be on it. These tests pin that
 * the officer is listed, and that the grant accepts them.
 */
describe('who can be given pay', () => {
  it('lists the accounts officer beside the admins, under their staff name', async () => {
    userMock.findMany
      .mockResolvedValueOnce([{ id: ADMIN, name: 'Head', email: 'head@x.test', canSeeSalary: true, createdAt: new Date() }])
      .mockResolvedValueOnce([{ id: OFFICER, name: 'login name', email: 'acc@x.test', canSeeSalary: false, createdAt: new Date() }]);
    staffMock.findMany.mockResolvedValue([{ userId: OFFICER, firstName: 'Meera', lastName: 'Shah' }]);

    const rows = await controller().access();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: ADMIN, job: 'Admin' });
    // The STAFF row's name, not the login's: the office knows her as Meera Shah.
    expect(rows[1]).toMatchObject({ id: OFFICER, job: 'Accounts officer', name: 'Meera Shah', canSeeSalary: false });
  });

  it('asks for no officer logins when the school has no accounts officer', async () => {
    userMock.findMany.mockResolvedValueOnce([]);
    staffMock.findMany.mockResolvedValue([]);
    const rows = await controller().access();
    expect(rows).toEqual([]);
    expect(userMock.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('granting it', () => {
  const actor = { sub: ADMIN, schoolId: SCHOOL } as never;

  it('grants to an accounts officer', async () => {
    userMock.findFirst.mockResolvedValue({ id: OFFICER, role: 'STAFF' });
    staffMock.count.mockResolvedValue(1);
    await controller().grant(actor, { userId: OFFICER, canSeeSalary: true });
    expect(userMock.update).toHaveBeenCalledWith({ where: { id: OFFICER }, data: { canSeeSalary: true } });
  });

  it('refuses a staff member who is not the accounts officer', async () => {
    userMock.findFirst.mockResolvedValue({ id: 'driver', role: 'STAFF' });
    staffMock.count.mockResolvedValue(0);
    await expect(controller().grant(actor, { userId: 'driver', canSeeSalary: true })).rejects.toThrow(ApiError);
    expect(userMock.update).not.toHaveBeenCalled();
  });

  it('refuses a teacher outright', async () => {
    userMock.findFirst.mockResolvedValue({ id: 'teacher', role: 'TEACHER' });
    await expect(controller().grant(actor, { userId: 'teacher', canSeeSalary: true })).rejects.toThrow(/admin or an accounts officer/);
    expect(staffMock.count).not.toHaveBeenCalled();
  });

  it('still refuses an admin taking the right away from themselves', async () => {
    // Otherwise the last holder can lock the school out of its own payroll.
    await expect(controller().grant(actor, { userId: ADMIN, canSeeSalary: false })).rejects.toThrow(/another admin/);
    expect(userMock.update).not.toHaveBeenCalled();
  });

  it('writes the grant to the audit log', async () => {
    userMock.findFirst.mockResolvedValue({ id: OFFICER, role: 'STAFF' });
    staffMock.count.mockResolvedValue(1);
    await controller().grant(actor, { userId: OFFICER, canSeeSalary: true });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'salary.grant', entityId: OFFICER }));
  });
});
