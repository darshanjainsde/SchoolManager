// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The staff-role list exists in THREE places and nothing checked they agreed.
 *
 *   1. `enum StaffRole` in packages/db/prisma/schema.prisma  — the database
 *   2. `STAFF_ROLES` in apps/api/.../management.dto.ts       — what the API accepts
 *   3. `STAFF_ROLES` in apps/web/app/app/staff/page.tsx      — what the UI offers
 *
 * The same shape as the feature-key drift found hours earlier, and the same
 * consequence: the UI offers a value, the API refuses it, and the user is told
 * the thing they just picked is not a valid choice. The feature-key version got
 * a guard; this one did not, and it should have — recognising a pattern and not
 * acting on it is how it happens a second time.
 *
 * Text-parsed, never imported: the schema is not TypeScript, and importing the
 * API's DTO would pull class-validator and Prisma into a web test.
 */
const root = resolve(process.cwd(), '../..');
const schemaSrc = readFileSync(resolve(root, 'packages/db/prisma/schema.prisma'), 'utf8');
const apiDtoSrc = readFileSync(
  resolve(root, 'apps/api/src/modules/management/management.dto.ts'),
  'utf8',
);
const consoleSrc = readFileSync(resolve(process.cwd(), 'app/app/staff/page.tsx'), 'utf8');

/** Values of a Prisma enum block, ignoring its `///` doc comments. */
function prismaEnumValues(src: string, name: string): string[] {
  const start = src.indexOf(`enum ${name} {`);
  if (start === -1) throw new Error(`enum not found: ${name}`);
  const body = src.slice(start, src.indexOf('}', start));
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

/** Quoted UPPER_CASE literals from the first bracket group that has any. */
function tsArrayValues(src: string, declaration: string): string[] {
  const start = src.indexOf(declaration);
  if (start === -1) throw new Error(`declaration not found: ${declaration}`);
  for (const group of src.slice(start, start + 2000).matchAll(/\[([^\]]*)\]/g)) {
    const keys = [...group[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    if (keys.length > 0) return keys;
  }
  return [];
}

describe('staff roles agree across database, API and console', () => {
  it('parses a non-empty list from all three', () => {
    // A silently-empty parse would make every comparison below trivially true.
    expect(prismaEnumValues(schemaSrc, 'StaffRole').length).toBeGreaterThan(3);
    expect(tsArrayValues(apiDtoSrc, 'const STAFF_ROLES').length).toBeGreaterThan(3);
    expect(tsArrayValues(consoleSrc, 'const STAFF_ROLES').length).toBeGreaterThan(3);
  });

  it('the API accepts exactly what the database allows', () => {
    // Otherwise a valid row cannot be created through the API, or the API
    // accepts a value the database will reject at write time.
    expect(tsArrayValues(apiDtoSrc, 'const STAFF_ROLES').sort()).toEqual(
      prismaEnumValues(schemaSrc, 'StaffRole').sort(),
    );
  });

  it('the console offers exactly what the API accepts', () => {
    // This is the one that shipped broken: the dropdown offered Librarian and
    // the API answered "role must be one of the following values: OFFICE,
    // SUPPORT, DRIVER, HELPER, SECURITY, OTHER".
    expect(tsArrayValues(consoleSrc, 'const STAFF_ROLES').sort()).toEqual(
      tsArrayValues(apiDtoSrc, 'const STAFF_ROLES').sort(),
    );
  });

  it('every role the console can show has a human label', () => {
    // A missing label renders `undefined` in the dropdown and on every card.
    const labels = consoleSrc.slice(consoleSrc.indexOf('const ROLE_LABELS'));
    for (const role of tsArrayValues(consoleSrc, 'const STAFF_ROLES')) {
      expect(labels.slice(0, labels.indexOf('};'))).toContain(`${role}:`);
    }
  });
});
