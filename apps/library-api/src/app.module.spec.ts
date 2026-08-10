import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
