import { mailKeyFrom, openFeeSecret, openMailSecret, sealFeeSecret, sealMailSecret } from '../../../common/crypto/machine-secrets';

/**
 * EVERYTHING ABOUT A SCHOOL THAT BELONGS TO THE MACHINE IT RUNS ON.
 *
 * A school is data — except for exactly four things, each of which would break
 * if its rows were copied to another machine unchanged:
 *
 *  1. sealed secrets  — locked with this server's FEES_SECRET_KEY / EMAIL_SECRET_KEY
 *  2. file links      — absolute URLs into THIS machine's object storage
 *  3. its own address — `<slug>.<this machine's PLATFORM_HOST>`
 *  4. custom domains  — verified against THIS deployment's hosting
 *
 * The backup records the source machine's side of each; the import rewrites
 * them to the target's. Nothing else is machine-bound — that claim is guarded:
 * a new createCipheriv call outside the registry fails a test.
 */
export interface Machine {
  /** e.g. `sckools.com`, `test.sckools.com`, `localhost`. */
  platformHost: string;
  /** The URL that `publicUrl('')` would start with — no trailing slash. */
  publicBase: string;
  feesMaster: string | null;
  mailKey: Buffer | null;
}

export function machineFromEnv(env: {
  PLATFORM_HOST: string;
  S3_PUBLIC_URL_BASE?: string;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  EMAIL_SECRET_KEY?: string;
}, feesMaster = process.env.FEES_SECRET_KEY ?? null): Machine {
  const base = env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, '') || `${env.S3_ENDPOINT.replace(/\/+$/, '')}/${env.S3_BUCKET}`;
  let mailKey: Buffer | null = null;
  try { mailKey = mailKeyFrom(env.EMAIL_SECRET_KEY); } catch { mailKey = null; }
  return { platformHost: env.PLATFORM_HOST.toLowerCase(), publicBase: base, feesMaster: feesMaster || null, mailKey };
}

/** The non-secret half of a machine, as recorded in a backup's manifest. */
export interface MachineFace { platformHost: string; publicBase: string }
export const faceOf = (m: Machine): MachineFace => ({ platformHost: m.platformHost, publicBase: m.publicBase });

/* ── 1. Sealed secrets ──────────────────────────────────────────────────── */

/** Every column that holds a value sealed with a machine key. */
export const SEALED_COLUMNS = [
  { model: 'SchoolPaymentConfig', table: 'SchoolPaymentConfig', column: 'secrets', kind: 'fee-map' as const },
  { model: 'EmailSettings', table: 'EmailSettings', column: 'smtpPassEnc', kind: 'mail' as const },
];
export type SealedColumn = (typeof SEALED_COLUMNS)[number];

/** One opened secret, as carried inside the (password-locked) backup. */
export interface OpenedSecret {
  table: string;
  id: string;
  column: string;
  /** fee-map: name → plaintext; mail: the plaintext. Null where it could not be opened. */
  value: Record<string, string | null> | string | null;
}

export interface SecretWarning { table: string; id: string; column: string; reason: string }

/** Export side: opens what this machine can open. Never throws — an unreadable secret is a warning. */
export function openRowSecrets(
  sealed: SealedColumn, row: Record<string, unknown>, schoolId: string, m: Machine,
): { secret: OpenedSecret | null; warnings: SecretWarning[] } {
  const id = String(row.id);
  const raw = row[sealed.column];
  const warnings: SecretWarning[] = [];
  if (sealed.kind === 'mail') {
    if (raw == null || raw === '') return { secret: null, warnings };
    const plain = openMailSecret(m.mailKey, String(raw));
    if (plain == null) warnings.push({ table: sealed.table, id, column: sealed.column, reason: m.mailKey ? 'sealed with a different EMAIL_SECRET_KEY' : 'this machine has no EMAIL_SECRET_KEY' });
    return { secret: { table: sealed.table, id, column: sealed.column, value: plain }, warnings };
  }
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const names = Object.keys(map);
  if (names.length === 0) return { secret: null, warnings };
  const value: Record<string, string | null> = {};
  for (const name of names) {
    try {
      if (!m.feesMaster) throw new Error('this machine has no FEES_SECRET_KEY');
      value[name] = openFeeSecret(m.feesMaster, schoolId, String(map[name]));
    } catch (e) {
      value[name] = null;
      warnings.push({ table: sealed.table, id, column: `${sealed.column}.${name}`, reason: (e as Error).message.includes('FEES_SECRET_KEY') ? 'this machine has no FEES_SECRET_KEY' : 'sealed with a different FEES_SECRET_KEY' });
    }
  }
  return { secret: { table: sealed.table, id, column: sealed.column, value }, warnings };
}

/**
 * Import side: the value to store on THIS machine. Anything that cannot be
 * sealed here — no key, or it could not be opened at export — is dropped, so
 * the school is asked to enter it again rather than holding a dead credential.
 */
export function resealSecret(
  s: OpenedSecret, schoolId: string, m: Machine,
): { value: Record<string, string> | string | null; warnings: SecretWarning[] } {
  const warnings: SecretWarning[] = [];
  const kind = SEALED_COLUMNS.find((c) => c.table === s.table && c.column === s.column)?.kind;
  if (kind === 'mail') {
    if (typeof s.value !== 'string') {
      warnings.push({ table: s.table, id: s.id, column: s.column, reason: 'could not be read from the backup — enter the mailbox password again' });
      return { value: null, warnings };
    }
    if (!m.mailKey) {
      warnings.push({ table: s.table, id: s.id, column: s.column, reason: 'this machine has no EMAIL_SECRET_KEY — enter the mailbox password again' });
      return { value: null, warnings };
    }
    return { value: sealMailSecret(m.mailKey, s.value), warnings };
  }
  const out: Record<string, string> = {};
  for (const [name, plain] of Object.entries((s.value ?? {}) as Record<string, string | null>)) {
    if (plain == null) {
      warnings.push({ table: s.table, id: s.id, column: `${s.column}.${name}`, reason: 'could not be read from the backup — enter it again' });
      continue;
    }
    if (!m.feesMaster) {
      warnings.push({ table: s.table, id: s.id, column: `${s.column}.${name}`, reason: 'this machine has no FEES_SECRET_KEY — enter it again' });
      continue;
    }
    out[name] = sealFeeSecret(m.feesMaster, schoolId, plain);
  }
  return { value: out, warnings };
}

/* ── 2 & 3. Links and the school's own address ──────────────────────────── */

export interface Rewrite { from: string; to: string }

export function rewritesFor(
  src: MachineFace & { slug: string }, dst: MachineFace & { slug: string },
): Rewrite[] {
  const list: Rewrite[] = [
    { from: `${src.publicBase}/`, to: `${dst.publicBase}/` },
    { from: `//${src.slug}.${src.platformHost}`, to: `//${dst.slug}.${dst.platformHost}` },
  ];
  return list.filter((r) => r.from !== r.to && r.from.length > 3);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Applies every rewrite in ONE pass, so a replacement's output is never
 * matched again by another rule. Walks strings inside arrays and JSON objects
 * (page blocks, section variants, footer config) as well as plain columns.
 */
export function makeRewriter(rewrites: Rewrite[]): <T>(value: T) => T {
  if (rewrites.length === 0) return (v) => v;
  const sorted = [...rewrites].sort((a, b) => b.from.length - a.from.length);
  const re = new RegExp(sorted.map((r) => escape(r.from)).join('|'), 'g');
  const map = new Map(sorted.map((r) => [r.from, r.to]));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.includes('/') ? v.replace(re, (m) => map.get(m)!) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk as <T>(value: T) => T;
}

/* ── 4. Domains ─────────────────────────────────────────────────────────── */

/**
 * The school's address on our own host follows the TARGET machine. A custom
 * domain is kept, but on a different machine it must be verified again —
 * DNS and hosting point at the old one.
 */
export function transformDomain(
  row: Record<string, unknown>,
  src: MachineFace & { slug: string },
  dst: MachineFace & { slug: string },
): Record<string, unknown> {
  const host = String(row.hostname ?? '').toLowerCase();
  const sameMachine = src.platformHost === dst.platformHost && src.publicBase === dst.publicBase;
  if (host === src.platformHost || host.endsWith(`.${src.platformHost}`)) {
    return { ...row, hostname: `${dst.slug}.${dst.platformHost}`, type: 'SUBDOMAIN' };
  }
  return sameMachine ? row : { ...row, status: 'PENDING' };
}
