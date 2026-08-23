import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from './password.service';
import { MailService } from '../../../common/mail/mail.service';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface UserWithSchool {
  id: string;
  email: string;
  school: { id: string; name: string; slug: string; domains: { hostname: string }[] };
}

/** "sonia@gmail.com" → "s•••a@gmail.com" (short local parts keep first char only). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const masked =
    local.length <= 2 ? `${local.charAt(0)}•••` : `${local.charAt(0)}•••${local.charAt(local.length - 1)}`;
  return `${masked}@${domain}`;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  /**
   * Always resolves (no account enumeration). When the email matches an active
   * user of this school, mints a single-use token and emails the reset link.
   * The link host comes from the school's own DB record — never from request
   * headers, which would allow host-header injection into the emailed link.
   */
  async requestReset(schoolId: string, email: string): Promise<void> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({
      where: { schoolId, email: email.toLowerCase(), isActive: true },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            slug: true,
            domains: { where: { isPrimary: true, status: 'LIVE' }, select: { hostname: true }, take: 1 },
          },
        },
      },
    });
    if (!user || !user.school) return;
    await this.mintAndSend(user as UserWithSchool);
  }

  /**
   * Phase 5·1 — reset with ONLY the student code (RAF-00042): resolves
   * code → student → linked login, sends the same reset link to the email on
   * the child's profile, and returns a MASKED form of that address for the
   * "sent to s•••a@gmail.com" confirmation. Returns null (still 200 at the
   * controller) when the code doesn't resolve or the student has no
   * login/email — the copy then points at the school office. Tightly
   * throttled at the route; codes are semi-public (printed in the diary), so
   * the mask is the confirmation, never the full address.
   */
  async requestResetByCode(schoolId: string, code: string): Promise<string | null> {
    const db = getPlatformPrisma();
    const student = await db.student.findFirst({
      where: { schoolId, code: { equals: code, mode: 'insensitive' } },
      select: { userId: true },
    });
    if (!student?.userId) return null;
    const user = await db.user.findFirst({
      where: { id: student.userId, isActive: true },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            slug: true,
            domains: { where: { isPrimary: true, status: 'LIVE' }, select: { hostname: true }, take: 1 },
          },
        },
      },
    });
    if (!user || !user.school || !user.email) return null;
    await this.mintAndSend(user as UserWithSchool);
    return maskEmail(user.email);
  }

  private async mintAndSend(user: UserWithSchool): Promise<void> {
    const db = getPlatformPrisma();
    const token = randomBytes(24).toString('base64url'); // 192-bit, like invites
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
    });

    const host = user.school.domains[0]?.hostname ?? `${user.school.slug}.${this.env.PLATFORM_HOST}`;
    const scheme = host.endsWith('.localhost') ? 'http' : 'https';
    const port = host.endsWith('.localhost') ? ':3000' : '';
    const resetUrl = `${scheme}://${host}${port}/reset-password?token=${token}`;
    const sent = await this.mail.sendPasswordReset(user.email, user.school.name, resetUrl, user.school.id);
    if (!sent) this.logger.warn(`Reset email not delivered for user ${user.id}`);
  }

  /** Validates the token, sets the new password, revokes sessions, burns the token. */
  async resetPassword(schoolId: string, token: string, newPassword: string): Promise<void> {
    const db = getPlatformPrisma();
    const row = await db.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, schoolId: true } } },
    });
    const invalid =
      !row ||
      row.usedAt !== null ||
      row.expiresAt < new Date() ||
      row.user.schoolId !== schoolId;
    if (invalid) throw new BadRequestException('This reset link is invalid or has expired — request a new one.');

    const passwordHash = await this.passwords.hash(newPassword);
    await db.$transaction([
      db.user.update({ where: { id: row.user.id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
      db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // Log out every existing session — the password may have leaked.
      db.refreshToken.updateMany({
        where: { userId: row.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
