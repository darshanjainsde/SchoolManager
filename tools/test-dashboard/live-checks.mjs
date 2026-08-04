/**
 * Live environment checks — the suite that actually runs AGAINST staging.
 *
 * WHY THIS IS A SEPARATE THING FROM THE UNIT TESTS. The 1,440 tests in the
 * catalogue mock the network: `api.request` is a jest.fn, `useApi` is stubbed,
 * and no HTTP leaves the machine. Pointing them at staging would change
 * nothing, because there is nothing in them to point. So "run the suite
 * against staging" cannot mean those tests — and quietly running them with a
 * staging label would be the worst outcome: a green board that proves the
 * mocks agree with themselves while staging is down.
 *
 * These checks are the real article. Every one performs an actual request to
 * the deployed environment and asserts on the real response. They are written
 * to answer the questions a unit test structurally cannot:
 *
 *   - is it up, and is the database behind it up
 *   - does a hostname still resolve to the right school (multi-tenancy is the
 *     one bug class where a mistake leaks one school's data to another)
 *   - does an UNKNOWN host get refused rather than silently served a default
 *   - is the commit serving traffic the commit we think we shipped
 *
 * Credentials are optional and never stored here. Set DASH_LIVE_IDENTIFIER
 * and DASH_LIVE_PASSWORD to enable the signed-in checks; without them those
 * checks report `skipped`, never `pass`. A skipped check that renders green
 * would be a lie told by the tool built to stop exactly that.
 */

const TIMEOUT_MS = 20000;

export const ENVIRONMENTS = {
  staging: {
    id: 'staging',
    label: 'Staging',
    branch: 'staging',
    site: 'https://test.sckools.com',
    api: 'https://api.test.sckools.com',
    schoolHost: 'raffles.test.sckools.com',
    schoolSlug: 'raffles',
    tenantSite: 'https://raffles.test.sckools.com',
  },
  production: {
    id: 'production',
    label: 'Production',
    branch: 'main',
    site: 'https://sckools.com',
    api: 'https://api.sckools.com',
    schoolHost: 'raffles.sckools.com',
    schoolSlug: 'raffles',
    tenantSite: 'https://raffles.sckools.com',
  },
};

async function req(url, { headers = {}, method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json — fine, the html probes don't need it */
    }
    return { status: res.status, ms: Date.now() - started, text, json, ok: res.ok };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, text: '', json: null, ok: false, error: e.name === 'AbortError' ? `timed out after ${timeout}ms` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every check declares, in the same shape the catalogue uses, what it is FOR
 * and what a pass means — so the live tab reads like the rest of the board
 * rather than like a pile of status codes.
 */
function defineChecks(env, creds) {
  const authed = (token) => ({ authorization: `Bearer ${token}`, 'x-skoolos-host': env.schoolHost });
  const tenant = { 'x-skoolos-host': env.schoolHost };

  return [
    {
      id: 'api-ready',
      group: 'Is it up',
      title: 'The API answers, and so does its database',
      what: `GET ${env.api}/ready`,
      expect: 'HTTP 200 with status/db/redis all reporting "ok".',
      why: 'A 200 from the site alone proves only that Vercel served static HTML. This is the check that fails when the database is asleep or the connection pooler is out of slots — the failure that looks like "the app is just slow".',
      async run() {
        const r = await req(`${env.api}/ready`);
        const j = r.json ?? {};
        const bad = ['status', 'db', 'redis'].filter((k) => j[k] && j[k] !== 'ok');
        return {
          ok: r.status === 200 && bad.length === 0,
          ms: r.ms,
          detail: r.status === 0 ? r.error : `HTTP ${r.status} · ${JSON.stringify(j)}`,
          failedBecause: bad.length ? `not ok: ${bad.join(', ')}` : r.status !== 200 ? `expected 200, got ${r.status}` : null,
        };
      },
    },
    {
      id: 'site',
      group: 'Is it up',
      title: 'The marketing site serves',
      what: `GET ${env.site}`,
      expect: 'HTTP 200.',
      why: 'The front door. Separate from the API because they deploy independently — one can be fine while the other is not.',
      async run() {
        const r = await req(env.site);
        return { ok: r.status === 200, ms: r.ms, detail: r.status === 0 ? r.error : `HTTP ${r.status}`, failedBecause: r.status === 200 ? null : `expected 200, got ${r.status || r.error}` };
      },
    },
    {
      id: 'tenant-site',
      group: 'Multi-tenancy',
      title: "A school's own site serves",
      what: `GET ${env.tenantSite}`,
      expect: 'HTTP 200.',
      why: 'School sites are served by wildcard DNS plus host-based routing. This breaks independently of the main site — usually when a domain row is missing or not marked LIVE.',
      async run() {
        const r = await req(env.tenantSite);
        return { ok: r.status === 200, ms: r.ms, detail: r.status === 0 ? r.error : `HTTP ${r.status}`, failedBecause: r.status === 200 ? null : `expected 200, got ${r.status || r.error}` };
      },
    },
    {
      id: 'tenant-resolve',
      group: 'Multi-tenancy',
      title: 'A hostname resolves to the right school',
      what: `GET ${env.api}/public/site with header X-Skoolos-Host: ${env.schoolHost}`,
      expect: `HTTP 200 and school.slug === "${env.schoolSlug}".`,
      why: 'This is the hinge the whole product turns on: every query is scoped by the school this header resolves to. If it resolved to the wrong school, one school would be shown another school\'s data — so the check asserts the identity, not just a 200.',
      async run() {
        const r = await req(`${env.api}/public/site`, { headers: tenant });
        const slug = r.json?.school?.slug ?? null;
        return {
          ok: r.status === 200 && slug === env.schoolSlug,
          ms: r.ms,
          detail: r.status === 0 ? r.error : `HTTP ${r.status} · school=${r.json?.school?.name ?? '—'} · slug=${slug ?? '—'} · tier=${r.json?.school?.tier ?? '—'}`,
          failedBecause: r.status !== 200 ? `expected 200, got ${r.status}` : slug !== env.schoolSlug ? `resolved to "${slug}", expected "${env.schoolSlug}"` : null,
        };
      },
    },
    {
      id: 'tenant-unknown',
      group: 'Multi-tenancy',
      title: 'An unknown hostname is refused, not defaulted',
      what: `GET ${env.api}/public/site with header X-Skoolos-Host: not-a-real-school.invalid`,
      expect: 'HTTP 4xx. Anything in the 200s is a failure.',
      why: 'The dangerous version of a tenancy bug is not "no school found" — it is falling back to some default school and serving its data to a stranger. A 200 here would mean exactly that, which is why this check treats success as failure.',
      async run() {
        const r = await req(`${env.api}/public/site`, { headers: { 'x-skoolos-host': 'not-a-real-school.invalid' } });
        const refused = r.status >= 400 && r.status < 500;
        return {
          ok: refused,
          ms: r.ms,
          detail: r.status === 0 ? r.error : `HTTP ${r.status}`,
          failedBecause: refused ? null : r.status === 200 ? 'served a school for a hostname that does not exist' : `expected 4xx, got ${r.status || r.error}`,
        };
      },
    },
    {
      id: 'features',
      group: 'Multi-tenancy',
      title: 'Feature flags come back for the school',
      what: `GET ${env.api}/public/site → school.features`,
      expect: 'A non-empty list. Flags decide which parts of the product a school can see.',
      why: 'An empty list is not a harmless default: it silently switches off every gated feature for that school, which reads to the school as "the app lost my modules" rather than as an error.',
      async run() {
        const r = await req(`${env.api}/public/site`, { headers: tenant });
        const f = r.json?.school?.features ?? [];
        return {
          ok: Array.isArray(f) && f.length > 0,
          ms: r.ms,
          detail: f.length ? `${f.length} flags · ${f.join(', ')}` : `HTTP ${r.status} · no features`,
          failedBecause: f.length ? null : 'no feature flags returned',
        };
      },
    },
    {
      id: 'deployed-commit',
      group: 'Is the right code live',
      title: 'The running commit is reported',
      what: `GET ${env.site}/api/version`,
      expect: `A commit sha and branch "${env.branch}".`,
      why: 'Without this you cannot tell "the fix does not work" from "the fix was never deployed" — a distinction that has cost several debugging sessions. The board compares this against the branch head.',
      async run() {
        const r = await req(`${env.site}/api/version`);
        const j = r.json ?? {};
        return {
          ok: r.status === 200 && !!j.commit,
          ms: r.ms,
          detail: r.status === 200 ? `commit=${j.commit ?? '—'} · branch=${j.branch ?? '—'} · env=${j.env ?? '—'}` : `HTTP ${r.status}`,
          failedBecause: r.status === 200 && j.commit ? null : `no commit reported (HTTP ${r.status})`,
          meta: j,
        };
      },
    },
    {
      id: 'auth-rejects-garbage',
      group: 'Sign-in',
      title: 'A wrong password is refused',
      what: `POST ${env.api}/auth/login with a made-up identifier and password`,
      expect: 'HTTP 4xx. Never a token.',
      why: 'Runs without credentials, so it works on every environment. It proves the login route is reachable AND that it says no — a route that 500s and a route that lets anyone in both fail here.',
      async run() {
        const r = await req(`${env.api}/auth/login`, {
          method: 'POST',
          headers: tenant,
          body: { identifier: `dash-check-${Date.now()}@invalid.test`, password: 'definitely-not-a-real-password' },
        });
        const gotToken = !!r.json?.accessToken;
        const refused = r.status >= 400 && r.status < 500 && !gotToken;
        return {
          ok: refused,
          ms: r.ms,
          detail: r.status === 0 ? r.error : `HTTP ${r.status}`,
          failedBecause: gotToken ? 'ISSUED A TOKEN for made-up credentials' : refused ? null : `expected 4xx, got ${r.status || r.error}`,
        };
      },
    },
    {
      id: 'auth-login',
      group: 'Sign-in',
      title: 'A real account can sign in',
      what: `POST ${env.api}/auth/login with the configured account`,
      expect: '2xx and an access token. Nest answers a @Post with 201, so 200 and 201 both count.',
      why: 'The first check that exercises the database through a write-shaped path. Everything below it needs the token this produces.',
      needsCreds: true,
      async run(ctx) {
        if (!creds) return { skipped: true, detail: 'No credentials configured — set DASH_LIVE_IDENTIFIER and DASH_LIVE_PASSWORD.' };
        const r = await req(`${env.api}/auth/login`, {
          method: 'POST',
          headers: tenant,
          body: { identifier: creds.identifier, password: creds.password },
        });
        const token = r.json?.accessToken ?? null;
        if (token) ctx.token = token;
        // The status is INTERPOLATED, never asserted-and-then-restated. The
        // first version of this line printed a hardcoded "HTTP 200 · token
        // received" while the check failed on a 201 — a detail line that
        // contradicted its own verdict, in the one tool whose job is to stop
        // exactly that.
        return {
          ok: r.status >= 200 && r.status < 300 && !!token,
          ms: r.ms,
          detail: `HTTP ${r.status}${token ? ' · access token received' : ` · ${(r.text || '').slice(0, 160)}`}`,
          failedBecause: token ? (r.status < 300 ? null : `token issued on an unexpected ${r.status}`) : `no access token (HTTP ${r.status})`,
        };
      },
    },
    {
      id: 'auth-me',
      group: 'Sign-in',
      title: 'The token identifies the right person',
      what: `GET ${env.api}/auth/me with the token from the previous check`,
      expect: 'HTTP 200 with a user whose school matches the host we signed in against.',
      why: 'A token that works but resolves to the wrong school is the multi-tenancy failure that a status code cannot show you.',
      needsCreds: true,
      async run(ctx) {
        if (!ctx.token) return { skipped: true, detail: 'No token — the sign-in check did not run or did not pass.' };
        const r = await req(`${env.api}/auth/me`, { headers: authed(ctx.token) });
        // The role decides which of the endpoint checks below can apply at
        // all: /me/* is the family's view, /manage/* is the staff's. Without
        // this, whichever set did not match the configured account failed
        // with a 403 that looked like a broken endpoint rather than the
        // wrong login.
        ctx.role = r.json?.role ?? null;
        ctx.schoolId = r.json?.schoolId ?? null;
        return {
          ok: r.status === 200,
          ms: r.ms,
          detail: r.status === 200 ? `HTTP 200 · role=${ctx.role ?? '—'} · school=${(ctx.schoolId ?? '—').slice(0, 8)}…` : `HTTP ${r.status}`,
          failedBecause: r.status === 200 ? null : `expected 200, got ${r.status}`,
        };
      },
    },
    {
      id: 'phase5-diary',
      group: 'Phase 5 endpoints',
      title: 'The diary endpoint answers',
      what: `GET ${env.api}/me/diary with the signed-in token`,
      expect: 'HTTP 200 with a days array and an unsignedCount.',
      why: 'Phase 5 shipped this. A 404 here means the deployed API predates the feature; a 500 usually means the migration has not been applied to this environment\'s database.',
      needsCreds: true,
      roles: FAMILY_ROLES,
      async run(ctx) {
        if (!ctx.token) return { skipped: true, detail: 'No token — the sign-in check did not run or did not pass.' };
        const wrong = wrongRole(ctx, FAMILY_ROLES);
        if (wrong) return { skipped: true, detail: wrong };
        const r = await req(`${env.api}/me/diary`, { headers: authed(ctx.token) });
        const shaped = r.json && Array.isArray(r.json.days) && typeof r.json.unsignedCount === 'number';
        return {
          ok: r.status === 200 && shaped,
          ms: r.ms,
          detail: r.status === 200 ? `HTTP 200 · ${r.json?.days?.length ?? 0} days · ${r.json?.unsignedCount ?? '—'} unsigned` : `HTTP ${r.status} · ${(r.text || '').slice(0, 160)}`,
          failedBecause: r.status !== 200 ? `expected 200, got ${r.status}` : shaped ? null : 'response is not the StudentDiaryResult shape',
        };
      },
    },
    {
      id: 'phase5-attendance',
      group: 'Phase 5 endpoints',
      title: 'The attendance summary answers',
      what: `GET ${env.api}/me/attendance with the signed-in token`,
      expect: 'HTTP 200 with present/absent/late counts and a month.',
      why: 'The family attendance screen on both clients reads this. The shape assertion is the point — a 200 carrying the wrong shape is what produces a blank card rather than an error.',
      needsCreds: true,
      roles: FAMILY_ROLES,
      async run(ctx) {
        if (!ctx.token) return { skipped: true, detail: 'No token — the sign-in check did not run or did not pass.' };
        const wrong = wrongRole(ctx, FAMILY_ROLES);
        if (wrong) return { skipped: true, detail: wrong };
        const r = await req(`${env.api}/me/attendance`, { headers: authed(ctx.token) });
        const j = r.json ?? {};
        const shaped = ['present', 'absent', 'late'].every((k) => typeof j[k] === 'number') && !!j.month;
        return {
          ok: r.status === 200 && shaped,
          ms: r.ms,
          detail: r.status === 200 ? `HTTP 200 · ${j.month ?? '—'} · ${j.present ?? '?'}P ${j.absent ?? '?'}A ${j.late ?? '?'}L` : `HTTP ${r.status}`,
          failedBecause: r.status !== 200 ? `expected 200, got ${r.status}` : shaped ? null : 'missing present/absent/late/month',
        };
      },
    },
    {
      id: 'phase5-my-classes',
      group: 'Phase 5 endpoints',
      title: "A teacher's class list answers",
      what: `GET ${env.api}/manage/attendance/my-classes with the signed-in token`,
      expect: 'HTTP 200 with an array of classes.',
      why: 'The picker every staff screen starts from. Deliberately UNFILTERED by weekday — a teacher must be able to post an announcement to a class on a Sunday — which is why it is checked separately from the day status below.',
      needsCreds: true,
      roles: STAFF_ROLES,
      async run(ctx) {
        if (!ctx.token) return { skipped: true, detail: 'No token — the sign-in check did not run or did not pass.' };
        const wrong = wrongRole(ctx, STAFF_ROLES);
        if (wrong) return { skipped: true, detail: wrong };
        const r = await req(`${env.api}/manage/attendance/my-classes`, { headers: authed(ctx.token) });
        const arr = Array.isArray(r.json) ? r.json : null;
        return {
          ok: r.status === 200 && !!arr,
          ms: r.ms,
          detail: arr ? `HTTP 200 · ${arr.length} classes · ${arr.slice(0, 4).map((c) => c.name).join(', ')}${arr.length > 4 ? '…' : ''}` : `HTTP ${r.status} · ${(r.text || '').slice(0, 140)}`,
          failedBecause: r.status !== 200 ? `expected 200, got ${r.status}` : arr ? null : 'response was not an array',
        };
      },
    },
    {
      id: 'phase5-day-status',
      group: 'Phase 5 endpoints',
      title: "Today's register list is filtered to today's timetable",
      what: `GET ${env.api}/manage/attendance/status?date=<today> and the same for the coming Sunday`,
      expect: 'HTTP 200 both times, and the Sunday list is no longer than the weekday list.',
      why: 'This endpoint gained a scheduled-only filter because it was offering every class on a Sunday, when none of them meet. A live check is the only way to see that: the filter reads the timetable rows in the database, so it can pass in unit tests and still be wrong against real data.',
      needsCreds: true,
      roles: STAFF_ROLES,
      async run(ctx) {
        if (!ctx.token) return { skipped: true, detail: 'No token — the sign-in check did not run or did not pass.' };
        const wrong = wrongRole(ctx, STAFF_ROLES);
        if (wrong) return { skipped: true, detail: wrong };
        const today = new Date();
        const iso = (d) => d.toISOString().slice(0, 10);
        const sunday = new Date(today);
        sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7 || 7));

        const [a, b] = await Promise.all([
          req(`${env.api}/manage/attendance/status?date=${iso(today)}`, { headers: authed(ctx.token) }),
          req(`${env.api}/manage/attendance/status?date=${iso(sunday)}`, { headers: authed(ctx.token) }),
        ]);
        const todayN = Array.isArray(a.json) ? a.json.length : null;
        const sundayN = Array.isArray(b.json) ? b.json.length : null;
        const bothOk = a.status === 200 && b.status === 200 && todayN !== null && sundayN !== null;
        return {
          ok: bothOk && sundayN <= todayN,
          ms: a.ms + b.ms,
          detail: bothOk ? `${iso(today)}: ${todayN} classes · Sunday ${iso(sunday)}: ${sundayN} classes` : `HTTP ${a.status}/${b.status}`,
          failedBecause: !bothOk
            ? `expected 200 from both, got ${a.status} and ${b.status}`
            : sundayN > todayN
              ? `Sunday offered ${sundayN} classes but the weekday only ${todayN} — the scheduled-only filter is not applied`
              : null,
        };
      },
    },
  ];
}

/* Which roles each signed-in check applies to. `/me/*` is the family's own
 * view of their data; `/manage/*` is staff. Checking the role first turns a
 * confusing 403 into an accurate "this account cannot answer this question". */
const FAMILY_ROLES = ['STUDENT', 'PARENT'];
const STAFF_ROLES = ['TEACHER', 'SCHOOL_ADMIN', 'ADMIN'];

function wrongRole(ctx, allowed) {
  if (!ctx.role) return null; // unknown — let the request speak for itself
  if (allowed.includes(ctx.role)) return null;
  return `The configured account is ${ctx.role}; this endpoint serves ${allowed.join(' / ')}. Not a failure — configure an account of that role to cover it.`;
}

/** Metadata only — lets the UI render the suite before anything has run. */
export function describeLive(envId) {
  const env = ENVIRONMENTS[envId];
  if (!env) return null;
  const creds = liveCreds();
  return {
    env: { id: env.id, label: env.label, site: env.site, api: env.api, branch: env.branch },
    credsConfigured: !!creds,
    checks: defineChecks(env, creds).map((c) => ({
      id: c.id,
      group: c.group,
      title: c.title,
      what: c.what,
      expect: c.expect,
      why: c.why,
      needsCreds: !!c.needsCreds,
    })),
  };
}

function liveCreds() {
  const identifier = process.env.DASH_LIVE_IDENTIFIER;
  const password = process.env.DASH_LIVE_PASSWORD;
  return identifier && password ? { identifier, password } : null;
}

/**
 * Runs the suite in order. Sequential on purpose: the signed-in checks share a
 * token produced by an earlier one, and hammering a cold environment in
 * parallel produces timeouts that look like outages.
 */
export async function runLive(envId, onProgress = () => {}) {
  const env = ENVIRONMENTS[envId];
  if (!env) return { error: `unknown environment "${envId}"` };

  const creds = liveCreds();
  const checks = defineChecks(env, creds);
  const ctx = { token: null };
  const results = [];
  const startedAt = Date.now();

  for (const check of checks) {
    onProgress({ id: check.id, status: 'running' });
    let outcome;
    try {
      outcome = await check.run(ctx);
    } catch (e) {
      outcome = { ok: false, detail: e.message, failedBecause: `the check itself threw: ${e.message}` };
    }
    const row = {
      id: check.id,
      group: check.group,
      title: check.title,
      what: check.what,
      expect: check.expect,
      why: check.why,
      needsCreds: !!check.needsCreds,
      status: outcome.skipped ? 'skipped' : outcome.ok ? 'pass' : 'fail',
      ms: outcome.ms ?? null,
      detail: outcome.detail ?? null,
      failedBecause: outcome.failedBecause ?? null,
      meta: outcome.meta ?? null,
    };
    results.push(row);
    onProgress(row);
  }

  return {
    env: { id: env.id, label: env.label, site: env.site, api: env.api, branch: env.branch },
    credsConfigured: !!creds,
    startedAt,
    finishedAt: Date.now(),
    results,
    // Skipped is counted separately and never folded into passed — a suite
    // that "passed" because half of it never ran is the exact failure this
    // dashboard exists to make visible.
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    },
  };
}
