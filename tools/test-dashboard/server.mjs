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
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { buildCatalogue, runnerFor, workspaceFor } from './catalogue.mjs';
import { describeLive, runLive, ENVIRONMENTS as LIVE_ENVS } from './live-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CACHE = join(HERE, '.cache');
const PORT = Number(process.env.DASH_PORT ?? 4000);

/**
 * The jobs the dashboard can run. `kind: 'jest'` jobs additionally emit a JSON
 * report and a coverage summary, which is what powers the coverage view.
 *
 * THE FLAGS HERE MUST MIRROR EACH PACKAGE'S OWN `test` SCRIPT. They did not,
 * and it produced the one result this dashboard must never produce: a red
 * suite that is green in the gate. `apps/mobile` pins `--maxWorkers=2`; bare
 * `jest` took seven workers on an eight-core machine and starved one
 * async save-flow test past its timeout, nondeterministically. The board then
 * reported a real regression that did not exist. A dashboard whose verdict
 * disagrees with `pnpm test` is worse than no dashboard, so if you change a
 * package's test script, change it here too.
 */
const JOBS = {
  api: {
    label: 'API',
    detail: 'NestJS · services, controllers, guards',
    kind: 'jest',
    cwd: 'apps/api',
    args: ['exec', 'jest', '--passWithNoTests', '--silent'],
    src: 'apps/api/src',
  },
  mobile: {
    label: 'Mobile',
    detail: 'Expo · screens, hooks, lib',
    kind: 'jest',
    cwd: 'apps/mobile',
    args: ['exec', 'jest', '--maxWorkers=2', '--silent'],
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
  // WAS `kind: 'none'` with "No test harness installed. Every change here is
  // verified by hand." That stopped being true — apps/web now runs vitest over
  // 43 files — and a dashboard reporting a harness that exists as absent is
  // worse than one reporting nothing: it tells you not to trust a suite that
  // is, in fact, guarding the code.
  web: {
    label: 'Web',
    detail: 'Next.js · marketing, school sites, 4 consoles',
    kind: 'vitest',
    cwd: 'apps/web',
    args: ['exec', 'vitest', 'run'],
    src: 'apps/web',
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
  if (job.kind === 'vitest') {
    // vitest speaks the same report shape as jest for the fields this
    // dashboard reads (numTotalTests, testResults[].assertionResults[]), so
    // one reader serves both runners.
    args.push('--reporter=json', `--outputFile=${join(CACHE, `${id}.report.json`)}`);
    if (withCoverage) {
      args.push('--coverage', '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${join(CACHE, `${id}-coverage`)}`);
    }
  }
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
    if (job.kind === 'jest' || job.kind === 'vitest') {
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


// ─────────────────────────────────────────────────────────────────────────────
// The catalogue — every test in the repo, grouped the way a person thinks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cached because a full scan reads ~170 files, and the board re-renders often.
 * Invalidated on a fingerprint of (file count, newest mtime), so editing any
 * test file rebuilds it and nothing else has to remember to.
 */
let catalogueCache = null;

async function getCatalogue(force = false) {
  if (!force && catalogueCache) {
    const fresh = await buildCatalogue(REPO);
    if (fresh.fingerprint === catalogueCache.fingerprint) return catalogueCache;
    catalogueCache = fresh;
    return fresh;
  }
  catalogueCache = await buildCatalogue(REPO);
  return catalogueCache;
}

/**
 * Merges the last run's per-test results INTO the catalogue, so a test in the
 * tree carries its own pass/fail rather than only its file's.
 *
 * Matched on file + full name. A test present in a report but absent from the
 * catalogue means the parser missed it — surfaced as `unmatched` rather than
 * dropped, because a silently missing test is the failure mode this whole
 * dashboard was built to prevent.
 */
async function catalogueResults() {
  const byKey = new Map();
  let unmatched = 0;
  for (const id of Object.keys(JOBS)) {
    const file = join(CACHE, `${id}.report.json`);
    if (!existsSync(file)) continue;
    let report;
    try {
      report = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    for (const suite of report.testResults ?? []) {
      const rel = relative(REPO, suite.name).split(sep).join('/');
      for (const t of suite.assertionResults ?? []) {
        const full = t.fullName || [...(t.ancestorTitles ?? []), t.title].join(' ');
        const row = {
          status: t.status,
          ms: t.duration ?? null,
          full,
          failure: (t.failureMessages?.[0] ?? '').split('\n').slice(0, 8).join('\n') || null,
          job: id,
        };
        // Keyed on the FULL name (describe titles + title), because a bare
        // title is not unique inside a file — this repo repeatedly reuses one
        // title across sibling describes, and keying on it alone silently
        // collapsed them so one test's verdict was shown against another's.
        byKey.set(`${rel}::${full}`, row);
        // Title-only kept as a fallback for tests with no enclosing describe.
        if (!byKey.has(`${rel}::${t.title}`)) byKey.set(`${rel}::${t.title}`, row);
      }
    }
  }
  return { byKey, unmatched };
}

let singleSeq = 0;

/** Regex-escapes a test name so `-t` matches it literally. */
function escapeForPattern(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs ONE test, by file and name.
 *
 * Deliberately synchronous-and-awaited rather than fire-and-forget: a single
 * test finishes in a second or two, and the caller wants the verdict in the
 * response rather than having to subscribe to a stream for it.
 */
async function runSingle({ path: relPath, name }) {
  if (!relPath || !name) return { error: 'need both a file and a test name' };
  // Contain it: the path must be a test file inside the repo, not an
  // arbitrary path handed to a spawned process.
  const abs = resolve(REPO, relPath);
  if (!abs.startsWith(REPO + sep) || !/\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(relPath)) {
    return { error: 'not a test file in this repo' };
  }
  if (!existsSync(abs)) return { error: `no such file: ${relPath}` };

  const runner = runnerFor(relPath);
  const ws = workspaceFor(relPath);
  const fileFromWs = relative(resolve(REPO, ws), abs).split(sep).join('/');
  // A unique file per run. A single shared `single.report.json` meant two runs
  // — two browser tabs, or a re-click before the first finished — read each
  // other's results, which is how a passing test reports as a failing one.
  await mkdir(CACHE, { recursive: true });
  const out = join(CACHE, `single-${process.pid}-${singleSeq++}.report.json`);
  const pattern = escapeForPattern(name);

  // `--runTestsByPath`, NOT a positional: jest reads a bare path argument as a
  // REGEX, so `src/app/(staff)/take/...` turned "(staff)" into a capture group
  // and matched no file at all — silently, reported as a failing test. Every
  // Expo Router group directory in this repo is parenthesised, so that hit
  // roughly a third of the mobile suite.
  const args =
    runner === 'vitest'
      ? ['exec', 'vitest', 'run', fileFromWs, '-t', pattern, '--reporter=json', `--outputFile=${out}`]
      : ['exec', 'jest', '--runTestsByPath', fileFromWs, '-t', pattern, '--json', `--outputFile=${out}`, '--silent'];

  const started = Date.now();
  const res = await new Promise((done) => {
    const child = spawn('pnpm', args, {
      cwd: resolve(REPO, ws),
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('close', (code) => done({ code, log }));
  });

  let matched = [];
  let readError = null;
  try {
    const report = JSON.parse(await readFile(out, 'utf8'));
    for (const suite of report.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        if (t.status === 'pending' || t.status === 'skipped' || t.status === 'todo') continue;
        matched.push({
          title: t.title,
          full: t.fullName || t.title,
          status: t.status,
          ms: t.duration ?? null,
          failure: (t.failureMessages?.[0] ?? '').split('\n').slice(0, 20).join('\n') || null,
        });
      }
    }
  } catch (e) {
    // Surfaced rather than swallowed: "no report" and "test failed" are
    // different problems, and a silent catch here reported the first as the
    // second while I was building this.
    readError = e.message;
  }
  await rm(out, { force: true }).catch(() => undefined);

  return {
    ok: res.code === 0,
    readError,
    exitCode: res.code,
    runner,
    workspace: ws,
    // Shown in the UI so the run is reproducible in a terminal by hand —
    // which means the arguments have to be quoted the way a shell needs them,
    // not merely joined. A test name with spaces is the common case here.
    command: `pnpm ${args
      .filter((a) => !a.startsWith('--outputFile'))
      .map((a) => (/[\s()[\]$'"*?]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a))
      .join(' ')}`,
    durationMs: Date.now() - started,
    matched,
    // A pattern that matched nothing exits non-zero on jest but says so only
    // in the log; calling that out explicitly saves a confusing "it failed".
    matchedNothing: matched.length === 0,
    log: res.log.split('\n').filter(Boolean).slice(-60),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Branches & deploys
// ─────────────────────────────────────────────────────────────────────────────

/** Runs a git command with an argv array — never a shell string. */
function git(args, opts = {}) {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd: REPO, ...opts });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => res({ code, out: out.trim(), err: err.trim() }));
  });
}

const ENVIRONMENTS = [
  { id: 'production', branch: 'main', site: 'https://sckools.com', api: 'https://api.sckools.com', tenant: 'https://raffles.sckools.com' },
  { id: 'staging', branch: 'staging', site: 'https://test.sckools.com', api: 'https://api.test.sckools.com', tenant: 'https://beacon.test.sckools.com' },
];

async function countBetween(a, b) {
  const r = await git(['rev-list', '--count', `${a}..${b}`]);
  return r.code === 0 ? Number(r.out) : null;
}

async function logLines(ref, n = 8) {
  const r = await git(['log', `-${n}`, '--format=%h\u0001%an\u0001%ar\u0001%s', ref]);
  if (r.code !== 0) return [];
  return r.out.split('\n').filter(Boolean).map((l) => {
    const [sha, author, when, subject] = l.split('\u0001');
    return { sha, author, when, subject };
  });
}

async function gitState() {
  await git(['fetch', '--quiet', 'origin', '--prune']);

  const [mainSha, stagingSha] = await Promise.all([
    git(['rev-parse', '--short', 'origin/main']),
    git(['rev-parse', '--short', 'origin/staging']),
  ]);

  const [stagingAhead, mainAhead] = await Promise.all([
    countBetween('origin/main', 'origin/staging'),
    countBetween('origin/staging', 'origin/main'),
  ]);

  // What is sitting on staging but not yet on production.
  const waiting = await logLines('origin/main..origin/staging', 20);

  const [current, dirty] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['status', '--porcelain']),
  ]);

  // Branches with work not on main — candidates to merge or delete.
  const refs = await git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
  const others = [];
  for (const ref of refs.out.split('\n').filter(Boolean)) {
    if (['origin/HEAD', 'origin/main', 'origin/staging'].includes(ref)) continue;
    const ahead = await countBetween('origin/main', ref);
    const behind = await countBetween(ref, 'origin/main');
    const last = await git(['log', '-1', '--format=%ar', ref]);
    others.push({ ref: ref.replace('origin/', ''), ahead, behind, last: last.out });
  }
  others.sort((a, b) => (b.ahead ?? 0) - (a.ahead ?? 0));

  // Tags that look like rollback anchors, newest first.
  const tagsRaw = await git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)\u0001%(objectname:short)\u0001%(creatordate:short)', 'refs/tags']);
  const tags = tagsRaw.out.split('\n').filter(Boolean).slice(0, 8).map((l) => {
    const [name, sha, date] = l.split('\u0001');
    return { name, sha, date };
  });

  return {
    branches: {
      main: { sha: mainSha.out, commits: await logLines('origin/main', 6) },
      staging: { sha: stagingSha.out, commits: await logLines('origin/staging', 6) },
    },
    inSync: stagingAhead === 0 && mainAhead === 0,
    stagingAhead,
    mainAhead,
    waiting,
    current: current.out,
    dirtyFiles: dirty.out ? dirty.out.split('\n').length : 0,
    others,
    tags,
  };
}

// Staging runs cold in Tokyo and can take >8s on a first hit — a generous
// timeout here prevents a healthy environment being reported as down.
async function probe(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status, ms: Date.now() - started, ok: res.ok, body: res };
  } catch {
    return { status: 0, ms: Date.now() - started, ok: false, body: null };
  } finally {
    clearTimeout(t);
  }
}

async function envState() {
  const out = [];
  for (const env of ENVIRONMENTS) {
    const [site, api, tenant, version] = await Promise.all([
      probe(env.site),
      probe(`${env.api}/ready`),
      probe(env.tenant),
      probe(`${env.site}/api/version`),
    ]);

    let deployed = null;
    if (version.ok && version.body) {
      try {
        deployed = await version.body.json();
      } catch {
        /* endpoint not deployed yet */
      }
    }

    const head = await git(['rev-parse', '--short', `origin/${env.branch}`]);
    let drift = null;
    if (deployed?.commit) {
      const r = await git(['rev-list', '--count', `${deployed.commit}..origin/${env.branch}`]);
      drift = r.code === 0 ? Number(r.out) : null;
    }

    out.push({
      ...env,
      checks: [
        { label: 'site', status: site.status, ms: site.ms },
        { label: 'api /ready', status: api.status, ms: api.ms },
        { label: 'school site', status: tenant.status, ms: tenant.ms },
      ],
      healthy: site.ok && api.ok && tenant.ok,
      branchHead: head.out,
      deployed,
      drift,
    });
  }
  return out;
}

/**
 * Rollback, in two deliberate steps.
 *
 * `prepare` builds a revert commit on a throwaway branch and reports what it
 * would undo. `push` publishes it — and only when the caller echoes back the
 * exact target SHA, because publishing to `main` redeploys production.
 *
 * A revert, never a force-push: history stays intact and the rollback itself
 * can be rolled back.
 */
async function rollbackPrepare(branch, to) {
  if (!['main', 'staging'].includes(branch)) return { error: 'branch must be main or staging' };
  if (!/^[0-9a-f]{7,40}$/.test(to)) return { error: 'target must be a commit sha' };

  await git(['fetch', '--quiet', 'origin']);
  const undone = await logLines(`${to}..origin/${branch}`, 50);
  if (undone.length === 0) return { error: `origin/${branch} is already at ${to}` };

  // Build the rollback commit with plumbing: take the tree of the target commit
  // and record it as a new commit on top of the branch head. The result is a
  // normal forward commit whose content is exactly the known-good state.
  //
  // Deliberately NOT `git checkout` + `git revert`: this dashboard runs inside
  // your working tree, and switching branches under you would disturb whatever
  // you have open. Nothing here touches the working tree or the index.
  const tree = await git(['rev-parse', `${to}^{tree}`]);
  if (tree.code !== 0) return { error: `unknown commit ${to}` };

  const parent = await git(['rev-parse', `origin/${branch}`]);
  const message =
    `revert: roll ${branch} back to ${to}\n\n` +
    `Restores the tree of ${to}, undoing ${undone.length} commit(s).\n` +
    `Prepared from the local test dashboard. History is preserved — this is a\n` +
    `forward commit, so the rollback can itself be rolled back.`;

  const made = await git(['commit-tree', tree.out, '-p', parent.out, '-m', message]);
  if (made.code !== 0) return { error: made.err };
  const sha = made.out.trim();

  // Park it on a ref so it survives gc and can be inspected with normal git.
  const ref = `refs/heads/rollback/${branch}-to-${to}`;
  await git(['update-ref', ref, sha]);

  const stat = await git(['diff', '--stat', `origin/${branch}`, sha]);
  const short = await git(['rev-parse', '--short', sha]);

  return {
    ok: true,
    workBranch: ref.replace('refs/heads/', ''),
    revertSha: short.out,
    undoes: undone,
    stat: stat.out.split('\n').slice(-14).join('\n') || '(no file differences)',
  };
}

async function rollbackPush(branch, workBranch, confirm, to) {
  if (!['main', 'staging'].includes(branch)) return { error: 'branch must be main or staging' };
  if (confirm !== to) return { error: 'confirmation did not match the target sha' };
  if (!/^rollback\//.test(workBranch || '')) return { error: 'refusing to push anything that is not a prepared rollback' };

  const push = await git(['push', 'origin', `${workBranch}:${branch}`]);
  if (push.code !== 0) return { error: push.err };
  return {
    ok: true,
    pushed: `${workBranch} → ${branch}`,
    note: 'Vercel redeploys from this branch. Verify the site before walking away.',
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(publicState()));
    return;
  }

  if (url.pathname === '/api/git') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await gitState()));
    return;
  }

  if (url.pathname === '/api/envs') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await envState()));
    return;
  }

  if (url.pathname === '/api/rollback/prepare' && req.method === 'POST') {
    const r = await rollbackPrepare(url.searchParams.get('branch'), url.searchParams.get('to'));
    res.writeHead(r.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r));
    return;
  }

  if (url.pathname === '/api/rollback/push' && req.method === 'POST') {
    const r = await rollbackPush(
      url.searchParams.get('branch'),
      url.searchParams.get('work'),
      url.searchParams.get('confirm'),
      url.searchParams.get('to'),
    );
    res.writeHead(r.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r));
    return;
  }

  if (url.pathname === '/api/catalogue') {
    const cat = await getCatalogue(url.searchParams.get('refresh') === '1');
    const { byKey } = await catalogueResults();
    // Attach the last known verdict to each test as the catalogue goes out,
    // so the tree can be browsed and read at the same time.
    const consumed = new Set();
    const files = cat.files.map((f) => ({
      ...f,
      tests: f.tests.map((t) => {
        if (!t.name) return { ...t, result: null };
        // Full name first — same key the report is written under — then the
        // bare title for tests that sit outside any describe.
        const full = [...t.groups.map((g) => g.title), t.name].join(' ');
        const kFull = `${f.path}::${full}`;
        const kTitle = `${f.path}::${t.name}`;
        const result = byKey.get(kFull) ?? byKey.get(kTitle) ?? null;
        if (result) consumed.add(byKey.has(kFull) ? kFull : kTitle);
        return { ...t, result };
      }),
    }));

    // Results the runners produced that no source test claims. Almost always
    // `it.each`, which expands one source line into N runtime tests — but it
    // is also exactly what a parser bug looks like, so the number is reported
    // rather than hidden. A catalogue that quietly drops results would be the
    // same blind spot this dashboard was built to remove.
    const ran = new Set();
    for (const k of byKey.keys()) if (!k.endsWith('::undefined')) ran.add(k);
    const orphans = [...byKey.entries()]
      .filter(([k, v]) => !consumed.has(k) && v.full && k.endsWith(`::${v.full}`))
      .map(([k]) => k);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ...cat,
      files,
      results: {
        matched: [...consumed].length,
        unmatched: orphans.length,
        examples: orphans.slice(0, 8),
      },
    }));
    return;
  }

  if (url.pathname === '/api/run-one' && req.method === 'POST') {
    const r = await runSingle({
      path: url.searchParams.get('path'),
      name: url.searchParams.get('name'),
    });
    res.writeHead(r.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r));
    return;
  }

  if (url.pathname === '/api/live') {
    const envId = url.searchParams.get('env') ?? 'staging';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ environments: Object.keys(LIVE_ENVS), suite: describeLive(envId) }));
    return;
  }

  if (url.pathname === '/api/live/run' && req.method === 'POST') {
    const envId = url.searchParams.get('env') ?? 'staging';
    const r = await runLive(envId, (row) => broadcast('live', row));
    res.writeHead(r.error ? 400 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r));
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
