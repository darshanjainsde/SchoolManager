import * as fs from 'fs';
import * as path from 'path';

/**
 * THE DATE STANDARD, HELD BY A TEST. Every date on screen goes through
 * lib/dates.ts. `toLocaleDateString(undefined, …)` follows the phone's own
 * language (an English-US phone writes "Oct 1, 2026") and a bare
 * `toLocaleString()` adds US order and seconds — six date shapes were on
 * screen at once before this (re-audit 2026-10-08).
 */
const SRC = path.join(__dirname, '..');
const ALLOWED = new Set(['lib/dates.ts']);
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(e.name) && !/ \d+\.tsx?$/.test(e.name) ? [full] : [];
  });
}
const files = ['app', 'components', 'lib'].flatMap((d) => walk(path.join(SRC, d)));

it('scans a real tree', () => expect(files.length).toBeGreaterThan(100));

it.each(files.map((f) => [path.relative(SRC, f), f] as const))('%s formats no date by itself', (rel, file) => {
  if (ALLOWED.has(rel)) return;
  const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  const hits = code.match(/\.(toLocaleDateString|toLocaleTimeString|toDateString)\(|\.toLocaleString\(\s*(\)|['"]en|undefined)/g);
  if (hits) throw new Error(`${rel} formats a date itself (${hits.join(', ')}) — use lib/dates.ts`);
});
