import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import type { TeacherProfile } from '@skoolos/types';
import { PasswordService } from '../auth';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2003, isP2025, p2002Target } from '../../common/errors/prisma-errors';
import { LoginInviteService } from './internal/login-invite.service';
import { closeLoginIn, reopenLoginIn } from './internal/close-login';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { AuditService } from '../../common/audit/audit.service';
import type { CreateLoginDto, CreateTeacherDto, ReleaseTeacherDto, UpdateTeacherDto } from './management.dto';
import type { LoginInviteResult } from './students.service';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

/** What a teacher still holds at the school — the handover sheet reads this. */
export interface ReleaseImpact {
  classTeacherOf: { id: string; label: string }[];
  timetableSlots: number;
  pendingLeave: number;
  featuredOnWebsite: boolean;
  libraryIssuesOut: number;
  openThreads: number;
}

export type { TeacherProfile };

@Injectable()
export class TeachersService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly invites: LoginInviteService,
    private readonly audit: AuditService,
  ) {}

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      // An explicit select, not a bare findMany: `include: { school: false }`
      // still ships every column of Teacher, and this row carries staff email,
      // phone and the userId that links to their login. The route is
      // SCHOOL_ADMIN-only now, but the payload should be a deliberate list
      // rather than whatever the model happens to grow next.
      tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true, schoolId: true, userId: true,
          firstName: true, lastName: true,
          email: true, phone: true,
          photoAssetId: true, primarySubjectId: true,
          bio: true, isActive: true, status: true, leftOn: true,
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
        where: { schoolId, userId },
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
          where: { schoolId, id: teacher.photoAssetId },
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
   * What a teacher still holds — shown before the office confirms "Remove
   * from this school", so every seat and period is handed over on purpose.
   */
  async releaseImpact(schoolId: string, id: string): Promise<ReleaseImpact> {
    return withTenant(schoolId, async (tx) => {
      const t = await tx.teacher.findFirst({ where: { schoolId, id }, select: { id: true } });
      if (!t) throw new NotFoundException('Teacher not found');
      const [sections, slots, leave, featured, issues, threads] = await Promise.all([
        tx.classSection.findMany({
          take: LIST_CEILING.STRUCTURE,
          where: { schoolId, classTeacherId: id },
          select: { id: true, name: true, grade: { select: { name: true } } },
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        }),
        tx.timetableSlot.count({ where: { schoolId, teacherId: id, effectiveTo: null } }),
        tx.leaveApplication.count({ where: { schoolId, teacherId: id, status: 'PENDING' } }),
        tx.featuredStaff.count({ where: { schoolId, teacherId: id } }),
        tx.libraryIssue.count({ where: { schoolId, teacherId: id, returnedOn: null } }),
        tx.messageThread.count({ where: { schoolId, teacherId: id } }),
      ]);
      return {
        classTeacherOf: sections.map((s) => ({ id: s.id, label: `${s.grade.name} ${s.name}` })),
        timetableSlots: slots,
        pendingLeave: leave,
        featuredOnWebsite: featured > 0,
        libraryIssuesOut: issues,
        openThreads: threads,
      };
    });
  }

  /**
   * "Remove from this school" (Phase 5·1, handover added in Track A) — the
   * clean off-board that FREES a teacher to be onboarded elsewhere.
   * Deactivates rather than deletes (a hard delete fails on references and
   * erases history): hands over what they held, marks the row LEFT with its
   * `isActive` mirror, then closes the login and revokes every session. The
   * one-school guard in `createLogin` only blocks on ACTIVE rows, so after
   * this the new school onboards them normally.
   */
  async release(schoolId: string, actorUserId: string, id: string, dto: ReleaseTeacherDto): Promise<{ released: true }> {
    const leftOn = new Date(dto.leftOn);
    const h = dto.handover ?? {};
    // Handover ids are client-supplied: real UUIDs, never the leaving teacher.
    for (const [sectionId, to] of Object.entries(h.classSections ?? {})) {
      if (!UUID_RE.test(sectionId) || (to !== null && (typeof to !== 'string' || !UUID_RE.test(to)))) {
        throw new ApiError('VALIDATION', 'Handover must map class ids to teacher ids', 400, 'handover.classSections');
      }
      if (to === id) throw new ApiError('VALIDATION', 'A class cannot be handed to the teacher who is leaving', 400, 'handover.classSections');
    }
    if (h.timetableTeacherId === id) {
      throw new ApiError('VALIDATION', 'Periods cannot be handed to the teacher who is leaving', 400, 'handover.timetableTeacherId');
    }

    try {
      await withTenant(schoolId, async (tx) => {
        const teacher = await tx.teacher.findFirst({ where: { schoolId, id }, select: { userId: true, status: true } });
        if (!teacher) throw new NotFoundException('Teacher not found');
        if (teacher.status !== 'ACTIVE') throw new ApiError('NOT_ACTIVE', 'This teacher is not active', 409, 'status');

        // Class-teacher seats: named replacements first (each checked against
        // the school — FK checks bypass RLS), then everything else is emptied.
        for (const [sectionId, to] of Object.entries(h.classSections ?? {})) {
          if (to) {
            const ok = await tx.teacher.findFirst({ where: { schoolId, id: to, status: 'ACTIVE' }, select: { id: true } });
            if (!ok) throw new ApiError('VALIDATION', 'Replacement class teacher not found', 400, 'handover.classSections');
          }
          await tx.classSection.updateMany({ where: { schoolId, id: sectionId, classTeacherId: id }, data: { classTeacherId: to } });
        }
        await tx.classSection.updateMany({ where: { schoolId, classTeacherId: id }, data: { classTeacherId: null } });

        // Open timetable periods: handed to one teacher, or ended on the leaving
        // date so the timetable shows them as unassigned.
        if (h.timetableTeacherId) {
          const to = h.timetableTeacherId;
          const ok = await tx.teacher.findFirst({ where: { schoolId, id: to, status: 'ACTIVE' }, select: { id: true, firstName: true, lastName: true } });
          if (!ok) throw new ApiError('VALIDATION', 'Timetable teacher not found', 400, 'handover.timetableTeacherId');
          // `teacher_slot` is unique on (teacher, day, period, year, effectiveFrom):
          // a replacement who already teaches at one of these times cannot take
          // them. Say so, with a count, instead of letting the unique index 500.
          const [mine, theirs] = await Promise.all([
            tx.timetableSlot.findMany({
              take: LIST_CEILING.STRUCTURE,
              where: { schoolId, teacherId: id, effectiveTo: null },
              select: { dayOfWeek: true, periodId: true, academicYearId: true, effectiveFrom: true },
            }),
            tx.timetableSlot.findMany({
              take: LIST_CEILING.STRUCTURE,
              where: { schoolId, teacherId: to, effectiveTo: null },
              select: { dayOfWeek: true, periodId: true, academicYearId: true, effectiveFrom: true },
            }),
          ]);
          const slotKey = (s: { dayOfWeek: number; periodId: string; academicYearId: string; effectiveFrom: Date }) =>
            `${s.dayOfWeek}|${s.periodId}|${s.academicYearId}|${s.effectiveFrom.toISOString()}`;
          const taken = new Set(theirs.map(slotKey));
          const clashes = mine.filter((s) => taken.has(slotKey(s))).length;
          if (clashes > 0) {
            throw new ApiError(
              'TEACHER_CONFLICT',
              `${ok.firstName} ${ok.lastName} already teaches at the same time as ${clashes} of these ${clashes === 1 ? 'period' : 'periods'} — hand them to someone else, or mark them as unassigned`,
              409,
              'handover.timetableTeacherId',
            );
          }
          await tx.timetableSlot.updateMany({ where: { schoolId, teacherId: id, effectiveTo: null }, data: { teacherId: to } });
        } else {
          await tx.timetableSlot.updateMany({ where: { schoolId, teacherId: id, effectiveTo: null }, data: { effectiveTo: leftOn } });
        }

        await tx.leaveApplication.updateMany({
          where: { schoolId, teacherId: id, status: 'PENDING' },
          data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: actorUserId },
        });

        // The public Educators band never shows a teacher who has LEFT. "Keep
        // them on the website" turns the card into an ordinary manual one —
        // name and photo are already on the FeaturedStaff row — by unlinking it.
        if (h.keepFeatured) {
          await tx.featuredStaff.updateMany({ where: { schoolId, teacherId: id }, data: { teacherId: null } });
        } else {
          await tx.featuredStaff.deleteMany({ where: { schoolId, teacherId: id } });
        }

        await tx.teacher.update({
          where: { id },
          data: {
            status: 'LEFT',
            isActive: false,
            leftOn,
            leftReason: dto.reason?.trim() || null,
            leftNote: dto.note?.trim() || null,
            statusChangedAt: new Date(),
            statusChangedById: actorUserId,
          },
        });
        // Same transaction as the row: the login closes with it, or neither happens.
        if (teacher.userId) await closeLoginIn(tx, schoolId, teacher.userId);
      });
    } catch (e) {
      if (isP2002(e)) {
        throw new ApiError('TEACHER_CONFLICT', 'That teacher already teaches at one of these times — hand the periods to someone else, or mark them as unassigned', 409, 'handover.timetableTeacherId');
      }
      throw e;
    }

    await this.audit.record({
      schoolId,
      actorUserId,
      action: 'teacher.release',
      entity: 'Teacher',
      entityId: id,
      meta: { leftOn: dto.leftOn, reason: dto.reason ?? null },
    });
    return { released: true };
  }

  /**
   * One school per teacher (Phase 5·1): the same identity (email) must not
   * hold an ACTIVE teaching post with a login at another school. Cross-tenant
   * by nature, so this runs on the platform client — the tenant-scoped `tx`
   * cannot see other schools by design. Released teachers (isActive=false)
   * don't block; neither do rows never linked to a login.
   */
  private async assertNotActiveElsewhere(schoolId: string, email: string): Promise<void> {
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
  }

  /** Back on the roll — the same row, the same login reopened, in one transaction. */
  async reactivate(schoolId: string, actorUserId: string, id: string): Promise<{ id: string; status: 'ACTIVE' }> {
    const t = await withTenant(schoolId, (tx) =>
      tx.teacher.findFirst({ where: { schoolId, id }, select: { userId: true, status: true, email: true } }),
    );
    if (!t) throw new NotFoundException('Teacher not found');
    if (t.status === 'ACTIVE') throw new ApiError('ALREADY_ACTIVE', 'This teacher is already active', 409, 'status');
    // Released here, onboarded elsewhere since: the other school holds them now.
    if (t.email) await this.assertNotActiveElsewhere(schoolId, t.email.toLowerCase());

    await withTenant(schoolId, async (tx) => {
      await tx.teacher.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          isActive: true,
          leftOn: null,
          leftReason: null,
          leftNote: null,
          statusChangedAt: new Date(),
          statusChangedById: actorUserId,
        },
      });
      if (t.userId) await reopenLoginIn(tx, schoolId, t.userId);
    });
    await this.audit.record({ schoolId, actorUserId, action: 'teacher.reactivate', entity: 'Teacher', entityId: id, meta: null });
    return { id, status: 'ACTIVE' };
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
      const teacher = await tx.teacher.findFirst({ where: { schoolId, id: teacherId } });
      if (!teacher) throw new NotFoundException('Teacher not found');
      if (teacher.userId) throw new ConflictException('Teacher already has a login');

      const email = (dto.email?.trim() || teacher.email?.trim() || '').toLowerCase();
      if (!email) {
        throw new ApiError('EMAIL_REQUIRED', 'An email address is required to send the invite', 400, 'email');
      }

      // Same identity, same school, marked as left: that row is the person.
      // Reactivating it keeps their history; a second row would not.
      const hereInactive = await tx.teacher.findFirst({
        where: { schoolId, email: { equals: email, mode: 'insensitive' }, status: 'LEFT', id: { not: teacherId } },
        select: { firstName: true, lastName: true },
      });
      if (hereInactive) {
        throw new ApiError(
          'ALREADY_HERE_INACTIVE',
          `${hereInactive.firstName} ${hereInactive.lastName} already has a record at this school that was marked as left — reactivate it instead of adding a duplicate`,
          409,
          'email',
        );
      }

      // One school per teacher (Phase 5·1) — see assertNotActiveElsewhere.
      await this.assertNotActiveElsewhere(schoolId, email);

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
      const teacher = await tx.teacher.findFirst({ where: { schoolId, id: teacherId } });
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
