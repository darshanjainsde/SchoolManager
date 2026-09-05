// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOptimisable, optimised } from './img';

const SUPA = 'https://abc.supabase.co/storage/v1/object/public/skoolos-files/logo/crest.jpg';

describe('optimised()', () => {
  it('routes a registered host through the optimiser', () => {
    const out = optimised(SUPA, 128);
    expect(out).toContain('/_next/image?url=');
    expect(out).toContain('w=128');
    expect(out).toContain(encodeURIComponent(SUPA));
  });

  // Next answers 400 for a width it was not configured with, which would turn
  // every image on the page into a broken one.
  it('snaps a requested width up to one Next will serve', () => {
    expect(optimised(SUPA, 40)).toContain('w=48');
    expect(optimised(SUPA, 200)).toContain('w=256');
    expect(optimised(SUPA, 1500)).toContain('w=1920');
  });

  it('leaves an unregistered host alone rather than breaking it', () => {
    for (const u of [
      'http://localhost:9000/skoolos/logo.png',   // MinIO in local dev
      'https://cdn.example.com/logo.png',
      'http://abc.supabase.co/insecure.png',      // http is not registered
    ]) {
      expect(optimised(u, 128), u).toBe(u);
      expect(isOptimisable(u), u).toBe(false);
    }
  });

  it('survives a malformed URL', () => {
    expect(optimised('not a url', 128)).toBe('not a url');
    expect(isOptimisable(undefined)).toBe(false);
  });
});

// The helper's host pattern and the build's remotePatterns are two statements
// of the same fact. If they drift, the optimiser is asked for a host it will
// refuse, and every school photo 400s.
describe('the host list', () => {
  it('matches what next.config.mjs registers', () => {
    const cfg = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8');
    expect(cfg).toContain('supabase.co');
    expect(isOptimisable('https://x.supabase.co/a.png')).toBe(true);
  });
});
