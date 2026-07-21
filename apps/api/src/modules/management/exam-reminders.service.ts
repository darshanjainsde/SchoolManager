import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import { reminderWindows } from './reminder-window';

export interface ExamReminderRunResult {
  exams: number;
  sent: number;
}

/**
 * Daily cron job (see apps/api/vercel.json `crons` + ExamRemindersController)
 * that reminds guardians/students of a test 2 days and 1 day before it
 * happens. Runs ACROSS ALL SCHOOLS via the platform Prisma client — there is
 * no tenant/JWT context for a cron trigger, and `Exam` carries no RLS anyway
 * (see the same note in exams.service.ts), so a plain cross-school query is
 * both correct and necessary here.
 */
@Injectable()
export class ExamRemindersService {
  private readonly logger = new Logger(ExamRemindersService.name);

  constructor(private readonly notifications: NotificationService) {}

  async run(): Promise<ExamReminderRunResult> {
    const db = getPlatformPrisma();
    const now = new Date();
    const { twoDaysOut, oneDayOut } = reminderWindows(now);

    const exams = await db.exam.findMany({
      where: {
        OR: [
          { scheduledAt: { gte: twoDaysOut.gte, lt: twoDaysOut.lt } },
          { scheduledAt: { gte: oneDayOut.gte, lt: oneDayOut.lt } },
        ],
      },
    });

    let sent = 0;
    for (const exam of exams) {
      try {
        const recipients = await resolveSectionRecipients(db, exam.classSectionId);
        if (recipients.length === 0) continue;

        const daysUntil = exam.scheduledAt >= twoDaysOut.gte && exam.scheduledAt < twoDaysOut.lt ? 2 : 1;

        const summary = await this.notifications.notify('TEST_REMINDER', recipients, {
          examId: exam.id,
          schoolId: exam.schoolId,
          title: exam.title,
          classSectionId: exam.classSectionId,
          scheduledAt: exam.scheduledAt.toISOString(),
          daysUntil,
        });
        sent += summary.sent;
      } catch (e) {
        // One school's failure must never abort the run for the rest.
        this.logger.error(`Reminder failed for exam ${exam.id}: ${(e as Error).message}`);
      }
    }

    return { exams: exams.length, sent };
  }
}
