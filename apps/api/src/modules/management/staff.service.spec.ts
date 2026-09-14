import 'reflect-metadata';

const txMock = {
  refreshToken: { updateMany: jest.fn() },
  staff: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

const platformMock = {
  user: { update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => platformMock,
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  // StaffService transitively imports the tenancy barrel (via '../auth'),
  // whose users.controller reads these enum members at decoration time.
  UserRole: {
    OWNER: 'OWNER',
    SCHOOL_ADMIN: 'SCHOOL_ADMIN',
    TEACHER: 'TEACHER',
    STUDENT: 'STUDENT',
    STAFF: 'STAFF',
  },
}));

jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({}),
}));

import { StaffService } from './staff.service';
import { ApiError } from '../../common/errors/api-error';
import type { PasswordService } from '../auth';
import type { LoginInviteService } from './internal/login-invite.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const auditMock = { record: jest.fn().mockResolvedValue(undefined) };
const STAFF_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('StaffService.list / create', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StaffService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
    auditMock as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  it('lists staff ordered by lastName, firstName', async () => {
    txMock.staff.findMany.mockResolvedValue([
      { id: STAFF_ID, firstName: 'Ravi', lastName: 'Kumar', role: 'SECURITY' },
    ]);

    const result = await svc.list(SCHOOL);

    expect(txMock.staff.findMany).toHaveBeenCalledWith({
        take: 500,
      where: { schoolId: SCHOOL },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    expect(result).toEqual([{ id: STAFF_ID, firstName: 'Ravi', lastName: 'Kumar', role: 'SECURITY' }]);
  });

  it('creates a staff member scoped to the school', async () => {
    txMock.staff.create.mockResolvedValue({ id: STAFF_ID });

    await svc.create(SCHOOL, {
      firstName: 'Ravi',
      lastName: 'Kumar',
      role: 'SECURITY',
    });

    expect(txMock.staff.create).toHaveBeenCalledWith({
      data: { firstName: 'Ravi', lastName: 'Kumar', role: 'SECURITY', schoolId: SCHOOL },
    });
  });
});

describe('StaffService.createLogin', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StaffService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
    auditMock as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    passwords.hash.mockResolvedValue('argon2-placeholder-hash');
    invites.sendInvite.mockResolvedValue(true);
    txMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      email: null,
      userId: null,
    });
    txMock.staff.update.mockResolvedValue({});
    txMock.user.create.mockResolvedValue({ id: 'user-1' });
  });

  it('throws EMAIL_REQUIRED when no email is supplied and the staff member has none on file', async () => {
    await expect(svc.createLogin(SCHOOL, STAFF_ID, {})).rejects.toThrow(ApiError);

    try {
      await svc.createLogin(SCHOOL, STAFF_ID, {});
      throw new Error('expected createLogin to throw');
    } catch (e) {
      expect((e as ApiError).getStatus()).toBe(400);
      expect((e as ApiError).getResponse()).toEqual({
        code: 'EMAIL_REQUIRED',
        message: 'An email address is required to send the invite',
        field: 'email',
      });
    }
    expect(txMock.user.create).not.toHaveBeenCalled();
  });

  it('creates the user with role STAFF, links the staff record, and emails the invite', async () => {
    const result = await svc.createLogin(SCHOOL, STAFF_ID, { email: 'Ravi.Kumar@Example.com' });

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'ravi.kumar@example.com',
        username: null,
        passwordHash: 'argon2-placeholder-hash',
        role: 'STAFF',
      },
    });
    expect(txMock.staff.update).toHaveBeenCalledWith({
      where: { id: STAFF_ID },
      data: { userId: 'user-1', email: 'ravi.kumar@example.com' },
    });
    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'ravi.kumar@example.com');
    expect(result).toEqual({
      email: 'ravi.kumar@example.com',
      username: null,
      loginName: 'ravi.kumar@example.com',
      invited: true,
      emailSent: true,
    });
  });

  it("falls back to the staff member's existing Staff.email when the body omits one", async () => {
    txMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      email: 'onfile@example.com',
      userId: null,
    });

    const result = await svc.createLogin(SCHOOL, STAFF_ID, {});

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'onfile@example.com',
        username: null,
        passwordHash: 'argon2-placeholder-hash',
        role: 'STAFF',
      },
    });
    expect(result.email).toBe('onfile@example.com');
  });

  it('rejects a staff member that already has a login', async () => {
    txMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      email: 'ravi.kumar@example.com',
      userId: 'user-existing',
    });

    await expect(
      svc.createLogin(SCHOOL, STAFF_ID, { email: 'ravi.kumar@example.com' }),
    ).rejects.toThrow('Staff member already has a login');
    expect(txMock.user.create).not.toHaveBeenCalled();
  });

  it('still returns emailSent: false (without throwing) when the mailer fails', async () => {
    invites.sendInvite.mockResolvedValue(false);

    const result = await svc.createLogin(SCHOOL, STAFF_ID, { email: 'ravi.kumar@example.com' });

    expect(result.emailSent).toBe(false);
    expect(result.invited).toBe(true);
    expect(txMock.user.create).toHaveBeenCalled();
  });
});

describe('StaffService.resendInvite', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StaffService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
    auditMock as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    invites.sendInvite.mockResolvedValue(true);
    txMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      email: 'ravi.kumar@example.com',
      userId: 'user-1',
    });
    txMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ravi.kumar@example.com',
      username: null,
    });
  });

  it('mints a fresh token and re-sends for a staff member that already has a login', async () => {
    const result = await svc.resendInvite(SCHOOL, STAFF_ID);

    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'ravi.kumar@example.com');
    expect(result).toEqual({
      email: 'ravi.kumar@example.com',
      username: null,
      loginName: 'ravi.kumar@example.com',
      invited: true,
      emailSent: true,
    });
  });

  it('rejects a staff member with no login to resend', async () => {
    txMock.staff.findFirst.mockResolvedValue({
      id: STAFF_ID,
      email: 'ravi.kumar@example.com',
      userId: null,
    });

    await expect(svc.resendInvite(SCHOOL, STAFF_ID)).rejects.toThrow(
      'Staff member has no login to resend an invite for',
    );
    expect(invites.sendInvite).not.toHaveBeenCalled();
  });
});

describe('StaffService.release / reactivate (Active Roster)', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StaffService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
    auditMock as never,
  );
  const STAFF_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.staff.update.mockResolvedValue({});
    platformMock.user.update.mockResolvedValue({});
    platformMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  });

  it('release marks LEFT with the isActive mirror, closes the login, audits', async () => {
    txMock.staff.findFirst.mockResolvedValue({ userId: 'user-3', status: 'ACTIVE' });
    const out = await svc.release(SCHOOL, ACTOR, STAFF_ID, { leftOn: '2026-03-31', reason: 'Retired' });
    expect(out).toEqual({ released: true });
    expect(txMock.staff.update).toHaveBeenCalledWith({
      where: { id: STAFF_ID },
      data: expect.objectContaining({ status: 'LEFT', isActive: false, leftReason: 'Retired', statusChangedById: ACTOR }),
    });
    expect(txMock.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-3', schoolId: SCHOOL }, data: { isActive: false } });
    expect(txMock.refreshToken.updateMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: 'user-3', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.release', entityId: STAFF_ID }));
  });

  it('release refuses when not ACTIVE; reactivate refuses when already ACTIVE', async () => {
    txMock.staff.findFirst.mockResolvedValue({ userId: null, status: 'LEFT' });
    await expect(svc.release(SCHOOL, ACTOR, STAFF_ID, { leftOn: '2026-03-31' })).rejects.toMatchObject({ response: { code: 'NOT_ACTIVE' } });
    txMock.staff.findFirst.mockResolvedValue({ userId: null, status: 'ACTIVE' });
    await expect(svc.reactivate(SCHOOL, ACTOR, STAFF_ID)).rejects.toMatchObject({ response: { code: 'ALREADY_ACTIVE' } });
    expect(txMock.staff.update).not.toHaveBeenCalled();
  });

  it('reactivate reopens the same row and login', async () => {
    txMock.staff.findFirst.mockResolvedValue({ userId: 'user-3', status: 'LEFT' });
    const out = await svc.reactivate(SCHOOL, ACTOR, STAFF_ID);
    expect(out).toEqual({ id: STAFF_ID, status: 'ACTIVE' });
    expect(txMock.staff.update).toHaveBeenCalledWith({ where: { id: STAFF_ID }, data: expect.objectContaining({ status: 'ACTIVE', isActive: true, leftOn: null }) });
    expect(txMock.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-3', schoolId: SCHOOL }, data: { isActive: true } });
  });
});
