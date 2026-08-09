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
