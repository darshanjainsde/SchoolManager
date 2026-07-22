import 'reflect-metadata';

const txMock = {
  student: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  // StudentsController pulls in the tenancy barrel, whose users.controller reads
  // these enum members at decoration time.
  UserRole: {
    OWNER: 'OWNER',
    SCHOOL_ADMIN: 'SCHOOL_ADMIN',
    TEACHER: 'TEACHER',
    STUDENT: 'STUDENT',
  },
}));

// StudentsController transitively imports guards that call loadEnv() at module-load
// time; this unit test has no .env, so stub the config the same way auth.service.spec does.
jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({
    JWT_SCHOOL_ACCESS_SECRET: 'test-school-access-secret',
    JWT_SCHOOL_REFRESH_SECRET: 'test-school-refresh-secret',
    JWT_ACCESS_TTL: 900,
  }),
}));

import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { ApiError } from '../../common/errors/api-error';
import type { PasswordService } from '../auth';
import type { TenantContextService } from '../tenancy';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import type { LoginInviteService } from './internal/login-invite.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const jwt = (role: SchoolJwtPayload['role']): SchoolJwtPayload => ({
  sub: 'user-1',
  aud: 'school',
  schoolId: SCHOOL,
  role,
  jti: 'jti-1',
});

describe('StudentsService.list', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StudentsService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    txMock.student.findMany.mockResolvedValue([]);
  });

  it('returns ONLY id/firstName/lastName/rollNo for the roster projection (no minor PII)', async () => {
    await svc.list(SCHOOL, { classSectionId: CLASS_SECTION, projection: 'roster' });

    const args = txMock.student.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      firstName: true,
      lastName: true,
      rollNo: true,
    });
    // A `select` and an `include` are mutually exclusive in Prisma — asserting
    // the absence of `include` is what guarantees no extra relation leaks.
    expect(args.include).toBeUndefined();
    // The columns a teacher must never be able to pull for the whole school.
    for (const pii of ['guardianName', 'guardianPhone', 'dob', 'gender', 'admissionNo']) {
      expect(Object.keys(args.select)).not.toContain(pii);
    }
  });

  it('scopes the roster projection to the requested class section', async () => {
    await svc.list(SCHOOL, { classSectionId: CLASS_SECTION, projection: 'roster' });

    expect(txMock.student.findMany.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL,
      classSectionId: CLASS_SECTION,
    });
  });

  it('keeps the full row + classSection include for the admin projection', async () => {
    await svc.list(SCHOOL, { projection: 'full' });

    const args = txMock.student.findMany.mock.calls[0][0];
    expect(args.select).toBeUndefined();
    expect(args.include).toEqual({
      classSection: { select: { name: true, grade: { select: { name: true } } } },
    });
    expect(args.where).toEqual({ schoolId: SCHOOL });
  });
});

describe('StudentsService.createLogin', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StudentsService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );
  const STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    passwords.hash.mockResolvedValue('argon2-placeholder-hash');
    invites.sendInvite.mockResolvedValue(true);
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      admissionNo: 'SUN-2231',
      userId: null,
    });
    txMock.student.update.mockResolvedValue({});
    txMock.user.create.mockResolvedValue({ id: 'user-1' });
  });

  it('throws EMAIL_REQUIRED when no email is supplied', async () => {
    await expect(svc.createLogin(SCHOOL, STUDENT_ID, {})).rejects.toThrow(ApiError);

    try {
      await svc.createLogin(SCHOOL, STUDENT_ID, { email: '   ' });
      throw new Error('expected createLogin to throw');
    } catch (e) {
      expect((e as ApiError).getStatus()).toBe(400);
      expect((e as ApiError).getResponse()).toEqual({
        code: 'EMAIL_REQUIRED',
        message: 'An email address is required to send the invite',
        field: 'email',
      });
    }
    // Never touches the DB when the business-rule check fails up front.
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it('creates the user with the REAL email, links the student, mints a token, and emails the invite', async () => {
    const result = await svc.createLogin(SCHOOL, STUDENT_ID, {
      email: 'Parent@Example.com',
    });

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'parent@example.com',
        username: null,
        passwordHash: 'argon2-placeholder-hash',
        role: 'STUDENT',
      },
    });
    expect(txMock.student.update).toHaveBeenCalledWith({
      where: { id: STUDENT_ID },
      data: { userId: 'user-1', email: 'parent@example.com' },
    });
    // "Mints a token" is LoginInviteService's job (tested there in isolation);
    // here we assert the collaborator is invoked with the right (userId, loginName).
    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'SUN-2231');
    expect(result).toEqual({
      email: 'parent@example.com',
      username: null,
      loginName: 'SUN-2231',
      invited: true,
      emailSent: true,
    });
  });

  it('persists a username when supplied', async () => {
    await svc.createLogin(SCHOOL, STUDENT_ID, { email: 'parent@example.com', username: 'sun.2231' });

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'parent@example.com',
        username: 'sun.2231',
        passwordHash: 'argon2-placeholder-hash',
        role: 'STUDENT',
      },
    });
  });

  it('rejects a student that already has a login', async () => {
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      admissionNo: 'SUN-2231',
      userId: 'user-existing',
    });

    await expect(
      svc.createLogin(SCHOOL, STUDENT_ID, { email: 'parent@example.com' }),
    ).rejects.toThrow('Student already has a login');
    expect(txMock.user.create).not.toHaveBeenCalled();
  });

  it('still returns emailSent: false (without throwing) when the mailer fails', async () => {
    invites.sendInvite.mockResolvedValue(false);

    const result = await svc.createLogin(SCHOOL, STUDENT_ID, { email: 'parent@example.com' });

    expect(result).toEqual({
      email: 'parent@example.com',
      username: null,
      loginName: 'SUN-2231',
      invited: true,
      emailSent: false,
    });
    // The account and its link were still created — only the send failed.
    expect(txMock.user.create).toHaveBeenCalled();
    expect(txMock.student.update).toHaveBeenCalled();
  });
});

describe('StudentsService.resendInvite', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new StudentsService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );
  const STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    invites.sendInvite.mockResolvedValue(true);
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      admissionNo: 'SUN-2231',
      userId: 'user-1',
    });
    txMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'parent@example.com',
      username: null,
    });
  });

  it('mints a fresh token and re-sends for a student that already has a login', async () => {
    const result = await svc.resendInvite(SCHOOL, STUDENT_ID);

    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'SUN-2231');
    expect(result).toEqual({
      email: 'parent@example.com',
      username: null,
      loginName: 'SUN-2231',
      invited: true,
      emailSent: true,
    });
  });

  it('rejects a student with no login to resend', async () => {
    txMock.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      admissionNo: 'SUN-2231',
      userId: null,
    });

    await expect(svc.resendInvite(SCHOOL, STUDENT_ID)).rejects.toThrow(
      'Student has no login to resend an invite for',
    );
    expect(invites.sendInvite).not.toHaveBeenCalled();
  });
});

describe('StudentsController.list', () => {
  const students = { list: jest.fn().mockResolvedValue([]) };
  const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) };
  const controller = new StudentsController(
    students as unknown as StudentsService,
    tenant as unknown as TenantContextService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects a TEACHER who omits classSectionId with a VALIDATION ApiError', () => {
    expect(() => controller.list(jwt('TEACHER'))).toThrow(ApiError);
    try {
      controller.list(jwt('TEACHER'));
    } catch (e) {
      expect((e as ApiError).getStatus()).toBe(400);
      expect((e as ApiError).getResponse()).toEqual({
        code: 'VALIDATION',
        message: 'classSectionId is required',
        field: 'classSectionId',
      });
    }
    expect(students.list).not.toHaveBeenCalled();
  });

  it('asks for the roster projection when a TEACHER supplies classSectionId', async () => {
    await controller.list(jwt('TEACHER'), CLASS_SECTION);

    expect(students.list).toHaveBeenCalledWith(SCHOOL, {
      classSectionId: CLASS_SECTION,
      projection: 'roster',
    });
  });

  it('lets SCHOOL_ADMIN keep the unfiltered, full-row contract', async () => {
    await controller.list(jwt('SCHOOL_ADMIN'));

    expect(students.list).toHaveBeenCalledWith(SCHOOL, {
      classSectionId: undefined,
      projection: 'full',
    });
  });
});
