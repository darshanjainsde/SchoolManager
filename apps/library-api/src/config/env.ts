import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function loadRootDotenv(start: string = process.cwd()): void {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) { loadDotenv({ path: candidate, override: false }); return; }
    const parent = resolve(dir, '..');
    if (parent === dir) return;
    dir = parent;
  }
}
loadRootDotenv();

const pg = z.string().startsWith('postgres');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LIBRARY_API_PORT: z.coerce.number().int().positive().default(3101),

  LIBRARY_DATABASE_URL_APP: pg,
  LIBRARY_DATABASE_URL_PLATFORM: pg,
  LIBRARY_REDIS_URL: z.string().startsWith('redis'),

  LIBRARY_JWT_SECRET: z.string().min(32),
  LIBRARY_REFRESH_SECRET: z.string().min(32),
  LIBRARY_ACCESS_TTL: z.string().default('15m'),
  LIBRARY_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  LIBRARY_PLATFORM_HOST: z.string().min(1),
  CRON_SECRET: z.string().optional(),

  /**
   * Bearer secret for `/internal/provisioning/*`, which CREATES a school's
   * library.
   *
   * Deliberately NOT reusing `CRON_SECRET`. A cron secret authorises a periodic
   * sweep; this authorises calling an org into existence for an arbitrary
   * `schoolId`. Sharing one value would mean the scheduler's credential — which
   * lives in a platform config and is handed to a third party's scheduler —
   * also grants org creation. Separate secrets keep the blast radii separate.
   *
   * Optional in the schema, but the guard fails CLOSED when it is unset: an
   * absent secret must never leave org creation open. (The library's outbox
   * sweep once did exactly that, which is why this is spelled out.)
   */
  PROVISIONING_SECRET: z.string().optional(),

  /**
   * The PUBLIC key Sckools signs its tokens with (RS256, PEM).
   *
   * Public deliberately, not a shared secret. A shared HMAC secret would mean a
   * compromise of this service lets an attacker mint SCKOOLS tokens too — one
   * blast radius becomes two, for a service that exists to be separable. And
   * verifying by calling Sckools would make every library login depend on
   * Sckools being reachable, coupling two systems that are deliberately not.
   *
   * Optional: the library runs standalone today and must keep working that way
   * (§1). Absent, the bridge route reports that it is not configured rather
   * than failing closed on a feature nobody enabled.
   */
  SCKOOLS_JWT_PUBLIC_KEY: z.string().optional(),
  /** Expected `iss` on a Sckools token. Checked so a token minted by some other
   *  service holding the same key cannot be replayed here. */
  SCKOOLS_JWT_ISSUER: z.string().default('sckools'),
  SENTRY_DSN: z.string().optional(),
});

export type LibraryEnv = z.infer<typeof schema>;

let cached: LibraryEnv | undefined;

export function loadLibraryEnv(opts: { force?: boolean } = {}): LibraryEnv {
  if (cached && !opts.force) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid library environment: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}
