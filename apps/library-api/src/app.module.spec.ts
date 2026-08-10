import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PlanResolverService } from './modules/plans';

describe('AppModule wiring (Group B, finding 4)', () => {
  // PlansModule and the idempotency interceptor's 'IDEMPOTENCY_STORE' token
  // were never imported into AppModule — not a live defect (nothing used
  // them yet), but a DI trap that would only surface the first time a
  // Phase 1 controller tried to use RequireFeatureGuard or
  // @UseInterceptors(IdempotencyInterceptor). Compiling the real AppModule
  // here — not a hand-picked subset of its providers — is what actually
  // proves both resolve through the app's real module graph.
  it('compiles the full app graph and resolves PlanResolverService and IDEMPOTENCY_STORE', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      expect(moduleRef.get(PlanResolverService)).toBeInstanceOf(PlanResolverService);
      expect(moduleRef.get('IDEMPOTENCY_STORE')).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });

  it('does NOT register IdempotencyInterceptor as a global APP_INTERCEPTOR — it must stay opt-in per route', () => {
    const source = readFileSync(join(__dirname, 'app.module.ts'), 'utf8');
    expect(source).not.toMatch(/APP_INTERCEPTOR/);
  });
});

describe('library-api wiring guards', () => {
  it('registers a Redis-backed throttler, never the in-memory default', () => {
    const source = readFileSync(join(__dirname, 'app.module.ts'), 'utf8');
    expect(source).toContain('RedisThrottlerStorage');
  });

  it('declares only daily crons — a sub-daily schedule fails the whole deploy', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '../vercel.json'), 'utf8'));
    for (const cron of vercel.crons ?? []) {
      const [minute, hour] = cron.schedule.split(' ');
      expect(minute).not.toBe('*');
      expect(hour).not.toBe('*');
      expect(hour).not.toContain('/');
    }
  });

  it('pins the Mumbai region to stay co-located with the database', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '../vercel.json'), 'utf8'));
    expect(vercel.regions).toEqual(['bom1']);
  });

  it('every module folder exposes a public index.ts', () => {
    const dir = join(__dirname, 'modules');
    for (const mod of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      expect(readdirSync(join(dir, mod.name))).toContain('index.ts');
    }
  });
});
