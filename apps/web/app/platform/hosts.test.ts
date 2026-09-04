// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

const pages = walk(resolve(process.cwd(), 'app/platform'));

describe('the owner console never names a domain itself', () => {
  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(8);
  });

  it('takes the owner host from lib/hosts, not a literal', () => {
    // /platform/jobs hardcoded 'owner.sckools.com'. On staging OWNER_HOST is
    // owner.test.sckools.com, so every request that page made was refused by
    // the owner-host guard with 403 and the vacancy queue was permanently
    // empty — on a page whose only job is to show a queue.
    const offenders = pages.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /hostHeader:\s*['"][^'"]*sckools/.test(src);
    });
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
