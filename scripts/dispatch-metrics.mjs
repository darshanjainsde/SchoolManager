#!/usr/bin/env node
/**
 * dispatch-metrics — where the time and tokens actually went.
 *
 * Every subagent dispatch reports subagent_tokens / tool_uses / duration_ms.
 * Read once and forgotten, those numbers tell you nothing. Recorded, they
 * answer the only question that matters when a build feels slow: *which
 * shape of work is expensive, and how much of it produced nothing?*
 *
 * The `outcome` field is the point. A dispatch that died after 90 minutes
 * having committed nothing costs exactly as much as one that shipped a
 * feature — and only this field distinguishes them.
 *
 *   node scripts/dispatch-metrics.mjs log --phase 1a --task "Batch B" \
 *     --kind impl --tokens 232953 --tools 110 --seconds 1675 --outcome shipped
 *
 *   node scripts/dispatch-metrics.mjs report
 *   node scripts/dispatch-metrics.mjs report --phase 0a
 *
 * outcomes: shipped | shipped-after-fix | died-nothing | died-partial | stalled
 * kinds:    impl | fix | review | rereview
 *
 * Node built-ins only.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = resolve(ROOT, '.superpowers/dispatch-metrics.jsonl');

const HUMAN_RECOVERABLE = new Set(['died-partial', 'stalled']);
const WASTED = new Set(['died-nothing']);

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}

function load() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function append(entry) {
  mkdirSync(dirname(LOG), { recursive: true });
  writeFileSync(LOG, `${JSON.stringify(entry)}\n`, { flag: 'a' });
}

function hhmm(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

function k(tokens) {
  return `${Math.round(tokens / 1000)}k`;
}

const cmd = process.argv[2];

if (cmd === 'log') {
  const entry = {
    at: new Date().toISOString(),
    phase: arg('phase', 'unknown'),
    task: arg('task', 'unnamed'),
    kind: arg('kind', 'impl'),
    tokens: Number(arg('tokens', 0)),
    tools: Number(arg('tools', 0)),
    seconds: Number(arg('seconds', 0)),
    outcome: arg('outcome', 'shipped'),
    note: arg('note', ''),
  };
  append(entry);
  console.log(`+ ${entry.phase} · ${entry.task} · ${entry.kind} · ${k(entry.tokens)} · ${hhmm(entry.seconds)} · ${entry.outcome}`);
  process.exit(0);
}

if (cmd !== 'report') {
  console.error('usage: dispatch-metrics.mjs log|report [--phase X]');
  process.exit(1);
}

const phaseFilter = arg('phase');
const rows = load().filter((r) => !phaseFilter || r.phase === phaseFilter);
if (rows.length === 0) {
  console.log('no dispatches recorded yet');
  process.exit(0);
}

const sum = (f, pred = () => true) => rows.filter(pred).reduce((a, r) => a + (r[f] || 0), 0);

const totalSec = sum('seconds');
const totalTok = sum('tokens');
const wastedSec = sum('seconds', (r) => WASTED.has(r.outcome));
const wastedTok = sum('tokens', (r) => WASTED.has(r.outcome));
const recovSec = sum('seconds', (r) => HUMAN_RECOVERABLE.has(r.outcome));

console.log(`\n  DISPATCH METRICS${phaseFilter ? ` — phase ${phaseFilter}` : ''}`);
console.log(`  ${rows.length} dispatches · ${hhmm(totalSec)} · ${k(totalTok)} tokens\n`);

// ── by kind ────────────────────────────────────────────────────────────────
const kinds = [...new Set(rows.map((r) => r.kind))];
console.log('  BY KIND');
for (const kind of kinds) {
  const sec = sum('seconds', (r) => r.kind === kind);
  const tok = sum('tokens', (r) => r.kind === kind);
  const n = rows.filter((r) => r.kind === kind).length;
  const pct = Math.round((sec / totalSec) * 100);
  console.log(`    ${kind.padEnd(9)} ${String(n).padStart(3)}×  ${hhmm(sec).padStart(7)}  ${k(tok).padStart(6)}  ${String(pct).padStart(3)}% of wall time`);
}

// ── by outcome — the part that matters ────────────────────────────────────
console.log('\n  BY OUTCOME');
for (const outcome of [...new Set(rows.map((r) => r.outcome))]) {
  const sec = sum('seconds', (r) => r.outcome === outcome);
  const n = rows.filter((r) => r.outcome === outcome).length;
  const pct = Math.round((sec / totalSec) * 100);
  const flag = WASTED.has(outcome) ? '  ← produced nothing' : HUMAN_RECOVERABLE.has(outcome) ? '  ← needed manual recovery' : '';
  console.log(`    ${outcome.padEnd(18)} ${String(n).padStart(3)}×  ${hhmm(sec).padStart(7)}  ${String(pct).padStart(3)}%${flag}`);
}

// ── the headline ──────────────────────────────────────────────────────────
console.log('\n  WASTE');
console.log(`    Dispatches that produced NOTHING:  ${hhmm(wastedSec)} · ${k(wastedTok)} tokens · ${Math.round((wastedSec / totalSec) * 100)}% of all wall time`);
console.log(`    Dispatches needing manual rescue:  ${hhmm(recovSec)} · ${Math.round((recovSec / totalSec) * 100)}%`);

// ── worst individual dispatches ───────────────────────────────────────────
const worst = [...rows].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
console.log('\n  LONGEST DISPATCHES');
for (const r of worst) {
  const flag = WASTED.has(r.outcome) ? ' ← nothing' : HUMAN_RECOVERABLE.has(r.outcome) ? ' ← rescued' : '';
  console.log(`    ${hhmm(r.seconds).padStart(7)}  ${k(r.tokens).padStart(6)}  ${r.phase}/${r.task} (${r.kind})${flag}`);
}

// ── retries per task ──────────────────────────────────────────────────────
const byTask = {};
for (const r of rows) {
  const key = `${r.phase}/${r.task}`;
  byTask[key] ??= { n: 0, sec: 0, dead: 0 };
  byTask[key].n++;
  byTask[key].sec += r.seconds;
  if (WASTED.has(r.outcome) || HUMAN_RECOVERABLE.has(r.outcome)) byTask[key].dead++;
}
const repeated = Object.entries(byTask).filter(([, v]) => v.dead >= 2).sort((a, b) => b[1].sec - a[1].sec);
if (repeated.length) {
  console.log('\n  TASKS THAT NEEDED 2+ RESCUES  ← these are where a smaller dispatch would have paid');
  for (const [task, v] of repeated) {
    console.log(`    ${hhmm(v.sec).padStart(7)}  ${v.n} dispatches, ${v.dead} lost/rescued  ${task}`);
  }
}
console.log('');
