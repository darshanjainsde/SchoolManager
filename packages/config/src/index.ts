import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Find the nearest `.env` walking up from `start` and load it. We do this once,
 * so any process started from anywhere in the monorepo (apps/api, apps/worker,
 * scripts) picks up the root `.env` without per-app dotenv wiring.
 */
function loadRootDotenv(start: string = process.cwd()): void {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return;
    dir = parent;
  }
}
loadRootDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3002),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  DATABASE_URL_APP: z.string().url().or(z.string().startsWith('postgres')).optional(),
  DATABASE_URL_PLATFORM: z.string().url().or(z.string().startsWith('postgres')).optional(),
  DATABASE_URL_TEST: z.string().optional(),
  REDIS_URL: z.string().url().or(z.string().startsWith('redis')),

  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  /**
   * Optional second bucket, NOT public, for files that are nobody's business
   * but the school's: fee payment proofs (bank screenshots with account
   * numbers and payer names) and print-order PDFs (unsat exam papers).
   *
   * The main bucket is public — an unsigned GET of
   * /object/public/<bucket>/<key> returns the object — which is correct for
   * site media and wrong for those two. Keys carry a randomUUID so nothing is
   * enumerable, but a link that leaks once is then permanent, and the
   * short-lived presigned URLs those paths already use are decorative while
   * the object is reachable without a signature.
   *
   * Unset → both categories stay in S3_BUCKET and behave exactly as before,
   * so this can be deployed before the bucket exists.
   */
  S3_PRIVATE_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  // Public base for browser-facing asset URLs when it differs from the S3
  // upload endpoint (e.g. Supabase Storage serves public objects via its CDN
  // at /storage/v1/object/public/<bucket>, not the S3 protocol endpoint).
  // Empty → fall back to <S3_ENDPOINT>/<S3_BUCKET> (MinIO-style path URL).
  S3_PUBLIC_URL_BASE: z.string().url().optional(),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().min(1),
  // Optional: Mailhog (local dev) accepts unauthenticated mail.
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // 32-byte key (base64 or 64-char hex) that encrypts schools' own SMTP
  // passwords at rest. UNSET IS SAFE AND MEANS ONE THING: a school cannot
  // save its own sender, so every school keeps sending through the platform
  // mailbox. It is never a silent downgrade — the API refuses the save and
  // says why, rather than storing a credential in the clear.
  EMAIL_SECRET_KEY: z.string().optional(),

  // Single shared password that unlocks the owner console at /owner.
  // Unset → the gate endpoint answers 503 and only email login works.
  OWNER_GATE_PASSWORD: z.string().min(8).optional(),

  JWT_SCHOOL_ACCESS_SECRET: z.string().min(16),
  JWT_SCHOOL_REFRESH_SECRET: z.string().min(16),
  JWT_PLATFORM_ACCESS_SECRET: z.string().min(16),
  JWT_PLATFORM_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_DURATION_SECONDS: z.coerce.number().int().positive().default(900),

  PLATFORM_HOST: z.string().default('localhost'),
  PLATFORM_OWNER_HOST: z.string().default('owner.localhost'),
  PLATFORM_IP_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /**
   * Where a school's own domain is told to point.
   *
   * This MUST be a hostname we control and can re-point without touching a
   * single school's DNS — that indirection is the whole reason it exists. The
   * old default was `ingress.skoolos.app`, a domain this project does not own:
   * it resolves to an unrelated product's nginx (cert `*.app.classmind.in`),
   * so every school that followed the setup instructions pointed its traffic
   * at a stranger. Point this at a record in our own zone that CNAMEs to the
   * current host (Vercel today, whatever comes next later).
   */
  INGRESS_CNAME_TARGET: z.string().default('ingress.localhost'),
  /**
   * The apex answer. A root domain cannot hold a CNAME, so apex schools get an
   * A record — and an A record's value must be a literal IPv4 address, never a
   * hostname. Registrars reject anything else at the form ("Value must be a
   * valid IPv4 address"), which is exactly what the instructions used to hand
   * out. Validated as an IP here so a hostname can never reach a school again.
   */
  INGRESS_A_RECORD: z.string().ip({ version: 'v4' }).default('127.0.0.1'),

  /**
   * Vercel API credentials, used to attach a school's domain to the hosting
   * project. DNS alone is not enough: an unattached hostname resolves to
   * Vercel and is answered with `DEPLOYMENT_NOT_FOUND`, and no certificate is
   * ever issued. Unset → `add` still records the domain and the operator is
   * told, in the response, that the attach step must be done by hand.
   */
  VERCEL_TOKEN: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),
  /**
   * Which deployment a school's domain should serve.
   *
   * A domain attached to a Vercel project points at the PRODUCTION deployment
   * unless it is pinned to a git branch. On staging that is the wrong answer
   * in the most confusing way possible: the domain resolves, TLS is valid, and
   * it serves the production app against the production database — so a school
   * created on staging is simply not found, and the domain looks broken rather
   * than mis-targeted. Set this to the branch a given environment deploys from
   * (e.g. `staging`); leave unset in production to mean the production
   * deployment.
   */
  VERCEL_GIT_BRANCH: z.string().min(1).optional(),
});

/**
 * The RLS-enforcing connection is optional in the schema because local dev and
 * the test harness share one superuser URL. In production it is not optional,
 * and the failure mode if it is missing is silent and total:
 * `getTenantPrisma()` falls back to DATABASE_URL, which on Supabase is the
 * `postgres` role holding BYPASSRLS. Every `withTenant` call then runs with no
 * isolation, with no error and no failed request — and the codebase leans on
 * RLS deliberately instead of repeating `where: { schoolId }`, so hundreds of
 * lookups become cross-tenant reads at once.
 *
 * apps/library-api already made the same variable required
 * (`LIBRARY_DATABASE_URL_APP`); this brings the school API in line.
 */
const requireRlsRolesInProduction = <T extends { NODE_ENV: string; DATABASE_URL_APP?: string; DATABASE_URL_PLATFORM?: string }>(
  env: T,
  ctx: z.RefinementCtx,
): void => {
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['DATABASE_URL_APP', 'DATABASE_URL_PLATFORM'] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message:
          `${key} is required in production. Without it the app would connect as ` +
          'DATABASE_URL, which is the superuser role and bypasses row-level security ' +
          'for every tenant query.',
      });
    }
  }
};

/**
 * A production deployment must NAME its own ingress.
 *
 * The old default was `ingress.skoolos.app`, a domain this project does not
 * own — it answers with an unrelated product's nginx. Because the variable was
 * never set on any environment, that default was the live value, so every
 * school onboarded was handed DNS pointing at a stranger's server. A default
 * that is wrong in production must fail at boot rather than quietly become the
 * answer, which is the same argument `requireRlsRolesInProduction` makes above.
 */
const requireIngressInProduction = <T extends { NODE_ENV: string; INGRESS_CNAME_TARGET: string; INGRESS_A_RECORD: string }>(
  env: T,
  ctx: z.RefinementCtx,
): void => {
  if (env.NODE_ENV !== 'production') return;
  if (env.INGRESS_CNAME_TARGET === 'ingress.localhost') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['INGRESS_CNAME_TARGET'],
      message:
        'INGRESS_CNAME_TARGET is required in production. Set it to a hostname you ' +
        'control and can re-point without touching a single school (e.g. ' +
        'ingress.sckools.com, itself CNAMEd to the current host). Schools are told ' +
        'to point their DNS at this name.',
    });
  }
  if (env.INGRESS_A_RECORD === '127.0.0.1') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['INGRESS_A_RECORD'],
      message:
        'INGRESS_A_RECORD is required in production. Set it to the public IPv4 that ' +
        'apex school domains should A-record to (216.198.79.1 for Vercel). It must be ' +
        'an address, not a hostname — registrars reject anything else.',
    });
  }
};

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const result = envSchema
    .superRefine(requireRlsRolesInProduction)
    .superRefine(requireIngressInProduction)
    .safeParse(source);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = result.data;
  return cached;
}
