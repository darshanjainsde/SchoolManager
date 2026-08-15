import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { PasswordService } from '../auth';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2003, isP2025, p2002Target } from '../../common/errors/prisma-errors';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateStaffDto, UpdateStaffDto } from './management.dto';
import type { LoginInviteResult } from './students.service';

@Injectable()
export class StaffService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly invites: LoginInviteService,
  ) {}

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.staff.findMany({
        where: { schoolId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    );
  }

  async create(schoolId: string, dto: CreateStaffDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.staff.create({
          data: { ...dto, schoolId },
        }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A staff member with those details already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateStaffDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.staff.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Staff member not found');
      if (isP2002(e)) throw new ConflictException('A staff member with those details already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.staff.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Staff member not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this staff member');
      throw e;
    }
  }

  /**
   * Creates the staff member's login and emails a "welcome — set your
   * password" invite, mirroring TeachersService.createLogin. The account is
   * created with role STAFF (never TEACHER/STUDENT) so a staff login can
   * never be mistaken for, or granted the portal reach of, either — see the
   * UserRole enum in packages/db/prisma/schema.prisma.
   *
   * `dto.email` falls back to the staff member's existing contact email
   * (Staff.email) when omitted — either way a real, usable address is
   * required to send the invite.
   */
  async createLogin(schoolId: string, staffId: string, dto: CreateLoginDto): Promise<LoginInviteResult> {
    const username = dto.username?.trim() || null;

    const { userId, email, loginName } = await withTenant(schoolId, async (tx) => {
      const staff = await tx.staff.findFirst({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff member not found');
      if (staff.userId) throw new ConflictException('Staff member already has a login');

      const email = (dto.email?.trim() || staff.email?.trim() || '').toLowerCase();
      if (!email) {
        throw new ApiError('EMAIL_REQUIRED', 'An email address is required to send the invite', 400, 'email');
      }

      const placeholder = randomBytes(32).toString('base64url');
      const passwordHash = await this.passwords.hash(placeholder);

      // THE JOB DECIDES THE LOGIN. A staff member whose role is LIBRARIAN gets
      // a LIBRARIAN user; everyone else gets STAFF. The admin picks what the
      // person IS on the staff form, and their access follows — rather than
      // being asked a second, separate question ("which kind of login?") that
      // a school has no reason to think in terms of.
      //
      // `dto.role` still wins when given, so the API contract is unchanged for
      // any caller that names it explicitly. Both paths are constrained to
      // STAFF | LIBRARIAN by the DTO: this screen must never be able to mint a
      // TEACHER or an admin, which is what would turn staff management into a
      // privilege-escalation path.
      const role = dto.role ?? (staff.role === 'LIBRARIAN' ? 'LIBRARIAN' : 'STAFF');

      let user: { id: string };
      try {
        user = await tx.user.create({
          data: { schoolId, email, username, passwordHash, role },
        });
      } catch (e) {
        if (isP2002(e)) throw this.conflictFor(e);
        throw e;
      }

      await tx.staff.update({ where: { id: staffId }, data: { userId: user.id, email } });
      return { userId: user.id, email, loginName: username ?? email };
    });

    const emailSent = await this.invites.sendInvite(userId, loginName);
    return { email, username, loginName, invited: true, emailSent };
  }

  /** Re-sends the welcome invite for a staff member who already has a login. */
  async resendInvite(schoolId: string, staffId: string): Promise<LoginInviteResult> {
    const { userId, email, username, loginName } = await withTenant(schoolId, async (tx) => {
      const staff = await tx.staff.findFirst({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff member not found');
      if (!staff.userId) throw new NotFoundException('Staff member has no login to resend an invite for');

      const user = await tx.user.findUnique({ where: { id: staff.userId } });
      if (!user) throw new NotFoundException('Staff member has no login to resend an invite for');

      return { userId: staff.userId, email: user.email, username: user.username, loginName: user.username ?? user.email };
    });

    const emailSent = await this.invites.sendInvite(userId, loginName);
    return { email, username, loginName, invited: true, emailSent };
  }

  private conflictFor(e: unknown): ApiError {
    const target = p2002Target(e);
    if (target.includes('username')) {
      return new ApiError('VALIDATION', 'That username is already in use', 409, 'username');
    }
    return new ApiError('VALIDATION', 'That email address is already in use', 409, 'email');
  }
}
