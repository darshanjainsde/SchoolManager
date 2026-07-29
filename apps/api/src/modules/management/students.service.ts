import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { RosterStudent } from '@skoolos/types';
import { PasswordService } from '../auth';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2003, isP2025, p2002Target } from '../../common/errors/prisma-errors';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateStudentDto, UpdateStudentDto } from './management.dto';

export interface LoginInviteResult {
  email: string;
  username: string | null;
  loginName: string;
  invited: true;
  emailSent: boolean;
}

/**
 * How much of a Student row the caller is allowed to see.
 *
 * - `full`   — every column plus the class/grade names. SCHOOL_ADMIN only.
 * - `roster` — the four fields needed to render a name next to a studentId
 *              (attendance / exam-result entry). Deliberately excludes the
 *              minor's PII: guardianName, guardianPhone, dob, gender,
 *              admissionNo, userId.
 *
 * The caller (controller) decides which projection applies — this service
 * never reads the request/role itself.
 */
export type StudentProjection = 'full' | 'roster';

/** Exactly the columns a `roster` projection may return. */
export const ROSTER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  rollNo: true,
} as const;

export type { RosterStudent };

interface ListFilters {
  classSectionId?: string;
  projection?: StudentProjection;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly invites: LoginInviteService,
  ) {}

  async list(schoolId: string, filters: ListFilters = {}) {
    const where = {
      schoolId,
      ...(filters.classSectionId ? { classSectionId: filters.classSectionId } : {}),
    };
    const orderBy = [{ admissionNo: 'asc' as const }];

    if (filters.projection === 'roster') {
      // Narrow projection: nothing here is minor PII, so a TEACHER may read it
      // for the one class section they asked about.
      return withTenant(schoolId, (tx) =>
        tx.student.findMany({ where, orderBy, select: { ...ROSTER_SELECT } }),
      ) as Promise<RosterStudent[]>;
    }

    return withTenant(schoolId, (tx) =>
      tx.student.findMany({
        where,
        orderBy,
        include: {
          classSection: {
            select: {
              name: true,
              grade: { select: { name: true } },
            },
          },
        },
      }),
    );
  }

  async create(schoolId: string, dto: CreateStudentDto) {
    if (dto.classSectionId !== undefined) {
      await this.validateClassSection(schoolId, dto.classSectionId);
    }
    const { dob, ...rest } = dto;
    try {
      return await withTenant(schoolId, (tx) =>
        tx.student.create({
          data: {
            ...rest,
            schoolId,
            dob: dob ? new Date(dob) : undefined,
          },
        }),
      );
    } catch (e) {
      if (isP2002(e))
        throw new ConflictException('A student with that admission number already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateStudentDto) {
    if (dto.classSectionId !== undefined) {
      await this.validateClassSection(schoolId, dto.classSectionId);
    }
    const { dob, ...rest } = dto;
    try {
      return await withTenant(schoolId, (tx) =>
        tx.student.update({
          where: { id },
          data: {
            ...rest,
            ...(dob !== undefined ? { dob: new Date(dob) } : {}),
          },
        }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Student not found');
      if (isP2002(e))
        throw new ConflictException('A student with that admission number already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.student.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Student not found');
      if (isP2003(e))
        throw new ConflictException('Cannot delete: other records still reference this student');
      throw e;
    }
  }

  /**
   * Creates the student's login and emails them a "welcome — set your
   * password" invite (see LoginInviteService). Replaces the old synthetic
   * undeliverable-email + on-screen-temp-password flow: the school admin now
   * supplies a REAL contact email, and the account is unusable until the
   * student follows the invite link and sets their own password.
   */
  async createLogin(schoolId: string, studentId: string, dto: CreateLoginDto): Promise<LoginInviteResult> {
    const email = dto.email?.trim().toLowerCase();
    if (!email) {
      throw new ApiError('EMAIL_REQUIRED', 'An email address is required to send the invite', 400, 'email');
    }
    const username = dto.username?.trim() || null;

    const { userId, admissionNo } = await withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId } });
      if (!student) throw new NotFoundException('Student not found');
      if (student.userId) throw new ConflictException('Student already has a login');

      // The account must exist to receive the invite, but must be unusable
      // until the student follows the link — hash a long random secret no
      // one is ever shown, rather than a short human-facing temp password.
      const placeholder = randomBytes(32).toString('base64url');
      const passwordHash = await this.passwords.hash(placeholder);

      let user: { id: string };
      try {
        user = await tx.user.create({
          data: { schoolId, email, username, passwordHash, role: 'STUDENT' },
        });
      } catch (e) {
        if (isP2002(e)) throw this.conflictFor(e);
        throw e;
      }

      await tx.student.update({ where: { id: studentId }, data: { userId: user.id, email } });
      return { userId: user.id, admissionNo: student.admissionNo };
    });

    const emailSent = await this.invites.sendInvite(userId, admissionNo);
    return { email, username, loginName: admissionNo, invited: true, emailSent };
  }

  /**
   * Re-sends the welcome invite for a student who already has a login (e.g.
   * the first email bounced, or the 30-minute link expired). Mints a fresh
   * token every time — old ones are simply left to expire/never get burned.
   */
  async resendInvite(schoolId: string, studentId: string): Promise<LoginInviteResult> {
    const { userId, email, username, admissionNo } = await withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId } });
      if (!student) throw new NotFoundException('Student not found');
      if (!student.userId) throw new NotFoundException('Student has no login to resend an invite for');

      const user = await tx.user.findUnique({ where: { id: student.userId } });
      if (!user) throw new NotFoundException('Student has no login to resend an invite for');

      return { userId: student.userId, email: user.email, username: user.username, admissionNo: student.admissionNo };
    });

    const emailSent = await this.invites.sendInvite(userId, admissionNo);
    return { email, username, loginName: admissionNo, invited: true, emailSent };
  }

  private conflictFor(e: unknown): ApiError {
    const target = p2002Target(e);
    if (target.includes('username')) {
      return new ApiError('VALIDATION', 'That username is already in use', 409, 'username');
    }
    return new ApiError('VALIDATION', 'That email address is already in use', 409, 'email');
  }

  private async validateClassSection(schoolId: string, classSectionId: string) {
    await withTenant(schoolId, async (tx) => {
      const cs = await tx.classSection.findUnique({ where: { id: classSectionId } });
      if (!cs) throw new BadRequestException('classSection not found');
    });
  }
}
