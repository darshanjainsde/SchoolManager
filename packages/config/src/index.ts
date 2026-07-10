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
  INGRESS_CNAME_TARGET: z.string().default('ingress.skoolos.app'),
  INGRESS_A_RECORD: z.string().default('127.0.0.1'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = result.data;
  return cached;
}
