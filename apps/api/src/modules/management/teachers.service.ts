import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { PasswordService } from '../auth';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2003, isP2025, p2002Target } from './internal/prisma-errors';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateTeacherDto, UpdateTeacherDto } from './management.dto';
import type { LoginInviteResult } from './students.service';

@Injectable()
export class TeachersService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly invites: LoginInviteService,
  ) {}

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.teacher.findMany({
        where: { schoolId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          school: false,
        },
      }),
    );
  }

  async create(schoolId: string, dto: CreateTeacherDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.teacher.create({
          data: { ...dto, schoolId },
        }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A teacher with those details already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateTeacherDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.teacher.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Teacher not found');
      if (isP2002(e)) throw new ConflictException('A teacher with those details already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.teacher.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Teacher not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this teacher');
      throw e;
    }
  }

  /**
   * Creates the teacher's login and emails a "welcome — set your password"
   * invite. `dto.email` falls back to the teacher's existing contact email
   * (Teacher.email) when omitted — either way a real, usable address is
   * required to send the invite.
   */
  async createLogin(schoolId: string, teacherId: string, dto: CreateLoginDto): Promise<LoginInviteResult> {
    const username = dto.username?.trim() || null;

    const { userId, email, loginName } = await withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { id: teacherId } });
      if (!teacher) throw new NotFoundException('Teacher not found');
      if (teacher.userId) throw new ConflictException('Teacher already has a login');

      const email = (dto.email?.trim() || teacher.email?.trim() || '').toLowerCase();
      if (!email) {
        throw new ApiError('EMAIL_REQUIRED', 'An email address is required to send the invite', 400, 'email');
      }

      const placeholder = randomBytes(32).toString('base64url');
      const passwordHash = await this.passwords.hash(placeholder);

      let user: { id: string };
      try {
        user = await tx.user.create({
          data: { schoolId, email, username, passwordHash, role: 'TEACHER' },
        });
      } catch (e) {
        if (isP2002(e)) throw this.conflictFor(e);
        throw e;
      }

      await tx.teacher.update({ where: { id: teacherId }, data: { userId: user.id, email } });
      return { userId: user.id, email, loginName: username ?? email };
    });

    const emailSent = await this.invites.sendInvite(userId, loginName);
    return { email, username, loginName, invited: true, emailSent };
  }

  /** Re-sends the welcome invite for a teacher who already has a login. */
  async resendInvite(schoolId: string, teacherId: string): Promise<LoginInviteResult> {
    const { userId, email, username, loginName } = await withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { id: teacherId } });
      if (!teacher) throw new NotFoundException('Teacher not found');
      if (!teacher.userId) throw new NotFoundException('Teacher has no login to resend an invite for');

      const user = await tx.user.findUnique({ where: { id: teacher.userId } });
      if (!user) throw new NotFoundException('Teacher has no login to resend an invite for');

      return { userId: teacher.userId, email: user.email, username: user.username, loginName: user.username ?? user.email };
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
