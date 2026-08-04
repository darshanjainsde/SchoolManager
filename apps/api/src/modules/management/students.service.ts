import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
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

/** RAF-00042 — 3 letters + a zero-padded counter (5 digits, growing past 99999). */
export const STUDENT_CODE_REGEX = /^[A-Za-z]{3}-\d{5,}$/;

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
      return await withTenant(schoolId, async (tx) => {
        // A CODE IS PART OF BEING A STUDENT, not part of being invited.
        //
        // It used to be minted only by `createLogin`/`resendInvite`, so every
        // student added through the roster carried `code = null` until somebody
        // happened to invite them. On production that meant 300 of 300 students
        // had no code, and the student-code login the school had been told
        // about simply did not work for any of them — with nothing on screen
        // to explain why.
        //
        // Allocating here also makes the code printable the moment a child is
        // enrolled, which is when the office actually wants it: it goes on the
        // welcome letter, not on an invite email that may never be sent.
        const code = await this.allocateCode(tx, schoolId);
        return tx.student.create({
          data: {
            ...rest,
            schoolId,
            code,
            dob: dob ? new Date(dob) : undefined,
          },
        });
      });
    } catch (e) {
      if (isP2002(e)) {
        // Two unique indexes can land here. `allocateCode` reads the current
        // max and adds one, so two concurrent enrolments can pick the same
        // code; that is a retryable clash and must not be reported as a
        // duplicate admission number, which is a mistake the user must fix.
        if (p2002Target(e).includes('code')) {
          throw new ConflictException('That student code was just taken — please try again');
        }
        throw new ConflictException('A student with that admission number already exists');
      }
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

    const { userId, code } = await withTenant(schoolId, async (tx) => {
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

      // Allocate the human-friendly code alongside the login (Phase 5·1) —
      // it becomes the login identifier and the add-a-child key, printed in
      // the welcome email. Idempotent for students that somehow already have
      // one.
      const code = student.code ?? (await this.allocateCode(tx, schoolId));
      await tx.student.update({ where: { id: studentId }, data: { userId: user.id, email, code } });
      return { userId: user.id, code };
    });

    const emailSent = await this.invites.sendInvite(userId, code);
    return { email, username, loginName: code, invited: true, emailSent };
  }

  /**
   * Next `{PREFIX}-NNNNN` for the school. The prefix is derived from the
   * school's name on first use (first three A–Z letters, padded with X) and
   * persisted on `School.codePrefix` so codes stay stable if the school is
   * renamed. Concurrency: the partial unique index on (schoolId, code) makes
   * a racing duplicate fail the caller's insert with P2002 rather than ever
   * storing two students under one code. Lexicographic max works while codes
   * share a width; widths only grow (padStart never truncates), and a new
   * width only starts past 99,999 students per school.
   */
  private async allocateCode(tx: TenantTx, schoolId: string): Promise<string> {
    const school = await tx.school.findUnique({
      where: { id: schoolId },
      select: { name: true, codePrefix: true },
    });
    let prefix = school?.codePrefix ?? null;
    if (!prefix) {
      const letters = (school?.name ?? '').toUpperCase().replace(/[^A-Z]/g, '');
      prefix = `${letters}XXX`.slice(0, 3);
      await tx.school.update({ where: { id: schoolId }, data: { codePrefix: prefix } });
    }
    const last = await tx.student.findFirst({
      where: { schoolId, code: { startsWith: `${prefix}-` } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const next = last?.code ? parseInt(last.code.split('-')[1], 10) + 1 : 1;
    return `${prefix}-${String(next).padStart(5, '0')}`;
  }

  /**
   * Re-sends the welcome invite for a student who already has a login (e.g.
   * the first email bounced, or the 30-minute link expired). Mints a fresh
   * token every time — old ones are simply left to expire/never get burned.
   */
  async resendInvite(schoolId: string, studentId: string): Promise<LoginInviteResult> {
    const { userId, email, username, code } = await withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId } });
      if (!student) throw new NotFoundException('Student not found');
      if (!student.userId) throw new NotFoundException('Student has no login to resend an invite for');

      const user = await tx.user.findUnique({ where: { id: student.userId } });
      if (!user) throw new NotFoundException('Student has no login to resend an invite for');

      // Backfill for logins created before Phase 5·1 — resending the invite
      // is exactly when the student needs a code in hand.
      const code = student.code ?? (await this.allocateCode(tx, schoolId));
      if (!student.code) {
        await tx.student.update({ where: { id: studentId }, data: { code } });
      }
      return { userId: student.userId, email: user.email, username: user.username, code };
    });

    const emailSent = await this.invites.sendInvite(userId, code);
    return { email, username, loginName: code, invited: true, emailSent };
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
