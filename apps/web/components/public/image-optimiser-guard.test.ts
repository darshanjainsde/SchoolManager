import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every school-uploaded photo must go through the image optimiser.
 *
 * School media arrives at whatever size the school happened to have — the
 * project's own note records a crest displayed at 240px shipping as a 238 KB
 * JPEG. `next/image` cannot reach a CSS `background-image`, which is how this
 * site paints heroes, course covers and event covers, so `lib/img.ts` exists to
 * build the optimiser URL by hand.
 *
 * Seven call sites did that correctly and SEVEN DID NOT — the split hero's side
 * tiles, the side-panel still, the collage band (up to four full-size photos as
 * the LCP), plus the course and event covers in four other sections. Nothing
 * caught it: each one renders perfectly, just enormous.
 *
 * So the rule is mechanical rather than remembered. `optimised()` returns the
 * original URL untouched for any host we have not registered, so wrapping is
 * always safe — there is no case where the bare interpolation is correct.
 */
const ROOT = join(__dirname, '..');
const DIRS = ['public', 'public/sections', 'marketing'];

function tsxFiles(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(join(ROOT, d));
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.endsWith('.tsx') && !e.includes('.test.')) out.push(join(ROOT, d, e));
    }
  }
  return out;
}

/** `backgroundImage: `url('${EXPR}')`` — captures EXPR. */
const BG = /backgroundImage:\s*`url\('\$\{([^}]*)\}'\)`/g;

describe('school photos always go through the image optimiser', () => {
  it('every backgroundImage interpolation calls optimised()', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (const m of src.matchAll(BG)) {
        const expr = m[1].trim();
        if (expr.startsWith('optimised(')) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file.slice(ROOT.length + 1)}:${line} — ${lines[line - 1]?.trim()}`);
      }
    }
    expect(offenders, `wrap these in optimised(url, width):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('finds the call sites it is meant to be guarding', () => {
    // If the pattern ever stops matching, the test above passes vacuously.
    const total = tsxFiles().reduce(
      (n, f) => n + [...readFileSync(f, 'utf8').matchAll(BG)].length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(11);
  });
});
