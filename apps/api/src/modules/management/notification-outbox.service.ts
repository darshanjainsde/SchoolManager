import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readableIstDate } from '../../common/dates/timetable-date';
import { INVOCATION_CEILING_MS, ROW_START_RESERVE_MS, registerOutboxDrainer, requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { invocationStartedAt } from '../../common/notifications/invocation-clock';

export { ROW_START_RESERVE_MS } from '../../common/notifications/outbox-signal';
import { getPlatformPrisma, type Prisma } from '@skoolos/db';
import { assertNotificationOutboxKind, type NotificationOutboxKind } from '@skoolos/types';
import { EmailChannel } from '../../common/notifications/email.channel';
import { PushChannel } from '../../common/notifications/push.channel';
import { WhatsAppChannel } from '../../common/notifications/whatsapp.channel';
import { ackPayload, actionKeys, leavePayload } from '../../common/notifications/whatsapp/actions';
import { resolveRecipientUsers } from '../../common/notifications/recipients';
import { isSchemaMissing } from '../../common/errors/prisma-errors';
import type {
  MessageReceivedOutboxPayload,
  AssignmentPostedOutboxPayload,
  DeliveryChannel,
  DeliveryOutcome,
  ExamScheduledOutboxPayload,
  LibraryNoticeOutboxPayload,
  FeeDecisionOutboxPayload,
  NotificationMessage,
  ResultPublishedOutboxPayload,
  SessionStartedOutboxPayload,
  SportsNoticeOutboxPayload,
} from '../../common/notifications/notification.types';

export interface NotificationOutboxDrainResult {
  /** Outbox rows claimed for expansion. */
  processed: number;
  /** Delivery rows created by this drain. */
  expanded: number;
  sent: number;
  /** Deliveries that failed for good, plus outbox rows whose expansion failed. */
  failed: number;
  retried: number;
  skipped: number;
  /** Outbox rows marked sentAt because every delivery reached an end. */
  closed: number;
  /** Delivered rows removed by the retention sweep — see `purgeDelivered()`. */
  purged: number;
  /**
   * Work is probably left: a claim came back full (the outbox batch cap, the
   * delivery batch cap, or one school's per-drain cap) or the deadline / hard
   * stop ended the run. The 10-minute workflow calls the endpoint again while
   * this is true — each call its own invocation, so never a chained drain.
   */
  more: boolean;
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
 * An outbox row whose EXPANSION has failed this many times is left unsent rather than retried
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
 * comfortably longer than a whole drain (bounded by the function's
 * maxDuration of 60s) and short enough that a genuine crash costs one cron
 * cycle, not a day. The same TTL applies to a NotificationDelivery claim.
 *
 * It is also the back-off between EXPANSION attempts: a row whose expansion
 * failed keeps a fresh `claimedAt`, so it is not retried for five minutes.
 * A failed delivery backs off on its own schedule (DELIVERY_BACKOFF_MS).
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

/**
 * How long after it begins a drain may still START work (the default
 * `deadline`): an expansion, or a chunk of DELIVERY_CONCURRENCY sends. It
 * bounds when work may START, not when the drain ends: the chunk in flight
 * always finishes. Each delivery is one send to one person on one channel, so
 * a chunk is short. The 20 s left of the function's 60 s is that chunk's room
 * plus the close step and the purge.
 */
export const DRAIN_TIME_BUDGET_MS = 40_000;

export type DeliveryChannelName = 'EMAIL' | 'PUSH' | 'WHATSAPP';

/**
 * The wait after the 1st … 5th failure of ONE delivery (spec §2.2). The 6th
 * failure is final. Each wait is a floor: the delivery goes on the next drain
 * after it (a write's drain, the 10-minute workflow, or the 02:00 cron).
 */
export const DELIVERY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000] as const;

/** Deliveries claimed per drain. Each is one send, so the batch is bounded by time, not by size. */
export const DELIVERY_BATCH_CAP = 300;

/**
 * No school takes more than this many deliveries of one drain, and the
 * schools are interleaved (each school's 1st due, then each school's 2nd, …).
 * Without it one school's notice to 1,800 children (5,400 deliveries) holds
 * every other school's leave and cover messages behind it for hours.
 */
export const DELIVERY_PER_SCHOOL_CAP = 60;

/**
 * A chunk of sends still in flight this close to the 60 s ceiling is
 * abandoned: the drain stops waiting, releases every delivery it has not
 * started, and returns while it still can. The hung sends keep their claims,
 * so CLAIM_TTL_MS protects them from a second send.
 */
export const HARD_STOP_MARGIN_MS = 5_000;

/** Sends in flight at once. SMTP is the slow leg; five keeps a class inside one drain. */
export const DELIVERY_CONCURRENCY = 5;

/** The channels a row fans out to. Email only where the writer does not send its own. */
export function channelsFor(kind: NotificationOutboxKind, payload: unknown): DeliveryChannelName[] {
  const email = OUTBOX_EMAIL[kind] && !(payload as { emailed?: boolean } | null)?.emailed;
  return email ? ['PUSH', 'WHATSAPP', 'EMAIL'] : ['PUSH', 'WHATSAPP'];
}

/** Postgres: undefined_table / undefined_column. */
const SCHEMA_MISSING_SQLSTATES = new Set(['42P01', '42703']);

/**
 * The database is behind the code: the NotificationDelivery table or the
 * `expandedAt` column is not there yet. Production deploys code BEFORE the
 * owner runs the migration, so this is an expected state, not a failure.
 * A delegate call reports it as P2021/P2022; a raw statement as P2010 with
 * the Postgres SQLSTATE in `meta.code`.
 */
function isDeliverySchemaMissing(e: unknown): boolean {
  if (isSchemaMissing(e)) return true;
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown };
  if (typeof err.code === 'string' && SCHEMA_MISSING_SQLSTATES.has(err.code)) return true;
  if (typeof err.meta?.code === 'string' && SCHEMA_MISSING_SQLSTATES.has(err.meta.code)) return true;
  return typeof err.message === 'string' && /\b(42P01|42703)\b/.test(err.message);
}

/** An error message as stored on a row: never undefined, never longer than 500. */
function clip(message: unknown): string {
  return String(message ?? 'unknown error').slice(0, 500);
}

/**
 * Resolves true when `work` settles before the epoch-ms `hardStop`, false when
 * the stop comes first. The timer is always cleared, so nothing is left pending.
 */
async function finishesBefore(work: Promise<unknown>, hardStop: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, hardStop - Date.now()));
  });
  try {
    return await Promise.race([work.then(() => true as const), stop]);
  } finally {
    clearTimeout(timer);
  }
}

/** `ids` of a batch grouped by the school they belong to, so every lookup carries its schoolId. */
function groupBySchool<T extends { schoolId: string }>(items: T[], idOf: (item: T) => string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const item of items) {
    const ids = out.get(item.schoolId) ?? new Set<string>();
    ids.add(idOf(item));
    out.set(item.schoolId, ids);
  }
  return out;
}

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
      // The button payloads are signed HERE, at send time, with the action key
      // — never stored on the row.
      const p = payload as { schoolName: string; leaveId: string; teacherName: string; dates: string; days: number; reason: string | null; periodsAffected: number };
      const keys = actionKeys();
      return { kind: 'LEAVE_APPLIED', payload: { ...p, approvePayload: leavePayload('approve', p.leaveId, keys), rejectPayload: leavePayload('reject', p.leaveId, keys) } };
    }
    case 'LEAVE_DECIDED': {
      const p = payload as { schoolName: string; leaveId: string; decision: 'APPROVED' | 'REJECTED'; dates: string; byName: string | null };
      return { kind: 'LEAVE_DECIDED', payload: { schoolName: p.schoolName, leaveId: p.leaveId, decision: p.decision, dates: p.dates, byName: p.byName ?? null } };
    }
    case 'COVER_ASSIGNED': {
      const p = payload as { schoolName: string; substitutionId: string; when: string; className: string; subjectName: string | null; originalTeacherName: string };
      const keys = actionKeys();
      return { kind: 'COVER_ASSIGNED', payload: { ...p, ackPayload: ackPayload(p.substitutionId, keys) } };
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
        payload: {
          schoolName: p.schoolName,
          title: p.title,
          body: p.body,
          className: 'Fees',
          postedOn,
          // Only the due-date reminder has a narrow template; a decision on a claim stays general.
          topic: kind === 'FEE_DUE' && p.termName && p.dueOn ? { kind: 'FEE', term: p.termName, dueOn: p.dueOn } : null,
        },
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
 * (`resolveRecipientUsers`, the login lookup, every single-row update).
 *
 * DELIVERY GUARANTEE. Still at-least-once, and now per delivery: a send and
 * the write that records it are two steps, so a crash between them repeats
 * THAT ONE delivery after CLAIM_TTL_MS — never the row, never the class. An
 * outbox row is expanded once (expandedAt) and closed (sentAt) when none of
 * its deliveries is still QUEUED or HELD.
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

/** Exactly the columns the delivery claim returns. */
interface ClaimedDelivery {
  id: string;
  schoolId: string;
  outboxId: string;
  userId: string;
  channel: string;
  attempts: number;
  /** The exact stamp this drain's claim wrote; the status write only lands while the row still carries it. */
  claimedAt: Date;
}

interface OutboxSummary {
  id: string;
  schoolId: string;
  kind: string;
  payload: unknown;
}

type Db = ReturnType<typeof getPlatformPrisma>;

@Injectable()
export class NotificationOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxService.name);
  /** The "migration not applied yet" warning is said once per instance, not on every write's drain. */
  private schemaMissingLogged = false;

  // WhatsApp rides the outbox for the same reason push does: these kinds are
  // the guaranteed, at-least-once ones. The channel itself decides per
  // school whether anything goes out (see WhatsAppChannel).
  constructor(
    private readonly push: PushChannel,
    private readonly whatsapp: WhatsAppChannel,
    private readonly email: EmailChannel,
  ) {}

  onModuleInit(): void {
    registerOutboxDrainer((o) => this.drain({ purge: false, deadline: o.deadline }));
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
  async drain(opts: { purge?: boolean; deadline?: number } = {}): Promise<NotificationOutboxDrainResult> {
    const { purge = true } = opts;
    // `deadline` is the epoch-ms time after which this drain must not START a
    // send. Whatever the caller asks for, never start one with fewer than
    // ROW_START_RESERVE_MS left of the invocation's 60 s ceiling.
    //
    // The 60 s counts from when the INVOCATION began (see invocation-clock.ts),
    // not from when this drain did; with no invocation known (a script, a
    // test) it counts from here.
    const started = Date.now();
    const anchor = invocationStartedAt() ?? started;
    const deadline = Math.min(opts.deadline ?? started + DRAIN_TIME_BUDGET_MS, anchor + INVOCATION_CEILING_MS - ROW_START_RESERVE_MS);
    // Past this, a chunk still in flight is no longer waited for.
    const hardStop = anchor + INVOCATION_CEILING_MS - HARD_STOP_MARGIN_MS;
    const db = getPlatformPrisma();
    const result: NotificationOutboxDrainResult = { processed: 0, expanded: 0, sent: 0, failed: 0, retried: 0, skipped: 0, closed: 0, purged: 0, more: false };

    try {
      await this.expand(db, deadline, result);
      // Expansion may have used the whole budget; then no delivery is claimed
      // (a claim this drain cannot work would only sit out the TTL).
      if (Date.now() >= deadline) {
        result.more = true;
      } else {
        await this.sendDue(db, deadline, hardStop, result);
      }
    } catch (e) {
      if (!isDeliverySchemaMissing(e)) throw e;
      // Deploy before migrate: the code is live, the NotificationDelivery
      // table / expandedAt column is not. Say so once and leave every row as
      // it is — the first drain after the migration picks them all up.
      if (!this.schemaMissingLogged) {
        this.schemaMissingLogged = true;
        this.logger.warn(`Notification delivery migration not applied yet — outbox rows wait untouched until it is (${(e as Error)?.message ?? 'schema missing'}).`);
      }
      return { ...result, more: false };
    }
    result.closed = await this.closeFinished(db);
    result.purged = purge ? await this.purgeDelivered(db) : 0;
    return result;
  }

  /**
   * Step 1: turn unexpanded outbox rows into delivery rows. Cheap — a
   * recipient lookup and one createMany per row — and idempotent: the
   * (outboxId, userId, channel) unique plus skipDuplicates makes a re-run
   * after a crash a no-op.
   */
  private async expand(db: Db, deadline: number, result: NotificationOutboxDrainResult): Promise<void> {
    // Claim the batch in ONE statement. `FOR UPDATE SKIP LOCKED` makes a second
    // concurrent drain step over rows this one already holds rather than block
    // on them, and stamping `claimedAt` in the same statement means the claim
    // survives after the row lock is released at commit. Raw SQL because
    // Prisma cannot express SKIP LOCKED; every interpolation is a bound
    // parameter. CROSS-TENANT ON PURPOSE: the queue spans every school, so
    // this claim cannot carry one schoolId — everything after it does.
    // JS time, never the database's now(). The columns are `timestamp`
    // WITHOUT time zone holding UTC wall-clock (what Prisma writes), and
    // Prisma binds a Date as `timestamptz` — so every bound time is cast
    // `::timestamptz AT TIME ZONE 'UTC'`. Without the cast Postgres compares
    // (and assigns) in the SESSION time zone: on an IST session that moved
    // every TTL and backoff by 5 h 30 m (measured on a scratch database).
    const now = new Date(Date.now());
    const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS);
    const rows = await db.$queryRaw<OutboxRow[]>`
      UPDATE "NotificationOutbox" SET "claimedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
      WHERE id IN (
        SELECT id FROM "NotificationOutbox"
        WHERE "sentAt" IS NULL
          AND "expandedAt" IS NULL
          AND attempts < ${MAX_ATTEMPTS}
          AND ("claimedAt" IS NULL OR "claimedAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC'))
        ORDER BY "createdAt" ASC
        LIMIT ${DRAIN_BATCH_CAP}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "schoolId", kind, payload, "classSectionId", "targetUserId"
    `;
    result.processed = rows.length;
    if (rows.length === DRAIN_BATCH_CAP) {
      result.more = true;
      this.logger.warn(`Outbox expansion hit the ${DRAIN_BATCH_CAP}-row cap — the rest wait for the next drain.`);
    }

    for (let i = 0; i < rows.length; i += 1) {
      if (Date.now() >= deadline) {
        const rest = rows.slice(i).map((r) => r.id);
        // By id list across schools, like the claim that produced it.
        result.more = true;
        await db.notificationOutbox.updateMany({ where: { id: { in: rest } }, data: { claimedAt: null } });
        this.logger.warn(`Outbox expansion stopped at its deadline; ${rest.length} rows released for the next run.`);
        return;
      }
      const row = rows[i];
      try {
        assertNotificationOutboxKind(row.kind);
        const users = await resolveRecipientUsers(db, row.schoolId, { targetUserId: row.targetUserId, classSectionId: row.classSectionId });
        const channels = channelsFor(row.kind, row.payload);
        const data = users.flatMap((userId) => channels.map((channel) => ({ schoolId: row.schoolId, outboxId: row.id, userId, channel })));
        if (data.length > 0) {
          const { count } = await db.notificationDelivery.createMany({ data, skipDuplicates: true });
          result.expanded += count;
        }
        await db.notificationOutbox.update({ where: { id: row.id, schoolId: row.schoolId }, data: { expandedAt: new Date(), claimedAt: null } });
      } catch (e) {
        if (isDeliverySchemaMissing(e)) {
          // Not this row's fault, so no attempt is burned: hand the claims
          // back and let drain() return quietly.
          const rest = rows.slice(i).map((r) => r.id);
          try {
            await db.notificationOutbox.updateMany({ where: { id: { in: rest } }, data: { claimedAt: null } });
          } catch {
            // The claims simply lapse after CLAIM_TTL_MS.
          }
          throw e;
        }
        result.failed += 1;
        const errorMessage = (e as Error)?.message ?? 'unknown error';
        this.logger.error(`NotificationOutbox row ${row.id} could not be expanded: ${errorMessage}`);
        try {
          // claimedAt is re-stamped NOW, not cleared: holding the claim makes
          // CLAIM_TTL_MS the back-off between expansion attempts.
          await db.notificationOutbox.update({
            where: { id: row.id, schoolId: row.schoolId },
            data: { attempts: { increment: 1 }, lastError: errorMessage.slice(0, 500), claimedAt: new Date() },
          });
        } catch (updateError) {
          this.logger.error(`Failed to record failure for outbox row ${row.id}: ${(updateError as Error).message}`);
        }
      }
    }
  }

  /**
   * Step 2: claim due deliveries and send each through its own channel.
   *
   * FAIR ACROSS SCHOOLS. `due` numbers each school's due rows by
   * nextAttemptAt; `picked` keeps each school's first DELIVERY_PER_SCHOOL_CAP
   * and interleaves the schools (every school's 1st, then every 2nd, …) up to
   * DELIVERY_BATCH_CAP. The lock is taken on a plain table SELECT — Postgres
   * refuses FOR UPDATE beside a window function — and re-checks status and
   * claimedAt, so a row another drain claimed since `due` was read is skipped
   * (locked) or filtered out (committed), never claimed twice.
   */
  private async sendDue(db: Db, deadline: number, hardStop: number, result: NotificationOutboxDrainResult): Promise<void> {
    // CROSS-TENANT ON PURPOSE, like the outbox claim: due deliveries of every
    // school, by id. Each returned row carries its schoolId, and every query
    // and write after this one is scoped by it. JS time throughout, cast to
    // UTC wall-clock, never the database's now() (see expand()).
    const now = new Date(Date.now());
    const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS);
    const due = await db.$queryRaw<ClaimedDelivery[]>`
      WITH due AS (
        SELECT id, "nextAttemptAt",
               ROW_NUMBER() OVER (PARTITION BY "schoolId" ORDER BY "nextAttemptAt" ASC, id ASC) AS rn
        FROM "NotificationDelivery"
        WHERE status IN ('QUEUED', 'HELD')
          AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
          AND ("claimedAt" IS NULL OR "claimedAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC'))
      ),
      picked AS (
        SELECT id FROM due
        WHERE rn <= ${DELIVERY_PER_SCHOOL_CAP}
        ORDER BY rn ASC, "nextAttemptAt" ASC
        LIMIT ${DELIVERY_BATCH_CAP}
      )
      UPDATE "NotificationDelivery" SET "claimedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
      WHERE id IN (
        SELECT id FROM "NotificationDelivery"
        WHERE id IN (SELECT id FROM picked)
          AND status IN ('QUEUED', 'HELD')
          AND ("claimedAt" IS NULL OR "claimedAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC'))
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "schoolId", "outboxId", "userId", channel, attempts, "claimedAt"
    `;
    if (due.length === DELIVERY_BATCH_CAP || [...groupBySchool(due, (d) => d.id).values()].some((ids) => ids.size >= DELIVERY_PER_SCHOOL_CAP)) {
      result.more = true;
    }
    if (due.length === 0) return;

    let outboxes: Map<string, OutboxSummary>;
    let emails: Map<string, string>;
    try {
      const bySchool = groupBySchool(due, (d) => d.outboxId);
      outboxes = new Map(
        (
          await db.notificationOutbox.findMany({
            where: { OR: [...bySchool].map(([schoolId, ids]) => ({ schoolId, id: { in: [...ids] } })) },
            select: { id: true, schoolId: true, kind: true, payload: true },
          })
        ).map((o) => [o.id, o as OutboxSummary]),
      );
      emails = await this.emailsOf(db, due);
    } catch (e) {
      // A failed lookup is not any delivery's fault: hand the claims back
      // (no attempt counted) and let the next drain try the batch.
      this.logger.error(`Delivery lookups failed; ${due.length} deliveries released: ${(e as Error)?.message}`);
      await this.release(db, due.map((d) => d.id));
      // Nothing was worked, and the lookups are failing: a workflow that chained
      // on `more` would hammer the API through an outage. The next scheduled run
      // retries the released rows.
      result.more = false;
      return;
    }
    const messageFor = this.messageCache(db);

    for (let i = 0; i < due.length; i += DELIVERY_CONCURRENCY) {
      // The deadline is checked before a chunk starts; a chunk in flight finishes.
      // No chained drain: this invocation is near its ceiling. The next write's
      // drain, the 10-minute workflow or the cron picks the released rows up.
      if (Date.now() >= deadline) {
        const rest = due.slice(i).map((d) => d.id);
        result.more = true;
        await this.release(db, rest);
        this.logger.warn(`Delivery drain stopped at its deadline; ${rest.length} deliveries released for the next run.`);
        return;
      }
      const chunk = Promise.all(
        due.slice(i, i + DELIVERY_CONCURRENCY).map(async (d) => {
          const outcome = await this.attemptOne(d, outboxes.get(d.outboxId), emails.get(`${d.schoolId}:${d.userId}`), messageFor);
          await this.record(db, d, outcome, result);
        }),
      );
      if (!(await finishesBefore(chunk, hardStop))) {
        // A send has hung. Stop waiting before the function is killed: the
        // unstarted deliveries go back to the queue now; the hung ones keep
        // their claims, so the TTL stands between them and a second send.
        const rest = due.slice(i + DELIVERY_CONCURRENCY).map((d) => d.id);
        result.more = true;
        if (rest.length > 0) await this.release(db, rest);
        this.logger.error(`A delivery chunk was still in flight at the hard stop; ${rest.length} unstarted deliveries released.`);
        return;
      }
    }
  }

  /** Clears claims by id across schools — the same id list the claim returned. Never throws. */
  private async release(db: Db, ids: string[]): Promise<void> {
    try {
      await db.notificationDelivery.updateMany({ where: { id: { in: ids } }, data: { claimedAt: null } });
    } catch (e) {
      this.logger.error(`Releasing ${ids.length} delivery claims failed; they lapse after the claim TTL: ${(e as Error)?.message}`);
    }
  }

  private channelFor(name: string): DeliveryChannel | null {
    if (name === 'PUSH') return this.push;
    if (name === 'WHATSAPP') return this.whatsapp;
    if (name === 'EMAIL') return this.email;
    return null;
  }

  private async attemptOne(
    d: ClaimedDelivery,
    outbox: OutboxSummary | undefined,
    email: string | undefined,
    messageFor: (o: OutboxSummary) => Promise<NotificationMessage>,
  ): Promise<DeliveryOutcome> {
    // The outbox row names the school; a delivery may only ever speak for it.
    if (!outbox || outbox.schoolId !== d.schoolId) return { status: 'FAILED', error: 'outbox row not found for this school' };
    if (!email) return { status: 'SKIPPED', reason: 'no-address' };
    const channel = this.channelFor(d.channel);
    if (!channel) return { status: 'FAILED', error: `unknown channel ${d.channel}` };
    try {
      return await channel.attempt(email, await messageFor(outbox), d.schoolId);
    } catch (e) {
      // A throw (a sender lookup, a pooler timeout) is transient: it is
      // scheduled exactly like a RETRY, and never stops the rest of the batch.
      return { status: 'RETRY', error: clip((e as Error)?.message) };
    }
  }

  /**
   * Writes what happened. A failed write is logged and left: the claim stands,
   * so after CLAIM_TTL_MS this one delivery is tried again — the only repeat a
   * crash can cause.
   *
   * SKIPPED (including template-pending: the gated WhatsApp template has no
   * approved fallback) and SUPPRESSED end the delivery without counting an
   * attempt — nothing was tried, so nothing failed.
   */
  private async record(db: Db, d: ClaimedDelivery, o: DeliveryOutcome, result: NotificationOutboxDrainResult): Promise<void> {
    const now = Date.now();
    let data: Prisma.NotificationDeliveryUpdateInput;
    switch (o.status) {
      case 'SENT':
        result.sent += 1;
        data = { status: 'SENT', sentAt: new Date(now), providerId: o.providerId ?? null, attempts: d.attempts + 1, error: null, claimedAt: null };
        break;
      case 'SKIPPED':
      case 'SUPPRESSED':
        result.skipped += 1;
        data = { status: o.status, reason: o.reason, claimedAt: null };
        break;
      case 'FAILED':
        result.failed += 1;
        data = { status: 'FAILED', attempts: d.attempts + 1, error: clip(o.error), claimedAt: null };
        break;
      case 'RETRY': {
        const failures = d.attempts + 1;
        if (failures > DELIVERY_BACKOFF_MS.length) {
          result.failed += 1;
          data = { status: 'FAILED', attempts: failures, error: clip(o.error), claimedAt: null };
        } else {
          result.retried += 1;
          data = { status: 'QUEUED', attempts: failures, error: clip(o.error), nextAttemptAt: new Date(now + DELIVERY_BACKOFF_MS[failures - 1]), claimedAt: null };
        }
        break;
      }
    }
    try {
      // Only while the row still carries THIS drain's claim. A send that hung
      // past CLAIM_TTL_MS and finishes late must not overwrite the claim or the
      // status a newer drain has since written.
      const { count } = await db.notificationDelivery.updateMany({ where: { id: d.id, schoolId: d.schoolId, claimedAt: d.claimedAt }, data });
      if (count === 0) this.logger.warn(`Delivery ${d.id} (${d.channel}) ended ${o.status} after its claim had been taken over; the newer drain's record stands.`);
    } catch (e) {
      this.logger.error(`Delivery ${d.id} (${d.channel}) ended ${o.status} but could not be recorded: ${(e as Error).message}`);
    }
  }

  /** Login emails for the batch, one query per school, keyed `${schoolId}:${userId}`. */
  private async emailsOf(db: Db, due: ClaimedDelivery[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const [schoolId, ids] of groupBySchool(due, (d) => d.userId)) {
      const users = await db.user.findMany({ where: { schoolId, id: { in: [...ids] } }, select: { id: true, email: true } });
      for (const u of users) if (u.email) out.set(`${schoolId}:${u.id}`, u.email);
    }
    return out;
  }

  /**
   * One rendered message per outbox row per drain (the leave buttons are
   * signed here, at send time, never stored). Some writers leave the school's
   * name off the row; it is filled once per school, and a FAILED lookup sends
   * as 'Your school' without caching the miss.
   */
  private messageCache(db: Db): (o: OutboxSummary) => Promise<NotificationMessage> {
    const messages = new Map<string, Promise<NotificationMessage>>();
    const schoolNames = new Map<string, string>();
    const schoolNameOf = async (id: string) => {
      const known = schoolNames.get(id);
      if (known !== undefined) return known;
      try {
        const name = (await db.school.findFirst({ where: { id }, select: { name: true } }))?.name ?? 'Your school';
        schoolNames.set(id, name);
        return name;
      } catch (e) {
        this.logger.warn(`school name lookup for ${id} failed, sending as 'Your school': ${(e as Error)?.message}`);
        return 'Your school';
      }
    };
    return (o) => {
      let p = messages.get(o.id);
      if (!p) {
        p = (async () => {
          assertNotificationOutboxKind(o.kind);
          const message = toNotificationMessage(o.kind, o.payload);
          if (!message.payload.schoolName) message.payload.schoolName = await schoolNameOf(o.schoolId);
          return message;
        })();
        messages.set(o.id, p);
      }
      return p;
    };
  }

  /**
   * Step 3: an outbox row is done when none of its deliveries is still
   * QUEUED or HELD. A failure here is logged and costs nothing — the next
   * drain runs the same statement. Cross-tenant on purpose: it closes every
   * school's finished rows, so it cannot carry one schoolId.
   *
   * A row is closable once expanded — or once PARKED (attempts at
   * MAX_ATTEMPTS) with deliveries already written: its createMany went
   * through but the expandedAt write kept failing, so its people were told
   * and only the bookkeeping is stuck. Closing stamps sentAt, which is what
   * lets the retention sweep remove it in time. A parked row with NO
   * deliveries is a real failure and stays for an operator.
   */
  private async closeFinished(db: Db): Promise<number> {
    try {
      return await db.$executeRaw`
        UPDATE "NotificationOutbox" o SET "sentAt" = (${new Date(Date.now())}::timestamptz AT TIME ZONE 'UTC'), "claimedAt" = NULL
        WHERE o."sentAt" IS NULL
          AND (
            o."expandedAt" IS NOT NULL
            OR (
              o.attempts >= ${MAX_ATTEMPTS}
              AND EXISTS (SELECT 1 FROM "NotificationDelivery" e WHERE e."outboxId" = o.id AND e."schoolId" = o."schoolId")
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM "NotificationDelivery" d
            WHERE d."outboxId" = o.id AND d."schoolId" = o."schoolId" AND d.status IN ('QUEUED', 'HELD')
          )
      `;
    } catch (e) {
      this.logger.error(`Closing finished outbox rows failed: ${(e as Error)?.message}`);
      return 0;
    }
  }

  /**
   * Retention sweep for rows this outbox has already delivered.
   *
   * Runs AFTER the drain and never throws: a failure to tidy up is not a
   * reason to report the delivery run as failed, so it is logged and swallowed
   * and the next run tries again. See `PURGE_DELIVERED_AFTER_DAYS` for why the
   * `sentAt < cutoff` predicate cannot touch undelivered rows.
   */
  private async purgeDelivered(db: Db): Promise<number> {
    const cutoff = new Date(Date.now() - PURGE_DELIVERED_AFTER_DAYS * 24 * 60 * 60 * 1000);
    try {
      // Cross-tenant on purpose (the nightly retention sweep covers every
      // school), so no schoolId; the predicate only ever matches delivered
      // rows. Their deliveries go with them (ON DELETE CASCADE).
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
