import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { assertNotificationOutboxKind, type NotificationOutboxKind } from '@skoolos/types';
import { PushChannel } from '../../common/notifications/push.channel';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import type {
  ExamScheduledOutboxPayload,
  NotificationMessage,
  ResultPublishedOutboxPayload,
} from '../../common/notifications/notification.types';

export interface NotificationOutboxDrainResult {
  processed: number;
  sent: number;
  failed: number;
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
@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(private readonly push: PushChannel) {}

  async drain(): Promise<NotificationOutboxDrainResult> {
    const db = getPlatformPrisma();

    const rows = await db.notificationOutbox.findMany({
      where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: [{ createdAt: 'asc' }],
      take: DRAIN_BATCH_CAP,
    });

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
        const recipients = await resolveSectionRecipients(db, row.schoolId, row.classSectionId);

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
            data: { attempts: { increment: 1 }, lastError: errorMessage.slice(0, 500) },
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

    return { processed: rows.length, sent, failed };
  }
}
