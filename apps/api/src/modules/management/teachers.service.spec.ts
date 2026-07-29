import 'reflect-metadata';

const txMock = {
  teacher: {
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
  // TeachersService transitively imports the tenancy barrel (via '../auth'),
  // whose users.controller reads these enum members at decoration time.
  UserRole: {
    OWNER: 'OWNER',
    SCHOOL_ADMIN: 'SCHOOL_ADMIN',
    TEACHER: 'TEACHER',
    STUDENT: 'STUDENT',
  },
}));

jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({}),
}));

import { TeachersService } from './teachers.service';
import { ApiError } from '../../common/errors/api-error';
import type { PasswordService } from '../auth';
import type { LoginInviteService } from './internal/login-invite.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('TeachersService.createLogin', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new TeachersService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    passwords.hash.mockResolvedValue('argon2-placeholder-hash');
    invites.sendInvite.mockResolvedValue(true);
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      email: null,
      userId: null,
    });
    txMock.teacher.update.mockResolvedValue({});
    txMock.user.create.mockResolvedValue({ id: 'user-1' });
  });

  it('throws EMAIL_REQUIRED when no email is supplied and the teacher has none on file', async () => {
    await expect(svc.createLogin(SCHOOL, TEACHER_ID, {})).rejects.toThrow(ApiError);

    try {
      await svc.createLogin(SCHOOL, TEACHER_ID, {});
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

  it('creates the user with the supplied email, links the teacher, and emails the invite', async () => {
    const result = await svc.createLogin(SCHOOL, TEACHER_ID, { email: 'Jane.Doe@Example.com' });

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'jane.doe@example.com',
        username: null,
        passwordHash: 'argon2-placeholder-hash',
        role: 'TEACHER',
      },
    });
    expect(txMock.teacher.update).toHaveBeenCalledWith({
      where: { id: TEACHER_ID },
      data: { userId: 'user-1', email: 'jane.doe@example.com' },
    });
    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'jane.doe@example.com');
    expect(result).toEqual({
      email: 'jane.doe@example.com',
      username: null,
      loginName: 'jane.doe@example.com',
      invited: true,
      emailSent: true,
    });
  });

  it('falls back to the teacher\'s existing Teacher.email when the body omits one', async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      email: 'onfile@example.com',
      userId: null,
    });

    const result = await svc.createLogin(SCHOOL, TEACHER_ID, {});

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        schoolId: SCHOOL,
        email: 'onfile@example.com',
        username: null,
        passwordHash: 'argon2-placeholder-hash',
        role: 'TEACHER',
      },
    });
    expect(result.email).toBe('onfile@example.com');
  });

  it('prefers loginName = username over email when a username is supplied', async () => {
    const result = await svc.createLogin(SCHOOL, TEACHER_ID, {
      email: 'jane.doe@example.com',
      username: 'jdoe',
    });

    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'jdoe');
    expect(result.loginName).toBe('jdoe');
  });

  it('rejects a teacher that already has a login', async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      email: 'jane.doe@example.com',
      userId: 'user-existing',
    });

    await expect(
      svc.createLogin(SCHOOL, TEACHER_ID, { email: 'jane.doe@example.com' }),
    ).rejects.toThrow('Teacher already has a login');
    expect(txMock.user.create).not.toHaveBeenCalled();
  });

  it('still returns emailSent: false (without throwing) when the mailer fails', async () => {
    invites.sendInvite.mockResolvedValue(false);

    const result = await svc.createLogin(SCHOOL, TEACHER_ID, { email: 'jane.doe@example.com' });

    expect(result.emailSent).toBe(false);
    expect(result.invited).toBe(true);
    expect(txMock.user.create).toHaveBeenCalled();
  });
});

describe('TeachersService.resendInvite', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new TeachersService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    invites.sendInvite.mockResolvedValue(true);
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      email: 'jane.doe@example.com',
      userId: 'user-1',
    });
    txMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'jane.doe@example.com',
      username: null,
    });
  });

  it('mints a fresh token and re-sends for a teacher that already has a login', async () => {
    const result = await svc.resendInvite(SCHOOL, TEACHER_ID);

    expect(invites.sendInvite).toHaveBeenCalledWith('user-1', 'jane.doe@example.com');
    expect(result).toEqual({
      email: 'jane.doe@example.com',
      username: null,
      loginName: 'jane.doe@example.com',
      invited: true,
      emailSent: true,
    });
  });

  it('rejects a teacher with no login to resend', async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      email: 'jane.doe@example.com',
      userId: null,
    });

    await expect(svc.resendInvite(SCHOOL, TEACHER_ID)).rejects.toThrow(
      'Teacher has no login to resend an invite for',
    );
    expect(invites.sendInvite).not.toHaveBeenCalled();
  });
});

describe('TeachersService.me', () => {
  const passwords = { hash: jest.fn() };
  const invites = { sendInvite: jest.fn() };
  const svc = new TeachersService(
    passwords as unknown as PasswordService,
    invites as unknown as LoginInviteService,
  );
  const USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  it("returns the caller's own Teacher row, resolved from userId (never an id in the URL)", async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      firstName: 'Priya',
      lastName: 'Rao',
      email: 'priya@example.com',
      phone: '9999999999',
      teacherSubjects: [{ subject: { name: 'Chemistry' } }],
      classSections: [{ name: 'A', grade: { name: '9', order: 9 } }],
    });

    const result = await svc.me(SCHOOL, USER_ID);

    expect(txMock.teacher.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
    expect(result).toEqual({
      id: TEACHER_ID,
      firstName: 'Priya',
      lastName: 'Rao',
      email: 'priya@example.com',
      phone: '9999999999',
      subjects: ['Chemistry'],
      classTeacherOf: ['9-A'],
    });
  });

  it('sorts subjects alphabetically and classTeacherOf by grade order, not DB/insertion order', async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      firstName: 'Priya',
      lastName: 'Rao',
      email: 'priya@example.com',
      phone: null,
      // DB order: Physics before Chemistry — the assertion below only
      // passes if the service actually sorts rather than passing this
      // through.
      teacherSubjects: [{ subject: { name: 'Physics' } }, { subject: { name: 'Chemistry' } }],
      // Grade 10 comes back from the DB before grade 9. A lexicographic sort
      // on "10-B"/"9-A" would (wrongly) keep "10-B" first; sorting by
      // Grade.order puts "9-A" first, matching how the rest of the school
      // numbers its grades.
      classSections: [
        { name: 'B', grade: { name: '10', order: 10 } },
        { name: 'A', grade: { name: '9', order: 9 } },
      ],
    });

    const result = await svc.me(SCHOOL, USER_ID);

    expect(result.subjects).toEqual(['Chemistry', 'Physics']);
    expect(result.classTeacherOf).toEqual(['9-A', '10-B']);
  });

  it('throws a readable 404 when the TEACHER-role caller has no Teacher row', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);

    await expect(svc.me(SCHOOL, USER_ID)).rejects.toThrow('No teacher profile found for this login');
  });

  it('returns empty arrays, not undefined, for a teacher with no subjects and no class-teacher section', async () => {
    txMock.teacher.findFirst.mockResolvedValue({
      id: TEACHER_ID,
      firstName: 'Priya',
      lastName: 'Rao',
      email: null,
      phone: null,
      teacherSubjects: [],
      classSections: [],
    });

    const result = await svc.me(SCHOOL, USER_ID);

    expect(result.subjects).toEqual([]);
    expect(result.classTeacherOf).toEqual([]);
  });
});
