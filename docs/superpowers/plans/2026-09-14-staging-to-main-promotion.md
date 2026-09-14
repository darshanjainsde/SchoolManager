# Promotion: staging → main

**What it is:** 65 commits, 273 files, ~30k insertions, 8 migrations. The Active
Roster (lifecycle, celebrations, session plans) and the whole Sports wing.

**The one thing that makes this safe:** every pending migration is *additive*.
No `DROP`, no `TRUNCATE`, no `DELETE`, and every `NOT NULL` column carries a
`DEFAULT`. That single property is what lets the schema go first and the code
roll back cleanly — both steps below depend on it.

---

## Before the day

- [ ] `pnpm preflight` green on the staging head.
- [ ] `pnpm --filter @skoolos/web audit:screens` → measure at 390/414/768/1024/1280, expect CLEAN.
- [ ] Confirm nothing uncommitted: `git status --porcelain`.
- [ ] Note the rollback point: `git rev-parse origin/main` — write it down.

## The order, and why

`db-migrate.yml` auto-applies on a push to **staging only**; production is a
manual dispatch. Vercel, meanwhile, deploys production the moment `main` moves.
So **merging first would put new code on an old schema** and 500 every request
that touches a new column.

Because the migrations are additive, the reverse order is safe: the new columns
sit unused until the code that reads them arrives.

### 1. Migrate production first

```
gh workflow run db-migrate.yml -f environment=production -f inspect_only=true   # dry run
gh workflow run db-migrate.yml -f environment=production                        # apply
```

Expect 8 migrations applied:
`person_lifecycle`, `celebrations`, `session_plans`, `sports_wing`,
`records_site_config`, `sports_team_basis`, `sports_stages`, `sports_gap`.

**Do this off-peak (after ~19:00 IST).** Three of them build indexes on
`Student`, `Teacher` and `Staff` — populated tables — with plain `CREATE INDEX`,
which holds a lock against *writes* on that table while it builds. Seconds at
current row counts, but not during attendance.

- [ ] Workflow green.
- [ ] `db-drift` workflow against production reports no drift.
- [ ] Production still serving: the old code is unaffected by the new columns.

### 2. Merge

```
gh pr create --base main --head staging --title "Active Roster + Sports wing"
# merge, do not squash — the history is the audit trail
```

- [ ] Vercel production deploy green for web **and** api.

### 3. Verify before anyone is told

- [ ] `GET /health` → 200.
- [ ] A tenant public page loads (`/`, `/records`).
- [ ] Sign in to the console; the sidebar shows **no new modules** — `SPORTS`,
      `ALUMNI` and `PRESS` are in no tier, so nothing changes for an existing
      school until an override is flipped.
- [ ] Error rate and p95 flat for 30 minutes.

### 4. Turn it on, one school

- [ ] Owner console → the pilot school → enable `SPORTS`.
- [ ] Walk one meet end to end: create, players, publish, one result.

## Rollback

Revert the merge commit on `main` and let Vercel redeploy. **Do not roll back
the schema** — the columns are additive and the old code ignores them entirely.
That is the whole reason to migrate first: the schema step is not the risky one,
and reverting the code needs no coordination with it.

## Accepted risks

| Risk | Why it is acceptable now |
|---|---|
| No load test of authenticated paths | Cannot sign in from CI. Public SSR held 0% errors at 35 VUs. Mitigated by the one-school pilot in step 4. |
| Rate limit is 100 req/min per IP | A school behind one NAT IP could trip it. Not new in this release; watch it during the pilot. |
| Some notification kinds wait for the nightly cron | Messages and exams deliver in seconds via `drainSoon()` (`waitUntil`). Assignments, sessions, library and sports enqueue WITHOUT calling it, so those wait for 02:00. Pre-existing, not a regression. The fix is to call `drainSoon()` from those services, which needs `NotificationOutboxService` exported and four module graphs touched — after the promotion, not an hour before it. **The cron cannot be made more frequent:** Vercel Hobby rejects the entire deployment for a sub-daily cron, and `scripts/check-tsconfig-scope.mjs` guards it. |
| The Sports wing has never run a real meet | Step 4 is exactly that, on one school, before anyone else sees it. |
