import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import type { TeacherProfile } from '@skoolos/types';
import { PasswordService } from '../auth';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2003, isP2025, p2002Target } from '../../common/errors/prisma-errors';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateTeacherDto, UpdateTeacherDto } from './management.dto';
import type { LoginInviteResult } from './students.service';

export type { TeacherProfile };

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

  /**
   * The caller's own Teacher row for `GET /manage/teachers/me` — no id in
   * the URL, so a TEACHER can only ever read their own profile. A 404 here
   * means the TEACHER-role login has no linked Teacher row (deleted out from
   * under it); RolesGuard already excludes SCHOOL_ADMIN, who wouldn't have
   * one either but for a different, unremarkable reason.
   */
  async me(schoolId: string, userId: string): Promise<TeacherProfile> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({
        where: { userId },
        include: {
          teacherSubjects: { include: { subject: { select: { name: true } } } },
          classSections: { select: { name: true, grade: { select: { name: true, order: true } } } },
        },
      });
      if (!teacher) {
        throw new NotFoundException('No teacher profile found for this login');
      }

      // Resolve photoAssetId → MediaAsset.url, mirroring PortalService.profile()
      // — self-uploaded avatars (POST /me/photo) land as MediaAsset rows.
      let photoUrl: string | null = null;
      if (teacher.photoAssetId) {
        const asset = await tx.mediaAsset.findFirst({
          where: { id: teacher.photoAssetId },
          select: { url: true },
        });
        photoUrl = asset?.url ?? null;
      }

      return {
        id: teacher.id,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        email: teacher.email,
        phone: teacher.phone,
        // Alphabetical, not DB/insertion order — the DTO comment on
        // TeacherProfile.subjects promises that, and a UI listing them
        // shouldn't shuffle every time a teacher is re-fetched.
        subjects: teacher.teacherSubjects.map((ts) => ts.subject.name).sort(),
        // Grade.order, not a string sort on "7-B" — a lexicographic sort would
        // put "10-A" ahead of "7-B" (same reason ClassesService/CatalogService
        // order grades by `order` everywhere else), which reads as wrong for
        // the one thing this list is for: seeing your classes in the order a
        // school actually numbers them.
        classTeacherOf: [...teacher.classSections]
          .sort((a, b) => a.grade.order - b.grade.order || a.name.localeCompare(b.name))
          .map((cs) => `${cs.grade.name}-${cs.name}`),
        photoUrl,
      };
    });
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
   * "Remove from this school" (Phase 5·1) — the clean off-board that FREES a
   * teacher to be onboarded elsewhere. Deactivates rather than deletes (a
   * hard delete fails on references and erases history): Teacher.isActive
   * false + their login disabled and every session revoked. The one-school
   * guard in `createLogin` only blocks on ACTIVE rows, so after this the new
   * school onboards them normally.
   */
  async release(schoolId: string, id: string): Promise<{ released: true }> {
    const userId = await withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { id }, select: { userId: true } });
      if (!teacher) throw new NotFoundException('Teacher not found');
      await tx.teacher.update({ where: { id }, data: { isActive: false } });
      return teacher.userId;
    });

    if (userId) {
      // Login shutdown is cross-cutting auth state — platform client, same
      // revoke-all pattern as a password reset.
      const platform = getPlatformPrisma();
      await platform.$transaction([
        platform.user.update({ where: { id: userId }, data: { isActive: false } }),
        platform.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    }
    return { released: true };
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

      // One school per teacher (Phase 5·1): the same identity (email) must
      // not hold an ACTIVE teaching post with a login at another school.
      // Cross-tenant by nature, so this runs on the platform client — the
      // tenant-scoped `tx` cannot see other schools by design. Released
      // teachers (isActive=false) don't block; neither do rows never linked
      // to a login.
      const platform = getPlatformPrisma();
      const elsewhere = await platform.teacher.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          isActive: true,
          userId: { not: null },
          schoolId: { not: schoolId },
        },
        select: { school: { select: { name: true } } },
      });
      if (elsewhere) {
        throw new ApiError(
          'ALREADY_AT_SCHOOL',
          `This teacher is active at ${elsewhere.school.name} — that school's office must release them before onboarding here`,
          409,
          'email',
        );
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
