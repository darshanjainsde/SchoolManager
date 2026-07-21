import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import { reminderDaysUntil, reminderWindows } from './reminder-window';

export interface ExamReminderRunResult {
  exams: number;
  sent: number;
}

/**
 * Hard ceiling on exams handled per run. The serverless function has
 * `maxDuration: 60` (apps/api/vercel.json), so an unbounded scan could be
 * killed mid-run and silently drop reminders. Truncation is logged loudly
 * instead of happening invisibly.
 */
const MAX_EXAMS_PER_RUN = 200;

/** Exams processed concurrently. Keeps the run inside maxDuration without
 * opening an unbounded number of DB/SMTP connections at once. */
const EXAM_CONCURRENCY = 10;

/** Never render `undefined` into a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';
const FALLBACK_SUBJECT_NAME = 'General';

interface ScannedExam {
  id: string;
  schoolId: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  scheduledAt: Date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Daily cron job (see apps/api/vercel.json `crons` + ExamRemindersController)
 * that reminds guardians/students of a test 2 days and 1 day before it
 * happens. Runs ACROSS ALL SCHOOLS via the platform Prisma client — there is
 * no tenant/JWT context for a cron trigger, and `Exam` carries no RLS anyway
 * (see the same note in exams.service.ts), so a plain cross-school query is
 * both correct and necessary here. Because that client BYPASSES RLS, every
 * downstream lookup is explicitly scoped by the exam's own `schoolId`.
 */
@Injectable()
export class ExamRemindersService {
  private readonly logger = new Logger(ExamRemindersService.name);

  constructor(private readonly notifications: NotificationService) {}

  async run(): Promise<ExamReminderRunResult> {
    const db = getPlatformPrisma();
    const now = new Date();
    const { twoDaysOut, oneDayOut } = reminderWindows(now);

    const exams: ScannedExam[] = await db.exam.findMany({
      where: {
        OR: [
          { scheduledAt: { gte: twoDaysOut.gte, lt: twoDaysOut.lt } },
          { scheduledAt: { gte: oneDayOut.gte, lt: oneDayOut.lt } },
        ],
      },
      select: {
        id: true,
        schoolId: true,
        classSectionId: true,
        subjectId: true,
        title: true,
        scheduledAt: true,
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: MAX_EXAMS_PER_RUN,
    });

    if (exams.length === MAX_EXAMS_PER_RUN) {
      this.logger.warn(
        `Exam reminder scan hit the ${MAX_EXAMS_PER_RUN}-exam cap — some reminders for this window may not have been sent.`,
      );
    }
    if (exams.length === 0) return { exams: 0, sent: 0 };

    const names = await this.loadNames(db, exams);

    let sent = 0;
    for (const batch of chunk(exams, EXAM_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((exam) => this.remindForExam(db, exam, names, now)),
      );
      for (const [i, outcome] of settled.entries()) {
        if (outcome.status === 'fulfilled') {
          sent += outcome.value;
        } else {
          // One school's failure must never abort the run for the rest.
          this.logger.error(
            `Reminder failed for exam ${batch[i].id}: ${(outcome.reason as Error)?.message}`,
          );
        }
      }
    }

    return { exams: exams.length, sent };
  }

  /** School + subject display names for the scanned exams, in two batched queries. */
  private async loadNames(
    db: ReturnType<typeof getPlatformPrisma>,
    exams: ScannedExam[],
  ): Promise<{ schools: Map<string, string>; subjects: Map<string, string> }> {
    const schoolIds = [...new Set(exams.map((e) => e.schoolId))];
    const subjectIds = [...new Set(exams.map((e) => e.subjectId))];

    const [schools, subjects] = await Promise.all([
      db.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } }),
      db.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } }),
    ]);

    return {
      schools: new Map(schools.map((s) => [s.id, s.name])),
      subjects: new Map(subjects.map((s) => [s.id, s.name])),
    };
  }

  private async remindForExam(
    db: ReturnType<typeof getPlatformPrisma>,
    exam: ScannedExam,
    names: { schools: Map<string, string>; subjects: Map<string, string> },
    now: Date,
  ): Promise<number> {
    const daysUntil = reminderDaysUntil(exam.scheduledAt, now);
    if (daysUntil === null) return 0;

    const recipients = await resolveSectionRecipients(db, exam.schoolId, exam.classSectionId);
    if (recipients.length === 0) return 0;

    const payload = {
      schoolName: names.schools.get(exam.schoolId) ?? FALLBACK_SCHOOL_NAME,
      subjectName: names.subjects.get(exam.subjectId) ?? FALLBACK_SUBJECT_NAME,
      examTitle: exam.title,
      scheduledAt: new Date(exam.scheduledAt).toISOString(),
      daysUntil,
    };

    const summary = await this.notifications.notify(
      'TEST_REMINDER',
      recipients.map((email) => ({ email, payload })),
    );
    return summary.sent;
  }
}
