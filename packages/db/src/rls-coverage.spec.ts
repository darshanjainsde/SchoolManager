import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every table must have row-level security enabled by some migration.
 *
 * Supabase exposes the whole `public` schema through its Data API, so a table
 * without RLS is readable and writable by anyone holding the project's anon
 * key. Its scanner reported exactly that against production
 * (`rls_disabled_in_public`): eight tables had been created by later migrations
 * that never joined the RLS loop the original `rls_and_roles` migration
 * established. Nothing catches this in review, because each migration looks
 * complete on its own — the gap only exists relative to the whole set.
 *
 * This check needs no database: it reads the models out of schema.prisma and
 * the tables out of every migration's RLS statements, and fails on the
 * difference. That means it runs in the ordinary unit-test job and catches the
 * omission in the pull request that introduces it, rather than in a scanner
 * email weeks later.
 *
 * If a new table genuinely must stay open, add it to ALLOWED_WITHOUT_RLS with
 * the reason. Making the exception explicit is the point; silence is what cost
 * us the last one.
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
const SCHEMA = join(__dirname, '..', 'prisma', 'schema.prisma');

/** Tables deliberately left without RLS, each with the reason it is safe. */
const ALLOWED_WITHOUT_RLS: Record<string, string> = {
  // Prisma's own migration bookkeeping, not application data.
  _prisma_migrations: 'Prisma internal',
};

function modelTables(): string[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  return models.map(([, name, body]) => {
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    return mapped ? mapped[1] : name;
  });
}

/**
 * Tables named by an `ENABLE ROW LEVEL SECURITY` anywhere in the migrations —
 * both the literal `ALTER TABLE "X"` form and the `FOREACH t IN ARRAY [...]`
 * loop the older migrations use. Reading only the literal form would report
 * fifty false positives and teach everyone to ignore this test.
 */
/**
 * Tables that some migration creates an actual POLICY for.
 *
 * `ENABLE ROW LEVEL SECURITY` alone denies everything to non-owners, but this
 * suite's docstring claims tenant isolation, and that needs a policy. A table
 * enabled with a permissive `USING (true)` would have passed the check below
 * while isolating nothing — flagged by a 4 Sept 2026 audit.
 */
function tablesWithPolicy(): Set<string> {
  const found = new Set<string>();
  for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir.name, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    for (const [, table] of sql.matchAll(/CREATE POLICY\s+"?[A-Za-z_]+"?\s+ON\s+"?([A-Za-z_]+)"?/gi)) {
      found.add(table);
    }
    // The FOREACH loops create policies for every table in their array.
    if (/CREATE POLICY/i.test(sql)) {
      for (const [, arr] of sql.matchAll(/ARRAY\s*\[([^\]]+)\]/g)) {
        for (const [, t] of arr.matchAll(/'([A-Za-z_]+)'/g)) found.add(t);
      }
    }
  }
  return found;
}

function tablesWithRls(): Set<string> {
  const found = new Set<string>();
  for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir.name, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    for (const [, table] of sql.matchAll(/ALTER TABLE\s+"?([A-Za-z_]+)"?\s+ENABLE ROW LEVEL SECURITY/gi)) {
      found.add(table);
    }
    if (/ENABLE ROW LEVEL SECURITY/i.test(sql)) {
      for (const [, block] of sql.matchAll(/ARRAY\s*\[([\s\S]*?)\]/g)) {
        for (const [, table] of block.matchAll(/'([A-Za-z_]+)'/g)) found.add(table);
      }
    }
  }
  return found;
}

describe('RLS coverage', () => {
  it('enables row-level security on every table in the schema', () => {
    const covered = tablesWithRls();
    const uncovered = modelTables()
      .filter((t) => !covered.has(t))
      .filter((t) => !(t in ALLOWED_WITHOUT_RLS));

    expect(uncovered).toEqual([]);
  });

  it('reads the loop form, not just literal ALTER TABLE statements', () => {
    // Guards the guard: if this regex ever stops matching the FOREACH arrays,
    // the test above turns into a wall of false failures and gets deleted.
    const covered = tablesWithRls();
    expect(covered.has('Student')).toBe(true); // only ever enabled via a loop
    expect(covered.has('EmailSettings')).toBe(true); // only ever via ALTER TABLE
  });
});

describe('the coverage check is measuring something', () => {
  // Both lists are produced by regex over files. If the schema is ever
  // reformatted so `modelTables()` matches nothing, `uncovered` is empty and
  // the suite above passes having verified nothing at all. The e2e sibling
  // already guards its own count for exactly this reason ("not a vacuous pass
  // against an empty database"); this is the static half.
  it('parses a realistic number of models out of the schema', () => {
    expect(modelTables().length).toBeGreaterThan(80);
  });

  it('finds RLS statements in the migrations', () => {
    expect(tablesWithRls().size).toBeGreaterThan(80);
  });

  it('finds CREATE POLICY statements in the migrations', () => {
    expect(tablesWithPolicy().size).toBeGreaterThan(80);
  });
});

describe('every tenant table has a policy, not just RLS enabled', () => {
  // ENABLE ROW LEVEL SECURITY denies non-owners everything; it does not
  // isolate tenants. Only a policy does. Asserting the enable alone let a
  // permissive `USING (true)` pass as "covered".
  it('creates a policy for every model it enables RLS on', () => {
    const policies = tablesWithPolicy();
    const missing = modelTables()
      .filter((t) => !(t in ALLOWED_WITHOUT_RLS))
      .filter((t) => !policies.has(t));
    expect(missing).toEqual([]);
  });

  it('never writes a permissive USING (true) policy', () => {
    const offenders: string[] = [];
    for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      let sql: string;
      try {
        sql = readFileSync(join(MIGRATIONS_DIR, dir.name, 'migration.sql'), 'utf8');
      } catch {
        continue;
      }
      if (/USING\s*\(\s*true\s*\)/i.test(sql)) offenders.push(dir.name);
    }
    expect(offenders).toEqual([]);
  });
});
