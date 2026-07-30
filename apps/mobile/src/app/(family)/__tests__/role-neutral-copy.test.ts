import * as fs from 'fs';
import * as path from 'path';

/**
 * Node-script-style test — the jest-native equivalent of
 * `rg -in "your child|parent" apps/mobile/src/app/(family)`.
 *
 * WHY: parents and students share ONE STUDENT login until the payments
 * module ships a real PARENT role. The app has no way to know whether a
 * parent or the student is holding the phone, so any copy that assumes a
 * parent-reader ("your child", "your daughter", a stray "parent") is simply
 * WRONG — it reads correctly to nobody in the STUDENT-is-actually-reading
 * case. See `docs/sync/2026-07-28-teacher-student-portal-parity.md` P1/S1/S2.
 *
 * Scope: every .tsx file under `app/(family)` (the whole family portal),
 * excluding this test file itself and other test files (which legitimately
 * name the bug in a comment/string when asserting it is fixed).
 */
const ROOT = path.join(__dirname, '..'); // apps/mobile/src/app/(family)
const ROLE_ASSUMING_PATTERN = /your child|\bparent\b/i;

/**
 * Strips `//` and `/* *\/` comments before matching. This test's job is to
 * catch role-assuming COPY actually shown to the user (JSX text, alert
 * strings) — not to forbid a code comment from naming the constraint it is
 * working around (this very file, and home.tsx's identity-card comment,
 * both legitimately say "parent" while explaining why the UI does not).
 * Naive on purpose: these screens have no string literals containing `//`
 * (no URLs), so a real regex-based comment-stripper would be overkill.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('role-neutral copy — the family portal never assumes a parent reader', () => {
  const files = listFiles(ROOT);

  it('found at least one screen to scan (sanity check the scan itself is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
    '%s has no role-assuming copy ("your child" / "parent")',
    (_label, file) => {
      const content = stripComments(fs.readFileSync(file, 'utf8'));
      const match = content.match(ROLE_ASSUMING_PATTERN);
      if (match) {
        throw new Error(
          `${path.relative(ROOT, file)} contains role-assuming copy: "${match[0]}". ` +
            'With a single shared STUDENT login the app cannot know whether a parent or the ' +
            'student is holding the phone — use the student\'s own name/class/role-neutral phrasing instead.',
        );
      }
    },
  );
});
