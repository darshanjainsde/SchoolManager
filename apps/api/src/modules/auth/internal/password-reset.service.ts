import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from './password.service';
import { MailService } from '../../../common/mail/mail.service';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
            name: true,
            slug: true,
            domains: { where: { isPrimary: true, status: 'LIVE' }, select: { hostname: true }, take: 1 },
          },
        },
      },
    });
    if (!user || !user.school) return;

    const token = randomBytes(24).toString('base64url'); // 192-bit, like invites
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
    });

    const host = user.school.domains[0]?.hostname ?? `${user.school.slug}.${this.env.PLATFORM_HOST}`;
    const scheme = host.endsWith('.localhost') ? 'http' : 'https';
    const port = host.endsWith('.localhost') ? ':3000' : '';
    const resetUrl = `${scheme}://${host}${port}/reset-password?token=${token}`;
    const sent = await this.mail.sendPasswordReset(user.email, user.school.name, resetUrl);
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
