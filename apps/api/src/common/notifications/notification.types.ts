/**
 * The set of events the platform can notify a recipient about. Adding a new
 * kind here is the only schema-level change needed to support a new event —
 * channels switch on it, callers pass it, nothing else changes shape.
 */
export type NotificationKind =
  | 'TEST_SCHEDULED'
  | 'TEST_REMINDER'
  | 'RESULTS_PUBLISHED'
  | 'ABSENCE_NOTICE';

/**
 * A delivery mechanism (email today, WhatsApp later). `NotificationService`
 * fans a `notify()` call out over every configured channel — a new channel
 * is wired in purely via `NOTIFICATION_CHANNELS` (see notification.module.ts)
 * and requires no change to `NotificationService` or any caller.
 */
export interface NotificationChannel {
  /** Short identifier used in logs, e.g. 'email', 'whatsapp'. */
  name: string;
  /**
   * Sends one message to one recipient. Must resolve to `true`/`false` and
   * should not throw for ordinary delivery failures (mirroring
   * `MailService.send`, which logs-but-never-throws) — `NotificationService`
   * also tolerates a throwing/rejecting channel defensively, but a
   * well-behaved channel resolves `false` instead.
   */
  send(kind: NotificationKind, to: string, payload: Record<string, unknown>): Promise<boolean>;
}

export interface NotifySummary {
  sent: number;
  failed: number;
}
