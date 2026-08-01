import type { TenantTx } from '@skoolos/db';
import { assertNotificationKind, type NotificationKind } from '@skoolos/types';

/**
 * In-app notification inbox writer — the persistent counterpart to the push
 * `recipients.ts` helpers. Where those resolve EMAILS for `PushChannel`, these
 * write persistent `Notification` rows (the bell's unread inbox) for the SAME
 * recipients, INSIDE the caller's `withTenant` transaction, so a notification
 * is all-or-nothing with the domain event that raised it (see the
 * `Notification` model docstring in schema.prisma).
 */

export interface EmitNotificationInput {
  schoolId: string;
  /** Recipient User.ids. Deduped here; an empty list is a no-op. */
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** Optional deep-link the client resolves to a route by role. */
  linkType?: string | null;
  linkId?: string | null;
}

/** Writes one `Notification` row per DISTINCT recipient, in `tx`. */
export async function emitNotifications(tx: TenantTx, input: EmitNotificationInput): Promise<void> {
  assertNotificationKind(input.kind);
  const userIds = Array.from(new Set(input.userIds));
  if (userIds.length === 0) return;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({
      schoolId: input.schoolId,
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      linkType: input.linkType ?? null,
      linkId: input.linkId ?? null,
    })),
  });
}

/**
 * The recipient `User.id`s for every student currently in a section who has a
 * linked login — the in-app counterpart to `resolveSectionRecipients` (which
 * returns emails for push). Skips students with no `userId`, exactly as that
 * helper does, so a section broadcast simply reaches whoever has an account.
 */
export async function sectionStudentUserIds(
  tx: TenantTx,
  schoolId: string,
  classSectionId: string,
): Promise<string[]> {
  const students = await tx.student.findMany({
    where: { schoolId, classSectionId, userId: { not: null } },
    select: { userId: true },
  });
  return students.map((s) => s.userId).filter((id): id is string => Boolean(id));
}
