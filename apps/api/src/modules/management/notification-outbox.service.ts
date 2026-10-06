import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readableIstDate } from '../../common/dates/timetable-date';
import { registerOutboxDrainer, requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { getPlatformPrisma } from '@skoolos/db';
import { assertNotificationOutboxKind, type NotificationOutboxKind } from '@skoolos/types';
import { EmailChannel } from '../../common/notifications/email.channel';
import { PushChannel } from '../../common/notifications/push.channel';
import { WhatsAppChannel } from '../../common/notifications/whatsapp.channel';
import { ackPayload, leavePayload } from '../../common/notifications/whatsapp/actions';
import { resolveSectionRecipients, resolveUserRecipients } from '../../common/notifications/recipients';
import type {
  MessageReceivedOutboxPayload,
  AssignmentPostedOutboxPayload,
  ExamScheduledOutboxPayload,
  LibraryNoticeOutboxPayload,
  FeeDecisionOutboxPayload,
  NotificationMessage,
  ResultPublishedOutboxPayload,
  SessionStartedOutboxPayload,
  SportsNoticeOutboxPayload,
} from '../../common/notifications/notification.types';

export interface NotificationOutboxDrainResult {
  processed: number;
  sent: number;
  failed: number;
  /** Delivered rows removed by the retention sweep — see `purgeDelivered()`. */
  purged: number;
}

/**
 * Hard ceiling on rows drained per run, mirroring `ExamRemindersService`'s
 * `MAX_EXAMS_PER_RUN` — the serverless function has `maxDuration: 60`
 * (apps/api/vercel.json), so an unbounded scan could be killed mid-run.
 * Truncation is logged loudly rather than happening invisibly; the next run
 * (this cron is scheduled frequently — see vercel.json) picks up the rest.
 */
const DRAIN_BATCH_CAP = 200;

/**
 * A row that has failed this many times is left unsent rather than retried
 * forever — the drain's `findMany` excludes it (`attempts: { lt: MAX_ATTEMPTS
 * }`), leaving it in place with `lastError` set for an operator to inspect
 * and requeue by hand (there is no automatic dead-letter table — decided
 * long ago, "no Kafka", keep it small).
 */
const MAX_ATTEMPTS = 5;

/**
 * How long a claim is honoured before another drain may take the row.
 *
 * A drain that crashes between claiming and finishing leaves `claimedAt` set
 * forever, so without a ceiling the row would never be retried. Five minutes is
 * comfortably longer than a full DRAIN_BATCH_CAP run (sequential push sends,
 * bounded by the function's maxDuration of 60s) and short enough that a genuine
 * crash costs one cron cycle, not a day.
 */
const CLAIM_TTL_MS = 5 * 60_000;

/**
 * Delivered rows are kept this long, then removed.
 *
 * This is a queue table, and nothing had ever deleted from it: every push ever
 * sent was still sitting here, so the table and its indexes only ever grew,
 * and the drain's own scan got slower for exactly as long as the product ran.
 * Thirty days is chosen to outlast any plausible "did the parents actually get
 * told?" question while keeping the working set small.
 *
 * WHAT THIS CAN AND CANNOT DELETE. The filter is `sentAt < cutoff`. In SQL a
 * comparison against NULL is NULL, never true, so a row that has not been
 * delivered — `sentAt IS NULL`, including one parked at MAX_ATTEMPTS with a
 * `lastError` for an operator to inspect — can never match this predicate, no
 * matter how old it is. Undelivered work is therefore never purged, which is
 * the property that makes running this on every drain safe rather than merely
 * convenient.
 */
const PURGE_DELIVERED_AFTER_DAYS = 30;

/**
 * Which outbox kinds the DRAIN emails. False means the writer already sends
 * its own email, and the drain sending one too would reach the family twice.
 * Tier 1 replaces this table with one NotificationDelivery row per channel.
 */
export const OUTBOX_EMAIL: Record<NotificationOutboxKind, boolean> = {
  RESULT_PUBLISHED: false, // ExamsService.publish → notify(EMAIL_ONLY)
  EXAM_SCHEDULED: false, // ExamsService.create → notify(EMAIL_ONLY)
  LIBRARY_NOTICE: false, // all three library writers send their own letter
  SESSION_STARTED: false, // SessionsService.afterStart → sendSessionStarted
  ASSIGNMENT_POSTED: true,
  MESSAGE_RECEIVED: true,
  SPORTS_NOTICE: true, // a record letter sets `emailed: true` on its payload
  FEE_VERIFIED: true,
  FEE_REJECTED: true,
  FEE_DUE: true,
  LEAVE_APPLIED: true,
  LEAVE_DECIDED: true,
  COVER_ASSIGNED: true,
  CONCERN_RAISED: true,
  CONCERN_REPLIED: true,
  CONCERN_RESOLVED: true,
};

/** Leaves 20 s of the function's 60 s for the bookkeeping and the purge. */
export const DRAIN_TIME_BUDGET_MS = 40_000;

/**
 * Maps a drained row's `kind` + denormalised `payload` onto the SAME
 * `NotificationMessage` shape `PushChannel`/`formatNotification` already
 * render for TEST_SCHEDULED/RESULTS_PUBLISHED emails — deliberately reusing
 * that existing text template rather than inventing a second copy of the
 * wording here. `ExamScheduledOutboxPayload`/`ResultPublishedOutboxPayload`
 * are supersets of `TestScheduledPayload`/`ResultsPublishedPayload` (extra
 * `classSectionName`/`maxMarks` fields the push text doesn't render today),
 * so building the narrower message is a plain field pick, not a lookup.
 */
export function toNotificationMessage(kind: NotificationOutboxKind, payload: unknown, postedOn = readableIstDate()): NotificationMessage {
  switch (kind) {
    case 'EXAM_SCHEDULED': {
      const p = payload as ExamScheduledOutboxPayload;
      return {
        kind: 'TEST_SCHEDULED',
        payload: {
          schoolName: p.schoolName,
          subjectName: p.subjectName,
          examTitle: p.examTitle,
          scheduledAt: p.scheduledAt,
          classSectionName: p.classSectionName,
        },
      };
    }
    case 'RESULT_PUBLISHED': {
      const p = payload as ResultPublishedOutboxPayload;
      return {
        kind: 'RESULTS_PUBLISHED',
        payload: {
          schoolName: p.schoolName,
          subjectName: p.subjectName,
          examTitle: p.examTitle,
        },
      };
    }
    case 'LIBRARY_NOTICE': {
      // Composed entirely at write time by the library module; renders through
      // the EXISTING 'ANNOUNCEMENT' shape like the branches below. Always a
      // single-reader row (targetUserId).
      const p = payload as LibraryNoticeOutboxPayload;
      return {
        kind: 'ANNOUNCEMENT',
        payload: {
          schoolName: p.schoolName,
          title: p.title,
          body: p.body,
          className: 'Library',
          postedOn,
        },
      };
    }
    case 'LEAVE_APPLIED': {
      // The button payloads are signed HERE, at send time, with the app secret
      // — never stored on the row.
      const p = payload as { schoolName: string; leaveId: string; teacherName: string; dates: string; days: number; reason: string | null; periodsAffected: number };
      const secret = process.env.META_APP_SECRET?.trim() || 'unset';
      return { kind: 'LEAVE_APPLIED', payload: { ...p, approvePayload: leavePayload('approve', p.leaveId, secret), rejectPayload: leavePayload('reject', p.leaveId, secret) } };
    }
    case 'LEAVE_DECIDED': {
      const p = payload as { schoolName: string; leaveId: string; decision: 'APPROVED' | 'REJECTED'; dates: string; byName: string | null };
      return { kind: 'LEAVE_DECIDED', payload: { schoolName: p.schoolName, leaveId: p.leaveId, decision: p.decision, dates: p.dates, byName: p.byName ?? null } };
    }
    case 'COVER_ASSIGNED': {
      const p = payload as { schoolName: string; substitutionId: string; when: string; className: string; subjectName: string | null; originalTeacherName: string };
      const secret = process.env.META_APP_SECRET?.trim() || 'unset';
      return { kind: 'COVER_ASSIGNED', payload: { ...p, ackPayload: ackPayload(p.substitutionId, secret) } };
    }
    case 'FEE_VERIFIED':
    case 'FEE_REJECTED':
    case 'FEE_DUE': {
      // The fee desk's decision to one family, composed at write time by
      // FeePaymentService. Renders through the ANNOUNCEMENT shape like the
      // other single-reader kinds; the class slot names the desk.
      const p = payload as FeeDecisionOutboxPayload;
      return {
        kind: 'ANNOUNCEMENT',
        payload: { schoolName: p.schoolName, title: p.title, body: p.body, className: 'Fees', postedOn },
      };
    }
    case 'SESSION_STARTED': {
      // The year end: "Aarav is in 6 A for 2026-27" to one family (targetUserId).
      const p = payload as SessionStartedOutboxPayload;
      return {
        kind: 'ANNOUNCEMENT',
        payload: { schoolName: p.schoolName, title: p.title, body: p.body, className: null, postedOn },
      };
    }
    case 'CONCERN_RAISED':
    case 'CONCERN_REPLIED':
    case 'CONCERN_RESOLVED': {
      // The Complaint Box, to one reader (targetUserId): the class teacher or
      // an admin when a family raises one, the family when the school answers.
      // Renders through the generic single-reader ANNOUNCEMENT shape; the class
      // slot names the desk, as the fee kinds do.
      const p = payload as { schoolName: string; title: string; body: string };
      return {
        kind: 'ANNOUNCEMENT',
        payload: { schoolName: p.schoolName, title: p.title, body: p.body, className: 'Complaint Box', postedOn },
      };
    }
    case 'MESSAGE_RECEIVED': {
      // Also renders through the EXISTING 'ANNOUNCEMENT' shape (no dedicated
      // template) — see MessageReceivedOutboxPayload. This row targets a single
      // user via row.targetUserId (handled in drain()), not a class section.
      const p = payload as MessageReceivedOutboxPayload;
      return {
        kind: 'ANNOUNCEMENT',
        payload: {
          schoolName: p.schoolName,
          title: `New message from ${p.senderName}`,
          body: p.preview,
          className: p.subjectName,
          postedOn,
        },
      };
    }
    case 'SPORTS_NOTICE': {
      // Until 2026-10-06 this kind had no branch and fell into the assignment
      // default: four call sites sent "undefined" to parents.
      const p = payload as SportsNoticeOutboxPayload;
      return { kind: 'ANNOUNCEMENT', payload: { schoolName: p.schoolName ?? '', title: p.title, body: p.body, className: 'Sports', postedOn } };
    }
    case 'ASSIGNMENT_POSTED': {
      // ASSIGNMENT_POSTED has no NotificationKind/template of its own (see
      // AssignmentPostedOutboxPayload's docstring) — it renders through the
      // EXISTING 'ANNOUNCEMENT' shape instead, the same "reuse the template"
      // move as the cases above.
      const p = payload as AssignmentPostedOutboxPayload;
      return {
        kind: 'ANNOUNCEMENT',
        payload: {
          schoolName: p.schoolName,
          title: p.assignmentTitle,
          body: `${p.subjectName} — due ${p.dueDate}`,
          className: p.classSectionName,
          postedOn,
        },
      };
    }
    default: {
      const never: never = kind;
      throw new Error(`No message for outbox kind "${String(never)}"`);
    }
  }
}

/**
 * Drains the `NotificationOutbox` (S6/S7 wiring — see the model's docstring
 * in packages/db/prisma/schema.prisma and `ExamsService.create()`/`publish()`,
 * which write the rows this reads). Triggered by
 * `NotificationOutboxController` (`internal/cron/notification-outbox`), the
 * SAME `CronSecretGuard` pattern as `ExamRemindersService`.
 *
 * Runs on the platform (RLS-BYPASSING) Prisma client — like
 * `ExamRemindersService`, there is no tenant/JWT context for a cron
 * invocation, and `NotificationOutbox` rows span every school. Every
 * downstream lookup is still explicitly scoped by the row's own `schoolId`
 * (`resolveSectionRecipients`, `PushChannel.send`'s own `schoolId` filter).
 *
 * DELIVERY GUARANTEE IS AT-LEAST-ONCE, NOT EXACTLY-ONCE: the push send and
 * the `sentAt` write below are two separate steps, not one atomic unit (Expo
 * push has no transactional participation). If this process crashes AFTER a
 * successful `push.send()` but BEFORE the `sentAt` update commits, the row is
 * still `sentAt: null` and the NEXT drain run will resend it — a duplicate
 * "results published" push in that narrow crash window. This is the
 * documented tradeoff from the pitch ("never notified twice" refers to the
 * ORDINARY case — a row is marked sent immediately after a successful send,
 * so a normal re-run never re-touches it); we accept the rare at-least-once
 * duplicate rather than risk the opposite (a crash before `sentAt` commits
 * silently losing the notification forever, which a naive "mark sent before
 * sending" ordering would risk instead).
 */
/** Exactly the columns the claim statement returns. */
interface OutboxRow {
  id: string;
  schoolId: string;
  kind: string;
  payload: unknown;
  classSectionId: string | null;
  targetUserId: string | null;
}

@Injectable()
export class NotificationOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxService.name);

  // WhatsApp rides the outbox for the same reason push does: these kinds are
  // the guaranteed, at-least-once ones. The channel itself decides per
  // school whether anything goes out (see WhatsAppChannel).
  constructor(
    private readonly push: PushChannel,
    private readonly whatsapp: WhatsAppChannel,
    private readonly email: EmailChannel,
  ) {}

  onModuleInit(): void {
    registerOutboxDrainer(() => this.drain({ purge: false }));
  }

  onModuleDestroy(): void {
    registerOutboxDrainer(null);
  }

  /**
   * Drain shortly, without blocking the caller.
   *
   * The cron is the safety net, not the delivery path. On a Vercel Hobby plan
   * it CANNOT be the delivery path: Hobby rejects any cron more frequent than
   * daily at deploy time, and fires it anywhere within the scheduled hour. A
   * notification enqueued at 09:00 would wait until the small hours.
   *
   * The delay (750ms), coalescing, and Vercel's `waitUntil` wrapping now live in
   * `common/notifications/outbox-signal.ts` — the work survives the response
   * being sent instead of being frozen with the instance. Failures are swallowed:
   * the row is still in the outbox and the cron will retry it, so a failed
   * opportunistic drain costs latency, never delivery.
   *
   * Safe to call concurrently with the cron — the drain claims its batch with
   * FOR UPDATE SKIP LOCKED, so two runs never take the same row.
   *
   * Kept for callers that already hold the service; prefer `requestOutboxDrain()`.
   */
  drainSoon(): void {
    requestOutboxDrain();
  }

  /**
   * `purge` is ON for the nightly cron and OFF for `drainSoon()`.
   *
   * The retention sweep filters on `sentAt < cutoff`, and the only index here
   * is `[schoolId, sentAt]` — `sentAt` is not its leading column, so the
   * predicate cannot use it and the delete scans the table. Once a night that
   * costs nothing. On `drainSoon()` it ran on EVERY message sent and every exam
   * created, which is the hot path: a table scan attached to an ordinary
   * request, to reclaim rows that are thirty days old. Delivery is urgent and
   * retention is not, so only the cron sweeps.
   */
  async drain(opts: { purge?: boolean } = {}): Promise<NotificationOutboxDrainResult> {
    const { purge = true } = opts;
    const db = getPlatformPrisma();

    // Claim the batch in ONE statement. `FOR UPDATE SKIP LOCKED` makes a second
    // concurrent drain step over rows this one already holds rather than block
    // on them, and stamping `claimedAt` in the same statement means the claim
    // survives after the row lock is released at commit.
    //
    // Written as raw SQL because Prisma has no way to express SKIP LOCKED. The
    // only interpolated values are bound parameters.
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const rows = await db.$queryRaw<OutboxRow[]>`
      UPDATE "NotificationOutbox" SET "claimedAt" = now()
      WHERE id IN (
        SELECT id FROM "NotificationOutbox"
        WHERE "sentAt" IS NULL
          AND attempts < ${MAX_ATTEMPTS}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${staleBefore})
        ORDER BY "createdAt" ASC
        LIMIT ${DRAIN_BATCH_CAP}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "schoolId", kind, payload, "classSectionId", "targetUserId"
    `;

    if (rows.length === DRAIN_BATCH_CAP) {
      this.logger.warn(
        `Notification outbox drain hit the ${DRAIN_BATCH_CAP}-row cap — some rows remain unsent until the next run.`,
      );
    }

    let sent = 0;
    let failed = 0;

    // Some writers do not carry the school's name on the row (see
    // SportsNoticeOutboxPayload); fill it once per school per run.
    const schoolNames = new Map<string, string>();
    const schoolNameOf = async (id: string) => {
      if (!schoolNames.has(id)) schoolNames.set(id, (await db.school.findFirst({ where: { id }, select: { name: true } }))?.name ?? 'Your school');
      return schoolNames.get(id)!;
    };

    // Sequential, not `Promise.allSettled` batches like ExamRemindersService:
    // this drain is expected to run every few minutes (a much smaller window
    // per run than the daily reminder scan), so a simple loop stays well
    // inside maxDuration without the added complexity of chunking. One bad
    // row's `catch` below still can never block the rest of the batch.
    const started = Date.now();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      // The budget is checked BEFORE a row starts; the row in flight finishes.
      // Rows not started are released in one statement and another drain is asked for.
      if (Date.now() - started > DRAIN_TIME_BUDGET_MS) {
        const rest = rows.slice(i).map((r) => r.id);
        await db.notificationOutbox.updateMany({ where: { id: { in: rest } }, data: { claimedAt: null } });
        this.logger.warn(`Outbox drain stopped at its time budget; ${rest.length} rows released for the next run.`);
        requestOutboxDrain();
        break;
      }
      try {
        assertNotificationOutboxKind(row.kind);
        const message = toNotificationMessage(row.kind, row.payload);
        if (!message.payload.schoolName) message.payload.schoolName = await schoolNameOf(row.schoolId);
        // Private messages (targetUserId set) push to that one recipient;
        // broadcast kinds resolve the whole class section as before.
        const recipients = row.targetUserId
          ? await resolveUserRecipients(db, row.schoolId, row.targetUserId)
          : row.classSectionId
            ? await resolveSectionRecipients(db, row.schoolId, row.classSectionId)
            : [];

        const emailIt = OUTBOX_EMAIL[row.kind] && !(row.payload as { emailed?: boolean } | null)?.emailed;
        for (const to of recipients) {
          await this.push.send(to, message, row.schoolId);
          await this.whatsapp.send(to, message, row.schoolId);
          if (emailIt) {
            // An email failure is logged, never thrown: throwing would retry the
            // whole row and push + WhatsApp would go out a second time.
            await this.email.send(to, message, row.schoolId).catch((e) => this.logger.warn(`outbox email to ${to} failed: ${(e as Error).message}`));
          }
        }

        await db.notificationOutbox.update({
          where: { id: row.id },
          data: { sentAt: new Date() },
        });
        sent += 1;
      } catch (e) {
        failed += 1;
        const errorMessage = (e as Error)?.message ?? 'unknown error';
        this.logger.error(`NotificationOutbox row ${row.id} failed: ${errorMessage}`);
        try {
          await db.notificationOutbox.update({
            where: { id: row.id },
            // claimedAt back to null: this row is released for the next run.
            data: {
              attempts: { increment: 1 },
              lastError: errorMessage.slice(0, 500),
              claimedAt: null,
            },
          });
        } catch (updateError) {
          // Even the failure-bookkeeping write failed — log and move on; the
          // row's `attempts` simply doesn't advance this run, and the next
          // drain retries it from its last known state.
          this.logger.error(
            `Failed to record failure for outbox row ${row.id}: ${(updateError as Error).message}`,
          );
        }
      }
    }

    const purged = purge ? await this.purgeDelivered(db) : 0;

    return { processed: rows.length, sent, failed, purged };
  }

  /**
   * Retention sweep for rows this outbox has already delivered.
   *
   * Runs AFTER the drain and never throws: a failure to tidy up is not a
   * reason to report the delivery run as failed, so it is logged and swallowed
   * and the next run tries again. See `PURGE_DELIVERED_AFTER_DAYS` for why the
   * `sentAt < cutoff` predicate cannot touch undelivered rows.
   */
  private async purgeDelivered(db: ReturnType<typeof getPlatformPrisma>): Promise<number> {
    const cutoff = new Date(Date.now() - PURGE_DELIVERED_AFTER_DAYS * 24 * 60 * 60 * 1000);
    try {
      const { count } = await db.notificationOutbox.deleteMany({
        where: { sentAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`Purged ${count} delivered outbox rows older than ${cutoff.toISOString()}.`);
      }
      return count;
    } catch (e) {
      this.logger.error(`Outbox retention sweep failed: ${(e as Error)?.message ?? 'unknown error'}`);
      return 0;
    }
  }
}
