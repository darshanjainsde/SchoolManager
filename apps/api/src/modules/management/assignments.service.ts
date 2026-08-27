import { Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import {
  assertNotificationOutboxKind,
  type Assignment,
  type AssignmentList,
  type AssignmentUploadResponse,
  type NotificationOutboxKind,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { formatDateIST } from '../../common/notifications/format';
import type { AssignmentPostedOutboxPayload } from '../../common/notifications/notification.types';
import { emitNotifications, sectionStudentUserIds } from '../../common/notifications/notification-inbox';
import { StorageService } from '../../common/storage/storage.service';
import { AttendanceService } from './attendance.service';
import type { CreateAssignmentDto } from './management.dto';

export type { Assignment, AssignmentList, AssignmentUploadResponse };

/** Shown when a School/Subject row cannot be read while composing the outbox payload. */
const FALLBACK_SCHOOL_NAME = 'Your school';
const FALLBACK_SUBJECT_NAME = 'General';

/**
 * Vercel serverless functions cap a request body at roughly 4.5MB. This is
 * kept comfortably under that (multipart framing adds a little overhead on
 * top of the raw file). The client (web/mobile) enforces the SAME cap
 * BEFORE ever attempting the upload — a request that would 413 must never
 * leave the device — but this server-side check is the one that actually
 * matters: it is what stops a client-side bug or a bypassed UI from ever
 * reaching `StorageService` with an oversized buffer already in memory.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** Raw `Assignment` row shape as Prisma returns it, with the seen-count include. */
type AssignmentRow = {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  instructions: string;
  dueDate: Date;
  attachments: Prisma.JsonValue;
  createdByTeacherId: string;
  createdAt: Date;
  _count?: { seen: number };
};

/**
 * The deployment region is `bom1` (India) — "today" for the upcoming/past
 * split means the current IST calendar day, matching `PortalService`'s
 * `IST_DAY_FORMATTER` (`en-CA` renders as `YYYY-MM-DD`, which slices cleanly
 * and sorts lexicographically the same as it sorts chronologically).
 */
const IST_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function todayISTKey(): string {
  return IST_DAY_FORMATTER.format(new Date());
}

/** `Assignment.dueDate` (`@db.Date`, stored as UTC midnight) → `YYYY-MM-DD`. Read in UTC, never the server's local zone, since it is a plain calendar date with no time component. */
function dueDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly attendance: AttendanceService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The SAME ownership rule `ExamsService.assertClassOwned` enforces —
   * copied here rather than shared, matching how every management service
   * that needs this (`AnnouncementsService`, `ExamsService`) owns its own
   * copy rather than importing a shared helper. A TEACHER caller may only
   * act on a class section they actually teach, resolved via
   * `AttendanceService.myClassSections` with `covering` sections excluded
   * (a one-day substitute does not post assignments for a class they cover
   * once). SCHOOL_ADMIN is exempt and always passes.
   */
  private async assertClassOwned(
    schoolId: string,
    userId: string,
    role: string,
    classSectionId: string,
    action: string,
  ): Promise<void> {
    if (role !== 'TEACHER') return;
    const mine = (await this.attendance.myClassSections(schoolId, userId, role)).filter(
      (c) => !c.covering,
    );
    const owned = new Set(mine.map((c) => c.classSectionId));
    if (!owned.has(classSectionId)) {
      throw new ApiError(
        'CLASS_NOT_OWNED',
        `You can only ${action} your own classes.`,
        403,
        'classSectionId',
      );
    }
  }

  private static toAssignment(a: AssignmentRow): Assignment {
    return {
      id: a.id,
      classSectionId: a.classSectionId,
      subjectId: a.subjectId,
      title: a.title,
      instructions: a.instructions,
      dueDate: dueDateKey(a.dueDate),
      attachments: (a.attachments ?? []) as unknown as Assignment['attachments'],
      createdByTeacherId: a.createdByTeacherId,
      createdAt: a.createdAt.toISOString(),
      seenCount: a._count?.seen ?? 0,
    };
  }

  /**
   * Validates and stores one attachment via the shared `StorageService`
   * (S3/MinIO — the SAME client `MediaService` uses), under
   * `schools/<id>/assignments/`. Deliberately NOT `MediaService`/
   * `MediaAsset`: that service is scoped to a fixed site-content `kind`
   * taxonomy (LOGO/HERO/GALLERY/…), rejects anything but an image, and
   * (today) carries no `@Roles` guard at all — none of which fits a
   * teacher-facing PDF/image attachment. See `AssignmentsController`'s
   * docstring for the full ACL comparison.
   *
   * Server-side validation never trusts the client: `dto`'s declared
   * mimetype/size are checked again here even though the web/mobile UI also
   * enforces `MAX_ATTACHMENT_BYTES` before ever attempting the request.
   */
  async upload(
    schoolId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
  ): Promise<AssignmentUploadResponse> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(
        'VALIDATION',
        `File too large — max ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB.`,
        400,
        'file',
      );
    }
    const isPdf = file.mimetype === 'application/pdf';
    const isImage = /^image\//.test(file.mimetype);
    if (!isPdf && !isImage) {
      throw new ApiError('VALIDATION', 'Only PDF or image files are allowed.', 400, 'file');
    }

    const { url } = await this.storage.upload(
      `schools/${schoolId}/assignments`,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    return { url, name: file.originalname, kind: isPdf ? 'pdf' : 'image' };
  }

  /**
   * Creates an Assignment for a class section, after confirming the
   * section actually belongs to this school. A TEACHER caller may only
   * target a class section they own (see `assertClassOwned`).
   *
   * Writes one `NotificationOutbox` row (`kind: 'ASSIGNMENT_POSTED'`) IN THE
   * SAME transaction as the `Assignment` row — mirrors
   * `ExamsService.create()` exactly: if anything past this point throws,
   * Prisma rolls the whole transaction back and the outbox row is never
   * written either, so a posted assignment is never visible without its
   * notification row existing (see assignments.service.spec.ts's rollback
   * test). There is no separate best-effort real-time email for this event
   * (unlike exams/results) — push is delivered EXCLUSIVELY through the
   * outbox drain, on the cadence `NotificationOutboxService` already runs.
   */
  async create(
    schoolId: string,
    callerUserId: string,
    role: string,
    dto: CreateAssignmentDto,
  ): Promise<Assignment> {
    await this.assertClassOwned(schoolId, callerUserId, role, dto.classSectionId, 'post an assignment for');

    const assignment = await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { schoolId, id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const created = await tx.assignment.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          subjectId: dto.subjectId,
          title: dto.title,
          instructions: dto.instructions,
          dueDate: new Date(dto.dueDate),
          attachments: (dto.attachments ?? []) as unknown as Prisma.InputJsonValue,
          createdByTeacherId: callerUserId,
        },
      });

      // Transactional outbox (S6/S7 wiring — see ExamsService.create()'s
      // matching comment). Every field is resolved to a display string HERE,
      // not at drain time, so NotificationOutboxService never joins back to
      // Subject/ClassSection to render a push.
      const [school, subject] = await Promise.all([
        tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        tx.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { name: true } }),
      ]);
      const kind: NotificationOutboxKind = 'ASSIGNMENT_POSTED';
      assertNotificationOutboxKind(kind);
      const outboxPayload: AssignmentPostedOutboxPayload = {
        schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
        subjectName: subject?.name ?? FALLBACK_SUBJECT_NAME,
        assignmentTitle: created.title,
        dueDate: formatDateIST(new Date(created.dueDate)),
        classSectionName: section.name,
      };
      await tx.notificationOutbox.create({
        data: {
          schoolId,
          kind,
          classSectionId: dto.classSectionId,
          payload: outboxPayload as unknown as Prisma.InputJsonValue,
        },
      });

      // In-app inbox rows (the bell) for every student in the section who has a
      // login — same transaction as the assignment + outbox row above.
      const assignmentRecipients = await sectionStudentUserIds(tx, schoolId, dto.classSectionId);
      await emitNotifications(tx, {
        schoolId,
        userIds: assignmentRecipients,
        kind: 'ASSIGNMENT',
        title: created.title,
        body: `${subject?.name ?? FALLBACK_SUBJECT_NAME} — due ${formatDateIST(new Date(created.dueDate))}`,
        linkType: 'assignment',
        linkId: created.id,
      });

      return created;
    });

    // A brand-new assignment has no AssignmentSeen rows yet — seenCount is
    // always 0 at creation, never worth a query.
    return AssignmentsService.toAssignment({ ...assignment, _count: { seen: 0 } });
  }

  /**
   * Every Assignment for a class section, split into `upcoming` (due today
   * or later) and `past`, each ordered by dueDate ascending. Today counts as
   * upcoming — a same-day due date has not passed yet.
   *
   * A TEACHER caller may only list assignments for a class section they own
   * (see `assertClassOwned`). Each row's `seenCount` is the count of its
   * `AssignmentSeen` rows (`_count`), included in the SAME query — never a
   * second round trip.
   */
  async list(
    schoolId: string,
    classSectionId: string,
    callerUserId: string,
    role: string,
  ): Promise<AssignmentList> {
    await this.assertClassOwned(schoolId, callerUserId, role, classSectionId, 'view assignments for');

    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { schoolId, id: classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const rows = await tx.assignment.findMany({
        where: { schoolId, classSectionId },
        include: { _count: { select: { seen: true } } },
        orderBy: [{ dueDate: 'asc' }],
      });

      const today = todayISTKey();
      const upcoming: Assignment[] = [];
      const past: Assignment[] = [];
      for (const row of rows) {
        if (dueDateKey(row.dueDate) >= today) {
          upcoming.push(AssignmentsService.toAssignment(row));
        } else {
          past.push(AssignmentsService.toAssignment(row));
        }
      }

      return { upcoming, past };
    });
  }

  /**
   * Deletes an Assignment. Ownership is resolved from the STORED row's
   * `classSectionId` — never a caller-supplied one — through the SAME
   * `assertClassOwned` check `create()`/`list()` use, not a separate
   * creator-based rule: `createdByTeacherId` is attribution only (mirrors
   * `Exam.createdById`), never the authorization gate. Any teacher who owns
   * the class section may delete an assignment posted to it, matching how
   * every other class-owned resource in this codebase works.
   */
  async remove(schoolId: string, id: string, callerUserId: string, role: string): Promise<{ ok: true }> {
    const owning = await withTenant(schoolId, (tx) =>
      tx.assignment.findFirst({ where: { id, schoolId }, select: { classSectionId: true } }),
    );
    if (!owning) {
      throw new ApiError('NOT_FOUND', 'assignment not found', 404, 'id');
    }
    await this.assertClassOwned(schoolId, callerUserId, role, owning.classSectionId, 'delete assignments for');

    await withTenant(schoolId, (tx) => tx.assignment.delete({ where: { id } }));
    return { ok: true };
  }
}
