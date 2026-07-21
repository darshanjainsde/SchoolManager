import type { TenantTx } from '@skoolos/db';

/**
 * Recipient resolution — LIMITATION: `Student` has `guardianName` /
 * `guardianPhone` but no guardian *email* column. The only email we can
 * reach for a student is `User.email` via `Student.userId`, when a portal
 * account has been linked for that student. Students with no linked
 * `userId` (the common case until guardian/student portal accounts are
 * rolled out) are silently skipped — they simply produce no recipient,
 * never an error.
 *
 * Both `withTenant`'s `tx` (tenant-scoped call sites) and the platform
 * client from `getPlatformPrisma()` (the cross-tenant reminder cron) satisfy
 * the `TenantTx` shape structurally, so this same helper serves both.
 */

async function emailsForUserIds(db: TenantTx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true },
  });
  return users.map((u) => u.email).filter((e): e is string => Boolean(e));
}

/** Every linked-user email for the students currently in a class section. */
export async function resolveSectionRecipients(db: TenantTx, classSectionId: string): Promise<string[]> {
  const students = await db.student.findMany({
    where: { classSectionId, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  return emailsForUserIds(db, userIds);
}

/** Every linked-user email for a specific, explicit set of student ids. */
export async function resolveStudentRecipients(db: TenantTx, studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const students = await db.student.findMany({
    where: { id: { in: studentIds }, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  return emailsForUserIds(db, userIds);
}
