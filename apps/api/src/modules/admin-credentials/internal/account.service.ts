import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { PasswordService } from '../../auth';

/**
 * Self-service password change for a logged-in school user. Requires the
 * current password, and revokes all of the user's sessions so the change
 * propagates everywhere.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly passwords: PasswordService) {}

  async changePassword(
    schoolId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash } }),
      db.refreshToken.updateMany({
        where: { userId: user.id, schoolId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log({ actor: userId, schoolId, action: 'admin.password.change' });
    return { ok: true };
  }
}
