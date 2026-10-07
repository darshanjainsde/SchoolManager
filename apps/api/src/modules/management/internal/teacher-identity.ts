import { getPlatformPrisma, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { toE164 } from '../../../common/otp/phone-identity';

/**
 * WHO A TEACHER IS, FOR "HAVE WE ALREADY GOT THEM?".
 *
 * A person is matched on their two canonical identifiers, never on a name:
 *  - email, trimmed and lower-cased (dots in Gmail addresses are NOT
 *    stripped — other providers treat them as real, and merging two people is
 *    worse than missing one duplicate);
 *  - mobile, as E.164 (`toE164`: "098765 43210", "+91-98765-43210" and
 *    "9876543210" are one number).
 *
 * The rules (2026-10-07):
 *  - one ACTIVE teaching post per person across every school — a released
 *    teacher (isActive=false) is free to join another;
 *  - one teacher record per person at a school, whatever its status (a LEFT
 *    record is reactivated, never duplicated);
 *  - nothing else is unique: the same mobile can be a teacher here AND the
 *    family login of her own children, here or anywhere, and one parent number
 *    can sit on any number of pupils. Those live on other tables and the phone
 *    login's profile chooser already shows them all.
 *
 * No hash is involved: the identifiers are stored readable (WhatsApp has to
 * send to the number), so the canonical value itself is the key. A keyed hash
 * ("blind index") only earns its place once a column is encrypted at rest.
 */
export interface TeacherIdentity {
  email: string | null;
  phoneE164: string | null;
}

export function identityOf(input: { email?: string | null; phone?: string | null }): TeacherIdentity {
  const email = input.email?.trim().toLowerCase() || null;
  return { email, phoneE164: toE164(input.phone ?? null) };
}

/**
 * Serialise every write that claims one of these identifiers, platform-wide.
 * The checks below are read-then-write; without this, two offices adding the
 * same teacher in the same second would both pass. Advisory locks are global
 * to the database, so a lock taken here also waits for a creator at another
 * school (whose row this school's RLS-scoped `tx` cannot see) to commit — and
 * the cross-school read runs after that, on the platform client.
 * Keys are sorted so two writers can never wait on each other in a circle.
 */
export async function lockIdentity(tx: TenantTx, id: TeacherIdentity): Promise<void> {
  const keys = [id.email && `email:${id.email}`, id.phoneE164 && `phone:${id.phoneE164}`].filter((k): k is string => !!k).sort();
  for (const k of keys) {
    // ::text — pg_advisory_xact_lock returns void, which $queryRaw cannot read.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('teacher-identity'), hashtext(${k}))::text`;
  }
}

export interface TeacherHere {
  id: string;
  name: string;
  status: string;
  /** Which identifier matched — the form puts the message on that field. */
  field: 'email' | 'phone';
}

/** A teacher record at THIS school with the same email or mobile (any status). */
export async function findTeacherHere(tx: TenantTx, schoolId: string, id: TeacherIdentity, excludeId?: string | null): Promise<TeacherHere | null> {
  const or = [
    ...(id.email ? [{ email: { equals: id.email, mode: 'insensitive' as const } }] : []),
    ...(id.phoneE164 ? [{ phoneE164: id.phoneE164 }] : []),
  ];
  if (!or.length) return null;
  const row = await tx.teacher.findFirst({
    where: { schoolId, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    // An ACTIVE match is the one to name when both an active and a LEFT row exist.
    orderBy: { isActive: 'desc' },
    select: { id: true, firstName: true, lastName: true, status: true, email: true, phoneE164: true },
  });
  if (!row) return null;
  const field = id.email && row.email?.toLowerCase() === id.email ? 'email' : 'phone';
  return { id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), status: row.status, field };
}

/**
 * Whether the person holds an ACTIVE teaching post at another school, and on
 * which identifier. Cross-tenant by nature, so it reads on the platform
 * client. It answers yes or no only: which school is not this office's to know.
 */
export async function activeElsewhere(schoolId: string, id: TeacherIdentity): Promise<'email' | 'phone' | null> {
  const db = getPlatformPrisma();
  const base = { isActive: true, schoolId: { not: schoolId } };
  if (id.email && (await db.teacher.findFirst({ where: { ...base, email: { equals: id.email, mode: 'insensitive' } }, select: { id: true } }))) return 'email';
  if (id.phoneE164 && (await db.teacher.findFirst({ where: { ...base, phoneE164: id.phoneE164 }, select: { id: true } }))) return 'phone';
  return null;
}

export const ELSEWHERE_MESSAGE =
  'This teacher is active at another school on Sckools. That school must release them before they can be added here.';

/**
 * Refuse a write that would give a person a second teacher record here or a
 * second active post anywhere. Call inside the transaction that writes.
 */
export async function assertIdentityFree(tx: TenantTx, schoolId: string, id: TeacherIdentity, excludeId?: string | null): Promise<void> {
  if (!id.email && !id.phoneE164) return;
  await lockIdentity(tx, id);
  const here = await findTeacherHere(tx, schoolId, id, excludeId);
  if (here) {
    const by = here.field === 'email' ? 'email' : 'mobile number';
    if (here.status === 'LEFT') {
      throw new ApiError(
        'ALREADY_HERE_INACTIVE',
        `${here.name} already has a record at this school with this ${by}, marked as left. Reactivate that record instead of adding a duplicate.`,
        409,
        here.field,
      );
    }
    throw new ApiError('ALREADY_TEACHER_HERE', `${here.name} is already a teacher here with this ${by}.`, 409, here.field);
  }
  const field = await activeElsewhere(schoolId, id);
  if (field) throw new ApiError('ALREADY_AT_SCHOOL', ELSEWHERE_MESSAGE, 409, field);
}
