/**
 * Rebuild the scorecard page from the last audit run.
 *
 * The scorecard is a published artifact the owner opens; it used to be
 * hand-edited, which meant the page and `log/latest.json` could disagree and
 * the page always won, because it is the one anybody looks at. This script
 * makes the log the only source: run the audit, run this, publish the file.
 *
 *     node scripts/audit/page-audit.mjs
 *     node scripts/audit/scorecard.mjs        # → scripts/audit/scorecard.html
 *
 * Surfaces come from the scanner's own `surface` field, so the page and the log
 * can never disagree about which bit of the product a route belongs to.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const log = JSON.parse(readFileSync(resolve(here, 'log/latest.json'), 'utf8'));

// The scanner already records which surface each route belongs to; this page
// reads that rather than deciding again, so the two can never disagree.
/**
 * The last run on an EARLIER DAY, for the "what changed" band.
 *
 * Deliberately not `latest.json`'s own `changes`, which diffs against the
 * previous run whenever that was. Fixing things means running the audit
 * several times in an afternoon, and by the last of those the diff is empty —
 * so the page would report "nothing moved" on the very day everything did.
 * The reader's question is "what changed since I last looked", and the answer
 * is the last dated file that is not today's.
 */
function previousRun() {
  const today = log.scannedAt.slice(0, 10);
  const files = readdirSync(resolve(here, 'log'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter((f) => f.slice(0, 10) < today)
    .sort();
  const last = files.pop();
  if (!last) return null;
  return { file: last, ...JSON.parse(readFileSync(resolve(here, 'log', last), 'utf8')) };
}

const rows = log.rows.map((r) => ({
  r: r.route,
  s: r.surface,
  g: r.grade,
  q: r.mountQueries ?? 0,
  k: r.firstLoadKb ?? 0,
  f: (r.findings ?? []).map((f) => ({ u: f.rule, d: f.detail, w: f.where ?? '', l: f.line ?? 0 })),
}));

const prev = previousRun();

/** Grades that moved since that run — computed here, over the same two files. */
function movesSince(before) {
  if (!before) return [];
  const was = new Map(before.rows.map((r) => [r.route, r.grade]));
  const out = [];
  for (const r of log.rows) {
    const then = was.get(r.route);
    if (!then) out.push({ route: r.route, from: 'new', to: r.grade });
    else if (then !== r.grade) out.push({ route: r.route, from: then, to: r.grade });
  }
  for (const [route, grade] of was) {
    if (!log.rows.some((r) => r.route === route)) out.push({ route, from: grade, to: 'gone' });
  }
  return out;
}

const data = {
  at: log.scannedAt,
  pages: log.pages,
  perfect: log.perfect,
  moderate: log.moderate,
  broken: log.broken,
  changes: movesSince(prev),
  prev: prev ? { at: prev.scannedAt, pages: prev.pages, perfect: prev.perfect, moderate: prev.moderate, broken: prev.broken } : null,
  rows,
};

const template = readFileSync(resolve(here, 'scorecard.template.html'), 'utf8');
const out = template.replace('/*__DATA__*/null', JSON.stringify(data));
writeFileSync(resolve(here, 'scorecard.html'), out);

console.log(`scorecard.html — ${data.pages} pages · ${data.perfect} perfect · ${data.moderate} moderate · ${data.broken} broken`);
if (prev) console.log(`  previous run ${prev.file}: ${prev.perfect} perfect · ${prev.moderate} moderate`);
console.log(`  ${data.changes.length} routes changed grade`);
