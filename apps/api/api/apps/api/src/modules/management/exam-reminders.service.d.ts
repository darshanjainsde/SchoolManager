import { NotificationService } from '../../common/notifications/notification.service';
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
 * both correct and necessary here. Because that client BYPASSES RLS, every
 * downstream lookup is explicitly scoped by the exam's own `schoolId`.
 */
export declare class ExamRemindersService {
    private readonly notifications;
    private readonly logger;
    constructor(notifications: NotificationService);
    run(): Promise<ExamReminderRunResult>;
    /** School + subject display names for the scanned exams, in two batched queries. */
    private loadNames;
    private remindForExam;
}
//# sourceMappingURL=exam-reminders.service.d.ts.map