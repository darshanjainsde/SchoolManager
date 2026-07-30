import * as fs from 'fs';
import * as path from 'path';

// Node-script-style test — the jest-native equivalent of
// `rg -n "#[0-9a-fA-F]{3,8}" apps/mobile/src`. Every colour used by a
// component must come from the theme palette (`useTokens()`/`tokens`/
// `brand`/`emergency`) so it can respond to dark mode (or, for the
// deliberately-fixed brand/emergency constants, at least live in ONE place
// instead of being copy-pasted as a magic literal). A hex literal reappearing
// in a component file means a colour slipped back to hard-coded — this test
// fails loudly instead of shipping another one-off `'#F1F3F7'`.
//
// Scope: only .tsx files under app/ and components/ (the actual UI
// component tree) — NOT theme/tokens.ts itself (that's the one file allowed,
// even required, to contain the literal hex values), not test files (which
// legitimately assert against expected rendered hex output), and not
// non-component .ts library code (lib/*, which has no styling to begin
// with).
const ROOT = path.join(__dirname, '..'); // apps/mobile/src
const SCAN_DIRS = ['app', 'components'];
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}/g;

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

describe('hex sweep — no hard-coded hex colours in component files', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(ROOT, d)));

  it('found at least one component file to scan (sanity check the scan itself is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
    '%s has no literal hex colour',
    (_label, file) => {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(HEX_PATTERN) ?? [];
      if (matches.length > 0) {
        throw new Error(
          `${path.relative(ROOT, file)} contains hard-coded hex colour(s): ${matches.join(', ')}. ` +
            'Move it into theme/tokens.ts (a scheme-aware token via useTokens(), or brand/emergency for deliberately fixed colours) instead.',
        );
      }
    },
  );
});
