const dbMock = {
  user: { findFirst: jest.fn() },
  student: { findFirst: jest.fn() },
  passwordResetToken: { create: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => dbMock,
}));
jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({ PLATFORM_HOST: 'sckools.com' }),
}));

import { PasswordResetService, maskEmail } from './password-reset.service';
import type { PasswordService } from './password.service';
import type { MailService } from '../../../common/mail/mail.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const userWithSchool = () => ({
  id: 'user-1',
  email: 'sonia.parent@gmail.com',
  school: { name: 'Sunrise Public School', slug: 'sunrise', domains: [{ hostname: 'sunrise.sckools.com' }] },
});

describe('PasswordResetService.requestResetByCode (Phase 5·1)', () => {
  const passwords = { hash: jest.fn() };
  const mail = { sendPasswordReset: jest.fn() };
  const svc = new PasswordResetService(
    passwords as unknown as PasswordService,
    mail as unknown as MailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mail.sendPasswordReset.mockResolvedValue(true);
    dbMock.passwordResetToken.create.mockResolvedValue({ id: 'prt-1' });
    dbMock.student.findFirst.mockResolvedValue({ userId: 'user-1' });
    dbMock.user.findFirst.mockResolvedValue(userWithSchool());
  });

  it('resolves the code (case-insensitive), mints a token, emails the reset link, returns the MASK', async () => {
    const masked = await svc.requestResetByCode(SCHOOL, 'sun-00042');

    expect(dbMock.student.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, code: { equals: 'sun-00042', mode: 'insensitive' } },
      select: { userId: true },
    });
    expect(dbMock.passwordResetToken.create).toHaveBeenCalled();
    const [to, schoolName, url] = mail.sendPasswordReset.mock.calls[0];
    expect(to).toBe('sonia.parent@gmail.com');
    expect(schoolName).toBe('Sunrise Public School');
    // Link host comes from the school's own DB record, never request headers.
    expect(url).toMatch(/^https:\/\/sunrise\.sckools\.com\/reset-password\?token=/);
    expect(masked).toBe('s•••t@gmail.com');
  });

  it('returns null (no mail, no token) for an unknown code', async () => {
    dbMock.student.findFirst.mockResolvedValue(null);

    expect(await svc.requestResetByCode(SCHOOL, 'SUN-99999')).toBeNull();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect(dbMock.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('returns null for a student with no login, and for a disabled login', async () => {
    dbMock.student.findFirst.mockResolvedValue({ userId: null });
    expect(await svc.requestResetByCode(SCHOOL, 'SUN-00042')).toBeNull();

    dbMock.student.findFirst.mockResolvedValue({ userId: 'user-1' });
    dbMock.user.findFirst.mockResolvedValue(null); // isActive filter missed
    expect(await svc.requestResetByCode(SCHOOL, 'SUN-00042')).toBeNull();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('maskEmail', () => {
  it('keeps first + last of the local part', () => {
    expect(maskEmail('sonia@gmail.com')).toBe('s•••a@gmail.com');
  });
  it('keeps only the first char for short local parts', () => {
    expect(maskEmail('ab@x.in')).toBe('a•••@x.in');
  });
  it('never throws on a malformed address', () => {
    expect(maskEmail('not-an-email')).toBe('•••');
  });
});
