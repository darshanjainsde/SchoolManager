/**
 * Sckools test dashboard — a localhost-only control room for the repo's checks.
 *
 * Why it exists: CI ran five steps in order and stopped at the first failure, so
 * for 87 runs nobody saw that the test steps never executed. A dashboard that
 * shows every gate side by side, with its own result, makes that failure mode
 * impossible to miss again.
 *
 * Zero dependencies on purpose — it must keep working when node_modules is in
 * whatever state the thing you're debugging left it.
 *
 *   node tools/test-dashboard/server.mjs        (or: pnpm dash)
 *
 * Binds to 127.0.0.1 only. It executes repo scripts, so it must never be
 * reachable from the network.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CACHE = join(HERE, '.cache');
const PORT = Number(process.env.DASH_PORT ?? 4000);

/**
 * The jobs the dashboard can run. `kind: 'jest'` jobs additionally emit a JSON
 * report and a coverage summary, which is what powers the coverage view.
 */
const JOBS = {
  api: {
    label: 'API',
    detail: 'NestJS · services, controllers, guards',
    kind: 'jest',
    cwd: 'apps/api',
    args: ['exec', 'jest', '--silent'],
    src: 'apps/api/src',
  },
  mobile: {
    label: 'Mobile',
    detail: 'Expo · screens, hooks, lib',
    kind: 'jest',
    cwd: 'apps/mobile',
    args: ['exec', 'jest', '--silent'],
    src: 'apps/mobile/src',
  },
  db: {
    label: 'Database',
    detail: 'Prisma helpers, feature resolver',
    kind: 'jest',
    cwd: 'packages/db',
    args: ['exec', 'jest', '--silent'],
    src: 'packages/db/src',
  },
  web: {
    label: 'Web',
    detail: 'Next.js · marketing, school sites, 4 consoles',
    kind: 'none',
    cwd: 'apps/web',
    src: 'apps/web',
    missing: 'No test harness installed. Every change here is verified by hand.',
  },
  lint: { label: 'Lint', detail: 'eslint, all workspaces', kind: 'gate', cwd: '.', args: ['lint'] },
  typecheck: { label: 'Typecheck', detail: 'tsc --noEmit, all workspaces', kind: 'gate', cwd: '.', args: ['typecheck'] },
  boundary: { label: 'Module boundary', detail: 'depcruise — the gate that hid the tests', kind: 'gate', cwd: '.', args: ['boundary'] },
  build: { label: 'Build', detail: 'turbo run build', kind: 'gate', cwd: '.', args: ['build'] },
};

/** id → { status, startedAt, finishedAt, exitCode, summary, output[] } */
const state = new Map();
const clients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

async function loadCache() {
  if (!existsSync(CACHE)) return;
  for (const f of await readdir(CACHE)) {
    if (!f.endsWith('.state.json')) continue;
    try {
      const raw = JSON.parse(await readFile(join(CACHE, f), 'utf8'));
      state.set(raw.id, raw);
    } catch {
      /* a half-written cache file is not worth crashing over */
    }
  }
}

async function persist(entry) {
  await mkdir(CACHE, { recursive: true });
  // Output can be long; keep the tail only — enough to diagnose, small on disk.
  const slim = { ...entry, output: entry.output.slice(-400) };
  await writeFile(join(CACHE, `${entry.id}.state.json`), JSON.stringify(slim, null, 2));
}

/** Reads the JSON report jest wrote, and turns it into the shape the UI wants. */
async function readJestReport(id) {
  const file = join(CACHE, `${id}.report.json`);
  if (!existsSync(file)) return null;
  const r = JSON.parse(await readFile(file, 'utf8'));

  const failures = [];
  for (const suite of r.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === 'failed') {
        failures.push({
          suite: relative(REPO, suite.name),
          title: t.fullName || t.title,
          message: (t.failureMessages?.[0] ?? '').split('\n').slice(0, 6).join('\n'),
        });
      }
    }
    // A suite that cannot even load reports no assertions but carries a message.
    if ((suite.assertionResults ?? []).length === 0 && suite.status === 'failed') {
      failures.push({
        suite: relative(REPO, suite.name),
        title: 'Suite failed to run',
        message: (suite.message ?? '').split('\n').slice(0, 6).join('\n'),
      });
    }
  }

  const slowest = (r.testResults ?? [])
    .map((s) => ({ suite: relative(REPO, s.name), ms: (s.endTime ?? 0) - (s.startTime ?? 0) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  return {
    suites: { total: r.numTotalTestSuites, passed: r.numPassedTestSuites, failed: r.numFailedTestSuites },
    tests: { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests },
    failures,
    slowest,
  };
}

/** Per-file coverage → overall %, and the files with nothing covering them. */
async function readCoverage(id) {
  const file = join(CACHE, `${id}-coverage`, 'coverage-summary.json');
  if (!existsSync(file)) return null;
  const c = JSON.parse(await readFile(file, 'utf8'));
  const total = c.total;
  const files = Object.entries(c)
    .filter(([k]) => k !== 'total')
    .map(([path, m]) => ({
      path: relative(REPO, path),
      lines: m.lines.pct,
      branches: m.branches.pct,
      uncovered: m.lines.total - m.lines.covered,
    }));

  const dead = files.filter((f) => f.lines === 0).sort((a, b) => b.uncovered - a.uncovered);
  const weak = files
    .filter((f) => f.lines > 0 && f.lines < 60)
    .sort((a, b) => a.lines - b.lines)
    .slice(0, 12);

  return {
    lines: total.lines.pct,
    branches: total.branches.pct,
    functions: total.functions.pct,
    fileCount: files.length,
    deadCount: dead.length,
    dead: dead.slice(0, 12),
    weak,
  };
}

/** Counts source files with no sibling test — the honest denominator for `web`. */
async function countSourceFiles(dir) {
  let n = 0;
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|test|d)\.tsx?$/.test(e.name)) n++;
    }
  }
  await walk(resolve(REPO, dir));
  return n;
}

function run(id, withCoverage = false) {
  const job = JOBS[id];
  if (!job || job.kind === 'none') return { error: 'not runnable' };
  const current = state.get(id);
  if (current?.status === 'running') return { error: 'already running' };

  const args = [...job.args];
  if (job.kind === 'jest') {
    args.push('--json', `--outputFile=${join(CACHE, `${id}.report.json`)}`);
    // Coverage is opt-in: instrumenting the code makes runs several times
    // slower, which pushed three mobile suites past their timeouts and turned
    // a green suite red. A default run must mirror what CI actually does.
    if (withCoverage) {
      args.push(
        '--coverage',
        '--coverageReporters=json-summary',
        `--coverageDirectory=${join(CACHE, `${id}-coverage`)}`,
      );
    }
  }

  const entry = {
    id,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    summary: null,
    coverage: null,
    coverageRequested: withCoverage,
    output: [],
  };
  state.set(id, entry);
  broadcast('state', publicState());

  const child = spawn('pnpm', args, {
    cwd: resolve(REPO, job.cwd),
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
  });

  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      entry.output.push(line);
      broadcast('log', { id, line });
    }
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);

  child.on('close', async (code) => {
    entry.status = code === 0 ? 'pass' : 'fail';
    entry.exitCode = code;
    entry.finishedAt = Date.now();
    if (job.kind === 'jest') {
      try {
        entry.summary = await readJestReport(id);
        if (withCoverage) entry.coverage = await readCoverage(id);
      } catch (e) {
        entry.output.push(`[dashboard] could not read report: ${e.message}`);
      }
    }
    await persist(entry);
    broadcast('state', publicState());
  });

  return { ok: true };
}

function publicState() {
  const jobs = {};
  for (const [id, job] of Object.entries(JOBS)) {
    const s = state.get(id);
    jobs[id] = {
      id,
      label: job.label,
      detail: job.detail,
      kind: job.kind,
      missing: job.missing ?? null,
      status: s?.status ?? 'unknown',
      startedAt: s?.startedAt ?? null,
      finishedAt: s?.finishedAt ?? null,
      durationMs: s?.finishedAt && s?.startedAt ? s.finishedAt - s.startedAt : null,
      exitCode: s?.exitCode ?? null,
      summary: s?.summary ?? null,
      coverage: s?.coverage ?? null,
      coverageRequested: s?.coverageRequested ?? false,
      tail: (s?.output ?? []).slice(-25),
    };
  }
  return { jobs, now: Date.now() };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(publicState()));
    return;
  }

  if (url.pathname === '/api/web-gap') {
    const files = await countSourceFiles('apps/web');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ files }));
    return;
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    const cov = url.searchParams.get('coverage') === '1';
    if (id === 'all') {
      for (const key of ['lint', 'typecheck', 'boundary', 'db', 'api', 'mobile']) run(key, cov);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, started: 'all' }));
      return;
    }
    const result = run(id, cov);
    res.writeHead(result.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Static: the dashboard itself.
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const path = join(HERE, 'public', file);
  if (!path.startsWith(join(HERE, 'public'))) {
    res.writeHead(403).end('nope');
    return;
  }
  try {
    const body = await readFile(path);
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await loadCache();
server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Sckools test dashboard → http://127.0.0.1:${PORT}\n  (localhost only — it runs repo scripts)\n`);
});
