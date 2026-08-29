---
name: sckool-infra
description: Verified infrastructure, scale and performance knowledge for Sckools — real deploy topology, measured ceilings with dates, the scaling ladder and its trigger values, what we changed and why, and the standing decisions (no AWS, no Kafka) with the evidence behind them. Use for any capacity, performance, database, connection-pool, queue, load-test or "should we scale X" question. Self-updating — see Freshness protocol.
---

# Sckools infrastructure & scale

Companion to [[sckool-expert]], which maps the *code*. This maps the *runtime*:
what the system actually runs on, where it breaks, and why each decision was
made. Every number here was measured, and says how.

## Freshness protocol (run FIRST, every invocation)

Trained at commit **`daffe40`** (`origin/staging`, 2026-08-29) — PRs #40–#43
all merged; staging is green and every migration is applied.

1. `git fetch origin && git log --oneline daffe40..origin/staging | head -30`
2. Empty → current; proceed.
3. Otherwise skim (`git show --stat`), read anything contradicting this file,
   answer from CURRENT code, then **update this file** and bump the commit
   above. Measurements carry dates — re-run `scripts/loadtest` rather than
   trusting a stale figure.

## Evidence rules

This file exists because the repo's own docs disagreed with each other and cost
real time. So:

- **Every number states how it was obtained.** No number without a method.
- **Prefer CI and code over prose docs.** `.env.production.example` said "Neon"
  for months while three CI workflows ran against Supabase.
- **A mock-based test is not functional proof.** See *Verification standard*.

---

## 1. Deploy topology (verified)

| Piece | Reality | How verified |
|---|---|---|
| Web | Vercel `skoolos-web` → sckools.com, *.sckools.com | `apps/web`, sckool-expert |
| API | Vercel `skoolos-api`, **region `bom1`** (Mumbai), ncc-bundled single function, `maxDuration: 60` | `apps/api/vercel.json`, `apps/api/.vercel/project.json` |
| Database | **Supabase Postgres** — transaction pooler :6543, session pooler :5432 | `docs/DATABASE.md`; `.github/workflows/db-{backup,migrate,restore-drill}.yml` |
| Redis | Upstash | `.env.production.example`, `common/redis` |
| Branches | `staging` → Preview, `main` → Production | sckool-expert |
| Cron | 3 entries: exam-reminders, notification-outbox, library-due-soon | `apps/api/vercel.json` |

**The Railway path in `docs/PRODUCTION.md` is stale** — it documents API+worker
on Railway; they are on Vercel. `apps/worker` is a stub: a health endpoint and
nothing else. BullMQ is a dependency with **zero** `new Queue()` / `new Worker()`
call sites.

**Do not say "Neon".** The only surviving references are
`IMPLEMENTATION_PLAN.md` and the scale specs. Production is Supabase.

---

## 2. Measured ceilings (2026-08-27/28)

Bench: 200 schools, 100k students, 9M attendance rows, 1M results, ~2 GB,
database built by `prisma migrate deploy` (so it matches production's schema,
not a hand-patched dev DB). Harness: `scripts/loadtest/`.

**These are RELATIVE, not production capacity** — one MacBook, local Postgres.
What transfers is the ratios, the failure mechanisms, and the concurrency at
which each knee appears.

### Attendance read — before and after query scoping

Controlled A/B, two APIs against one database, differing only in code:

| VUs | before req/s | after req/s | before p95 | after p95 | before err | after err |
|-----|------|---------|----------|--------|-------|----|
| 5   | 15.6 | 683.7   | 572 ms   | 13 ms  | 0%    | 0% |
| 40  | 34.5 | 1,336.3 | 2,076 ms | 47 ms  | 0%    | 0% |
| 100 | 44.3 | 754.4   | 2,584 ms | 237 ms | 20.8% | 0% |

Query level: `1226.481 ms / 17,996 buffers` → `0.201 ms / 20 buffers`.

### Login — a hard wall

**~35 logins/s per instance, flat at any concurrency.** argon2id at 64 MB is
memory-bandwidth bound, so extra cores buy almost nothing: 5 sequential = 31/s,
10 concurrent = 36/s. Latency grows linearly (127 ms at 5 VUs → 1,428 ms at 50)
while throughput does not move. Horizontal scale is the only lever here; code is
not.

### Prisma `connection_limit` (per instance, 100 VUs)

| limit | req/s | p95 |
|---|---|---|
| **1** | 284.7 | 505 ms | ← the only value referenced anywhere (stale doc — see below)
| 2 | 457.0 | 296 ms |
| 5 | 754.6 | 190 ms |
| 8 | 1009.0 | 142 ms |
| 17 (Prisma default) | 1166.6 | 127 ms |

**Production's actual `connection_limit` is UNVERIFIED.** The only reference in
the repo is `docs/PRODUCTION.md:148` — the same stale doc that says "Neon-style"
and puts the API on Railway. `docs/DATABASE.md` (authoritative) specifies
`?pgbouncer=true` and says nothing about a limit. Read the live Vercel env
before acting on any of this.

If it really is 1, that gives up ~4× throughput and ~4× p95 versus 5. But
raising it trades against Supavisor pool capacity, which this bench **cannot**
measure — move it with pooler metrics in view, never blind.

### Write throughput degrades with table size

Attendance bulk insert: 43,000 rows/s at 1M rows → 13,700 rows/s at 9M
(3.2× degradation, measured during seeding). Relevant because attendance
arrives as a synchronised morning burst.

---

### Where we stand — full-surface measurement, 2026-08-29

Every parameterless GET the API exposes, against the 200-school / 2.8 GB bench,
on merged staging. 61 routes returned 200 for a SCHOOL_ADMIN token:

| | |
|---|---|
| median | 12.6 ms |
| p95 | 18.3 ms |
| slowest single route | 30.6 ms (`/public/site`) |
| largest payload | 233 KB (`/manage/students`) — cap is 4.5 MB |

Mixed-workload throughput, one API process, one local Postgres:

| VUs | req/s | p95 | errors |
|---|---|---|---|
| 10 | 418 | 56 ms | 0% |
| 50 | 462 | 246 ms | 0% |
| 150 | 400 | 946 ms | 0% |

Throughput is flat from 50 VUs while latency grows linearly — a saturated
single Node process, which is what horizontal scale fixes. **Zero errors at
every level**; the pre-#34 build returned 20.8% at 100 VUs.

Sampled during the 150-VU run: **35 connections, 1–5 active, 13–17 idle in
transaction.** At 150 concurrent users only about three connections are
executing. The database is not the constraint and is nowhere near becoming one.

### The `_count` trap — the third disguise of the same bug (2026-08-29)

`include: { _count: { select: { students: true } } }` reads like a scoped count
and is not. Prisma compiles it to a LEFT JOIN over a subquery whose WHERE
clause is literally `1=1`: the whole table is aggregated and the join discards
other schools' rows afterwards. Correct answer, cost proportional to the
platform.

**The `where` inside `_count` filters the RELATION, not the parent — there is
no way to push a tenant predicate into that subquery through Prisma's API.**
Use an explicit scoped `groupBy`; `apps/api/src/common/lists/relation-counts.ts`
holds the four helpers.

| site | Prisma's `_count` | scoped |
|---|---:|---:|
| unread messages per thread | 2,432 ms | 1.77 ms |
| `GET /manage/classes` end to end | 270 ms | 6 ms |
| students per class section | 27 ms | 0.19 ms |

The messages one was a full parallel seq scan of 1M rows to draw one school's
inbox. `Message` had no index on `schoolId` at all.

A third variant, same root: **`count()` called with no `where` whatsoever** —
`libraryBookCopy.count()` and `libraryBookTitle.count()`, 50 ms of the library
dashboard's 66 ms. When auditing, grep for all three shapes: unscoped
`findMany`, relation `_count`, and bare `count()`/`aggregate()`.

**Why the #34 scoping pass missed all of them:** it searched for queries
missing `schoolId` in a `where`. These have no `where` to inspect — the tenant
predicate is absent somewhere the reviewer cannot see it.

## 3. Why RLS cannot save you from a missing `schoolId`

The single most important fact in this file.

Every policy is `("schoolId")::text = current_setting('app.current_tenant', true)`.
The cast is on the **column** side, so **the uuid index can never serve it**. The
tenant predicate is always a post-scan `Filter`, never an `Index Cond`.

Consequences:

1. A query whose only remaining predicate is a **non-leading** index column
   scans the table. `Attendance` is indexed `(schoolId, classSectionId, date)`;
   filtering on `classSectionId, date` alone walks all 9M rows.
2. Cost grows with **total platform size**, not the tenant's own data. Every
   school gets slower as you add unrelated schools.
3. RLS remains correct for *security* — `tenant-isolation.e2e-spec.ts` proves
   cross-tenant writes are still rejected. It just contributes nothing to speed.

**Rule: always pass `schoolId` explicitly. RLS is defence in depth, not a query
plan.** Adding it is a pure narrowing and cannot widen access.

Exceptions that must stay unscoped:

- **`community/public-events`** — cross-tenant BY DESIGN. Its policy returns the
  host's rows OR any `NETWORK` + `APPROVED` row; that is how Connect surfaces
  other schools' events. Scoping it silently breaks the feature.
- `findUnique`/`update`/`delete` on a primary key — Prisma rejects extra keys,
  and a PK lookup already seeks.
- `Student.userId` is `@unique`; `Message` has `@@index([threadId, createdAt])`.

---

## 4. What changed, and why (PRs #34 → #36, stacked on `staging`)

**#34 — scope every tenant query.** ~140 sites + `Teacher_userId_idx`
(`Teacher.userId` had no index at all, yet "which teacher is this caller?" is on
the hot path for attendance, leave, class notes, messages and diary).

**#35 — connection layer.** One Redis client instead of five, adopting the
throttler's `enableOfflineQueue: false` — which also fixes a latent stall where
a Redis outage would have queued cache commands through connect-timeout cycles
instead of falling through to Postgres. `withTenant` binds the tenant id via
`set_config` instead of splicing it into `$executeRawUnsafe`, and sets explicit
`timeout: 10s` / `maxWait: 3s`.

**List ceilings (2026-08-29).** 158 tenant lists returned however many rows a
tenant owned — the same 4.5 MB payload class as the public-site events. Now
guarded per growth class (STRUCTURE 500 / ACTIVITY 2,000 / ROSTER 20,000), set
above what any query legitimately returns so no screen changed behaviour.
**Truncation is reported, never silent**: `packages/db` flags any findMany
returning exactly its take. Three attendance rosters stay uncapped on purpose —
a partial roster drops children from the register.

Two things that round also fixed: `seatsTaken` now sums in the database (a
ceiling there would have oversold the hall) with a matching
`(ticketTypeId, status)` index, and class-notes' timetable guard gained the
`schoolId` every TimetableSlot index leads with.

**Metrics history (2026-08-29).** Redis is now explicitly a buffer; completed
minutes promote to hourly `MetricRollup` rows and are deleted. Promotion runs
off the flush timer, not cron, because Hobby cannot schedule more often than
daily and the 2h TTL would lose everything in between.

**#37 — ops dashboard.** `/platform/ops` answers "which rung are we on" from the
ladder in ARCHITECTURE.md §5. Fixed-bucket histograms because they are the only
form that MERGES across instances — nothing is scrapeable on serverless, so
everything must be summable. Latency and connection-hold time are collected
separately: hold × throughput is the concurrent connection count, which is what
actually breaks. In-memory accumulation flushed every 15s via HINCRBY, never
per-request (Upstash bills per command). Route labels templated and capped at
200/instance.

**Known limitation:** `instances` is hard-coded to 1 — a function cannot count
its warm siblings. The login-headroom rung is therefore pessimistic, which is
the safe direction, but reads "act" early once Vercel scales out.

**#36 — outbox latency.** The outbox always had durability right (rows written
in the same transaction as the business change, with attempts/lastError). Its
gap was that the cron ran **daily**, so a 09:00 notification waited ~17 hours —
while the service's own comment said it "is expected to run every few minutes".
Now minutely, with `FOR UPDATE SKIP LOCKED` claiming so overlapping drains
cannot double-send.

---

## 5. Latent failure modes found by this work

- **`Transaction already closed`.** Prisma's interactive-transaction timeout
  defaulted to 5s. A batched attendance read exceeded it at 9M rows and returned
  an opaque **HTTP 500** on `GET /manage/attendance/status`. Found by the
  differential API diff, invisible to the unit suite. Now 10s, and #34 removes
  the cause. **Any occurrence in production is a 500 — alert on it.**
- **Schema drift.** `Result.schoolId` existed in the dev DB but not in
  migrations, so production ran a correlated-subquery RLS policy and was
  **slower than dev** — the opposite of the usual assumption. Guard:
  `prisma migrate diff --from-migrations --to-schema-datamodel`.
- **Still-open drift:** `ImpersonationToken.id`, `LibrarySettings.id`,
  `MarketingLead.id` carry `gen_random_uuid()` defaults in migrations that the
  Prisma models do not declare. `prisma migrate dev` may try to "correct" them.

- **A new table can ship without RLS and nothing at runtime will say so.**
  `MetricRollup` did. Supabase exposes the whole `public` schema through its
  Data API, so a table without RLS is readable AND WRITABLE by anyone holding
  the anon key — for a metrics table that means handing out platform traffic
  patterns and letting a stranger write the operator's dashboard. Caught by
  `packages/db/src/rls-coverage.spec.ts` in the PR that added it, which is what
  that check is for. Platform-only tables take `ENABLE` plus an explicit
  deny-all (`USING (false) WITH CHECK (false)`); the BYPASSRLS platform role
  still passes.

- **CI's Lint step runs first, so one lint error hides every other result.**
  A `require()` inside a test body sat on staging from #39 and made Typecheck,
  Build and Unit tests *skip* — two unrelated PRs showed red for something
  neither had written. When a PR is red, check WHICH STEP failed before
  reading the failure as yours.

---

## 6. Standing decisions

**Stay on Vercel. No AWS migration.** After #34, connection-hold time drops ~50×.
Little's Law (`concurrent connections = throughput × hold time`) puts a modelled
5,000 schools at ~20 concurrent connections. Migration solves a problem that does
not exist, and costs `bom1` edge proximity. Revisit only on the triggers below.

**No Kafka. Ever, realistically.** Modelled peak event rate ~28/s; Kafka's design
point is ~1,000,000/s — a ~35,000× gap. A Postgres outbox gives durability,
retries, a DLQ, and queue depth as `SELECT count(*)`. Managed Kafka starts around
$200/month for brokers you would operate.

**Redis: keep, use more.** Already backs host lookup, feature resolution and the
throttler. Correct amount of Redis.

### Triggers to revisit

| Trigger | Threshold | Then |
|---|---|---|
| Concurrent DB connections | > 300 sustained | Reconsider long-running compute |
| p95 after #34–#36 | > 500 ms sustained | Profile before scaling infra |
| `Transaction already closed` | **any** occurrence | Investigate now — it is a 500 |
| Outbox depth | > 1,000 for 5 min | Persistent worker instead of cron |
| Supabase CPU, morning window | > 70%, read-dominated | Read replicas |
| Login QPS | > 70% of ~35/s × instances | Scale out; code cannot fix argon2 |
| Event rate | > 50,000/s | Only then consider a broker |

---

## 7. Verification standard (non-negotiable)

The unit suite is **mock-based**: it proves a `where` clause changed, never that
the query returns the same rows. Every scale change clears three checks:

1. **Unit** — unchanged against baseline (915 on `perf/phase3`).
2. **e2e against real Postgres** — `pnpm --filter @skoolos/api test:e2e`,
   including `tenant-isolation` and `rls-coverage`. Some behaviours (RLS,
   `SKIP LOCKED`) exist only in a real database.
3. **Differential API diff** — `scripts/loadtest/diff-api.py`. Two builds, one
   database, every GET route compared byte-for-byte.

That third check is what caught the attendance-status 500. Do not skip it.

---

## 8. Corrections log (things previously believed, now disproved)

Kept because each cost real time, and the wrong belief is easy to re-acquire.

- **"Batch transactions cut round trips."** Prisma's `$transaction([...])` was
  expected to collapse to one round trip. Measured through a latency-injecting
  TCP proxy at 4 ms RTT: **0.98×**. No benefit. The real lever is *query count*
  — ~8 round trips per attendance request, and hold time = round trips × RTT.
- **"The database is Neon."** `.env.production.example` said so; CI says
  Supabase. Trust CI over prose.
- **"The scale work needs a big infra change."** A seven-line query fix was 21×;
  every infra option modelled at ~1×.
- **"39 unscoped queries."** That was `feat/blog-platform`, 616 commits behind
  `staging`. The real number was 152. **Always branch from `origin/staging` and
  check how stale your base is.**
