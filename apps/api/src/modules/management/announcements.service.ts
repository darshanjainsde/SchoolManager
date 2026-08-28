import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { withTenant, type Announcement, type UserRole } from '@skoolos/db';
import type { AnnouncementMine } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveSchoolRecipients, resolveSectionRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { isP2002, isP2025 } from '../../common/errors/prisma-errors';
import { AttendanceService } from './attendance.service';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

/** Never let a missing School row render as `undefined` in a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';

/** `ArrayMaxSize(30)` on the DTO only bounds each field individually — a
 * caller can still send 30 in `classSectionIds` PLUS a distinct
 * `classSectionId`, netting 31 after the merge below. This is the cap on
 * the MERGED, de-duplicated set, so "at most 30" means what it says
 * regardless of which field(s) a caller used to get there. */
const MAX_TARGET_SECTIONS = 30;

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly attendance: AttendanceService,
  ) {}

  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        include: { classSection: { select: { name: true } } },
      }),
    );
  }

  /**
   * The caller's OWN posted rows, newest first — `GET
   * /manage/announcements/mine` (`TEACHER` only; `SCHOOL_ADMIN` already has
   * the unfiltered `list()` above and has no need of this one).
   *
   * One `AnnouncementMine` per stored row (see the type's doc comment in
   * `@skoolos/types` for why this is NOT grouped by title/body/createdAt
   * into a plural `classSectionIds` shape) — each entry maps 1:1 to the
   * `PATCH`/`DELETE /manage/announcements/:id` the teacher client calls to
   * edit/delete it.
   */
  async mine(schoolId: string, userId: string): Promise<AnnouncementMine[]> {
    const rows = await withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: { schoolId, createdByUserId: userId },
        orderBy: { createdAt: 'desc' },
        include: { classSection: { select: { name: true, grade: { select: { name: true } } } } },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      classSectionId: r.classSectionId,
      className: r.classSection ? `${r.classSection.grade.name}-${r.classSection.name}` : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Creates one `Announcement` row per targeted class section, or a single
   * whole-school row (`classSectionId: null`) when nothing is targeted.
   *
   * `dto.classSectionId` (legacy singular, still posted by the web admin UI)
   * and `dto.classSectionIds` (new, multi-target) are merged — a caller may
   * send either or both.
   *
   * A TEACHER caller may only target sections from their own
   * `AttendanceService.myClassSections(schoolId, userId, role)` list — the
   * SAME ownership query `attendance.service.ts` already uses for the
   * take/view-attendance scope, reused here via constructor injection
   * (both services already live in `ManagementModule`) rather than
   * re-implemented. A TEACHER who targets nothing, or targets a section they
   * do not own, is rejected with a 403 `CLASS_NOT_OWNED` before any write.
   * SCHOOL_ADMIN is exempt from the ownership check and may omit/empty the
   * target list for a whole-school announcement (the pre-existing
   * `classSectionId: null` behavior).
   *
   * Push/email fan-out (`ANNOUNCEMENT`) runs best-effort, in the background
   * (`runInBackground`) after the write transaction commits, so the caller's
   * response is never blocked on notification delivery. For a class-targeted
   * announcement it resolves recipients per targeted section — via the same
   * `resolveSectionRecipients` helper `AttendanceService.save`'s
   * ABSENCE_NOTICE fan-out uses — so each recipient's payload carries THEIR
   * class's name. For a whole-school announcement it resolves EVERY
   * linked-user student in the school via `resolveSchoolRecipients` (the
   * school-wide counterpart, no classSectionId filter) and every recipient
   * gets `className: null`.
   */
  async create(
    schoolId: string,
    createdByUserId: string,
    role: UserRole,
    dto: CreateAnnouncementDto,
  ): Promise<Announcement[]> {
    const requestedIds = [
      ...new Set([...(dto.classSectionId ? [dto.classSectionId] : []), ...(dto.classSectionIds ?? [])]),
    ];
    if (requestedIds.length > MAX_TARGET_SECTIONS) {
      throw new BadRequestException(
        `Cannot target more than ${MAX_TARGET_SECTIONS} class sections in one announcement`,
      );
    }

    let targetIds: string[] | null; // null => whole-school
    if (role === 'TEACHER') {
      if (requestedIds.length === 0) {
        throw new ApiError(
          'CLASS_NOT_OWNED',
          'Teachers must target at least one of their own class sections',
          403,
        );
      }
      // `myClassSections` also includes sections the caller is merely covering
      // as a substitute today (Task 2). Covering one period does not make you
      // one of the class's teachers, so it must not grant the broadcast
      // rights this endpoint hands out — drop those rows before checking
      // ownership. (Attendance/Today legitimately want the covered classes,
      // so `myClassSections` itself is unchanged.)
      const mine = (await this.attendance.myClassSections(schoolId, createdByUserId, role)).filter(
        (c) => !c.covering,
      );
      const owned = new Set(mine.map((c) => c.classSectionId));
      for (const id of requestedIds) {
        if (!owned.has(id)) {
          throw new ApiError('CLASS_NOT_OWNED', 'You can only announce to your own class sections', 403);
        }
      }
      targetIds = requestedIds;
    } else {
      // SCHOOL_ADMIN (the only other role RolesGuard admits to this handler)
      // is not restricted to owned classes.
      targetIds = requestedIds.length > 0 ? requestedIds : null;
    }

    const { rows, sectionNames } = await withTenant(schoolId, async (tx) => {
      const names = new Map<string, string>();
      if (targetIds) {
        const sections = await tx.classSection.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, name: true, grade: { select: { name: true } } },
        });
        if (sections.length !== targetIds.length) {
          throw new BadRequestException('classSectionIds not found');
        }
        for (const s of sections) names.set(s.id, `${s.grade.name}-${s.name}`);
      }

      try {
        const rows = [];
        for (const id of targetIds ?? [null]) {
          rows.push(
            await tx.announcement.create({
              data: { schoolId, title: dto.title, body: dto.body, classSectionId: id, createdByUserId },
            }),
          );
        }
        return { rows, sectionNames: names };
      } catch (e) {
        if (isP2002(e)) throw new ConflictException('Duplicate announcement');
        throw e;
      }
    });

    const targetSectionIds = targetIds; // captured for the closure below (string[] | null)
    runInBackground(
      async () => {
        const { recipients } = await withTenant(schoolId, async (tx) => {
          const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });
          const schoolName = school?.name ?? FALLBACK_SCHOOL_NAME;

          if (targetSectionIds) {
            const perClass = await Promise.all(
              targetSectionIds.map(async (id) => {
                const emails = await resolveSectionRecipients(tx, schoolId, id);
                const className = sectionNames.get(id) ?? null;
                return emails.map((email) => ({
                  email,
                  schoolId,
                  payload: { schoolName, title: dto.title, body: dto.body, className },
                }));
              }),
            );
            return { recipients: perClass.flat() };
          }

          // Whole-school: every linked-user student in the school, not
          // scoped to any section.
          const emails = await resolveSchoolRecipients(tx, schoolId);
          return {
            recipients: emails.map((email) => ({
              email,
              schoolId,
              payload: { schoolName, title: dto.title, body: dto.body, className: null },
            })),
          };
        });

        if (recipients.length === 0) return;
        await this.notifications.notify('ANNOUNCEMENT', recipients);
      },
      (e) => this.logger.error(`ANNOUNCEMENT notify failed: ${(e as Error).message}`),
    );

    return rows;
  }

  /**
   * `caller` is required so a TEACHER's edit can be checked against the row
   * they actually authored — resolved from the STORED row's
   * `createdByUserId` below, never from anything the client sends.
   * `SCHOOL_ADMIN` keeps today's unrestricted access (both to any
   * announcement AND to retargeting `classSectionId`).
   *
   * A TEACHER may edit title/body only — class targets are immutable once
   * posted (v1 decision: retargeting is a delete-and-repost, not an edit,
   * so the ownership/CLASS_NOT_OWNED check `create()` runs never has to be
   * re-run here). A TEACHER supplying `classSectionId` at all — even
   * unchanged — is rejected, since only `SCHOOL_ADMIN` payloads are
   * expected to carry that field.
   */
  async update(
    schoolId: string,
    id: string,
    dto: UpdateAnnouncementDto,
    caller: { userId: string; role: UserRole },
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.announcement.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Announcement not found');

      if (caller.role === 'TEACHER') {
        if (existing.createdByUserId !== caller.userId) {
          throw new ApiError('ANNOUNCEMENT_NOT_OWNED', 'You can only edit your own announcements', 403);
        }
        if (dto.classSectionId !== undefined) {
          throw new ApiError(
            'ANNOUNCEMENT_TARGETS_LOCKED',
            'Class targets cannot be changed after posting — delete and repost instead',
            400,
          );
        }
      }

      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { schoolId, id: dto.classSectionId } });
        if (!cs) throw new BadRequestException('classSectionId not found');
      }
      try {
        return await tx.announcement.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
            ...(dto.classSectionId !== undefined ? { classSectionId: dto.classSectionId } : {}),
          },
        });
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }

  /** Same authorship rule as `update` — resolved from the stored row, never client input. */
  async remove(schoolId: string, id: string, caller: { userId: string; role: UserRole }) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.announcement.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Announcement not found');

      if (caller.role === 'TEACHER' && existing.createdByUserId !== caller.userId) {
        throw new ApiError('ANNOUNCEMENT_NOT_OWNED', 'You can only delete your own announcements', 403);
      }

      try {
        await tx.announcement.delete({ where: { id } });
        return { ok: true };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }
}
