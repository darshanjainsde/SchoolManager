import { Injectable, Logger } from '@nestjs/common';
import { runInBackground } from '../../common/notifications/run-in-background';
import { getPlatformPrisma } from '@skoolos/db';
import { assertNotificationOutboxKind, type NotificationOutboxKind } from '@skoolos/types';
import { PushChannel } from '../../common/notifications/push.channel';
import { resolveSectionRecipients, resolveUserRecipients } from '../../common/notifications/recipients';
import type {
  MessageReceivedOutboxPayload,
  AssignmentPostedOutboxPayload,
  ExamScheduledOutboxPayload,
  LibraryNoticeOutboxPayload,
  NotificationMessage,
  ResultPublishedOutboxPayload,
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
 * Maps a drained row's `kind` + denormalised `payload` onto the SAME
 * `NotificationMessage` shape `PushChannel`/`formatNotification` already
 * render for TEST_SCHEDULED/RESULTS_PUBLISHED emails — deliberately reusing
 * that existing text template rather than inventing a second copy of the
 * wording here. `ExamScheduledOutboxPayload`/`ResultPublishedOutboxPayload`
 * are supersets of `TestScheduledPayload`/`ResultsPublishedPayload` (extra
 * `classSectionName`/`maxMarks` fields the push text doesn't render today),
 * so building the narrower message is a plain field pick, not a lookup.
 */
function toNotificationMessage(kind: NotificationOutboxKind, payload: unknown): NotificationMessage {
  if (kind === 'EXAM_SCHEDULED') {
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
  if (kind === 'RESULT_PUBLISHED') {
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
  if (kind === 'LIBRARY_NOTICE') {
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
      },
    };
  }
  if (kind === 'MESSAGE_RECEIVED') {
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
      },
    };
  }

  // ASSIGNMENT_POSTED has no NotificationKind/template of its own (see
  // AssignmentPostedOutboxPayload's docstring) — it renders through the
  // EXISTING 'ANNOUNCEMENT' shape instead, the same "reuse the template"
  // move as the two branches above.
  const p = payload as AssignmentPostedOutboxPayload;
  return {
    kind: 'ANNOUNCEMENT',
    payload: {
      schoolName: p.schoolName,
      title: p.assignmentTitle,
      body: `${p.subjectName} — due ${p.dueDate}`,
      className: p.classSectionName,
    },
  };
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
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(private readonly push: PushChannel) {}

  /**
   * Drain shortly, without blocking the caller.
   *
   * The cron is the safety net, not the delivery path. On a Vercel Hobby plan
   * it CANNOT be the delivery path: Hobby rejects any cron more frequent than
   * daily at deploy time, and fires it anywhere within the scheduled hour. A
   * notification enqueued at 09:00 would wait until the small hours.
   *
   * `runInBackground` wraps Vercel's `waitUntil`, so the work survives the
   * response being sent instead of being frozen with the instance. Failures are
   * swallowed: the row is still in the outbox and the cron will retry it, so a
   * failed opportunistic drain costs latency, never delivery.
   *
   * Safe to call concurrently with the cron — the drain claims its batch with
   * FOR UPDATE SKIP LOCKED, so two runs never take the same row.
   */
  drainSoon(): void {
    runInBackground(
      () => this.drain(),
      (e) => this.logger.warn(`opportunistic outbox drain failed: ${(e as Error)?.message}`),
    );
  }

  async drain(): Promise<NotificationOutboxDrainResult> {
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

    // Sequential, not `Promise.allSettled` batches like ExamRemindersService:
    // this drain is expected to run every few minutes (a much smaller window
    // per run than the daily reminder scan), so a simple loop stays well
    // inside maxDuration without the added complexity of chunking. One bad
    // row's `catch` below still can never block the rest of the batch.
    for (const row of rows) {
      try {
        assertNotificationOutboxKind(row.kind);
        const message = toNotificationMessage(row.kind, row.payload);
        // Private messages (targetUserId set) push to that one recipient;
        // broadcast kinds resolve the whole class section as before.
        const recipients = row.targetUserId
          ? await resolveUserRecipients(db, row.schoolId, row.targetUserId)
          : row.classSectionId
            ? await resolveSectionRecipients(db, row.schoolId, row.classSectionId)
            : [];

        for (const email of recipients) {
          await this.push.send(email, message, row.schoolId);
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

    const purged = await this.purgeDelivered(db);

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
