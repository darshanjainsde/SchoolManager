import type { AbsenceNoticePayload, AnnouncementPayload, DiaryRemarkPayload, LowAttendancePayload, ResultsPublishedPayload, TestReminderPayload, TestScheduledPayload } from '../notifications/notification.types';
/**
 * The notification payload interfaces live in `notification.types.ts` (the
 * authoritative contract shared with every caller and channel); these aliases
 * exist only so the composer signatures below read naturally.
 */
export type TestScheduledInfo = TestScheduledPayload;
export type TestReminderInfo = TestReminderPayload;
export type ResultsPublishedInfo = ResultsPublishedPayload;
export type AbsenceNoticeInfo = AbsenceNoticePayload;
export type AnnouncementInfo = AnnouncementPayload;
export type DiaryRemarkInfo = DiaryRemarkPayload;
export type LowAttendanceInfo = LowAttendancePayload;
/**
 * Escapes a value for interpolation into an HTML email body. School-authored
 * text (exam titles, school names, student names) reaches parents' inboxes,
 * so it must never be able to inject markup.
 */
export declare function escapeHtml(value: string | number): string;
/**
 * Thin SMTP wrapper. Hostinger (authenticated, port 465/SSL) in prod,
 * Mailhog (unauthenticated, port 1025) in local dev — env-swap only.
 */
export declare class MailService {
    private readonly logger;
    private readonly env;
    private readonly transporter;
    constructor();
    /** Sends and reports success; failures are logged, never thrown to callers. */
    send(to: string, subject: string, html: string, text: string): Promise<boolean>;
    sendLeadNotification(to: string, lead: {
        name: string | null;
        phone: string;
        school: string | null;
        interest: string | null;
        source: string;
    }): Promise<boolean>;
    sendPasswordReset(to: string, schoolName: string, resetUrl: string): Promise<boolean>;
    sendWelcomeInvite(to: string, schoolName: string, loginName: string, setPasswordUrl: string): Promise<boolean>;
    sendTestScheduled(to: string, info: TestScheduledInfo): Promise<boolean>;
    sendTestReminder(to: string, info: TestReminderInfo): Promise<boolean>;
    sendResultsPublished(to: string, info: ResultsPublishedInfo): Promise<boolean>;
    sendAbsenceNotice(to: string, info: AbsenceNoticeInfo): Promise<boolean>;
    /**
     * The red-ink remark, sent to the family the moment a teacher writes it —
     * ALWAYS, even if the child then signs it in the app (the pitch's rule: a
     * remark reaches the parent, it does not sit in a child's phone). The
     * remark is quoted in a bordered block so it reads as the teacher's own
     * words rather than platform copy.
     */
    sendDiaryRemark(to: string, info: DiaryRemarkInfo): Promise<boolean>;
    /**
     * The attendance bar's private nudge — one family, their own child, their
     * own number. Never names or counts other students (see
     * `AttendanceBarService.notifyLow`).
     */
    sendLowAttendance(to: string, info: LowAttendanceInfo): Promise<boolean>;
    sendAnnouncement(to: string, info: AnnouncementInfo): Promise<boolean>;
}
//# sourceMappingURL=mail.service.d.ts.map