import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { withTenant, type UserRole } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { isP2002, isP2025 } from './internal/prisma-errors';
import { AttendanceService } from './attendance.service';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

/** Never let a missing School row render as `undefined` in a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';

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
   * response is never blocked on notification delivery. It resolves
   * recipients per targeted section — via the same `resolveSectionRecipients`
   * helper `AttendanceService.save`'s ABSENCE_NOTICE fan-out uses — and is
   * scoped to targeted sections only; a whole-school announcement's
   * broadcast reach is intentionally out of scope here (nothing was
   * "targeted" to resolve recipients from).
   */
  async create(
    schoolId: string,
    createdByUserId: string,
    role: UserRole,
    dto: CreateAnnouncementDto,
  ) {
    const requestedIds = [
      ...new Set([...(dto.classSectionId ? [dto.classSectionId] : []), ...(dto.classSectionIds ?? [])]),
    ];

    let targetIds: string[] | null; // null => whole-school
    if (role === 'TEACHER') {
      if (requestedIds.length === 0) {
        throw new ApiError(
          'CLASS_NOT_OWNED',
          'Teachers must target at least one of their own class sections',
          403,
        );
      }
      const mine = await this.attendance.myClassSections(schoolId, createdByUserId, role);
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

    if (targetIds) {
      const targetSectionIds = targetIds;
      runInBackground(
        async () => {
          const { recipients } = await withTenant(schoolId, async (tx) => {
            const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });
            const schoolName = school?.name ?? FALLBACK_SCHOOL_NAME;

            const perClass = await Promise.all(
              targetSectionIds.map(async (id) => {
                const emails = await resolveSectionRecipients(tx, schoolId, id);
                const className = sectionNames.get(id) ?? null;
                return emails.map((email) => ({
                  email,
                  payload: { schoolName, title: dto.title, body: dto.body, className },
                }));
              }),
            );
            return { schoolName, recipients: perClass.flat() };
          });

          if (recipients.length === 0) return;
          await this.notifications.notify('ANNOUNCEMENT', recipients);
        },
        (e) => this.logger.error(`ANNOUNCEMENT notify failed: ${(e as Error).message}`),
      );
    }

    return rows;
  }

  async update(schoolId: string, id: string, dto: UpdateAnnouncementDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
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

  async remove(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
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
