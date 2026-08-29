import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type Prisma } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { MailService } from '../../../common/mail/mail.service';
import type { Letter } from '../../../common/mail/letterhead';
import { runInBackground } from '../../../common/notifications/run-in-background';
import { emitNotifications } from '../../../common/notifications/notification-inbox';
import type { LibraryNoticeOutboxPayload } from '../../../common/notifications/notification.types';
import { istTodayISO } from '../../management';
import { LibrarySettingsService } from './library-settings.service';
import { accruedFineRupees, dateOnlyISO, finesApply, type BorrowerKind } from './library-policy';
import type { RemindFinesDto } from './library.dto';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

/** One line on the Fines tab — either a crystallized row or a still-growing accrual. */
export interface FineEntry {
  /** LibraryFine.id for FIXED entries; the issue id for ACCRUING ones. */
  id: string;
  kind: 'FIXED' | 'ACCRUING';
  reason: 'LATE' | 'LOST';
  amountRupees: number;
  title: string;
  accessionNo: string;
  borrower: {
    kind: BorrowerKind;
    id: string;
    name: string;
    code: string | null;
    className: string | null;
    classSectionId: string | null;
    userId: string | null;
  };
  /** Human context: "4 days late · still out" / "returned 12 Aug" / "lost". */
  detail: string;
}

const FINE_INCLUDE = {
  issue: {
    select: {
      returnedOn: true,
      copy: { select: { accessionNo: true, title: { select: { title: true } } } },
    },
  },
  // Borrower is denormalised on the fine; names still need one hop each.
} as const;

@Injectable()
export class LibraryFinesService {
  private readonly logger = new Logger(LibraryFinesService.name);

  constructor(
    private readonly settings: LibrarySettingsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Everything owed right now: crystallized DUE rows plus the accrual on
   * open overdue loans (which "settles at return" — it has no row yet).
   * Teacher entries vanish entirely while fineTeachers is off.
   */
  async list(schoolId: string) {
    const todayISO = istTodayISO();
    return withTenant(schoolId, async (tx) => {
      const settings = await this.settings.ensure(tx, schoolId);
      const rules = this.settings.rules(settings);
      const [fixed, openLate, collected] = await Promise.all([
        tx.libraryFine.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, status: 'DUE' },
          orderBy: { createdAt: 'asc' },
          include: FINE_INCLUDE,
        }),
        tx.libraryIssue.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, returnedOn: null, dueOn: { lt: new Date(`${todayISO}T00:00:00.000Z`) } },
          include: {
            copy: { select: { accessionNo: true, title: { select: { title: true } } } },
            student: {
              select: {
                id: true, firstName: true, lastName: true, code: true, userId: true,
                classSectionId: true,
                classSection: { select: { name: true, grade: { select: { name: true } } } },
              },
            },
            teacher: { select: { id: true, firstName: true, lastName: true, userId: true } },
          },
        }),
        tx.libraryFine.aggregate({ where: { schoolId, status: 'PAID' }, _sum: { amountRupees: true } }),
      ]);

      const borrowerIds = {
        students: fixed.map((f) => f.studentId).filter((x): x is string => !!x),
        teachers: fixed.map((f) => f.teacherId).filter((x): x is string => !!x),
      };
      const [students, teachers] = await Promise.all([
        tx.student.findMany({ take: LIST_CEILING.ROSTER,
          where: { id: { in: borrowerIds.students } },
          select: {
            id: true, firstName: true, lastName: true, code: true, userId: true,
            classSectionId: true,
            classSection: { select: { name: true, grade: { select: { name: true } } } },
          },
        }),
        tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { id: { in: borrowerIds.teachers } },
          select: { id: true, firstName: true, lastName: true, userId: true },
        }),
      ]);
      const studentById = new Map(students.map((s) => [s.id, s]));
      const teacherById = new Map(teachers.map((t) => [t.id, t]));

      const entries: FineEntry[] = [];
      for (const f of fixed) {
        if (f.teacherId && !rules.fineTeachers) continue;
        const s = f.studentId ? studentById.get(f.studentId) : null;
        const t = f.teacherId ? teacherById.get(f.teacherId) : null;
        if (!s && !t) continue;
        entries.push({
          id: f.id,
          kind: 'FIXED',
          reason: f.reason,
          amountRupees: f.amountRupees,
          title: f.issue.copy.title.title,
          accessionNo: f.issue.copy.accessionNo,
          borrower: s
            ? {
                kind: 'STUDENT', id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), code: s.code,
                className: s.classSection ? `${s.classSection.grade.name}${s.classSection.name}` : null,
                classSectionId: s.classSectionId, userId: s.userId,
              }
            : {
                kind: 'TEACHER', id: t!.id, name: `${t!.firstName} ${t!.lastName}`.trim(), code: null,
                className: null, classSectionId: null, userId: t!.userId,
              },
          detail:
            f.reason === 'LOST'
              ? 'lost — replacement'
              : f.issue.returnedOn
                ? `returned ${dateOnlyISO(f.issue.returnedOn)}`
                : 'late',
        });
      }
      for (const i of openLate) {
        const kind: BorrowerKind = i.student ? 'STUDENT' : 'TEACHER';
        if (!finesApply(rules, kind)) continue;
        const amount = accruedFineRupees(rules, kind, dateOnlyISO(i.dueOn), todayISO);
        if (amount <= 0) continue;
        const daysLate = Math.round(
          (Date.parse(`${todayISO}T00:00:00.000Z`) - i.dueOn.getTime()) / 86_400_000,
        );
        entries.push({
          id: i.id,
          kind: 'ACCRUING',
          reason: 'LATE',
          amountRupees: amount,
          title: i.copy.title.title,
          accessionNo: i.copy.accessionNo,
          borrower: i.student
            ? {
                kind: 'STUDENT', id: i.student.id, name: `${i.student.firstName} ${i.student.lastName}`.trim(),
                code: i.student.code,
                className: i.student.classSection
                  ? `${i.student.classSection.grade.name}${i.student.classSection.name}`
                  : null,
                classSectionId: i.student.classSectionId, userId: i.student.userId,
              }
            : {
                kind: 'TEACHER', id: i.teacher!.id, name: `${i.teacher!.firstName} ${i.teacher!.lastName}`.trim(),
                code: null, className: null, classSectionId: null, userId: i.teacher!.userId,
              },
          detail: `${daysLate} day${daysLate === 1 ? '' : 's'} late · still out — settles at return`,
        });
      }

      return {
        collectedRupees: collected._sum.amountRupees ?? 0,
        dueRupees: entries.reduce((n, e) => n + e.amountRupees, 0),
        entries,
      };
    });
  }

  async collect(schoolId: string, librarianUserId: string, fineId: string) {
    return this.settle(schoolId, librarianUserId, fineId, 'PAID');
  }

  async waive(schoolId: string, librarianUserId: string, fineId: string) {
    return this.settle(schoolId, librarianUserId, fineId, 'WAIVED');
  }

  private settle(schoolId: string, librarianUserId: string, fineId: string, to: 'PAID' | 'WAIVED') {
    return withTenant(schoolId, async (tx) => {
      const fine = await tx.libraryFine.findFirst({ where: { id: fineId } });
      if (!fine) throw new ApiError('NOT_FOUND', 'No such fine.', 404);
      if (fine.status !== 'DUE') {
        throw new ApiError('LIBRARY_FINE_SETTLED', 'This fine is already settled.', 409);
      }
      return tx.libraryFine.update({
        where: { id: fineId },
        data: { status: to, settledById: librarianUserId, settledAt: new Date() },
      });
    });
  }

  /** Undo a collect/waive — the row is owed again. */
  async reopenFine(schoolId: string, fineId: string) {
    return withTenant(schoolId, async (tx) => {
      const fine = await tx.libraryFine.findFirst({ where: { id: fineId } });
      if (!fine) throw new ApiError('NOT_FOUND', 'No such fine.', 404);
      if (fine.status === 'DUE') {
        throw new ApiError('LIBRARY_FINE_SETTLED', 'This fine is already due.', 409);
      }
      return tx.libraryFine.update({
        where: { id: fineId },
        data: { status: 'DUE', settledById: null, settledAt: null },
      });
    });
  }

  /**
   * One tap chases a whole class (or the staff group): every indebted reader
   * gets an in-app bell row + a push (via the outbox, the guaranteed path) in
   * the SAME transaction, and an email fired after commit — the house
   * email-immediate/push-outbox split that prevents double sends.
   */
  async remind(schoolId: string, dto: RemindFinesDto) {
    if (!dto.classSectionId && !dto.staff) {
      throw new ApiError('VALIDATION', 'Pick a class (classSectionId) or staff: true.', 400);
    }
    const { entries } = await this.list(schoolId);
    const targets = entries.filter((e) =>
      dto.staff ? e.borrower.kind === 'TEACHER' : e.borrower.classSectionId === dto.classSectionId,
    );
    if (!targets.length) return { readers: 0, pushes: 0, emails: 0 };

    // Group per reader — one message listing all their items.
    const byReader = new Map<string, FineEntry[]>();
    for (const e of targets) {
      const key = `${e.borrower.kind}:${e.borrower.id}`;
      byReader.set(key, [...(byReader.get(key) ?? []), e]);
    }

    const emailJobs: Array<{ to: string; subject: string; letter: Letter }> = [];
    let pushes = 0;

    await withTenant(schoolId, async (tx) => {
      const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });
      const schoolName = school?.name ?? 'Your school';
      for (const items of byReader.values()) {
        const reader = items[0].borrower;
        const total = items.reduce((n, e) => n + e.amountRupees, 0);
        const lines = items.map((e) => `${e.title} — ₹${e.amountRupees} (${e.detail})`);
        const title = `Library fine: ₹${total} to clear`;
        const body = lines.join(' · ');
        if (reader.userId) {
          const payload: LibraryNoticeOutboxPayload = { schoolName, title, body };
          await tx.notificationOutbox.create({
            data: {
              schoolId,
              kind: 'LIBRARY_NOTICE',
              targetUserId: reader.userId,
              payload: payload as unknown as Prisma.InputJsonValue,
            },
          });
          await emitNotifications(tx, {
            schoolId,
            userIds: [reader.userId],
            kind: 'ANNOUNCEMENT',
            title,
            body,
          });
          pushes += 1;
          const user = await tx.user.findFirst({ where: { id: reader.userId }, select: { email: true } });
          if (user?.email) {
            emailJobs.push({
              to: user.email,
              subject: `${schoolName} library — ₹${total} fine to clear`,
              letter: {
                title: 'A library fine to clear',
                intro: `${reader.name} has library fines to settle at the counter.`,
                rows: [
                  ...items.map((e) => ({ label: e.title, value: `₹${e.amountRupees} · ${e.detail}` })),
                  { label: 'Total', value: `₹${total}` },
                ],
                note: 'Please settle it at the library counter.',
              } satisfies Letter,
            });
          }
        }
      }
    });

    runInBackground(async () => {
      for (const job of emailJobs) {
        await this.mail.sendLetter(job.to, schoolId, job.subject, job.letter);
      }
    }, (e) => this.logger.error(`library fine reminder emails failed: ${String(e)}`));

    return { readers: byReader.size, pushes, emails: emailJobs.length };
  }
}
