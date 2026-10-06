import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ADMISSIONS MIGRATIONS ARE EXPAND-ONLY, AND THIS IS WHAT HOLDS THEM TO IT.
 *
 * They are applied by the owner through the db-migrate workflow BEFORE the code
 * that uses them is merged. Between those two moments the deployed API keeps
 * inserting website enquiries with no idea these columns exist, and any backup
 * taken before today can be restored onto the new schema — `applyRows` in the
 * backup engine refuses a NOT NULL column that has no default. So every column
 * must be optional to a writer that does not know it.
 *
 * And an enum value cannot be USED in the transaction that adds it (Prisma
 * wraps each migration in one), so the ADD VALUEs sit in a file of their own —
 * the 20260904170000_enquiry_stages precedent.
 */
const DIR = join(__dirname, '..', 'prisma', 'migrations');
const read = (name: string): string => readFileSync(join(DIR, name, 'migration.sql'), 'utf8');
/** The SQL with its `--` comment lines removed, so prose cannot satisfy or trip a check. */
const code = (src: string): string => src.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const ENUMS = '20261006_000000_admissions_enum_values';
const COLUMNS = '20261006_000100_enquiry_lead_fields';

describe('the admissions migrations', () => {
  it('adds the two enum values in a file of their own, and nothing else', () => {
    const statements = code(read(ENUMS)).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(statements).toEqual([
      `ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMISSIONS'`,
      `ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'INTERESTED' BEFORE 'VISITED'`,
    ]);
  });

  it('never uses a value in the same file that adds it', () => {
    expect(code(read(COLUMNS))).not.toMatch(/INTERESTED|ADMISSIONS/);
  });

  it('adds exactly the five lead columns', () => {
    const names = [...code(read(COLUMNS)).matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(['childName', 'lastContactedAt', 'source', 'updatedAt', 'whatsappOk']);
  });

  it('every column an older writer leaves out is nullable or has a default', () => {
    const sql = code(read(COLUMNS));
    const adds = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"\s+([^,;]+)/g)];
    expect(adds.length).toBe(5);
    for (const [, name, definition] of adds) {
      const notNull = /NOT NULL/.test(definition) || new RegExp(`"${name}" SET NOT NULL`).test(sql);
      const hasDefault = /DEFAULT/.test(definition) || new RegExp(`"${name}" SET DEFAULT`).test(sql);
      expect({ name, safe: !notNull || hasDefault }).toEqual({ name, safe: true });
    }
  });

  it('drops nothing and leaves row-level security alone', () => {
    const all = code(read(ENUMS)) + code(read(COLUMNS));
    expect(all).not.toMatch(/\bDROP\b/i);
    expect(all).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(all).not.toMatch(/\bPOLICY\b/i);
  });
});
