import { Prisma } from '@skoolos/db';

/**
 * A SCHOOL'S DATA, WHOLE, FOR DEBUGGING.
 *
 * When a school reports something we cannot reproduce, the fastest honest
 * answer is to load exactly their data into a local database and look. This
 * builds that: every row of every tenant-scoped table for one school, as one
 * JSON document.
 *
 * Which tables? Derived from the Prisma schema at runtime — every model with a
 * `schoolId` column — so a table added next month is in the snapshot without
 * anyone remembering this file exists. The alternative, a hand-kept list, is
 * the "new table misses the cross-cutting guarantee" defect this repo has
 * already paid for twice.
 *
 * Which columns? All of them, MINUS a deny-list of secrets. A snapshot is for
 * reproducing a bug, never for signing in as anyone: password hashes, refresh
 * tokens, OTP challenges and API secrets are replaced with a marker so the
 * shape survives and the value does not.
 */
export const SECRET_FIELDS = new Set([
  'passwordHash', 'refreshTokenHash', 'tokenHash', 'secret', 'secretHash', 'otpHash', 'codeHash',
  'totpSecret', 'apiKey', 'apiKeyHash', 'webhookSecret', 'accessToken', 'refreshToken',
]);
/** Models whose rows are secrets in themselves, not data about the school. */
export const SECRET_MODELS = new Set(['OtpChallenge', 'RefreshToken', 'Session', 'PasswordReset', 'OwnerSession']);

export interface SnapshotPlan { model: string; table: string }

/** Every model that carries a schoolId, in schema order. */
export function tenantModels(dmmf: typeof Prisma.dmmf.datamodel = Prisma.dmmf.datamodel): SnapshotPlan[] {
  return dmmf.models
    .filter((m) => m.fields.some((f) => f.name === 'schoolId'))
    .filter((m) => !SECRET_MODELS.has(m.name))
    .map((m) => ({ model: m.name, table: m.dbName ?? m.name }));
}

export function redact<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = SECRET_FIELDS.has(k) && v != null ? '[redacted]' : v;
  return out as T;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Reads every table for one school through the platform client (BYPASSRLS —
 * this is an owner action, guarded at the controller). Pages so a big school
 * does not pull 20k rows in one query.
 */
export async function buildSnapshot(
  db: { school: { findUnique: (a: unknown) => Promise<unknown> } } & Record<string, unknown>,
  schoolId: string,
  page = 2000,
): Promise<{ meta: Record<string, unknown>; school: unknown; tables: Record<string, unknown[]> }> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) throw new Error('School not found');
  const tables: Record<string, unknown[]> = {};
  for (const { model } of tenantModels()) {
    const delegate = db[lower(model)] as { findMany?: (a: unknown) => Promise<Record<string, unknown>[]> } | undefined;
    if (!delegate?.findMany) continue;
    const rows: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await delegate.findMany({ where: { schoolId }, take: page, orderBy: { id: 'asc' }, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      rows.push(...batch.map(redact));
      if (batch.length < page) break;
      cursor = String(batch[batch.length - 1].id);
    }
    tables[model] = rows;
  }
  return {
    meta: { schoolId, takenAt: new Date().toISOString(), models: Object.keys(tables).length, rows: Object.values(tables).reduce((n, r) => n + r.length, 0), note: 'Secrets are redacted; this reproduces data, never a login.' },
    school: redact(school as Record<string, unknown>),
    tables,
  };
}
