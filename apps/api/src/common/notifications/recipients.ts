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
 * the `TenantTx` shape structurally, so this same helper serves both. Because
 * the cron path runs on the RLS-BYPASSING platform client, every `where` here
 * carries an explicit `schoolId` — correctness must not depend on RLS or on
 * UUID primary keys never colliding across tenants.
 */

/** One notifiable person, plus the student they are being contacted about. */
export interface StudentRecipient {
  email: string;
  studentName: string;
}

async function emailsByUserId(
  db: TenantTx,
  schoolId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: userIds }, schoolId },
    select: { id: true, email: true },
  });
  const byId = new Map<string, string>();
  for (const u of users) {
    if (u.email) byId.set(u.id, u.email);
  }
  return byId;
}

/**
 * The single linked-user email for one userId, as a 0-or-1-element array so the
 * drain can treat it uniformly with `resolveSectionRecipients`. Used for
 * private messages (MESSAGE_RECEIVED), which target one recipient — the message
 * addressee — not a whole section. Returns `[]` when the user has no email
 * (e.g. no login yet), in which case there is simply nothing to push.
 */
export async function resolveUserRecipients(
  db: TenantTx,
  schoolId: string,
  userId: string,
): Promise<string[]> {
  const byId = await emailsByUserId(db, schoolId, [userId]);
  const email = byId.get(userId);
  return email ? [email] : [];
}

/** Every linked-user email for the students currently in a class section. */
export async function resolveSectionRecipients(
  db: TenantTx,
  schoolId: string,
  classSectionId: string,
): Promise<string[]> {
  const students = await db.student.findMany({
    where: { schoolId, classSectionId, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  const byId = await emailsByUserId(db, schoolId, userIds);
  return userIds.map((id) => byId.get(id)).filter((e): e is string => Boolean(e));
}

/**
 * Every linked-user email for every student in the school, regardless of
 * class section — the whole-school counterpart to `resolveSectionRecipients`,
 * for a broadcast (e.g. a whole-school ANNOUNCEMENT) that has no single
 * class to scope the query to. Still tenant-scoped via the explicit
 * `schoolId` in `where` (see the file-level LIMITATION comment for why that
 * matters even inside `withTenant`'s RLS-scoped `tx`).
 */
export async function resolveSchoolRecipients(
  db: TenantTx,
  schoolId: string,
): Promise<string[]> {
  const students = await db.student.findMany({
    where: { schoolId, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  const byId = await emailsByUserId(db, schoolId, userIds);
  return userIds.map((id) => byId.get(id)).filter((e): e is string => Boolean(e));
}

/**
 * Every linked-user email for a specific, explicit set of student ids, each
 * paired with that student's name so the caller can personalise per recipient
 * (an absence notice must name the right child).
 */
export async function resolveStudentRecipients(
  db: TenantTx,
  schoolId: string,
  studentIds: string[],
): Promise<StudentRecipient[]> {
  if (studentIds.length === 0) return [];
  const students = await db.student.findMany({
    where: { schoolId, id: { in: studentIds }, userId: { not: null } },
    select: { userId: true, firstName: true, lastName: true },
  });

  const userIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  const byId = await emailsByUserId(db, schoolId, userIds);

  const recipients: StudentRecipient[] = [];
  for (const s of students) {
    const email = s.userId ? byId.get(s.userId) : undefined;
    if (!email) continue;
    recipients.push({
      email,
      studentName: [s.firstName, s.lastName].filter(Boolean).join(' ').trim(),
    });
  }
  return recipients;
}
