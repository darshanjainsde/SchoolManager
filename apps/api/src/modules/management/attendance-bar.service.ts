import { Injectable, Logger } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { AttendanceRatesResult, NotifyLowAttendanceResult } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { formatDateIST } from '../../common/notifications/format';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveStudentRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { requireClassAccess } from './internal/class-access';
import { istTodayISO } from './internal/timetable-date';
import type { NotifyLowAttendanceDto } from './management.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A family is never nudged about the same thing twice inside this window. The
 * teacher still sees the child in the list — greyed, with "told 3 days ago" —
 * so the cooldown reads as information, not a disabled button with no reason.
 */
export const NOTICE_COOLDOWN_DAYS = 7;

/** How far back an unspecified window reaches (roughly a term to date). */
const DEFAULT_WINDOW_DAYS = 90;

/** Never let a missing School row render as `undefined` in a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';

/**
 * The attendance bar under the register (Phase 5·3): every child's attendance
 * percentage for a window, ranked lowest first, with a one-tap private nudge
 * to the families below the teacher's chosen benchmark.
 *
 * PRIVACY IS THE FEATURE. The nudge is one email per family naming only their
 * own child and only their own number — never a class list, never a ranking,
 * never "you are in the bottom five". The teacher sees the whole class; each
 * parent sees exactly one child.
 *
 * `percent` counts PRESENT and LATE as attended: a child who arrived late was
 * in the room, and a benchmark that punished lateness twice (once in the
 * register, once here) would make this list read as a discipline report rather
 * than an attendance one.
 */
@Injectable()
export class AttendanceBarService {
  private readonly logger = new Logger(AttendanceBarService.name);

  constructor(private readonly notifications: NotificationService) {}

  private assertDate(date: string, field: string): void {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', `${field} must be formatted as YYYY-MM-DD`, 400, field);
    }
  }

  /** Defaults an open-ended window to "the last 90 days, up to today". */
  private resolveWindow(from?: string, to?: string): { from: string; to: string } {
    const end = to ?? istTodayISO();
    this.assertDate(end, 'to');
    let start = from;
    if (!start) {
      const d = new Date(end);
      d.setDate(d.getDate() - DEFAULT_WINDOW_DAYS);
      start = d.toISOString().slice(0, 10);
    }
    this.assertDate(start, 'from');
    if (start > end) {
      throw new ApiError('VALIDATION', 'from must be on or before to', 400, 'from');
    }
    return { from: start, to: end };
  }

  /**
   * Per-student attendance over the window. Two queries regardless of class
   * size: one `attendance.groupBy` over the whole section, one roster read —
   * a per-student loop would have scaled with the class.
   */
  async rates(
    schoolId: string,
    classSectionId: string,
    userId: string,
    role: string,
    opts: { from?: string; to?: string } = {},
  ): Promise<AttendanceRatesResult> {
    const { from, to } = this.resolveWindow(opts.from, opts.to);

    return withTenant(schoolId, async (tx) => {
      if (role !== 'SCHOOL_ADMIN') {
        await requireClassAccess(tx, userId, classSectionId, to, 'view attendance for');
      }

      const section = await tx.classSection.findFirst({
        where: { schoolId, id: classSectionId },
        select: { name: true, grade: { select: { name: true } } },
      });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const students = await // Deliberately uncapped — see attendance.service: a partial roster loses
      // children from the register rather than merely shortening a list.
      tx.student.findMany({
        where: { schoolId, classSectionId },
        orderBy: [{ rollNo: 'asc' }, { admissionNo: 'asc' }],
        select: { id: true, firstName: true, lastName: true, rollNo: true },
      });
      if (students.length === 0) {
        return {
          classSectionId,
          className: `${section.grade.name}-${section.name}`,
          from,
          to,
          daysMarked: 0,
          students: [],
        };
      }

      const window = { gte: new Date(from), lte: new Date(to) };
      const marks = await tx.attendance.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, classSectionId, date: window },
        select: { studentId: true, status: true, date: true },
      });

      // The most recent notice per student, for the cooldown display.
      const notices = await tx.attendanceNotice.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, classSectionId },
        orderBy: { sentAt: 'desc' },
        select: { studentId: true, sentAt: true },
      });
      const lastNotice = new Map<string, Date>();
      for (const n of notices) {
        if (!lastNotice.has(n.studentId)) lastNotice.set(n.studentId, n.sentAt);
      }

      const tally = new Map<string, { present: number; total: number }>();
      const days = new Set<string>();
      for (const m of marks) {
        days.add(m.date.toISOString().slice(0, 10));
        const t = tally.get(m.studentId) ?? { present: 0, total: 0 };
        t.total += 1;
        // LATE counts as attended — see the class docstring.
        if (m.status === 'PRESENT' || m.status === 'LATE') t.present += 1;
        tally.set(m.studentId, t);
      }

      const rows = students.map((s) => {
        const t = tally.get(s.id) ?? { present: 0, total: 0 };
        const percent = t.total === 0 ? 0 : Math.round((t.present / t.total) * 100);
        return {
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          rollNo: s.rollNo,
          present: t.present,
          total: t.total,
          percent,
          lastNoticeAt: lastNotice.get(s.id)?.toISOString() ?? null,
        };
      });
      // Lowest first: the whole point of the bar is who needs looking at.
      rows.sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name));

      return {
        classSectionId,
        className: `${section.grade.name}-${section.name}`,
        from,
        to,
        daysMarked: days.size,
        students: rows,
      };
    });
  }

  /**
   * The one-tap nudge. Recomputes every percentage server-side rather than
   * trusting the numbers the client is showing — a stale slider must not be
   * able to email a family whose child has since recovered — then writes an
   * `AttendanceNotice` receipt per family inside the transaction, so the
   * cooldown holds even if two teachers tap at the same moment.
   */
  async notifyLow(
    schoolId: string,
    userId: string,
    role: string,
    dto: NotifyLowAttendanceDto,
  ): Promise<NotifyLowAttendanceResult> {
    const { from, to } = this.resolveWindow(dto.from, dto.to);
    const rates = await this.rates(schoolId, dto.classSectionId, userId, role, { from, to });

    const chosen = dto.studentIds ? new Set(dto.studentIds) : null;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - NOTICE_COOLDOWN_DAYS);

    // Below the benchmark, actually chosen, and with at least one marked day —
    // a child with no register taken yet reads as 0%, and emailing their family
    // about a percentage the school never recorded would be plainly wrong.
    const candidates = rates.students.filter(
      (s) =>
        s.percent < dto.threshold &&
        s.total > 0 &&
        (chosen === null || chosen.has(s.studentId)),
    );

    let skippedInCooldown = 0;
    const targets = candidates.filter((s) => {
      const last = s.lastNoticeAt ? new Date(s.lastNoticeAt) : null;
      if (last && last > cutoff) {
        skippedInCooldown += 1;
        return false;
      }
      return true;
    });

    if (targets.length === 0) {
      return { notified: 0, skippedInCooldown, cooldownDays: NOTICE_COOLDOWN_DAYS };
    }

    const studentIds = targets.map((t) => t.studentId);

    const { schoolName } = await withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
      const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });

      await tx.attendanceNotice.createMany({
        data: targets.map((t) => ({
          schoolId,
          studentId: t.studentId,
          classSectionId: dto.classSectionId,
          percent: t.percent,
          threshold: dto.threshold,
          sentByTeacherId: teacher?.id ?? userId,
        })),
      });

      // The in-app bell, in the same transaction as the receipt.
      const withLogins = await tx.student.findMany({ take: LIST_CEILING.ROSTER,
        where: { schoolId, id: { in: studentIds }, userId: { not: null } },
        select: { id: true, userId: true },
      });
      const percentById = new Map(targets.map((t) => [t.studentId, t.percent]));
      for (const s of withLogins) {
        if (!s.userId) continue;
        await emitNotifications(tx, {
          schoolId,
          userIds: [s.userId],
          kind: 'ATTENDANCE',
          title: 'A note about attendance',
          body: `Attendance is ${percentById.get(s.id) ?? 0}% — below the school's ${dto.threshold}% benchmark. Please talk to the class teacher.`,
          linkType: 'attendance',
          linkId: null,
        });
      }

      return { schoolName: school?.name ?? FALLBACK_SCHOOL_NAME };
    });

    // Email, best-effort and post-commit — one family, one child, one number.
    const period = `${formatDateIST(new Date(from))} – ${formatDateIST(new Date(to))}`;
    const percentById = new Map(targets.map((t) => [t.studentId, t.percent]));
    runInBackground(
      async () => {
        const recipients = await withTenant(schoolId, (tx) =>
          resolveStudentRecipients(tx, schoolId, studentIds),
        );
        if (recipients.length === 0) return;
        const percentByName = new Map(
          targets.map((t) => [t.name, percentById.get(t.studentId) ?? 0]),
        );
        await this.notifications.notify(
          'LOW_ATTENDANCE',
          recipients.map((r) => ({
            email: r.email,
            schoolId,
            payload: {
              schoolName,
              studentName: r.studentName,
              className: rates.className,
              percent: percentByName.get(r.studentName) ?? 0,
              threshold: dto.threshold,
              period,
            },
          })),
        );
      },
      (e) => this.logger.error(`LOW_ATTENDANCE notify failed: ${(e as Error).message}`),
    );

    return {
      notified: targets.length,
      skippedInCooldown,
      cooldownDays: NOTICE_COOLDOWN_DAYS,
    };
  }
}
