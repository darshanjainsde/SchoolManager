import type { TenantTx } from '@skoolos/db';
import { activeStudentsWhere } from '../roster/active-students';

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

/** Every linked-user email for the students currently in a class section. */
export async function resolveSectionRecipients(
  db: TenantTx,
  schoolId: string,
  classSectionId: string,
): Promise<string[]> {
  const students = await db.student.findMany({
    where: activeStudentsWhere(schoolId, { classSectionId, userId: { not: null } }),
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
    where: activeStudentsWhere(schoolId, { userId: { not: null } }),
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
    where: activeStudentsWhere(schoolId, { id: { in: studentIds }, userId: { not: null } }),
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

/**
 * Every active SCHOOL_ADMIN login of the school — the people who act on a
 * request. Email reaches all of them; WhatsApp reaches those whose number
 * is verified (the channel decides that, not this resolver).
 */
export async function resolveAdminRecipients(db: TenantTx, schoolId: string): Promise<{ userId: string; email: string }[]> {
  const admins = await db.user.findMany({
    where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    select: { id: true, email: true },
  });
  return admins.filter((a) => a.email).map((a) => ({ userId: a.id, email: a.email }));
}

/** The accounts officers of a school — the staff half of the leave desk. */
export function leaveDeskStaffWhere(schoolId: string) {
  return { schoolId, role: 'ACCOUNTS' as const, isActive: true as const };
}

/**
 * Everyone who runs the leave desk: every active admin, plus every active
 * accounts officer with a login — the same set LeaveDeskGuard admits. Until
 * 2026-10-06 a leave request went to admins only, so the officer who decides
 * most of them heard nothing.
 *
 * Each person once, by userId. `exceptUserId` leaves out the applicant: an
 * officer who applies for her own leave must not be asked to approve it.
 */
export async function resolveLeaveDeskRecipients(
  db: TenantTx,
  schoolId: string,
  opts: { exceptUserId?: string } = {},
): Promise<{ userId: string; email: string }[]> {
  const [allAdmins, officers] = await Promise.all([
    resolveAdminRecipients(db, schoolId),
    db.staff.findMany({ where: { ...leaveDeskStaffWhere(schoolId), userId: { not: null } }, select: { userId: true } }),
  ]);
  const admins = allAdmins.filter((a) => a.userId !== opts.exceptUserId);
  // Ids seen among ALL admins (even the excluded applicant) are never re-added as officers.
  const adminIds = new Set(allAdmins.map((a) => a.userId));
  const officerIds = [
    ...new Set(officers.map((o) => o.userId).filter((id): id is string => !!id && !adminIds.has(id) && id !== opts.exceptUserId)),
  ];
  if (officerIds.length === 0) return admins;
  const users = await db.user.findMany({ where: { schoolId, id: { in: officerIds }, isActive: true }, select: { id: true, email: true } });
  return [...admins, ...users.filter((u) => u.email).map((u) => ({ userId: u.id, email: u.email }))];
}

/**
 * The logins an outbox row is for, by id — what a NotificationDelivery row is
 * keyed on. A login with no email is left out: every channel addresses a
 * person by their login email within the school.
 */
export async function resolveRecipientUsers(
  db: TenantTx,
  schoolId: string,
  target: { targetUserId: string | null; classSectionId: string | null },
): Promise<string[]> {
  let ids: string[];
  if (target.targetUserId) {
    ids = [target.targetUserId];
  } else if (target.classSectionId) {
    const students = await db.student.findMany({
      where: activeStudentsWhere(schoolId, { classSectionId: target.classSectionId, userId: { not: null } }),
      select: { userId: true },
    });
    ids = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  } else {
    return [];
  }
  const unique = [...new Set(ids)];
  const byId = await emailsByUserId(db, schoolId, unique);
  return unique.filter((id) => byId.has(id));
}
