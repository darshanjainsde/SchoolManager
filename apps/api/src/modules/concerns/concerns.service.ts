import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  CONCERN_REOPEN_DAYS,
  type ConcernAudience,
  type ConcernAuthorRole,
  type ConcernCounts,
  type ConcernDetail,
  type ConcernRow,
  type ConcernStatus,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { commentCountsByConcern } from '../../common/lists/relation-counts';
import { resolveAdminRecipients } from '../../common/notifications/recipients';

/** Who is asking, and therefore what they may see and do. */
export type Viewer =
  | { kind: 'FAMILY'; userId: string }
  | { kind: 'TEACHER'; userId: string }
  | { kind: 'ADMIN'; userId: string };

const PREVIEW = 4_000;

/**
 * THE COMPLAINT BOX — one place a family raises something and watches it get
 * read, answered and resolved.
 *
 * Three rules hold the whole thing up, and all three are enforced HERE rather
 * than in any screen:
 *
 *  1. THE FAMILY CHOOSES WHO SEES IT. `audience` is OFFICE or CLASS_TEACHER,
 *     and a teacher's read is `assignedTeacherId = me AND audience =
 *     CLASS_TEACHER` — expressed in the query, so no filter in a UI can leak
 *     one child's concern to another child's teacher.
 *  2. THE ROUTE IS SNAPSHOTTED. The class teacher is resolved once, when the
 *     concern is written, into `assignedTeacherId`. Reassigning a section in
 *     March must not silently move February's concerns to a new person, nor
 *     strand them when a section has nobody.
 *  3. A PRIVATE NOTE IS NEVER SENT TO THE FAMILY. `visibleToFamily` is read
 *     on the way OUT of the database for a family viewer, not filtered in the
 *     client, and the notification for a reply is only enqueued for a comment
 *     the family can actually read.
 *
 * Escalation is one way on purpose: a class teacher may send a concern to the
 * office, and then BOTH can see it. The office cannot hand it back — a family
 * that wrote to the office should not discover a teacher reading it.
 */
@Injectable()
export class ConcernsService {

  // ── reading ────────────────────────────────────────────────────────────

  /** The list for whoever is asking. `status`/`category` narrow it; unread is per-reader. */
  async list(
    schoolId: string,
    viewer: Viewer,
    filter: { status?: string; category?: string; unreadOnly?: boolean } = {},
  ): Promise<ConcernRow[]> {
    return withTenant(schoolId, async (tx) => {
      const where = await this.scope(tx, schoolId, viewer);
      if (filter.status && filter.status !== 'ALL') where.status = filter.status;
      if (filter.category) where.category = filter.category;
      if (filter.unreadOnly) {
        if (viewer.kind === 'ADMIN') where.readByOfficeAt = null;
        else if (viewer.kind === 'TEACHER') where.readByTeacherAt = null;
      }
      // The tallies come from a tenant-scoped groupBy, never Prisma's relation
      // `_count`: that one aggregates every comment on the platform to draw
      // one school's box (see common/lists/relation-counts.ts).
      const [rows, comments] = await Promise.all([
        tx.concern.findMany({
          where,
          take: LIST_CEILING.ACTIVITY,
          orderBy: [{ lastActivityAt: 'desc' }],
          include: this.rowInclude(),
        }),
        commentCountsByConcern(tx, schoolId),
      ]);
      return rows.map((r) => this.toRow(r, viewer, comments.get(r.id) ?? 0));
    });
  }

  /** The numbers on the admin's Complaint Box, and the teacher's own slice of them. */
  async counts(schoolId: string, viewer: Viewer): Promise<ConcernCounts> {
    return withTenant(schoolId, async (tx) => {
      const base = await this.scope(tx, schoolId, viewer);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const unreadWhere = { ...base, ...(viewer.kind === 'TEACHER' ? { readByTeacherAt: null } : { readByOfficeAt: null }) };
      const [unread, open, withTeachers, resolved] = await Promise.all([
        tx.concern.count({ where: unreadWhere }),
        tx.concern.count({ where: { ...base, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        tx.concern.count({ where: { ...base, audience: 'CLASS_TEACHER', status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        tx.concern.findMany({
          where: { ...base, status: 'RESOLVED', resolvedAt: { gte: monthStart } },
          take: LIST_CEILING.ACTIVITY,
          select: { createdAt: true, resolvedAt: true },
        }),
      ]);

      // The median, not the mean: one concern that sat for six weeks should
      // not make a school that answers in a day look like it takes a week.
      const days = resolved
        .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 86_400_000)
        .sort((a, b) => a - b);
      const median = days.length
        ? Math.round((days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) * 10) / 10
        : null;

      const byCategory = await tx.concern.groupBy({
        by: ['category'],
        where: { ...base, createdAt: { gte: monthStart } },
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } },
        take: 1,
      });

      return {
        unread, open, withClassTeachers: withTeachers,
        resolvedThisMonth: resolved.length,
        medianDaysToResolve: median,
        topCategory: (byCategory[0]?.category as ConcernCounts['topCategory']) ?? null,
      };
    });
  }

  /** One concern with its timeline. Opening it marks it read for THIS reader. */
  async detail(schoolId: string, viewer: Viewer, id: string): Promise<ConcernDetail> {
    return withTenant(schoolId, async (tx) => {
      const where = await this.scope(tx, schoolId, viewer);
      const row = await tx.concern.findFirst({
        where: { ...where, id },
        include: { ...this.rowInclude(), comments: { orderBy: { createdAt: 'asc' }, take: LIST_CEILING.ACTIVITY, include: { author: { select: { name: true, email: true } } } } },
      });
      if (!row) throw new ApiError('NOT_FOUND', 'That is not in your Complaint Box.', 404, 'id');

      // Reading it is what marks it read — not a separate button nobody presses.
      if (viewer.kind === 'ADMIN' && !row.readByOfficeAt) {
        await tx.concern.update({ where: { id }, data: { readByOfficeAt: new Date() } });
      } else if (viewer.kind === 'TEACHER' && !row.readByTeacherAt) {
        await tx.concern.update({ where: { id }, data: { readByTeacherAt: new Date() } });
      }

      const comments = row.comments
        .filter((c) => (viewer.kind === 'FAMILY' ? c.visibleToFamily : true))
        .map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          visibleToFamily: c.visibleToFamily,
          statusFrom: (c.statusFrom as ConcernStatus | null) ?? null,
          statusTo: (c.statusTo as ConcernStatus | null) ?? null,
          author: { name: c.author.name ?? c.author.email, role: c.authorRole as ConcernAuthorRole },
        }));

      return {
        ...this.toRow(row, viewer, row.comments.length),
        body: row.body,
        attachments: row.attachmentIds.map((aid) => ({ id: aid, url: '' })),
        comments,
        canReopen: viewer.kind === 'FAMILY' && this.reopenable(row.status, row.resolvedAt, row.reopenedAt),
      };
    });
  }

  // ── writing ────────────────────────────────────────────────────────────

  /**
   * A family raises something. The student must be theirs, and the class
   * teacher is snapshotted now — including the case where the section has
   * nobody, which falls to the office rather than into a hole.
   */
  async raise(
    schoolId: string,
    userId: string,
    input: { studentId?: string; audience: ConcernAudience; category: string; title: string; body: string; attachmentIds?: string[] },
  ): Promise<ConcernRow> {
    const { id } = await withTenant(schoolId, async (tx) => {
      const me = await tx.user.findFirst({ where: { id: userId, schoolId }, select: { id: true, role: true, name: true, email: true } });
      if (!me) throw new ApiError('NOT_FOUND', 'Sign in again to raise a concern.', 404);

      // The shared family login is a STUDENT user with one Student row; when a
      // school later gives parents their own logins this is where the child
      // list widens, and the id below is already checked against it.
      const student = input.studentId
        ? await tx.student.findFirst({ where: { id: input.studentId, schoolId, userId }, select: { id: true, classSectionId: true } })
        : await tx.student.findFirst({ where: { schoolId, userId }, select: { id: true, classSectionId: true } });
      if (!student) throw new ApiError('NOT_FOUND', 'That child is not on your login.', 404, 'studentId');

      let assignedTeacherId: string | null = null;
      let audience: ConcernAudience = input.audience;
      if (audience === 'CLASS_TEACHER') {
        const section = student.classSectionId
          ? await tx.classSection.findFirst({ where: { id: student.classSectionId, schoolId }, select: { classTeacherId: true, classTeacher: { select: { id: true, status: true } } } })
          : null;
        if (section?.classTeacher && section.classTeacher.status === 'ACTIVE') {
          assignedTeacherId = section.classTeacher.id;
        } else {
          // No class teacher (or they have left): the office takes it. A
          // concern must never be addressed to nobody.
          audience = 'OFFICE';
        }
      }

      const created = await tx.concern.create({
        data: {
          schoolId,
          studentId: student.id,
          raisedById: userId,
          raisedByRole: me.role === 'STUDENT' ? 'STUDENT' : 'PARENT',
          audience,
          assignedTeacherId,
          category: input.category,
          title: input.title.trim().slice(0, 160),
          body: input.body.trim().slice(0, PREVIEW),
          attachmentIds: (input.attachmentIds ?? []).slice(0, 5),
        },
        select: { id: true, audience: true, assignedTeacherId: true, title: true },
      });
      return created;
    });

    await this.notifyRaised(schoolId, id);
    // The family's OWN view of what they just wrote — the same shape their
    // list will show, with the school's side of it (nothing yet) already
    // filtered the way a family sees it.
    return this.detail(schoolId, { kind: 'FAMILY', userId }, id);
  }

  /** A reply the family sees, or a note only the school does. */
  async comment(
    schoolId: string,
    viewer: Viewer,
    id: string,
    input: { body: string; visibleToFamily?: boolean },
  ): Promise<ConcernDetail> {
    const role: ConcernAuthorRole = viewer.kind === 'ADMIN' ? 'ADMIN' : viewer.kind === 'TEACHER' ? 'TEACHER' : 'PARENT';
    // A family's own message is always visible to it; only the school may
    // write a note the family cannot see.
    const visible = viewer.kind === 'FAMILY' ? true : input.visibleToFamily !== false;

    await withTenant(schoolId, async (tx) => {
      const where = await this.scope(tx, schoolId, viewer);
      const concern = await tx.concern.findFirst({ where: { ...where, id }, select: { id: true } });
      if (!concern) throw new ApiError('NOT_FOUND', 'That is not in your Complaint Box.', 404, 'id');
      await tx.concernComment.create({
        data: { schoolId, concernId: id, authorId: viewer.userId, authorRole: role, body: input.body.trim().slice(0, PREVIEW), visibleToFamily: visible },
      });
      await tx.concern.update({
        where: { id },
        data: {
          lastActivityAt: new Date(),
          // The other side has something new to read.
          ...(viewer.kind === 'FAMILY' ? { readByOfficeAt: null, readByTeacherAt: null } : {}),
        },
      });
    });

    if (visible && viewer.kind !== 'FAMILY') await this.notifyFamily(schoolId, id, 'CONCERN_REPLIED');
    return this.detail(schoolId, viewer, id);
  }

  /** Move it along: Open → Looking into it → Resolved, with the move on the timeline. */
  async setStatus(schoolId: string, viewer: Viewer, id: string, status: ConcernStatus, note?: string): Promise<ConcernDetail> {
    if (viewer.kind === 'FAMILY') throw new ApiError('CONCERN_NOT_YOUR_MOVE', 'Only the school can change this.', 403, 'status');
    await withTenant(schoolId, async (tx) => {
      const where = await this.scope(tx, schoolId, viewer);
      const concern = await tx.concern.findFirst({ where: { ...where, id }, select: { id: true, status: true } });
      if (!concern) throw new ApiError('NOT_FOUND', 'That is not in your Complaint Box.', 404, 'id');
      if (concern.status === status) return;
      const now = new Date();
      await tx.concernComment.create({
        data: {
          schoolId, concernId: id, authorId: viewer.userId,
          authorRole: viewer.kind === 'ADMIN' ? 'ADMIN' : 'TEACHER',
          body: (note ?? '').trim().slice(0, PREVIEW),
          visibleToFamily: true,
          statusFrom: concern.status, statusTo: status,
        },
      });
      await tx.concern.update({
        where: { id },
        data: {
          status,
          lastActivityAt: now,
          resolvedAt: status === 'RESOLVED' ? now : null,
          resolvedById: status === 'RESOLVED' ? viewer.userId : null,
        },
      });
    });
    await this.notifyFamily(schoolId, id, status === 'RESOLVED' ? 'CONCERN_RESOLVED' : 'CONCERN_REPLIED');
    return this.detail(schoolId, viewer, id);
  }

  /**
   * A class teacher sends it up to the office. One way: after this both can
   * see it, and the office cannot push it back to the teacher.
   */
  async escalate(schoolId: string, viewer: Viewer, id: string): Promise<ConcernDetail> {
    if (viewer.kind !== 'TEACHER') throw new ApiError('CONCERN_NOT_YOUR_MOVE', 'Only the class teacher can send this to the office.', 403, 'id');
    await withTenant(schoolId, async (tx) => {
      const where = await this.scope(tx, schoolId, viewer);
      const concern = await tx.concern.findFirst({ where: { ...where, id }, select: { id: true, escalatedAt: true } });
      if (!concern) throw new ApiError('NOT_FOUND', 'That is not in your Complaint Box.', 404, 'id');
      if (concern.escalatedAt) return;
      const now = new Date();
      await tx.concernComment.create({
        data: { schoolId, concernId: id, authorId: viewer.userId, authorRole: 'TEACHER', body: 'Sent to the school office.', visibleToFamily: true },
      });
      // `escalatedAt` is what widens the office's scope; the audience stays
      // CLASS_TEACHER so the teacher keeps it too.
      await tx.concern.update({ where: { id }, data: { escalatedAt: now, lastActivityAt: now, readByOfficeAt: null } });
    });
    await this.notifyRaised(schoolId, id, true);
    return this.detail(schoolId, viewer, id);
  }

  /** The family reopens a resolved concern — once, inside the window. */
  async reopen(schoolId: string, userId: string, id: string, body: string): Promise<ConcernDetail> {
    await withTenant(schoolId, async (tx) => {
      const concern = await tx.concern.findFirst({ where: { id, schoolId, raisedById: userId }, select: { id: true, status: true, resolvedAt: true, reopenedAt: true } });
      if (!concern) throw new ApiError('NOT_FOUND', 'That is not in your Complaint Box.', 404, 'id');
      if (!this.reopenable(concern.status, concern.resolvedAt, concern.reopenedAt)) {
        throw new ApiError('VALIDATION', `This one is closed. You can reopen a concern within ${CONCERN_REOPEN_DAYS} days of it being resolved, once — please raise a new one.`, 400, 'id');
      }
      const now = new Date();
      await tx.concernComment.create({
        data: { schoolId, concernId: id, authorId: userId, authorRole: 'PARENT', body: body.trim().slice(0, PREVIEW), visibleToFamily: true, statusFrom: 'RESOLVED', statusTo: 'OPEN' },
      });
      await tx.concern.update({
        where: { id },
        data: { status: 'OPEN', reopenedAt: now, resolvedAt: null, resolvedById: null, lastActivityAt: now, readByOfficeAt: null, readByTeacherAt: null },
      });
    });
    await this.notifyRaised(schoolId, id);
    return this.detail(schoolId, { kind: 'FAMILY', userId }, id);
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** What this viewer may see AT ALL — the rule, as a query, not as a filter. */
  private async scope(tx: TenantTx, schoolId: string, viewer: Viewer): Promise<Record<string, unknown>> {
    if (viewer.kind === 'FAMILY') return { schoolId, raisedById: viewer.userId };
    if (viewer.kind === 'ADMIN') {
      // The office sees what was addressed to it, plus anything a class
      // teacher has sent up.
      return { schoolId, OR: [{ audience: 'OFFICE' }, { escalatedAt: { not: null } }] };
    }
    const teacher = await tx.teacher.findFirst({ where: { schoolId, userId: viewer.userId }, select: { id: true } });
    // A login with no teacher row sees nothing — never everything.
    return { schoolId, audience: 'CLASS_TEACHER', assignedTeacherId: teacher?.id ?? '00000000-0000-0000-0000-000000000000' };
  }

  private rowInclude() {
    return {
      student: { select: { id: true, firstName: true, lastName: true, classSection: { select: { name: true, grade: { select: { name: true } } } } } },
      assignedTeacher: { select: { id: true, firstName: true, lastName: true } },
      raisedBy: { select: { name: true, email: true } },
    } as const;
  }

  private toRow(r: ConcernRecord, viewer: Viewer, commentCount: number): ConcernRow {
    return {
      id: r.id,
      status: r.status as ConcernStatus,
      category: r.category as ConcernRow['category'],
      audience: r.audience as ConcernAudience,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.lastActivityAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      escalatedAt: r.escalatedAt?.toISOString() ?? null,
      unread: viewer.kind === 'ADMIN' ? !r.readByOfficeAt : viewer.kind === 'TEACHER' ? !r.readByTeacherAt : false,
      student: {
        id: r.student.id,
        name: `${r.student.firstName} ${r.student.lastName}`.trim(),
        className: r.student.classSection ? `${r.student.classSection.grade.name} ${r.student.classSection.name}`.trim() : null,
      },
      assignedTeacher: r.assignedTeacher ? { id: r.assignedTeacher.id, name: `${r.assignedTeacher.firstName} ${r.assignedTeacher.lastName}`.trim() } : null,
      raisedBy: { name: r.raisedBy.name ?? r.raisedBy.email, role: r.raisedByRole as ConcernAuthorRole },
      commentCount,
    };
  }

  private reopenable(status: string, resolvedAt: Date | null, reopenedAt: Date | null): boolean {
    if (status !== 'RESOLVED' || !resolvedAt || reopenedAt) return false;
    return Date.now() - resolvedAt.getTime() <= CONCERN_REOPEN_DAYS * 86_400_000;
  }

  /**
   * Tell whoever the family chose. Writes the in-app row and the outbox row
   * the drain turns into a push / WhatsApp message — the same pair every
   * other module writes. Never throws into the caller's write: a notification
   * that fails must not undo the concern it describes.
   */
  private async notifyRaised(schoolId: string, id: string, escalated = false): Promise<void> {
    try {
      await withTenant(schoolId, async (tx) => {
        const [concern, school] = await Promise.all([
          tx.concern.findFirst({
            where: { id, schoolId },
            select: {
              title: true, audience: true, category: true,
              assignedTeacher: { select: { userId: true } },
              student: { select: { firstName: true, lastName: true } },
            },
          }),
          tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        ]);
        if (!concern) return;
        const child = `${concern.student.firstName} ${concern.student.lastName}`.trim();
        const title = escalated ? 'A concern was sent to the office' : 'A family raised a concern';
        const body = `${child} · ${concern.title}`;
        const schoolName = school?.name ?? 'Your school';

        // Straight to the class teacher when that is who the family chose and
        // nobody has sent it up; to every admin otherwise.
        const toTeacher = !escalated && concern.audience === 'CLASS_TEACHER' && concern.assignedTeacher?.userId;
        const readers = toTeacher
          ? [{ userId: concern.assignedTeacher!.userId! }]
          : await resolveAdminRecipients(tx, schoolId);
        for (const r of readers) {
          await tx.notification.create({
            data: { schoolId, userId: r.userId, kind: 'CONCERN_RAISED', title, body, linkType: 'concern', linkId: id },
          });
          await tx.notificationOutbox.create({
            data: { schoolId, kind: 'CONCERN_RAISED', payload: { schoolName, title, body }, targetUserId: r.userId },
          });
        }
      });
    } catch { /* a notification must never undo the write it describes */ }
  }

  private async notifyFamily(schoolId: string, id: string, kind: 'CONCERN_REPLIED' | 'CONCERN_RESOLVED'): Promise<void> {
    try {
      await withTenant(schoolId, async (tx) => {
        const [concern, school] = await Promise.all([
          tx.concern.findFirst({ where: { id, schoolId }, select: { title: true, raisedById: true } }),
          tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        ]);
        if (!concern) return;
        const title = kind === 'CONCERN_RESOLVED' ? 'Your concern was resolved' : 'The school replied to your concern';
        await tx.notification.create({
          data: { schoolId, userId: concern.raisedById, kind, title, body: concern.title, linkType: 'concern', linkId: id },
        });
        await tx.notificationOutbox.create({
          data: { schoolId, kind, payload: { schoolName: school?.name ?? 'Your school', title, body: concern.title }, targetUserId: concern.raisedById },
        });
      });
    } catch { /* as above */ }
  }
}

type TenantTx = Parameters<Parameters<typeof withTenant>[1]>[0];
type ConcernRecord = {
  id: string; status: string; category: string; audience: string; title: string;
  createdAt: Date; lastActivityAt: Date; resolvedAt: Date | null; escalatedAt: Date | null;
  readByOfficeAt: Date | null; readByTeacherAt: Date | null; raisedByRole: string;
  student: { id: string; firstName: string; lastName: string; classSection: { name: string; grade: { name: string } } | null };
  assignedTeacher: { id: string; firstName: string; lastName: string } | null;
  raisedBy: { name: string | null; email: string };
};
