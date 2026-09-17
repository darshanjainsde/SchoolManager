import * as fs from 'fs';
import * as path from 'path';

/**
 * THE STANDARD, HELD BY A TEST (second edition, D12).
 *
 * The app's own rule, stated in three places, is that emoji are drawn by
 * the OS — different on every Android vendor, pre-coloured, unable to take
 * the school's colour, and read aloud as part of a sentence. The rule was
 * breached six times in the hero and once on Home. This sweep is what stops
 * the seventh: any Extended_Pictographic character in a component or screen
 * file fails the build with the file and line.
 *
 * Text glyphs like ✓ and ✕ are NOT emoji (they have no emoji presentation)
 * and stay allowed — the register's tick is one.
 */
const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];
const EMOJI = /\p{Extended_Pictographic}/u;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') && !/ \d+\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the standard — no emoji in a screen or component', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(path.join(ROOT, d)));

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f] as const))('%s draws no emoji', (_label, file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const hits = lines.map((l, i) => (EMOJI.test(l) ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
    if (hits.length) {
      throw new Error(`${path.relative(ROOT, file)} draws an emoji — use a duotone glyph (components/icons.tsx) or a word:\n  ${hits.join('\n  ')}`);
    }
  });
});
