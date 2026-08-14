import type { AttendanceRatesResult, NotifyLowAttendanceResult } from '@skoolos/types';
import { NotificationService } from '../../common/notifications/notification.service';
import type { NotifyLowAttendanceDto } from './management.dto';
/**
 * A family is never nudged about the same thing twice inside this window. The
 * teacher still sees the child in the list — greyed, with "told 3 days ago" —
 * so the cooldown reads as information, not a disabled button with no reason.
 */
export declare const NOTICE_COOLDOWN_DAYS = 7;
/**
 * The attendance bar under the register (Phase 5·3): every child's attendance
 * percentage for a window, ranked lowest first, with a one-tap private nudge
 * to the families below the teacher's chosen benchmark.
 *
 * PRIVACY IS THE FEATURE. The nudge is one email per family naming only their
 * own child and only their own number — never a class list, never a ranking,
 * never "you are in the bottom five". The teacher sees the whole class; each
 * parent sees exactly one child.
 *
 * `percent` counts PRESENT and LATE as attended: a child who arrived late was
 * in the room, and a benchmark that punished lateness twice (once in the
 * register, once here) would make this list read as a discipline report rather
 * than an attendance one.
 */
export declare class AttendanceBarService {
    private readonly notifications;
    private readonly logger;
    constructor(notifications: NotificationService);
    private assertDate;
    /** Defaults an open-ended window to "the last 90 days, up to today". */
    private resolveWindow;
    /**
     * Per-student attendance over the window. Two queries regardless of class
     * size: one `attendance.groupBy` over the whole section, one roster read —
     * a per-student loop would have scaled with the class.
     */
    rates(schoolId: string, classSectionId: string, userId: string, role: string, opts?: {
        from?: string;
        to?: string;
    }): Promise<AttendanceRatesResult>;
    /**
     * The one-tap nudge. Recomputes every percentage server-side rather than
     * trusting the numbers the client is showing — a stale slider must not be
     * able to email a family whose child has since recovered — then writes an
     * `AttendanceNotice` receipt per family inside the transaction, so the
     * cooldown holds even if two teachers tap at the same moment.
     */
    notifyLow(schoolId: string, userId: string, role: string, dto: NotifyLowAttendanceDto): Promise<NotifyLowAttendanceResult>;
}
//# sourceMappingURL=attendance-bar.service.d.ts.map