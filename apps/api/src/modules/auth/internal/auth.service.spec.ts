import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  student: {
    findFirst: jest.fn(),
  },
  teacher: {
    findFirst: jest.fn(),
  },
  staff: {
    findFirst: jest.fn(),
  },
};

const txMock = {
  refreshToken: {
    create: jest.fn().mockResolvedValue({ id: 'refresh-row-1' }),
  },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => prismaMock,
  withTenant: (_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));
jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({
    JWT_SCHOOL_ACCESS_SECRET: 'test-school-access-secret',
    JWT_SCHOOL_REFRESH_SECRET: 'test-school-refresh-secret',
    JWT_ACCESS_TTL: 900,
    JWT_REFRESH_TTL: 3600,
    LOCKOUT_MAX_ATTEMPTS: 5,
    LOCKOUT_DURATION_SECONDS: 900,
  }),
}));

import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    schoolId: SCHOOL,
    email: 'student.parent@example.com',
    passwordHash: 'hashed',
    role: 'STUDENT',
    isActive: true,
    lockedUntil: null,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'student-1',
    schoolId: SCHOOL,
    admissionNo: 'SUN-2231',
    userId: 'user-1',
    ...overrides,
  };
}

describe('AuthService.login', () => {
  const jwt = new JwtService({});
  const passwords = { verify: jest.fn() };
  const svc = new AuthService(jwt, passwords as unknown as PasswordService);

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.update.mockResolvedValue({});
    // Non-email logins try username first; default to "no such username" so
    // existing admission-number-path tests fall through unchanged unless a
    // test overrides this explicitly.
    prismaMock.user.findFirst.mockResolvedValue(null);
    txMock.refreshToken.create.mockResolvedValue({ id: 'refresh-row-1' });
  });

  it('logs a student in with a valid admission number + password', async () => {
    prismaMock.student.findFirst.mockResolvedValue(studentRow());
    prismaMock.user.findUnique.mockResolvedValue(userRow());
    passwords.verify.mockResolvedValue(true);

    const res = await svc.login(SCHOOL, 'SUN-2231', 'correct-password');

    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, username: { equals: 'SUN-2231', mode: 'insensitive' } },
    });
    expect(prismaMock.student.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, admissionNo: { equals: 'SUN-2231', mode: 'insensitive' } },
    });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('rejects an admission number that resolves to a student with no linked user', async () => {
    prismaMock.student.findFirst.mockResolvedValue(studentRow({ userId: null }));

    await expect(svc.login(SCHOOL, 'SUN-2231', 'whatever')).rejects.toThrow(UnauthorizedException);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown admission number with the same generic message (no enumeration)', async () => {
    prismaMock.student.findFirst.mockResolvedValue(null);

    await expect(svc.login(SCHOOL, 'NOT-A-REAL-ADM-NO', 'whatever')).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('logs a student in with the RAF-00042 student code (Phase 5·1) — code path first, case-insensitive', async () => {
    prismaMock.student.findFirst.mockResolvedValue(studentRow());
    prismaMock.user.findUnique.mockResolvedValue(userRow());
    passwords.verify.mockResolvedValue(true);

    const res = await svc.login(SCHOOL, 'sun-00042', 'correct-password');

    expect(res.accessToken).toBeTruthy();
    expect(prismaMock.student.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, code: { equals: 'sun-00042', mode: 'insensitive' } },
    });
    // Resolved by code — the username path was never consulted.
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('a code-shaped identifier that matches no code still falls through to username/admission-no', async () => {
    prismaMock.student.findFirst
      .mockResolvedValueOnce(null) // the code lookup misses…
      .mockResolvedValueOnce(studentRow()); // …the admission-no lookup hits
    prismaMock.user.findFirst.mockResolvedValue(null); // username misses too
    prismaMock.user.findUnique.mockResolvedValue(userRow());
    passwords.verify.mockResolvedValue(true);

    const res = await svc.login(SCHOOL, 'SUN-22310', 'correct-password');

    expect(res.accessToken).toBeTruthy();
  });

  it('logs in by username without ever touching the admission-number path', async () => {
    prismaMock.user.findFirst.mockResolvedValue(userRow({ id: 'user-2', username: 'jane.doe' }));
    prismaMock.user.findUnique.mockResolvedValue(userRow({ id: 'user-2', username: 'jane.doe' }));
    passwords.verify.mockResolvedValue(true);

    const res = await svc.login(SCHOOL, 'jane.doe', 'correct-password');

    expect(res.accessToken).toBeTruthy();
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, username: { equals: 'jane.doe', mode: 'insensitive' } },
    });
    expect(prismaMock.student.findFirst).not.toHaveBeenCalled();
    // findFirst already resolved the full user row — no extra findUnique
    // round-trip needed on the username path (unlike admission-number, which
    // resolves Student -> userId -> User in two hops).
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown username with the same generic message (no enumeration)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.student.findFirst.mockResolvedValue(null);

    await expect(svc.login(SCHOOL, 'no-such-user', 'whatever')).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('still logs in via email unchanged', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow());
    passwords.verify.mockResolvedValue(true);

    const res = await svc.login(SCHOOL, 'Student.Parent@Example.com', 'correct-password');

    expect(res.accessToken).toBeTruthy();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { schoolId_email: { schoolId: SCHOOL, email: 'student.parent@example.com' } },
    });
    expect(prismaMock.student.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a bad password on the admission-number path and records the failed attempt', async () => {
    prismaMock.student.findFirst.mockResolvedValue(studentRow());
    prismaMock.user.findUnique.mockResolvedValue(userRow({ failedLoginAttempts: 0 }));
    passwords.verify.mockResolvedValue(false);

    await expect(svc.login(SCHOOL, 'SUN-2231', 'wrong-password')).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 1, lockedUntil: null },
    });
  });

  it('rejects a locked-out user resolved via admission number', async () => {
    prismaMock.student.findFirst.mockResolvedValue(studentRow());
    prismaMock.user.findUnique.mockResolvedValue(
      userRow({ lockedUntil: new Date(Date.now() + 60_000) }),
    );

    await expect(svc.login(SCHOOL, 'SUN-2231', 'correct-password')).rejects.toThrow(ForbiddenException);
  });
});

/**
 * GREETING SOMEONE BY THEIR EMAIL ADDRESS IS NOT A GREETING.
 *
 * `User` stores credentials and has no name column, so the mobile app had
 * nothing to show but the identifier typed at the login box — the staff home
 * screen read "Good day, rao@raffles.sckools.com". The name lives on whichever
 * role record points back at the user, and this resolves it.
 */
describe('AuthService.displayNameFor', () => {
  const jwt = new JwtService({});
  const passwords = { verify: jest.fn() };
  const svc = new AuthService(jwt, passwords as unknown as PasswordService);

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.teacher.findFirst.mockResolvedValue(null);
    prismaMock.student.findFirst.mockResolvedValue(null);
    prismaMock.staff.findFirst.mockResolvedValue(null);
  });

  it('reads a teacher name off the Teacher record', async () => {
    prismaMock.teacher.findFirst.mockResolvedValue({ firstName: 'Priya', lastName: 'Sharma' });
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'TEACHER')).resolves.toBe('Priya Sharma');
  });

  it('scopes the lookup to the school AND the user, never the user alone', async () => {
    prismaMock.teacher.findFirst.mockResolvedValue({ firstName: 'Priya', lastName: 'Sharma' });
    await svc.displayNameFor(SCHOOL, 'user-1', 'TEACHER');
    expect(prismaMock.teacher.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: SCHOOL, userId: 'user-1' } }),
    );
  });

  it('checks the role-hinted table first, so the common case costs one query', async () => {
    prismaMock.student.findFirst.mockResolvedValue({ firstName: 'Aarav', lastName: 'Patel' });
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'STUDENT')).resolves.toBe('Aarav Patel');
    expect(prismaMock.teacher.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it('finds a SCHOOL_ADMIN, whose name sits on a Staff row no role name points at', async () => {
    // The JWT role has no matching table of its own. Hinting STAFF is what
    // stops an admin being greeted by their email forever.
    prismaMock.staff.findFirst.mockResolvedValue({ firstName: 'Ravi', lastName: 'Menon' });
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'SCHOOL_ADMIN')).resolves.toBe('Ravi Menon');
  });

  it('keeps looking when the hinted table has nothing — a re-roled account still has a name', async () => {
    prismaMock.teacher.findFirst.mockResolvedValue({ firstName: 'Nadia', lastName: 'Khan' });
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'SCHOOL_ADMIN')).resolves.toBe('Nadia Khan');
  });

  it('returns null when no role record claims the user, rather than a stray space', async () => {
    // A fresh admin invited by email before any staff record exists. The client
    // must render something sensible — never the word "null".
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'SCHOOL_ADMIN')).resolves.toBeNull();
  });

  it('treats a whitespace-only name as no name at all', async () => {
    prismaMock.teacher.findFirst.mockResolvedValue({ firstName: ' ', lastName: ' ' });
    await expect(svc.displayNameFor(SCHOOL, 'user-1', 'TEACHER')).resolves.toBeNull();
  });
});

/**
 * A refresh token from ANOTHER school must be refused before anything is
 * rotated.
 *
 * Both schools' refresh cookies travel under the shared parent domain, so a
 * browser signed into two schools offers both on every refresh. Accepting the
 * wrong one mints an access token for school A on school B's host — the console
 * then renders while every request 401s ("Token does not match this tenant"),
 * which is exactly what happened on production. The rejection must also happen
 * BEFORE any database work: rotating or revoking the other school's token would
 * silently end a live session belonging to a different school.
 */
describe('AuthService.refresh — tenant binding', () => {
  const jwt = new JwtService({});
  const passwords = { verify: jest.fn() };
  const svc = new AuthService(jwt, passwords as unknown as PasswordService);
  const SCHOOL_A = '11111111-1111-1111-1111-111111111111';
  const SCHOOL_B = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => jest.clearAllMocks());

  function tokenFor(schoolId: string): string {
    return jwt.sign(
      { sub: 'user-1', jti: 'j1', fam: 'f1', schoolId },
      { secret: process.env.JWT_SCHOOL_REFRESH_SECRET, audience: 'school-refresh' },
    );
  }

  it('refuses a token minted for a different school', async () => {
    await expect(svc.refresh(tokenFor(SCHOOL_A), SCHOOL_B)).rejects.toThrow(
      'Refresh token belongs to another school',
    );
    // Nothing was looked up or rotated — the other school's session is intact.
    expect(txMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it('gets past the tenant gate when the token belongs to this school', async () => {
    // It still fails further down (this harness stubs no stored token), but it
    // must NOT fail with the tenant message — that is what proves the gate
    // opened for the right school rather than rejecting everything.
    await expect(svc.refresh(tokenFor(SCHOOL_A), SCHOOL_A)).rejects.not.toThrow(
      'Refresh token belongs to another school',
    );
  });

  it('stays backward compatible when no tenant is supplied', async () => {
    await expect(svc.refresh(tokenFor(SCHOOL_A))).rejects.not.toThrow(
      'Refresh token belongs to another school',
    );
  });
});
