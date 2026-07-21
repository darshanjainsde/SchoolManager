import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import type {
  AbsenceNoticeInfo,
  ResultsPublishedInfo,
  TestReminderInfo,
  TestScheduledInfo,
} from '../mail/mail.service';
import type { NotificationChannel, NotificationKind } from './notification.types';

/**
 * Wraps `MailService` as a `NotificationChannel`. Each `NotificationKind`
 * maps to one of the `MailService.send*` composers — the payload shape
 * expected for each kind matches that composer's parameter, and is the
 * caller's responsibility to supply (see exams.service.ts / attendance.service.ts
 * / exam-reminders.service.ts for the shapes actually sent today).
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(private readonly mail: MailService) {}

  async send(kind: NotificationKind, to: string, payload: Record<string, unknown>): Promise<boolean> {
    switch (kind) {
      case 'TEST_SCHEDULED':
        return this.mail.sendTestScheduled(to, payload as unknown as TestScheduledInfo);
      case 'TEST_REMINDER':
        return this.mail.sendTestReminder(to, payload as unknown as TestReminderInfo);
      case 'RESULTS_PUBLISHED':
        return this.mail.sendResultsPublished(to, payload as unknown as ResultsPublishedInfo);
      case 'ABSENCE_NOTICE':
        return this.mail.sendAbsenceNotice(to, payload as unknown as AbsenceNoticeInfo);
      default: {
        // Exhaustiveness guard — a new NotificationKind must be handled above.
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }
}
