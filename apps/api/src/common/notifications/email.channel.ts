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

  // `schoolId` is part of the `NotificationChannel` contract (see
  // notification.types.ts — `PushChannel` needs it to avoid a cross-tenant
  // lookup) but SMTP delivery needs no DB lookup at all, so this channel
  // ignores it.
  async send(to: string, message: NotificationMessage, _schoolId: string): Promise<boolean> {
    switch (message.kind) {
      case 'TEST_SCHEDULED':
        return this.mail.sendTestScheduled(to, message.payload);
      case 'TEST_REMINDER':
        return this.mail.sendTestReminder(to, message.payload);
      case 'RESULTS_PUBLISHED':
        return this.mail.sendResultsPublished(to, message.payload);
      case 'ABSENCE_NOTICE':
        return this.mail.sendAbsenceNotice(to, message.payload);
      case 'ANNOUNCEMENT':
        return this.mail.sendAnnouncement(to, message.payload);
      case 'DIARY_REMARK':
        return this.mail.sendDiaryRemark(to, message.payload);
      case 'LOW_ATTENDANCE':
        return this.mail.sendLowAttendance(to, message.payload);
      default: {
        // Exhaustiveness guard — a new NotificationKind must be handled above.
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }
}
