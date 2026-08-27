# Sckools — Scale Hardening & Observability, v2 (against `staging`)

**Date:** 2026-08-28
**Status:** Draft — supersedes `2026-08-28-scale-hardening-and-observability-design.md`
**Why v2:** v1 was written against `feat/blog-platform`, which is 616 commits behind
`staging`. Roughly half of what it proposed already exists on `staging`. This
version is audited against `origin/staging` at `a724f4e`.

---

## 1. What changed between v1 and this document

| v1 proposed | Actual state on `staging` |
|---|---|
| Add `Result.schoolId` + index | **Already present.** v1's migration would have collided |
| Redis-backed throttler | **Already present** — `RedisThrottlerModule` / `RedisThrottlerStorage` |
| Build a transactional outbox | **Already present** — `NotificationOutbox` model, service, controller, cron, with `attempts` / `MAX_ATTEMPTS` / `lastError` |
| 39 unscoped tenant queries | **152.** v1's inventory covered ~a quarter of the real surface |
| 80 unbounded `findMany` | **158** |

`feat/horizontal-scale` also carries two unmerged commits; its throttler fix
reached `staging` by another route and is now redundant there.

---

## 2. Phase 1 — Query scoping — **DONE, in review**

Shipped as PR #34 (`perf/tenant-query-scoping`). ~140 call sites scoped, plus
`Teacher_userId_idx`.

### Measured on `staging`'s own schema

Controlled A/B: two APIs running simultaneously against one database
(200 schools, 100k students, 9M attendance rows, built by `prisma migrate deploy`),
differing only in code.

| VUs | before req/s | after req/s | gain | before p95 | after p95 | before err | after err |
|-----|-------------|-------------|------|-----------|-----------|-----------|-----------|
| 5   | 15.6 | 683.7   | 43.8× | 572 ms   | 13 ms  | 0%    | 0% |
| 20  | 31.9 | 1,308.0 | 41.0× | 1,232 ms | 24 ms  | 0%    | 0% |
| 40  | 34.5 | 1,336.3 | 38.7× | 2,076 ms | 47 ms  | 0%    | 0% |
| 60  | 32.9 | 874.4   | 26.6× | 2,460 ms | 135 ms | 3.4%  | **0%** |
| 100 | 44.3 | 754.4   | 17.0× | 2,584 ms | 237 ms | 20.8% | **0%** |

Query level: `1226.481 ms / 17,996 buffers` → `0.201 ms / 20 buffers`.

### Functional equivalence — how it was proved

Mock-based unit tests prove a `where` clause changed; they cannot prove the
query still returns the same rows. Three independent checks were used:

1. **Unit** — 912/912, identical to the pre-change baseline.
2. **e2e against a real database** — 550 passed / 42 skipped / 15 of 19 suites,
   byte-identical to the baseline, including `tenant-isolation.e2e-spec.ts`
   (cross-tenant writes still rejected by RLS `WITH CHECK`) and
   `rls-coverage.e2e-spec.ts`.
3. **Differential API diff** — every GET route (145 discovered from the app's own
   route table) called against both APIs with the same token, host and database;
   responses compared byte-for-byte. **140 of 141 comparable routes identical**,
   4 skipped for unresolvable path params.

The single difference was not a regression: `GET /manage/attendance/status`
returns **HTTP 500 on unmodified `staging`** and 200 after the fix.

### A latent outage this uncovered

`attendance.service.ts:240` batches the day's marks for every section:

```ts
where: { classSectionId: { in: classSectionIds }, date: day }
```

With no `schoolId` the index cannot seek, and at 9M rows the read exceeds
**Prisma's 5,000 ms interactive-transaction timeout**:

```
Transaction already closed: A query cannot be executed on an expired
transaction. The timeout for this transaction was 5000 ms, however 5023 ms
passed since the start of the transaction.
```

Warm it is 1.571 s versus 0.048 s scoped — 33×. Cold it fails outright. This is
the teacher day-status screen: it works at today's data volume and breaks as
attendance history accumulates, or after any deploy that empties the cache.

---

## 3. Phase 2 — Connection layer — **reduced scope**

Two of v1's four items are already done. What remains:

### 3.1 Explicit pool sizing (NOT done)

`.env.production.example` points the runtime roles at `…pooler.neon.tech` with
only `sslmode=require`. No `connection_limit`, no `pgbouncer=true`.

- Prisma's default pool is `physical_cpus × 2 + 1` — 17 on the bench machine.
  That is sized for a long-running server and wrong for serverless, where each
  instance handles few concurrent requests. Pooled-serverless guidance is 1–3.
- `pgbouncer=true` disables prepared statements, which Neon's transaction-mode
  pooler discards between transactions. Without it, expect intermittent
  `prepared statement "s0" already exists` under concurrency.

**Action:** set `connection_limit=3&pgbouncer=true` on both runtime URLs, and
load-test at 3 before shipping rather than assuming.

### 3.2 Interactive-transaction timeout (NEW — found by this audit)

The 5 s default killed a real endpoint above. Phase 1 removes the immediate
cause, but the class of failure remains: any tenant transaction doing enough
work will hit it, and the error surfaces as an opaque 500.

**Action:** raise `transactionOptions.timeout` deliberately (10 s) *and* add a
route-level assertion that hot read paths stay well inside it. The timeout is a
safety net, not a budget.

### 3.3 Round trips, not transaction style (CORRECTED from v1)

v1 proposed rewriting `withTenant()` to Prisma's batch form, on the assumption
that batch collapses to a single round trip. **Measured, it does not:**

| RTT | interactive | batch | ratio |
|---|---|---|---|
| ~0.05 ms (localhost) | 2.01 ms/op | 1.79 ms/op | 1.12× |
| 4 ms (Vercel → Neon, same region) | 31.66 ms/op | 32.30 ms/op | **0.98×** |

Measured through a latency-injecting TCP proxy. The rewrite is **dropped**.

What the same experiment did establish: 31.66 ms ÷ 4 ms ≈ **8 round trips per
attendance request**, and connection-hold time is round trips × RTT. The lever
is query count.

**Action:** cut round trips on hot read paths (drop redundant existence checks
now that reads are `schoolId`-scoped; shape results outside the transaction so a
connection is not held while JavaScript runs). Target 4 → 2 on the hot reads.

### 3.4 Parameterise the tenant setting (safety, not speed)

`withTenant` splices the tenant id into `$executeRawUnsafe` behind a UUID regex.
Replace with `` $executeRaw`SELECT set_config('app.current_tenant', ${id}, TRUE)` ``.
Adopted for injection safety — it removes the string-splice entirely. No
measurable performance effect.

### 3.5 One Redis client (NOT done)

Five services each construct `new Redis()`. Upstash bills per connection.
Provide a single injectable client.

---

## 4. Phase 3 — Outbox — **mostly done, one real gap**

`NotificationOutbox` already has durability, `attempts` with a `MAX_ATTEMPTS`
cap, `lastError`, and a drain-shaped index. Two gaps remain:

### 4.1 Drain latency (the real problem)

The drain runs **only** from cron, at `0 2 * * *` — daily. A notification
enqueued at 09:00 waits ~17 hours. Nothing drains it sooner.

**Action:** add an opportunistic drain via `runInBackground` at enqueue time, so
the common path is immediate and the cron becomes the safety net rather than the
only path. `runInBackground` already wraps Vercel's `waitUntil` correctly.

### 4.2 No `SKIP LOCKED`

The drain claims rows with a plain `findMany`. With one daily cron the race is
unlikely; adding an opportunistic drain makes concurrent drains normal.

**Action:** claim with `FOR UPDATE SKIP LOCKED`, and add a unique
`(schoolId, kind, dedupeKey)` so an at-least-once retry after an ambiguous send
cannot double-notify.

---

## 5. Phase 4 — Ops dashboard — unchanged from v1

Thesis stands: `ARCHITECTURE.md` §5 already defines a scaling ladder with
trigger metrics, so the dashboard's job is to say *which rung we are on*.

Collection: a Nest interceptor accumulating in-process, flushed to Redis in a
batched pipeline on a timer and on invocation end. Per-request Redis writes are
avoided — Upstash bills per command. An existing cron rolls Redis into a
`MetricRollup` table.

Panels, and the threshold each watches:

| Panel | Metric | Trigger |
|---|---|---|
| Ladder rung | worst trigger currently firing | — |
| Route health | p95 + error rate per route | p95 > 500 ms |
| Connection hold | mean ms held | > 300 concurrent |
| Login headroom | logins/s vs the measured ~35/s ceiling | > 70% |
| Outbox | depth, oldest pending age, attempts-exhausted count | depth > 1,000 for 5 min |
| **Transaction timeouts** | count of `Transaction already closed` | any occurrence |

The last row is new, and earns its place: that error is exactly how the
attendance-status outage would have announced itself, and today nothing watches
for it.

`PRODUCTION.md` promises `otel.endpoint` / `otel.headers` in owner settings, but
that encrypted-settings layer does not exist in code — no `PLATFORM_SETTINGS_KEY`,
no settings service. This spec assumes plain env vars and a doc correction.

---

## 6. Phase 5 — `sckool-infra` skill — unchanged from v1

`.claude/skills/sckool-infra/SKILL.md`, sibling to `sckool-expert`, carrying the
deployed topology, the measured ceilings with their dates, the ladder with
trigger values, the load-test harness and how to re-run it, and the standing
decisions (no AWS, no Kafka) with the evidence behind them.

---

## 7. Known drift, not fixed here

`prisma migrate diff` reports pre-existing drift unrelated to this work:
`ImpersonationToken.id`, `LibrarySettings.id` and `MarketingLead.id` carry
`gen_random_uuid()` defaults in the migrations that the Prisma models do not
declare. Same class of bug as the `Result.schoolId` drift that made production
slower than dev. `prisma migrate dev` may try to "correct" these.

---

## 8. Triggers to revisit the infrastructure decision

| Trigger | Threshold | Then |
|---|---|---|
| Concurrent DB connections | > 300 sustained | Reconsider long-running compute |
| p95 after Phase 1–2 | > 500 ms sustained | Profile before scaling infra |
| `Transaction already closed` | any occurrence in production | Investigate immediately — it is a 500 |
| Outbox depth | > 1,000 for 5 min | Move drain to a persistent worker |
| Neon CPU in morning window | > 70%, read-dominated | Read replicas |
| Event rate | > 50,000/s | Only then consider a broker |

Standing decision: stay on Vercel. Modelling shows the current stack serves
~5,000 schools once connection-hold time is fixed — 14% of the 36,424-school
Rajasthan TAM.

---

## 9. Testing standard for every remaining phase

Phase 1 established the bar. Each subsequent phase must clear the same three:

1. Unit suite unchanged against baseline.
2. e2e suite unchanged, including `tenant-isolation` and `rls-coverage`.
3. Differential API diff before/after on a seeded database — byte-for-byte on
   every comparable GET route.

No phase may weaken tenant isolation, and the differential diff is what proves
it rather than asserting it.
