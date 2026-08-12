#!/usr/bin/env node
/**
 * dispatch-ui — browse where the build's time went, in a browser.
 *
 *   node scripts/dispatch-ui.mjs                 # http://127.0.0.1:4200
 *   node scripts/dispatch-ui.mjs --port 4300
 *   node scripts/dispatch-ui.mjs --no-open
 *   node scripts/dispatch-ui.mjs --html out.html # write a standalone file instead of serving
 *
 * Reads .superpowers/dispatch-metrics.jsonl (written by dispatch-metrics.mjs).
 * Node built-ins only — no dependencies, same constraint as scripts/test-ui.mjs.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = resolve(ROOT, '.superpowers/dispatch-metrics.jsonl');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
const PORT = Number(flag('port', 4200));
const OPEN = !process.argv.includes('--no-open');
const HTML_OUT = flag('html', null);

const LOST = new Set(['died-nothing']);
const RESCUED = new Set(['died-partial', 'stalled']);

function load() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.round(s / 60)}m`);
const kt = (t) => `${Math.round(t / 1000)}k`;

function render(rows) {
  const total = rows.reduce((a, r) => a + r.seconds, 0) || 1;
  const totalTok = rows.reduce((a, r) => a + r.tokens, 0);
  const lostSec = rows.filter((r) => LOST.has(r.outcome)).reduce((a, r) => a + r.seconds, 0);
  const rescSec = rows.filter((r) => RESCUED.has(r.outcome)).reduce((a, r) => a + r.seconds, 0);
  const reviewSec = rows.filter((r) => r.kind === 'review' || r.kind === 'rereview').reduce((a, r) => a + r.seconds, 0);

  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      const g = m.get(k) ?? { key: k, seconds: 0, tokens: 0, n: 0, rows: [] };
      g.seconds += r.seconds; g.tokens += r.tokens; g.n++; g.rows.push(r);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.seconds - a.seconds);
  };

  const OUTCOME_ROLE = {
    shipped: 'good',
    'shipped-after-fix': 'ok',
    stalled: 'warning',
    'died-partial': 'serious',
    'died-nothing': 'critical',
  };
  const OUTCOME_ICON = {
    shipped: '●', 'shipped-after-fix': '◐', stalled: '◌', 'died-partial': '◍', 'died-nothing': '○',
  };

  const bars = (groups, colorFor) => groups.map((g) => {
    const pct = (g.seconds / total) * 100;
    return `<div class="bar-row">
      <div class="bar-label">${esc(g.key)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${colorFor(g.key)}"></div></div>
      <div class="bar-val">${hhmm(g.seconds)}<span class="dim"> · ${g.n}×</span></div>
    </div>`;
  }).join('');

  const byKind = group((r) => r.kind);
  const byOutcome = group((r) => r.outcome);
  const byTask = group((r) => `${r.phase} · ${r.task}`);

  const taskCards = byTask.map((g, i) => {
    const bad = g.rows.filter((r) => LOST.has(r.outcome) || RESCUED.has(r.outcome)).length;
    const subs = [...g.rows].sort((a, b) => b.seconds - a.seconds).map((r) => `
      <tr>
        <td><span class="dot ${OUTCOME_ROLE[r.outcome] ?? 'ok'}" aria-hidden="true">${OUTCOME_ICON[r.outcome] ?? '●'}</span> ${esc(r.outcome)}</td>
        <td class="mono">${esc(r.kind)}</td>
        <td class="num">${hhmm(r.seconds)}</td>
        <td class="num">${kt(r.tokens)}</td>
        <td class="num dim">${r.tools}</td>
      </tr>`).join('');
    return `<details class="task"${i < 3 ? ' open' : ''}>
      <summary>
        <span class="t-time">${hhmm(g.seconds)}</span>
        <span class="t-name">${esc(g.key)}</span>
        <span class="t-meta">${g.n} dispatch${g.n === 1 ? '' : 'es'}${bad ? ` · <b class="warn-ink">${bad} lost or rescued</b>` : ''}</span>
      </summary>
      <table class="subs">
        <thead><tr><th>outcome</th><th>kind</th><th>time</th><th>tokens</th><th>tools</th></tr></thead>
        <tbody>${subs}</tbody>
      </table>
    </details>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dispatch time — where the build went</title>
<style>
  .viz-root, :root {
    color-scheme: light dark;
    --surface-1: #fcfcfb; --surface-2: #f3f2ef; --line: #e2e0da;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #86847d;
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
    --good: #0ca30c; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b; --ok: #2a78d6;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --surface-1: #1a1a19; --surface-2: #232322; --line: #34332f;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8d8b82;
      --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --ok: #3987e5;
    }
  }
  :root[data-theme="dark"] {
    --surface-1: #1a1a19; --surface-2: #232322; --line: #34332f;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8d8b82;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --ok: #3987e5;
  }
  * { box-sizing: border-box; }
  body { margin:0; background: var(--surface-1); color: var(--text-primary);
    font: 15px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    font-variant-numeric: tabular-nums; }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .2rem; letter-spacing: -.01em; }
  .sub { color: var(--text-secondary); margin: 0 0 1.5rem; font-size: .9rem; }
  .mono { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size: .8rem; }
  .dim { color: var(--text-muted); }
  .num { text-align: right; }
  .warn-ink { color: var(--critical); }

  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(11rem,1fr)); gap:.6rem; margin-bottom:1.75rem; }
  .tile { background: var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:.75rem .9rem; }
  .tile .k { font-size:.66rem; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); display:block; }
  .tile .v { font-size:1.9rem; font-weight:600; line-height:1.05; display:block; margin-top:.25rem; }
  .tile .d { font-size:.76rem; color:var(--text-secondary); }
  .tile.alarm .v { color: var(--critical); }

  h2 { font-size:.98rem; margin:1.75rem 0 .7rem; padding-bottom:.4rem; border-bottom:1px solid var(--line); }
  .legend { display:flex; gap:.9rem; flex-wrap:wrap; font-size:.78rem; color:var(--text-secondary); margin:-.3rem 0 .8rem; }
  .legend span { display:inline-flex; align-items:center; gap:.35rem; }
  .swatch { width:.7rem; height:.7rem; border-radius:2px; display:inline-block; }

  .bar-row { display:grid; grid-template-columns:11rem 1fr 7rem; gap:.7rem; align-items:center; margin-bottom:.3rem; }
  .bar-label { font-size:.84rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { background:var(--surface-2); border-radius:4px; height:1.15rem; overflow:hidden; }
  .bar-fill { height:100%; border-radius:0 4px 4px 0; }
  .bar-val { font-size:.82rem; text-align:right; }

  details.task { border:1px solid var(--line); border-radius:10px; margin-bottom:.5rem; background:var(--surface-2); }
  details.task summary { cursor:pointer; padding:.6rem .85rem; display:grid;
    grid-template-columns:4.5rem 1fr auto; gap:.75rem; align-items:baseline; }
  details.task summary::-webkit-details-marker { display:none; }
  .t-time { font-weight:600; }
  .t-name { font-size:.9rem; }
  .t-meta { font-size:.76rem; color:var(--text-muted); }
  table { width:100%; border-collapse:collapse; font-size:.82rem; }
  .subs { border-top:1px solid var(--line); }
  .subs th { text-align:left; font-size:.62rem; letter-spacing:.1em; text-transform:uppercase;
    color:var(--text-muted); font-weight:500; padding:.4rem .85rem; }
  .subs th.num, .subs td.num { text-align:right; }
  .subs td { padding:.35rem .85rem; border-top:1px solid var(--line); }
  .dot { font-size:.7rem; }
  .dot.good{color:var(--good)} .dot.ok{color:var(--ok)} .dot.warning{color:var(--warning)}
  .dot.serious{color:var(--serious)} .dot.critical{color:var(--critical)}
  .note { font-size:.82rem; color:var(--text-secondary); background:var(--surface-2);
    border-left:3px solid var(--s2); padding:.6rem .8rem; border-radius:0 6px 6px 0; margin:1rem 0 0; }
  @media (max-width:36rem){ .bar-row{grid-template-columns:7rem 1fr 5rem} }
</style></head><body><div class="wrap">

<h1>Dispatch time</h1>
<p class="sub">${rows.length} dispatches · ${hhmm(total)} wall clock · ${kt(totalTok)} tokens. Every number read off a real Agent result, none estimated.</p>

<div class="tiles">
  <div class="tile"><span class="k">Wall clock</span><span class="v">${hhmm(total)}</span><span class="d">${rows.length} dispatches</span></div>
  <div class="tile alarm"><span class="k">Produced nothing</span><span class="v">${Math.round((lostSec / total) * 100)}%</span><span class="d">${hhmm(lostSec)} · died with no commit</span></div>
  <div class="tile alarm"><span class="k">Needed rescue</span><span class="v">${Math.round((rescSec / total) * 100)}%</span><span class="d">${hhmm(rescSec)} · work recovered by hand</span></div>
  <div class="tile"><span class="k">Review + re-review</span><span class="v">${Math.round((reviewSec / total) * 100)}%</span><span class="d">${hhmm(reviewSec)} · not the bottleneck</span></div>
</div>

<h2>Time by outcome</h2>
<div class="legend">
  <span><i class="swatch" style="background:var(--good)"></i> shipped</span>
  <span><i class="swatch" style="background:var(--ok)"></i> shipped after fix</span>
  <span><i class="swatch" style="background:var(--warning)"></i> stalled</span>
  <span><i class="swatch" style="background:var(--serious)"></i> died, partial work</span>
  <span><i class="swatch" style="background:var(--critical)"></i> died, nothing</span>
</div>
${bars(byOutcome, (k) => `var(--${OUTCOME_ROLE[k] ?? 'ok'})`)}

<h2>Time by kind of dispatch</h2>
<div class="legend">
  <span><i class="swatch" style="background:var(--s1)"></i> impl</span>
  <span><i class="swatch" style="background:var(--s2)"></i> fix</span>
  <span><i class="swatch" style="background:var(--s3)"></i> review</span>
  <span><i class="swatch" style="background:var(--s4)"></i> rereview</span>
</div>
${bars(byKind, (k) => ({ impl: 'var(--s1)', fix: 'var(--s2)', review: 'var(--s3)', rereview: 'var(--s4)' }[k] ?? 'var(--s1)'))}

<h2>Every task, and the dispatches inside it</h2>
<p class="sub" style="margin-bottom:.8rem">Sorted by total time. Open a row to see each dispatch that went into it — that is where a task with three attempts and one result shows itself.</p>
${taskCards}

<p class="note">A dispatch that dies after 90 minutes costs exactly what one that ships a feature costs. The <b>outcome</b> column is the only thing that tells them apart, which is why it is the first column rather than a footnote.</p>

</div></body></html>`;
}

const rows = load();
if (rows.length === 0) {
  console.error(`no data at ${LOG} — log some dispatches first:\n  node scripts/dispatch-metrics.mjs log --phase 1a --task X --kind impl --tokens 1000 --tools 5 --seconds 60 --outcome shipped`);
  process.exit(1);
}

if (HTML_OUT) {
  writeFileSync(HTML_OUT, render(rows));
  console.log(`wrote ${HTML_OUT} (${rows.length} dispatches)`);
  process.exit(0);
}

createServer((req, res) => {
  // Re-read on every request so the page reflects dispatches logged while it is open.
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(render(load()));
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`dispatch-ui → ${url}  (${rows.length} dispatches; reload to refresh)`);
  if (OPEN) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
});
