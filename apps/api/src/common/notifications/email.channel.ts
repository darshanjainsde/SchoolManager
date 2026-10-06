import { Injectable } from '@nestjs/common';
import type { MailOutcomeSink } from '../mail/mail-outcome';
import { MailService } from '../mail/mail.service';
import type { DeliveryChannel, DeliveryOutcome, NotificationMessage } from './notification.types';

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
export class EmailChannel implements DeliveryChannel {
  readonly name = 'email';

  constructor(private readonly mail: MailService) {}

  // `schoolId` now matters to this channel too: it is what resolves the
  // school's letterhead and sender (see MailIdentityService), so every
  // composer receives it rather than the mail going out unbranded.
  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    return (await this.attempt(to, message, schoolId)).status === 'SENT';
  }

  async attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome> {
    const out: MailOutcomeSink = {};
    const ok = await this.compose(to, message, schoolId, out);
    const o = out.outcome;
    // A composer stub (tests) or an older path that never fills the sink:
    // trust the boolean, and call a silent false a retry.
    if (!o) return ok ? { status: 'SENT' } : { status: 'RETRY', error: 'mail was not sent' };
    return o.status === 'SENT' ? { status: 'SENT', providerId: o.providerId } : o;
  }

  private compose(to: string, message: NotificationMessage, schoolId: string, out: MailOutcomeSink): Promise<boolean> {
    switch (message.kind) {
      case 'TEST_SCHEDULED':
        return this.mail.sendTestScheduled(to, message.payload, schoolId, out);
      case 'TEST_REMINDER':
        return this.mail.sendTestReminder(to, message.payload, schoolId, out);
      case 'RESULTS_PUBLISHED':
        return this.mail.sendResultsPublished(to, message.payload, schoolId, out);
      case 'ABSENCE_NOTICE':
        return this.mail.sendAbsenceNotice(to, message.payload, schoolId, out);
      case 'ANNOUNCEMENT':
        return this.mail.sendAnnouncement(to, message.payload, schoolId, out);
      case 'DIARY_REMARK':
        return this.mail.sendDiaryRemark(to, message.payload, schoolId, out);
      case 'LOW_ATTENDANCE':
        return this.mail.sendLowAttendance(to, message.payload, schoolId, out);
      case 'LEAVE_APPLIED':
        return this.mail.sendLeaveApplied(to, message.payload, schoolId, out);
      case 'LEAVE_DECIDED':
        return this.mail.sendLeaveDecided(to, message.payload, schoolId, out);
      case 'COVER_ASSIGNED':
        return this.mail.sendCoverAssigned(to, message.payload, schoolId, out);
      case 'LEAVE_CANCELLED':
        return this.mail.sendLeaveCancelled(to, message.payload, schoolId, out);
      case 'COVER_CANCELLED':
        return this.mail.sendCoverCancelled(to, message.payload, schoolId, out);
      case 'COVER_UNFILLED':
        return this.mail.sendCoverUnfilled(to, message.payload, schoolId, out);
      default: {
        // Exhaustiveness guard — a new NotificationKind must be handled above.
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }
}
