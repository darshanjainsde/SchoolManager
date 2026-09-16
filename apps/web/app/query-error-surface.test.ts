import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A failed request must never render as a loading message.
 *
 * `if (q.isLoading || !q.data) return <Loading/>` is true on EVERY failure —
 * `data` is undefined and `isLoading` is false — so a 404, a 500, a dropped
 * connection or an expired session leaves the screen sitting on its loading
 * line for good. Nothing errors and nothing logs; the only symptom is a user
 * saying the page is slow.
 *
 * It was written THIRTEEN times across the console before anybody noticed, and
 * the one that got reported — the year-end wizard's "Adding it up…" — was
 * behind queries that take 0.5-3.7 ms. The product was not slow. It was
 * finished and broken, and the screen was the only thing that did not know.
 *
 * The rule: if a component gates on `isLoading || !data`, it must also answer
 * `isError` somewhere. `components/ui/query-state.tsx` has the standard block.
 */
const APP = __dirname;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (e.endsWith('.tsx') && !e.includes('.test.')) out.push(p);
  }
  return out;
}

/** `if (thing.isLoading || !…` / `if (thing.isPending || !…` → the query's name. */
const GATE = /if\s*\(\s*(\w+)\.(?:isLoading|isPending)\s*\|\|\s*!/;

describe('a failed request is never shown as "loading"', () => {
  it('every loading gate is paired with an error branch', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(APP)) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        const m = line.match(GATE);
        if (!m) return;
        const query = m[1];
        // The same query must be asked about its failure somewhere in the file.
        if (new RegExp(`\\b${query}\\.isError\\b`).test(src)) return;
        offenders.push(`${file.slice(APP.length + 1)}:${i + 1} — ${query} gates on loading but its failure is never rendered`);
      });
    }
    expect(offenders, `these will sit on a loading message forever when the request fails:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the scan reaches the screens it is meant to guard', () => {
    // Without this it passes vacuously the day the walk breaks.
    const files = tsxFiles(APP);
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.endsWith(join('sessions', 'steps', 'review.tsx')))).toBe(true);
  });
});
