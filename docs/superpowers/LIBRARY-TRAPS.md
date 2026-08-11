# Library service — known traps

**Every implementer and reviewer on this service reads this file first.** Each entry
cost a real defect and a fix round. They are counted in the project mistake ledger
(`~/.claude/projects/.../mistakes`); re-hitting one is a logged repeat.

Do not treat this as background reading. Each line is a check you owe.

---

## Database

**1. `current_setting(x, true)` returns `''`, not NULL, on a pooled connection.**
Once a connection has served one `SET LOCAL` request, a later *unscoped* query reads
back an empty string, and `''::uuid` raises a cast error instead of the comparison
quietly failing closed. **Every** policy predicate must be
`NULLIF(current_setting('app.current_org', true), '')::uuid`. Test fail-closed on a
connection that has *already* served a scoped request, not a fresh one.

**2. `FORCE ROW LEVEL SECURITY` only binds the table OWNER.** It is not what protects
the app. `library_app` is bound by plain `ENABLE` plus being neither owner, superuser,
nor `BYPASSRLS`. When you claim RLS protects a path, say which of those facts is
load-bearing. To sabotage-test, use `DISABLE ROW LEVEL SECURITY` — `NO FORCE` is a
no-op against a non-owner and will make a broken test look like it passed.

**3. A transaction gives atomicity, not mutual exclusion.** Under READ COMMITTED two
transactions that both `BEGIN` before either commits read the same snapshot, so a
check-then-write inside one transaction still races. Take a
`pg_advisory_xact_lock(hashtext(a), hashtext(b))` **before** the read, or enforce it
with a partial unique index. Multiple `assertQuota` calls in one transaction must
acquire in a canonical order or they deadlock.

**4. Migration folder names are the APPLY ORDER, not documentation.** A migration
timestamped before one it depends on passes on every database that already applied
them interactively, and fails only on the **first fresh deploy** — i.e. in production,
never locally. After adding any migration, run `migrate deploy` against a genuinely
empty database.

**5. The RLS coverage audit requires the policy expression to reference
`app.current_org` literally.** A policy that scopes indirectly (an `EXISTS` against a
parent table) is correct but will be flagged — allow-list it *with* a test proving
cross-org invisibility, never silently.

---

## Runtime

**6. `tsx` does not reliably emit `design:paramtypes`.** A bare-typed Nest constructor
parameter can silently resolve to `undefined` — in a guard that means failing *open*.
Use explicit `@Inject()` everywhere.

**7. Vercel Hobby permits daily crons only, and a sub-daily schedule rejects the whole
deployment.** No state transition may depend on a scheduler. `OVERDUE`, `EXPIRING`,
`EXPIRED` are computed at read time from date columns and must not exist as enum
values. A GC sweep of expired data is fine — that is cleanup, not a state transition.

**8. ioredis `status` becomes `'reconnecting'` after a live drop**, not `'wait'` or
`'end'`, so a reconnect guard on those two never re-fires and the offline queue blocks
`ping()` behind an infinite retry loop. `/ready` hung ~11 minutes this way. Keep
`enableOfflineQueue: false` and a `connectTimeout`.

---

## Gates and tooling

**9. A gate covers less than you assume — this is the most-repeated mistake on this
project (3×).** Check three things every time you touch CI or preflight:
- Does the `paths:` filter include the files that *define* the guarantee? Deleting the
  no-Sckools-imports rule or the DB bootstrap SQL must not be able to run zero CI.
- Does the gate build the artifact that actually **deploys**? `tsc` is not `ncc build`.
  The bundle failed to build once while every test was green.
- Does dependency-cruiser's scan path include `server.ts`? It is the ncc entry point —
  the file that actually runs in production — and lives outside `src/`.

**10. A live test that skips on a missing env var is a false green in CI.** Guard live
suites so they **throw** when `process.env.CI` is set without the connection. Import
the shared guard rather than re-deriving the flag; two different `LIVE` definitions
already exist in this repo.

**11. Never write a control character as a literal byte.** Raw `0x00` in a source file
makes git classify it as binary — "binary file not shown" in every diff and blame,
permanently. `grep` does not find it; only a byte scan does. A `-\t-` in
`git diff --numstat` on a text file is a defect, not a display quirk.

**12. `pnpm --filter <pkg> exec …` does not load the root `.env`.** pnpm sets cwd to
the package directory and the Prisma CLI does not walk up. Use
`set -a && source .env && set +a`, or pass env explicitly in CI.

**13. The e2e suite needs ≥2 simultaneous database connections** (the quota and refresh
race tests use a barrier). A URL pinned to `connection_limit=1` makes them **hang**
rather than fail. Production pins that limit deliberately; CI must not.

---

## Judgement

**14. Before proposing a fix to a security or concurrency defect, name the new failure
mode it creates.** Write one line: what capability does this grant an attacker, and
what quantity does it make unbounded? If either is non-empty, bound it *in the same
change*. Two consecutive fix rounds were lost to this: storing a raw token to make
retries idempotent turned a hash-only table into a store of live secrets; minting a
fresh token per retry then made minting unbounded.

**15. Verification code written from memory is the single most-repeated mistake in this
project's history (10×).** Do not write a probe, a live check, or a test stub from
recollection of an API's shape — open the declared contract. A check that fails against
a healthy system, or passes while asserting the wrong thing, costs more than no check.

**16. A test nobody has watched fail is not evidence.** Every guard added here is
proven by removing the thing it guards, observing the failure, and restoring it. Report
both runs.
