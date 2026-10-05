import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { PasswordService } from '../../auth';

export interface AdminRow {
  userId: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
}

/**
 * Owner-side school-admin credential control. Runs on the BYPASSRLS platform
 * connection, so every lookup is explicitly scoped by schoolId + role — that
 * scoping is the only thing preventing an IDOR onto another school or an OWNER.
 */
@Injectable()
export class AdminCredentialsService {
  private readonly logger = new Logger(AdminCredentialsService.name);

  constructor(private readonly passwords: PasswordService) {}

  async listAdmins(schoolId: string): Promise<AdminRow[]> {
    const db = getPlatformPrisma();
    const users = await db.user.findMany({
      where: { schoolId, role: 'SCHOOL_ADMIN' },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, isActive: true, lastLoginAt: true, lockedUntil: true },
    });
    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
    }));
  }

  /**
   * Sets a new password for one of THIS school's admins: the one the owner
   * typed, or a generated one when they left it blank. Either way the old
   * password stops working at once, any lockout is lifted, and every session
   * the admin has open is signed out. The password is returned once, for the
   * owner to hand over; it is never stored or logged in the clear.
   */
  async resetPassword(
    schoolId: string,
    userId: string,
    chosen?: string,
  ): Promise<{ password: string; generated: boolean }> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({
      where: { id: userId, schoolId, role: 'SCHOOL_ADMIN' },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Admin not found for this school');

    const generated = !chosen;
    const password = chosen ?? randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(password);

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      db.refreshToken.updateMany({
        where: { userId: user.id, schoolId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log({ actor: 'owner', schoolId, targetUserId: user.id, action: 'admin.password.reset', generated });
    return { password, generated };
  }
}
