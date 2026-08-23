import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { MailService } from '../../../common/mail/mail.service';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Shared by StudentsService and TeachersService: mints a single-use
 * set-password token in the SAME table/mechanism as
 * `auth/internal/password-reset.service.ts` (so the existing
 * `/reset-password?token=…` page on the web app handles both "reset" and
 * "first-time welcome" links identically), then emails the welcome invite.
 *
 * Best-effort by design: a mail-provider outage must never make the account
 * or the token disappear — the caller gets `emailSent: false` back and the
 * admin can hit the resend endpoint once the mail path is healthy again.
 */
@Injectable()
export class LoginInviteService {
  private readonly logger = new Logger(LoginInviteService.name);
  private readonly env = loadEnv();

  constructor(private readonly mail: MailService) {}

  async sendInvite(userId: string, loginName: string): Promise<boolean> {
    const db = getPlatformPrisma();
    const user = await db.user.findUnique({
      where: { id: userId },
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
    if (!user || !user.school) {
      this.logger.warn(`sendInvite: user ${userId} or its school not found — invite not sent`);
      return false;
    }

    const token = randomBytes(24).toString('base64url'); // 192-bit, like password-reset
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
    });

    const host = user.school.domains[0]?.hostname ?? `${user.school.slug}.${this.env.PLATFORM_HOST}`;
    const scheme = host.endsWith('.localhost') ? 'http' : 'https';
    const port = host.endsWith('.localhost') ? ':3000' : '';
    const setPasswordUrl = `${scheme}://${host}${port}/reset-password?token=${token}`;

    const sent = await this.mail.sendWelcomeInvite(
      user.email,
      user.school.name,
      loginName,
      setPasswordUrl,
      user.school.id,
    );
    if (!sent) this.logger.warn(`Welcome invite email not delivered for user ${user.id}`);
    return sent;
  }
}
