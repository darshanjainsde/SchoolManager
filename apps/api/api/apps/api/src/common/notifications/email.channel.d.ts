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
export declare class EmailChannel implements NotificationChannel {
    private readonly mail;
    readonly name = "email";
    constructor(mail: MailService);
    send(to: string, message: NotificationMessage, _schoolId: string): Promise<boolean>;
}
//# sourceMappingURL=email.channel.d.ts.map