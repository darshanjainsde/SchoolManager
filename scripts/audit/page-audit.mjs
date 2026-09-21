#!/usr/bin/env node
/**
 * Grade every page in the web app, and keep a log so runs can be compared.
 *
 *   node scripts/audit/page-audit.mjs              # scan, print, write the log
 *   node scripts/audit/page-audit.mjs --quiet      # log only
 *   node scripts/audit/page-audit.mjs --diff       # what changed since last run
 *
 * WHY A SCRIPT AND NOT A CONVERSATION. Every audit before this one was a
 * fresh sweep with slightly different rules, so "is this page fine?" got a
 * slightly different answer each time and nothing accumulated. The rules live
 * in checks.mjs, the verdicts land in log/, and a page that was PERFECT last
 * week and is not today shows up as a regression rather than as a new opinion.
 *
 * The grades are deliberate:
 *   PERFECT  — every check ran and found nothing. Not "unexamined".
 *   MODERATE — works today, carries a cost that grows with the data.
 *   BROKEN   — a person can reach this and be stuck or misled.
 *
 * First-load JavaScript is read from a production build when one is present
 * (.next/app-build-manifest.json). Without it the bundle check is skipped and
 * the run says so, rather than quietly grading on six checks instead of seven.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, gradeOf } from './checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WEB = path.join(REPO, 'apps', 'web');
const APP = path.join(WEB, 'app');
const LOG = path.join(HERE, 'log');

const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');

// ── the page list ────────────────────────────────────────────────────────────
function pages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === 'page.tsx') out.push(p);
  }
  return out;
}

const routeOf = (file) => file.slice(APP.length).replace(/\/page\.tsx$/, '') || '/';

/** Which console a route belongs to — the audit reads by surface. */
function surfaceOf(r) {
  if (r.startsWith('/app')) return 'Admin console';
  if (r.startsWith('/portal')) return 'Family portal';
  if (r.startsWith('/teacher')) return 'Teacher portal';
  if (r.startsWith('/platform') || r === '/owner') return 'Owner console';
  if (r.startsWith('/s/') || r === '/alumni' || r === '/preview') return 'School website';
  if (r.startsWith('/blog') || r.startsWith('/overview')) return 'School website';
  if (r.startsWith('/library') || r.startsWith('/sports') || r === '/staff' || r.startsWith('/sv')) return 'Staff doors';
  return 'Open pages';
}

// ── module graph, so a page is judged with what it renders ──────────────────
const cache = new Map();
function read(file) {
  if (!cache.has(file)) {
    const src = fs.readFileSync(file, 'utf8');
    cache.set(file, {
      src,
      lines: src.split('\n'),
      isClient: /^\s*(['"])use client\1/.test(src.split('\n').slice(0, 3).join('\n')),
    });
  }
  return cache.get(file);
}

function resolveFrom(file) {
  return (spec) => {
    let base;
    if (spec.startsWith('@/')) base = path.join(WEB, spec.slice(2));
    else if (spec.startsWith('.')) base = path.resolve(path.dirname(file), spec);
    else return null;
    for (const c of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
      try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
    }
    return null;
  };
}
const isClientFile = (f) => { try { return read(f).isClient; } catch { return false; } };

/** Files a page pulls in, so a finding in its own components is its finding. */
function graph(entry, limit = 60) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length && seen.size < limit) {
    const f = stack.pop();
    if (seen.has(f) || /\.(test|spec)\.tsx?$/.test(f)) continue;
    seen.add(f);
    let mod;
    try { mod = read(f); } catch { continue; }
    const res = resolveFrom(f);
    for (const m of mod.src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const t = res(m[1]);
      // Only follow into this app's own components, not the whole world.
      if (t && !seen.has(t)) stack.push(t);
    }
  }
  return [...seen];
}

// ── first-load JS from a production build, when there is one ────────────────
function bundleSizes() {
  const log = path.join(HERE, 'build.log');
  const src = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const out = {};
  for (const m of src.matchAll(/^[├└┌│ ]*[○ƒ●]\s+(\S+)\s+[\d.]+\s*[kKMB]+\s+([\d.]+)\s*kB/gm)) {
    out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────
const sizes = bundleSizes();
const haveSizes = Object.keys(sizes).length > 0;
const rows = [];

for (const file of pages(APP).sort()) {
  const route = routeOf(file);
  const own = read(file);
  const files = graph(file);
  const mountQueries = files.reduce(
    (n, f) => { try { return n + (read(f).src.match(/use(Query|Queries|InfiniteQuery)\s*\(/g) || []).length; } catch { return n; } },
    0,
  );

  const findings = [];
  for (const f of files) {
    let mod;
    try { mod = read(f); } catch { continue; }
    const ctx = {
      ...mod,
      file: f,
      route,
      mountQueries: f === file ? mountQueries : 0,
      firstLoadKb: f === file && haveSizes ? sizes[route] : null,
      resolve: resolveFrom(f),
      isClientFile,
    };
    for (const check of CHECKS) {
      for (const hit of check(ctx) ?? []) {
        findings.push({ ...hit, where: path.relative(WEB, f) });
      }
    }
  }

  // One finding per rule per page — the worst one, with a count.
  const byRule = new Map();
  for (const f of findings) {
    const prev = byRule.get(f.rule);
    if (!prev) byRule.set(f.rule, { ...f, count: 1 });
    else prev.count += 1;
  }

  rows.push({
    route,
    surface: surfaceOf(route),
    client: own.isClient,
    files: files.length,
    mountQueries,
    firstLoadKb: haveSizes ? (sizes[route] ?? null) : null,
    grade: gradeOf([...byRule.values()]),
    findings: [...byRule.values()],
  });
}

const summary = {
  scannedAt: new Date().toISOString(),
  pages: rows.length,
  bundleSizes: haveSizes ? 'from a production build' : 'SKIPPED — no build.log, the heavy-bundle check did not run',
  perfect: rows.filter((r) => r.grade === 'PERFECT').length,
  moderate: rows.filter((r) => r.grade === 'MODERATE').length,
  broken: rows.filter((r) => r.grade === 'BROKEN').length,
};

// ── log, and the diff against the run before ────────────────────────────────
fs.mkdirSync(LOG, { recursive: true });
const latestPath = path.join(LOG, 'latest.json');
const previous = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null;

const changes = [];
if (previous) {
  const was = new Map(previous.rows.map((r) => [r.route, r.grade]));
  for (const r of rows) {
    const before = was.get(r.route);
    if (before && before !== r.grade) changes.push({ route: r.route, from: before, to: r.grade });
    if (!before) changes.push({ route: r.route, from: 'new', to: r.grade });
  }
  for (const [route] of was) if (!rows.some((r) => r.route === route)) changes.push({ route, from: was.get(route), to: 'gone' });
}

const payload = { ...summary, changes, rows };
fs.writeFileSync(latestPath, JSON.stringify(payload, null, 1));
fs.writeFileSync(path.join(LOG, `${summary.scannedAt.slice(0, 10)}.json`), JSON.stringify(payload, null, 1));

// ── print ───────────────────────────────────────────────────────────────────
if (!quiet) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nScanned ${summary.pages} pages · bundle sizes: ${summary.bundleSizes}`);
  console.log(`  PERFECT ${summary.perfect}   MODERATE ${summary.moderate}   BROKEN ${summary.broken}\n`);

  for (const grade of ['BROKEN', 'MODERATE']) {
    const list = rows.filter((r) => r.grade === grade);
    if (!list.length) continue;
    console.log(`── ${grade} (${list.length}) ─────────────────────────────`);
    for (const r of list) {
      console.log(`  ${pad(r.route, 44)}`);
      for (const f of r.findings) {
        console.log(`      ${f.severity === 'BROKEN' ? '✗' : '·'} ${f.rule}: ${f.detail}`);
        console.log(`        ${f.where}${f.line ? ':' + f.line : ''}${f.count > 1 ? `  (+${f.count - 1} more)` : ''}`);
      }
    }
    console.log('');
  }

  if (previous) {
    console.log(changes.length ? `── changed since ${previous.scannedAt.slice(0, 16)} ──` : `── no grade changed since ${previous.scannedAt.slice(0, 16)} ──`);
    for (const c of changes) console.log(`  ${pad(c.route, 44)} ${c.from} → ${c.to}`);
  } else {
    console.log('── first run: this is the baseline every later run is compared to ──');
  }
  console.log(`\nlog: scripts/audit/log/latest.json`);
}

process.exit(summary.broken > 0 ? 1 : 0);
