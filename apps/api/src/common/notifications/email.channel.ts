import { Injectable } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import type { NotificationChannel, NotificationMessage } from './notification.types';

/**
 * Wraps `MailService` as a `NotificationChannel`. Each `NotificationKind`
 * maps to one of the `MailService.send*` composers, and the payload handed to
 * that composer is the SAME interface the caller had to satisfy (see
 * notification.types.ts) — `switch (message.kind)` narrows the discriminated
 * union, so there is no cast anywhere in this file. If a caller's payload
 * ever drifts from what a composer reads, it fails to compile at the call
 * site instead of rendering "undefined" into a parent's inbox.
 */
@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly name = 'email';

  constructor(private readonly mail: MailService) {}

  // `schoolId` now matters to this channel too: it is what resolves the
  // school's letterhead and sender (see MailIdentityService), so every
  // composer receives it rather than the mail going out unbranded.
  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    switch (message.kind) {
      case 'TEST_SCHEDULED':
        return this.mail.sendTestScheduled(to, message.payload, schoolId);
      case 'TEST_REMINDER':
        return this.mail.sendTestReminder(to, message.payload, schoolId);
      case 'RESULTS_PUBLISHED':
        return this.mail.sendResultsPublished(to, message.payload, schoolId);
      case 'ABSENCE_NOTICE':
        return this.mail.sendAbsenceNotice(to, message.payload, schoolId);
      case 'ANNOUNCEMENT':
        return this.mail.sendAnnouncement(to, message.payload, schoolId);
      case 'DIARY_REMARK':
        return this.mail.sendDiaryRemark(to, message.payload, schoolId);
      case 'LOW_ATTENDANCE':
        return this.mail.sendLowAttendance(to, message.payload, schoolId);
      default: {
        // Exhaustiveness guard — a new NotificationKind must be handled above.
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }
}
