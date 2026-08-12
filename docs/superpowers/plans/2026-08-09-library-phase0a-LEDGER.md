# SDD ledger — plan: docs/superpowers/plans/2026-08-09-library-phase0a-foundation.md

Worktree: /Users/darshanjain/skoolos-library
Branch: feat/library-service
Merge base: eb4d19ab53b11a589c8098fb940fd25551e24768
Plan committed at: 9c5a98eedcfbc0f04001b177dc39d351f211a516

## Pre-flight scan (controller-resolved, no human decision needed)

- Task 2 Step 1 deliberately writes `MemberStatus.EXPIRED`, which the Global
  Constraints forbid, so that Step 3's guard test fails red and Step 4 fixes it.
  This is an intentional red-green cycle, not a constraint violation. The final
  diff contains no `EXPIRED`. Resolved: stated explicitly in the Task 2 dispatch
  so the implementer does not "helpfully" skip the red step.
- Tasks 7 (step 7), 9 (step 5), 10 (step 4) and 11 (step 3) describe some
  implementations in prose rather than complete code blocks. Resolved: those
  implementers run on a standard model rather than the cheapest tier, and their
  reviewers check against the task's Interfaces block, which is exact.
- Task 12's seed text names `library@sckool.com` as a LIBRARIAN login. That
  credential was given by the user for the **testboard owner** (Plan B), not the
  library. Resolved: the library seed uses `librarian@raffles.test` with the
  password from `LIBRARY_SEED_PASSWORD`, matching the existing Raffles
  sample-school convention. Carried into the Task 12 dispatch.

## Progress

Task 1: complete (commits 9c5a98e..9b8bfb3, review clean — spec ✅, quality Approved)
Task 1: minor (deferred): `build: "tsc -p tsconfig.json || true"` swallows compile
  errors. Labeled plan-mandated by the reviewer (copied from packages/db's existing
  convention). Ruling: downgraded to minor — the separate `typecheck` script
  (`tsc --noEmit`, no `|| true`) is what the Task 12 preflight gate runs, so type
  errors still fail the gate. Revisit in Task 12 when preflight is written.
Task 1: minor (deferred): generated/client was hand-stubbed because `prisma generate`
  refuses a zero-model schema. Gitignored, never committed, and verified narrow by
  the reviewer. Task 2 MUST replace it with a real `prisma generate` and re-run
  `tsc --noEmit` — carried into the Task 2 dispatch.

Controller infrastructure (not a plan task): local dev stack added at
docker-compose.library.yml + scripts/library-db-init.sql, on ports 55432/56379 with
distinct container names so the Sckools containers are untouched. Verified
library_app has rolbypassrls=f. Worktree .env (gitignored) points at it. This
unblocks Tasks 2, 3, 6 and 11 without any staging credentials.
Task 2: complete (commits f9fc1f7..0a102eb, review clean — spec ✅, quality Approved)
Task 2: minor (deferred): schema.prisma `enum LibRole` carries a doc comment whose
  text describes MemberType, not LibRole. Plan-mandated (verbatim from the brief).
  Doc fix, no functional effect.
Task 2: minor (deferred): AuditLog and IdempotencyKey carry `orgId` with no FK to
  LibraryOrg, so orgId is unenforced at the DB level on those two. Plan-mandated and
  defensible (audit rows should survive tenant deletion) but worth an explicit note.
Task 2: minor (deferred) → CARRY TO TASK 12: `pnpm --filter @library/db exec prisma`
  does not load the root .env (pnpm sets cwd to the package dir; the Prisma CLI does
  not walk up). Needs `set -a && source .env && set +a` today. The CI workflow and
  preflight script in Task 12 must handle env loading explicitly.
Task 3: fix round 1/5 (1 addressed, 0 open — RLS audit now counts tablesChecked and
  ok requires it > 0, so an empty/mis-scoped schema reports ok:false instead of a
  vacuous green; guard proven by revert-and-fail; commits d9e7190..03a0706)
Task 3: complete (commits 0a102eb..03a0706, review clean — spec ✅, all findings addressed)
  Key evidence: unscoped SELECT as library_app (rolbypassrls=f) returns 0 rows.
  Fail-closed tenancy is verified against a real database, not just configured.
Task 3: minor (deferred): rls-audit.spec.ts "allow-lists exactly three tables" asserts
  against the hardcoded RLS_ALLOW_LIST the function returns unconditionally — zero
  discriminating power. Plan-mandated (verbatim from brief).
Task 3: minor (deferred): migration 20260809120000_rls_identity sorts lexicographically
  BEFORE the already-applied 20260809190637_init_identity. Plan-mandated; verified to
  apply correctly, but a latent trap for anyone assuming folder order is chronological.
Task 4: fix round 1/5 (1 addressed — ioredis options now guarded by a mocked-constructor
  test proven to fail when an option is removed, plus a no-connect-at-construction
  assertion; apps/library-api/api/ gitignored; commits 8d3fe63..1d5dd64)
Task 4: fix round 2/5 (1 addressed — tsconfig rootDir:"." excluded the cross-package
  @library/db source so `ncc build` died with TS6059; removed rootDir and added a
  LITERAL include path for packages/library-db/src only, deliberately narrower than
  apps/api's `packages/*/src` wildcard so it cannot reach Sckools packages. bundle now
  exits 0, 4.15MB artifact, zero @skoolos/* references inside it; commits 1d5dd64..7d00141)
Task 4: complete (commits 03a0706..7d00141, all findings addressed)
  NOTE: two real defects in the PLAN's verbatim code were caught here, both only
  because the dispatch demanded a real boot + real bundle rather than green unit tests:
  (a) /ready hung ~11 min on Redis drop (ioredis status becomes 'reconnecting', not
      'wait'/'end', so the reconnect guard never re-fired and the offline queue blocked
      ping() behind infinite retry);
  (b) the bundle never built at all.
  Both are the local-gate-≠-cloud-gate class. Keep demanding real execution.
Task 4: minor (deferred): disconnectLibrary is never wired to a shutdown hook, so the
  Prisma clients are not gracefully closed. Gap in the plan's own snippets; belongs to
  whichever task owns app lifecycle.
Task 5: HUMAN RULING (2026-08-10) on the reviewer's plan-mandated finding that
  `X-Library-Host` is unvalidated and any client can be resolved into another org's
  request context. Decision: ACCEPT AS DESIGNED. The header only selects which tenant
  context a request runs in; it grants nothing, because the Task 7 JWT guard rejects
  any token whose org != the host-resolved org. Exposure is limited to unauthenticated
  org-scoped endpoints, which are public-by-design. Same design as Sckools'
  X-Skoolos-Host, which the system-design baseline lists under "what is genuinely
  right". ACTION: the middleware must document this trust boundary explicitly so no
  later reader assumes the header is authenticated.
Task 5: minor (deferred): concurrent cold starts can race on `redis.status === 'wait'`
  and make ioredis throw "already connecting" on the losing calls. Caught by the
  fail-open path; costs only a cache miss under first-load concurrency.
Task 5: fix round 1/5 (2 findings + 2 minors addressed — suspended orgs now blocked on
  the custom-domain path AND the real Prisma select updated to fetch org.status, so it
  is not a fake-only fix; suspended results are never cached; middleware resolution-order
  and requireOrgId specs added with competing sources set simultaneously; Array.isArray
  guard on repeated headers; trailing-dot normalised before endsWith. Three deliberate
  breaks each reproduced the predicted failure. commits f547b71..0696539)
Task 5: fix round 2/5 (1 addressed — trust-boundary doc comment per the human ruling,
  verified comment-only; commit 0696539..5c478ad)
Task 5: complete (commits 7d00141..5c478ad, all findings addressed) — 26/26 tests
Task 5: minor (deferred): the Redis org cache holds {orgId, orgSlug} for 60s without
  re-checking org status, so an org suspended mid-window stays resolvable for up to
  60s on BOTH lookup paths. Bounded by TTL, pre-existing. Fix when suspension becomes
  operationally meaningful (billing enforcement): invalidate libhost:* on status change.
Task 6: complete (commits 5c478ad..114cfe3, review clean — spec ✅, quality Approved)
  TWO REAL DEFECTS FOUND, both only visible against a live pooled database:
  (a) `current_setting('app.current_org', true)` returns '' (EMPTY STRING), not NULL,
      once a pooled connection has previously run SET LOCAL. So ''::uuid raised a cast
      ERROR instead of the policy evaluating false. Fixed in a NEW migration
      20260810120000_rls_null_safe_guc using NULLIF(...,'')::uuid on all 9 policies.
      Reviewer independently reproduced the empty-string behaviour on the live DB and
      confirmed via pg_policies that ALTER POLICY replaced rather than layered the old
      policy — the highest-risk failure mode, since two policies OR together.
  (b) The plan's sabotage command `NO FORCE ROW LEVEL SECURITY` is a NO-OP here.
  Suite: 5/5 ran (not skipped), 3/5 fail under real sabotage, 5/5 skip cleanly with
  no DB env. It has teeth.

CORRECTION TO THE DESIGN SPEC (§4.2) — carry into the final spec update:
  The spec claims FORCE ROW LEVEL SECURITY is what stops the owner bypassing policies
  and implies it is what protects the app role. Verified wrong. FORCE only extends
  enforcement to the TABLE OWNER's own queries. Our tables are owned by `postgres`
  while the app connects as `library_app`, so what actually protects us is
  `relrowsecurity = t` (plain ENABLE) plus library_app being neither owner, nor
  superuser, nor BYPASSRLS. FORCE is still correct defence-in-depth if ownership ever
  changes, but it is not the load-bearing control. Rewrite that paragraph.
Task 6: minor (deferred): Task 3's docs/comments quote the pre-NULLIF policy SQL and
  are now stale.
Task 7: implemented (commit 114cfe3..1a804bf) then fix round 1/5 (commit 1a804bf..6142958).
  Review found 2 Important: (1) user-enumeration TIMING ORACLE — only the
  "exists+active+wrong password" path paid the argon2 cost, so unknown/locked/deactivated
  were distinguishable by response time; ruled a defect fix (it serves the plan's stated
  intent of indistinguishable failures) rather than a plan contradiction, so fixed
  without escalation. (2) the guard's cross-org org-binding — the security property the
  task exists to establish — had NO CI test; it had only been proven via a throwaway
  controller that was deleted before commit.
  Implementer reports both fixed, 41 tests / 8 suites, with a deliberate-break run
  isolating exactly the org-equality check (1 failed, 6 green).
  *** RE-REVIEW OF THIS FIX ROUND DID NOT COMPLETE — the subagent died on an account
  session limit (resets 04:50 Asia/Calcutta). Task 7 is NOT yet closed. Resume by
  re-running the scoped re-review over 1a804bf..6142958 using
  review-1a804bf..6142958.diff (already generated) before marking Task 7 complete. ***
  Two runtime defects were also found and fixed during implementation: tsx does not emit
  design:paramtypes so bare-typed constructor params silently DI'd to undefined in the
  controller/guard/issuer (fixed with explicit @Inject); and jsonwebtoken.sign() rejects
  options.audience when the payload already carries aud.
Task 7: minor (deferred): non-atomic recordFailure increment-then-lock race.
Task 7: minor (deferred): lockout thresholds hardcoded, not env-configurable.
Task 7: minor (deferred): unguarded update surfaces P2025 as a 500 on a deleted-row race.
Task 7: fix round 1/5 re-review COMPLETED on retry (2 addressed, 0 open). Dummy hash
  memoised at module scope; all THREE short-circuit paths (unknown/locked/deactivated)
  now perform the argon2 verify, so the oracle is closed rather than narrowed; the
  guard spec covers all six cases and the deliberate break proved tests 3a/3b exercise
  tenant-PRESENCE, not tenant-equality. commits 1a804bf..6142958
Task 7: complete (commits 114cfe3..6142958, all findings addressed) — 41 tests / 8 suites
Task 8: implemented (commit 6142958..5fda0ea), review Approved with 2 Important.
  Real defect found and fixed in the plan's code: a TOCTOU race where two concurrent
  rotate() calls on one valid token could BOTH mint children — closed with a single
  atomic updateMany({where:{id, revokedAt:null}}), so the DB arbitrates and the loser
  throws before create(). Reviewer confirmed the family revocation is genuinely
  COMMITTED before the 401 (verified live via a second Prisma connection), and that
  the expired path correctly does NOT revoke the family.
  The implementer's `active` check in loadUser was judged a correct security addition,
  NOT scope creep: without it a deactivated account's still-held refresh token keeps
  minting access tokens for the full refresh TTL, because the refresh path bypasses
  login's active gate entirely. Kept.
Task 8: TRACKED FOLLOW-UP (controller decision, do not lose): concurrent refresh causes
  a FALSE-POSITIVE FULL LOGOUT. A client double-tap, duplicate tab sharing storage, or
  mobile auto-retry-on-timeout produces two concurrent rotates; the loser's late read
  sees the token already revoked and triggers family revocation, killing the winner's
  brand-new never-replayed child. Reproduced under 5-way contention. Deferred here
  because the brief's fixed tests encode zero-tolerance revoked-replay by design and
  patching it would break them. REQUIRED before real multi-device/mobile traffic hits
  /auth/refresh. Standard mitigation: a short grace window tolerating the immediately-
  previous token rather than treating it as theft. Add to the Phase 1 plan.
Task 8: minor (deferred): no throttle on POST /auth/refresh.
Task 8: minor (deferred): partial-failure window — markUsed succeeds, then loadUser or
  create fails, leaving that refresh chain dead with re-login the only recovery.
Task 8: fix round 1/5 (1 addressed — real-Postgres regression test for markUsed's atomic
  consume guard, LIVE-gated so laptops skip cleanly, deliberate break of the
  `revokedAt: null` WHERE reproduced the double-consumption symptom; commits
  5fda0ea..7df32a1)
Task 8: complete (commits 6142958..7df32a1, all findings addressed)
  Unit 9 suites/45 tests + e2e 2 suites/6 tests green.
Task 9: complete (commits 7df32a1..6d0c441, review clean — spec ✅, quality Approved,
  zero Critical/Important). 61/61 tests.
  The Infinity-quota serialisation trap was handled correctly AND hardened beyond the
  brief: the cached payload is version-tagged (v:1) and deserialize rejects unparseable
  JSON, non-objects, version mismatch (including a MISSING v, i.e. a pre-versioning
  payload), and non-number/non-null quota fields — all returning null so the request
  falls through to the DB rather than coercing an unlimited quota to 0. Verified live:
  raw cache holds "quotas":{"branches":null,"adminSeats":null} and forOrg returns
  Infinity on both the DB read and the cache hit.
  Reviewer verified against the Prisma schema that overrides CANNOT widen quotas —
  PlanOverride has only key+enabled, no numeric field. Carried into Task 10: branch and
  admin-seat creation guards must check the quota NUMBERS, never the capability flag.
Task 9: minor (deferred): no committed test pins TTL_SECONDS=300 — the spec's set stub
  discards the ttl arg, so a future edit to the TTL would not fail `pnpm test`.
Task 9: minor (deferred): the malformed-cache fall-through is proven at the
  deserializePlan level but not end-to-end through forOrg.
Task 9: minor (deferred): deserializePlan checks capabilities is a string[] but does not
  validate each entry against the CAPABILITIES union.
Task 9: NOTE: invalidate(orgId) is implemented and unit-tested but not yet CALLED
  anywhere — correct for now (no plan/override mutation endpoint exists yet), but it
  MUST be wired when the org console lands, or an upgrade stays invisible for 300s.
Task 10: IN PROGRESS, interrupted twice by API/infrastructure errors (not agent fault).
  Part 1/3 committed: 752d1ad branch-scope guard. Working tree clean at that point.
  Instructed the agent to commit each increment; that has now saved the work twice.
  Remaining when last resumed: part 2/3 (RequireFeature decorator+guard, RolesGuard,
  assertQuota counting INSIDE the caller's tx) and part 3/3 (real-Postgres concurrency
  proof: 2 concurrent branch creations on a FREE 1-branch quota → exactly one succeeds
  in-transaction, both succeed out-of-transaction as the contrast).
  Resume point if interrupted again: check `git log --oneline` for part 2/3 and 3/3
  commits, then continue from the first missing one.
Task 10: implemented across 4 commits (752d1ad, 2db8bad, 5a5a4d9, 83d207e) by two
  agents — the first was killed 3x by infrastructure errors; incremental commits saved
  every increment. Review Approved, 1 Important (lock-ordering doc) in fix round 1.
  *** CORRECTION TO THE PLAN (carry into the spec) ***
  The plan asserted that counting INSIDE the caller's transaction prevents the quota
  TOCTOU. That is NECESSARY BUT NOT SUFFICIENT, proven empirically against real
  Postgres: under READ COMMITTED two transactions that both BEGIN before either
  commits run their SELECT count against the same pre-race snapshot, so both see 0 and
  both pass. Being in a transaction gives atomicity, NOT mutual exclusion. The fix is
  pg_advisory_xact_lock(hashtext(orgId), hashtext(what)) acquired BEFORE the count —
  transaction-scoped, auto-released at COMMIT/ROLLBACK, no leak under pgbouncer reuse.
  Reviewer verified the reasoning is correct, not cargo-culted, and confirmed a
  hashtext collision costs only contention (the WHERE orgId=X still filters correctly).
  Regression test apps/library-api/test/quota-race.e2e.spec.ts uses a real barrier so
  both transactions are provably open before either counts; removing the lock line
  makes it fail with 2 branches created where 1 is allowed.
Task 10: minor (deferred): common/guards/ has no index.ts barrel, deviating from the
  one-public-index convention. Inherited from the brief's own code.
Task 10: minor (deferred): the e2e race test assumes the Prisma pool yields >=2
  connections; it would HANG rather than fail cleanly if connection_limit=1 were pinned
  on LIBRARY_DATABASE_URL_APP — which the deploy config DOES pin. Check before CI runs
  e2e against a pooled URL.
Task 10: fix round 1/5 (1 addressed — lock-ordering discipline documented; verified
  comment-only, zero executable lines changed; commit 83d207e..67ecda2)
Task 10: complete (commits 6d0c441..67ecda2, all findings addressed)
  82 unit / 15 suites + 7 e2e / 3 suites green, typecheck clean.

## Staging credentials (received 2026-08-10)
- Pooler host CONFIRMED: aws-1-ap-south-1.pooler.supabase.com (NOT aws-0 as the old
  staging note said). Use :6543 transaction pooler at runtime, :5432 session for migrations.
- Upstash Redis (its own database, per the bulkhead decision): host
  primary-dogfish-124934.upstash.io:6379, scheme rediss:// (TLS). Verified live: PONG.
- GitHub PAT: works, scoped Actions read/write only. CONFIRMED it CANNOT manage
  environments/secrets (403) — correct least privilege; the user sets secrets in the UI.
- STILL MISSING: the three Postgres role passwords (library_app, library_platform,
  testboard_app). The bootstrap SQL has not been run yet. Staging deploy is blocked on
  this alone; local Docker work is unaffected.
- SECURITY: darshanjainsde/SchoolManager is a PUBLIC repo. Verified no secrets have
  ever been committed (.env never tracked; .env.example holds only localhost
  placeholders). Credentials were pasted in chat — rotate the Upstash token and the
  GitHub PAT after setup.
- DECISION (2026-08-10): stay in the monorepo on feat/library-service rather than
  extracting to a new repo. Isolation is already enforced by a build-failing
  dependency-cruiser rule (stronger than repo convention) and the stated end goal is
  merging into Sckools, which is a routing change from here and a migration from a
  separate repo.

## Staging verified 2026-08-10 (roles + schemas live)
Connected via docker psql to aws-1-ap-south-1.pooler.supabase.com:5432. Confirmed:
  - schemas `library` and `testboard` both exist
  - library_app      bypassrls=FALSE  <- critical: RLS genuinely applies
  - library_platform bypassrls=TRUE
  - testboard_app    bypassrls=FALSE
All three roles authenticate. Password is the SAME weak value for all three and was
pasted in chat — ROTATION SQL owed to the user; library_platform is the one that
matters most (BYPASSRLS = reads every tenant).
STILL BLOCKED for staging migrate: need the Supabase `postgres` superuser password.
The app roles have USAGE but not CREATE on the schema, and the SQL's
ALTER DEFAULT PRIVILEGES FOR ROLE postgres assumes migrations run as postgres.
Local Docker work is unaffected.
Task 11: implemented (67ecda2..05f45b5), fix round 1/5 (05f45b5..0f4d2bf), all addressed.
  *** NOTABLE DEFECT: raw NUL bytes (offsets 2422, 2430) were committed into
  idempotency.interceptor.ts where TS \x00 escapes were intended, making git classify a
  security-relevant source file as BINARY — no diff, no blame, "binary file not shown"
  in every PR view, permanently. `grep -q $'\x00'` does NOT catch it; only a byte-level
  scan (perl -0777) does. Fixed with source-level escapes, runtime string byte-identical
  so stored hashes stay valid. A diff of 0f4d2bf vs its pushed parent still reports
  binary (git flags a pair if EITHER blob has NUL) — resolves itself on squash-merge;
  not force-pushing shared history to fix cosmetics.
  Also fixed: fail-open on Redis was silent (now a Logger.warn naming the consequence
  "rate limiting is DISABLED", suppressed to one per 30s via a single timestamp), and
  the class doc overclaimed — it now states plainly that sequential retries are fully
  idempotent but CONCURRENT duplicates may run the handler twice server-side, so any
  endpoint where double-execution is itself harmful needs a DB uniqueness constraint or
  advisory lock (pointing at assertQuota's precedent).
  @nestjs/throttler bumped 5.1.2 -> 6.5.0: reviewer independently verified from both
  versions' shipped .d.ts that v5's 2-arg increment() cannot satisfy the brief's own
  verbatim 5-arg test, and that forRoot options, @Throttle, and APP_GUARD signatures
  are unchanged. Necessary, not scope creep.
Task 11: complete (commits 67ecda2..0f4d2bf) — 99 unit / 17 suites + 9 e2e / 4 suites.
Task 11: minor (deferred): throttler storage test uses one instance not two sharing a
  fake client, so it shows within-instance accumulation rather than cross-instance.
Task 11: minor (deferred): cold-start connect() race (self-heals via fail-open).
Task 11: minor (deferred): isBlocked does not honour a blockDuration longer than ttl.
Task 12: implemented (0f4d2bf..55bb237, 6 commits), fix round 1/5 (55bb237..fc89c33).
  *** MOST VALUABLE FIND OF THE PHASE: a migration-ordering bug. init_identity was
  timestamped AFTER rls_identity, so `prisma migrate deploy` against a FRESH database
  failed with P3018 — i.e. the FIRST staging/prod deploy would have failed. Every
  existing DB was fine because migrations had been applied interactively in the right
  order, so nothing local would ever have shown it. NOTE: I logged exactly this as a
  "minor (deferred)" in Task 3 ("latent trap for anyone assuming folder order is
  chronological") and deferred it. It was deploy-blocking. Lesson: migration ordering
  is never a cosmetic minor.
  Fixed durably: an idempotent reconcile-init-identity-rename.sql (guarded by
  to_regclass so a fresh DB is a no-op), wired to a package script and referenced from
  preflight's header, verified against old-name / new-name / fresh databases.
  Second Important: CI's gate job SILENTLY SKIPPED the RLS coverage audit —
  rls-audit.spec.ts gates on LIBRARY_DATABASE_URL_PLATFORM and gate had no Postgres,
  so describeLive became describe.skip. A false green on the one test that catches
  "new tenant table, forgot the policy". Fixed by moving @library/db unit tests into
  the e2e job AND closing the class: a shared test-live.ts guard that FAILS (not skips)
  when CI is set without a DB URL. Reviewer verified all four e2e specs inherit it.
Task 12: complete (commits 0f4d2bf..fc89c33, all findings addressed)
  113 unit / 21 suites + 9 e2e / 4 suites; pnpm preflight:library green end to end.
Task 12: minor (deferred): prisma/seed.ts sits outside the depcruise scan path.
Task 12: minor (deferred): seed's hashPassword duplicates PasswordService.hash by hand.
Task 12: minor (deferred): if: always() asymmetry between the two unit-test CI steps.

## FINAL WHOLE-BRANCH REVIEW (opus) + fix wave — PHASE 0a COMPLETE
Verdict: "Ship after fixing 2 items", no Criticals. All five invariants verified HOLDS
against the live database, not just read from code. Reviewer traced every BYPASSRLS
call site as a set and confirmed no code path reaches tenant data without RLS scoping
or an explicit justified orgId filter.
Fix wave (fc89c33..cfcbcdc, 6 commits), all 9 items re-reviewed ADDRESSED:
  A1 CI path filter excluded the very files that DEFINE the isolation guarantee — a PR
     editing .dependency-cruiser.library.cjs (deleting the no-sckools rule) or
     library-db-init.sql (the BYPASSRLS grants) ran NO ci at all.
  A2 Neither gate built the ncc bundle Vercel actually deploys. Task 4 found the bundle
     never built; no regression guard was ever added. Now in preflight AND ci.
  A3 depcruise scanned .../src, so it MISSED apps/library-api/server.ts — the ncc entry
     point, i.e. the file that actually runs in production — and prisma/seed.ts. Proven
     to fire on server.ts by deliberate violation.
  A4/A5 stale RLS comments + the spec's §4.2 claim that FORCE is load-bearing (it is
     not: FORCE only binds the table OWNER; ENABLE + library_app being neither owner,
     superuser nor BYPASSRLS is the real control).
  B1 the RLS audit checked a policy EXISTS, not that it SCOPES — `USING (true)` would
     have passed while leaking every tenant. Now requires the expression to reference
     app.current_org and WITH CHECK to be non-null.
  B2 idempotency requestHash used the route PATTERN (/loans/:id), so /loans/1 and
     /loans/2 with one key hashed identically and the second REPLAYED instead of 409.
  B3 a dropped PEXPIRE left a throttle key with no TTL, blocking that IP forever.
  B4 PlansModule + IDEMPOTENCY_STORE were never wired; first Phase 1 controller to use
     them would have failed at DI.
Final: preflight:library green end to end (lint, typecheck, boundary, build, BUNDLE,
109 unit + 11 db unit, 9 e2e). Verified by the controller directly, not just reported.

## Phase 1a — whole-branch review (2026-08-12, opus)

Verdict: ship after fixing 2. Preflight green end to end (249 unit / 262 e2e /
16 suites, real ncc bundle). All five load-bearing invariants verified LIVE
against pg_policy, not read from the diff: 20 tenant tables forced with both
USING and WITH CHECK and the NULLIF predicate; every client-supplied FK looked
up on `tx`; no scheduler transition; the three concurrency primitives proven
free of any deadlock cycle; every long-lived client owned.

FIXED (controller, hybrid mode):
  The isbn13 P2002 "recovery" in applyChunk was DEAD CODE and its comment was
  false. The reviewer proved against live Postgres that Prisma does not wrap
  statements in savepoints, so the failed INSERT aborts the transaction and the
  recovery's findFirst always returns 25P02. Worse, the trigger was not exotic
  concurrency but A DUPLICATE ISBN INSIDE ONE UPLOADED CSV — resolvePrepass
  builds its existing map once, before any chunk, so the second occurrence took
  the CREATE branch and discarded up to 199 unrelated valid rows, blamed on the
  wrong row. Fixed by deduping in-file in validateRows (keep-last, dropped rows
  reported), and removing the recovery with an honest comment. The unit test
  that "proved" the recovery was asserting a fiction — it passed only because
  the fake tx does not model transaction abort. Replaced.

RULING OWED AND GIVEN (user, 2026-08-12): **fix branch scope before the
console.** Circulation shipped entirely un-branch-scoped, contradicting spec §7
and §5.3 — Loan/Hold carry no branchId, CirculationPolicy is unique on
(orgId, memberType) not (orgId, branchId, memberType), CirculationController
has no BranchScopeGuard, and holds/fines/overdue/day-report all return org-wide
data. An ASSISTANT scoped to branch A can work any branch-B copy. This is PLAN
drift, not execution error: each task matched its own brief, which is exactly
what per-task review cannot catch. Backfillable (Loan.branchId derives from
Copy.branchId). Do it before Phase 1b so the console is built against the real
shape.

NEXT PHASE (triaged): org cache holds suspension 60s · no (orgId,isbn10) partial
unique index · cap-crossing refresh revoke is audit-silent · day report uses UTC
not org timezone (5.5h wrong for IST — needs LibraryOrg.timezone + AT TIME ZONE,
a schema change, before the console renders a "Today" tile) · /overdue soft
500-row cap without pagination.

GENUINELY FINE: PlanResolverService.invalidate() uncalled (no mutation endpoint
exists) · cancelling a READY hold does not re-promote (documented, nobody
blocked) · login/refresh throttling design.

MINORS worth doing with the branch-scope task: authz matrix's route enumeration
passes VACUOUSLY if Express's _router is absent (assert length > 0, same
reasoning rls-audit already applies to itself) · duplicate queuePosition
possible after cancelHold · money crosses the API as both string and number ·
three of four Redis clients lack the trap-8 enableOfflineQueue/connectTimeout
hardening, and org.middleware's runs on EVERY request before auth · returnLoan
overwrites Copy.status so a DAMAGED copy reverts to AVAILABLE · DayReportQueryDto
accepts 2026-13-45 and 500s.
