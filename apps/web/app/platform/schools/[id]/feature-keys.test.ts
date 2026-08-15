// @vitest-environment node
//
// Reads packages/db/src/features.ts off disk as TEXT and never imports it.
// Importing would pull `@skoolos/db`'s barrel — and PrismaClient with it — into
// a test that has no business opening a database, and into a bundle that has no
// business shipping one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The owner console keeps its own copy of the feature list because a client
 * component cannot import the db package. That copy DRIFTED, and the drift was
 * invisible until someone went looking for a checkbox that was never rendered.
 *
 * Two keys were missing — HIRING and LIBRARY — and the consequence is bigger
 * than a missing row: this page is the ONLY UI that writes `featureOverrides`,
 * so a key absent here cannot be enabled for any school by anyone. LIBRARY sits
 * in no tier's default set by design, which means the override path is its only
 * route to being on at all. The entire library feature was unreachable.
 *
 * This test is the thing that makes keeping a copy acceptable.
 */
const featuresSrc = readFileSync(
  resolve(process.cwd(), '../../packages/db/src/features.ts'),
  'utf8',
);
const consoleSrc = readFileSync(
  resolve(process.cwd(), 'app/platform/schools/[id]/page.tsx'),
  'utf8',
);

/**
 * Pulls the quoted string literals out of a named array declaration.
 *
 * Takes the first bracket group that actually CONTAINS keys, rather than the
 * first bracket after the name. `const ALL_KEYS: FeatureKey[] = [...]` has an
 * earlier `[` in its type annotation, and locking onto that one reads an empty
 * slice — which would have made every assertion here vacuously true had the
 * non-empty check below not caught it first.
 */
function keysFrom(src: string, declaration: string): string[] {
  const start = src.indexOf(declaration);
  if (start === -1) throw new Error(`declaration not found: ${declaration}`);
  const tail = src.slice(start, start + 2000);
  for (const group of tail.matchAll(/\[([^\]]*)\]/g)) {
    const keys = [...group[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    if (keys.length > 0) return keys;
  }
  return [];
}

describe('owner console feature list matches the source of truth', () => {
  it('parses a non-empty list from each side', () => {
    // Without this, a regex that silently matched nothing would make every
    // assertion below vacuously true — the same failure the RLS coverage audit
    // guards against by counting what it checked.
    expect(keysFrom(featuresSrc, 'const ALL_KEYS').length).toBeGreaterThan(5);
    expect(keysFrom(consoleSrc, 'const ALL_FEATURES').length).toBeGreaterThan(5);
  });

  it('offers a checkbox for EVERY feature key, or that feature can never be enabled', () => {
    const truth = keysFrom(featuresSrc, 'const ALL_KEYS').sort();
    const shown = keysFrom(consoleSrc, 'const ALL_FEATURES').sort();
    expect(shown).toEqual(truth);
  });

  it('includes LIBRARY, which no tier grants and only this screen can turn on', () => {
    expect(keysFrom(consoleSrc, 'const ALL_FEATURES')).toContain('LIBRARY');
  });

  it("agrees with PRO's granted set, so the tier/override badge tells the truth", () => {
    // A key the tier grants shows "tier"; anything else shows "override". Get
    // this wrong and the badge misreports how a school came to have a feature —
    // which is the one question this screen exists to answer.
    const proLine = featuresSrc.slice(featuresSrc.indexOf('const PRO:'));
    const proAdds = [...proLine.slice(0, proLine.indexOf(']')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    const consolePro = keysFrom(consoleSrc, "PRO: new Set");
    for (const key of proAdds) expect(consolePro).toContain(key);
  });
});
