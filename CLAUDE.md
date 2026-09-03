# Working in this repo

Standing instructions. These are not suggestions — each one exists because
skipping it already cost real time or shipped a real defect.

## The environments (read this before touching data or deploys)

| | Branch | What it is |
|---|---|---|
| **Production** | `main` | Real schools. Migrations are a MANUAL `db-migrate` dispatch (`environment=production`); Darshan runs it. Never seed, never demo-data — the workflow has no production option by design. |
| **Staging** | `staging` | The integration branch and the only environment that gets seeded. Push to `staging` auto-applies migrations AND re-runs `demo-data` when the seed files change. |

**Staging facts** (credentials live in the GitHub `staging` Environment and in
Vercel's Preview env — never in this repo, never in chat):

- Postgres: Supabase project ref `pnczxkyteaocpdoufwyz` (`db.<ref>.supabase.co`).
- Object storage: Supabase Storage on the SAME project. **As of 3 Sept 2026 the
  API's `S3_ENDPOINT` still pointed at an older ref (`uehgshnytylrjdclxxig`)
  that no longer exists — it answers `410 Project removed`, so every upload
  (fee proofs, logos, print-order PDFs) 500s.** Fix is env-only: point
  `S3_ENDPOINT` / keys / `S3_BUCKET` at the live project.
- Hosts: `raffles.test.sckools.com` (demo school), `api.test.sckools.com`,
  `owner.test.sckools.com`.
- **The demo school is `raffles`, and every one of its logins has the password
  `password`** — deliberately, for testing ease. `admin@raffles.test`,
  `teacher1@raffles.test`, … all the same. The demo-data workflow's default
  input sets it, so a push-triggered run keeps it that way.
- Student identifiers there follow ONE standard: `admissionNo` == `code` ==
  `RPS-00001`, allocated in grade → section → roll order by the seed.

**Never paste a credential into a chat, a file, or a commit.** If one arrives
that way, say so and treat it as compromised — the fix is rotation, not
silence.

## Before touching anything

1. **Read `docs/superpowers/LIBRARY-TRAPS.md`.** 16 checks, each paid for by a
   defect on this service. Re-hitting one is a logged repeat, not a discovery.
2. **Read the mistake ledger.** `node ~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes/log.mjs list`
   — anything marked ⚠️ (2+) is a pattern that has already bitten twice.
3. **Check the branch.** Local checkouts drift behind `main`, and `main` is what
   production runs. `git log --oneline HEAD..origin/main | head`.
4. **Touching any user-facing UI? Read
   `.claude/skills/sckools-ui-taste/SKILL.md` FIRST** — before the first class
   is written, not at review. Every rule in it was paid for by a screenshot
   sent back. It applies even when the request says nothing about design,
   because the first feedback on a feature is always visual.

## While working

**Log every mistake, immediately.** The moment the user corrects a wrong
assumption, a review finds a defect you introduced, or work has to be redone:

```bash
cd ~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes
node log.mjs search <keyword>          # ALWAYS first — find the id to bump
node log.mjs log --id <existing-id> --note "what happened this time"
node log.mjs log --id <new-slug> --generic "…" --fact "…" --rule "…" --tags api,db
```

Search before creating. A near-duplicate under a new slug defeats the counting,
which is the entire point.

**Log every subagent dispatch as it completes.** The numbers are on the Agent
result (`subagent_tokens`, `tool_uses`, `duration_ms`):

```bash
pnpm dispatch:log --phase 1a --task "Batch B" --kind impl \
  --tokens 232953 --tools 110 --seconds 1675 --outcome shipped
pnpm dispatch:report      # or pnpm dispatch:ui for the browser view
```

outcomes: `shipped` · `shipped-after-fix` · `died-nothing` · `died-partial` · `stalled`

The `outcome` field is the whole point — a dispatch that dies after 90 minutes
costs what one that ships a feature costs, and nothing else distinguishes them.

## Execution mode — decided 2026-08-12

**Hybrid: the controller implements, subagents review.** Measured over 65+
dispatches: implementation dispatches were 70% of wall time and carried every
death; review dispatches were 15% and caught every defect that mattered — two
live cross-tenant writes, an RLS audit passing against an empty schema, an
11-minute `/ready` hang, a bundle that never built, a migration that would have
failed the first production deploy. None would have failed a test.

So: write the code in-session, and dispatch adversarial reviews. Checkpoint to
the ledger often, since the controller no longer gets fresh eyes per task and
that was the property being traded away.

Full-subagent implementation is still right for work that is large, mechanical,
and well-specified enough to hand over whole. The rules below apply whenever a
dispatch does happen.

## Dispatching subagents

Measured over 65 dispatches (15h35m): **reviews are 15% of wall time, dying
dispatches are 52%.** When a build feels slow, that is the ratio to act on.
Full rules in `.claude/skills/long-build-dispatch/SKILL.md`.

- **At most two pieces per dispatch, smallest first.** Dispatches that died
  averaged 44 minutes; ones that shipped averaged 6.
- **Never let an agent wait on the full `preflight:library`** (it runs lint,
  typecheck, boundary, build and the ncc bundle). Say so explicitly and run it
  yourself afterwards. The e2e suite itself is fine to run — it takes ~17s since
  the handle leak was fixed. It was banned for most of this build because it
  hung forever, which is a bug that no longer exists; keep the ban scoped to
  what is actually slow rather than to what was once broken.
- **Tell it to commit each increment the moment it is green**, and give the
  count of prior deaths — concrete beats polite.
- **Point at the traps file; don't restate traps inline.** Rediscovery is most
  of what long dispatches spend their time on.

**After any interrupted dispatch, read the tree before re-dispatching.** 7 of 11
deaths had real work on disk; one had the *entire* implementation written with
only the report missing, and it sat uncommitted through two retries.

```bash
git log --oneline <base>..HEAD && git status --short && git diff
```

Then run the gate before trusting it — twice a dead agent left the repo looking
fine while a schema field was flipped to `Cascade` or a security check was
commented out behind a probe marker.

**Stop delegating after three dispatches with no commits.** Do it yourself.

## Verifying

- **Run the package script, never the bare tool.** `pnpm --filter X test:e2e`,
  not `jest --config …`. The bare invocation misses env the script provides and
  reports "skipped" rather than failing — a false green.
- **`set -a && source .env && set +a`** before the **e2e suites and DB scripts
  only** — they need real credentials, and `pnpm --filter` does not load the
  root `.env`. NEVER before a build or the unit tests. A sourced `.env` leaks
  into whatever runs next, and the resulting failures name your code rather
  than your shell: three times in one build, twice reported to Darshan as
  pre-existing product breakage. Builds now pin their own `NODE_ENV` and the
  unit fixture overrides rather than defers, so both are immune — but the habit
  is what to fix.
- **Never say "pre-existing" without reproducing it cleanly.** "It fails on an
  earlier commit too" proves your change is innocent; it does NOT prove the
  code is at fault, because a polluted shell, a stale server on the wrong
  database, or a missing fixture fails identically on every commit. Two cheap
  checks first: run it the way CI does with nothing sourced, and read the
  failure for a *precondition* before reading it as a defect. A suite whose
  first line says "requires a separately booted API" is telling you which.
- **Never background a long command through a buffering pipe.** `cmd | grep` in
  the background leaves the output file empty until the pipe closes, destroying
  exactly the progress you piped it through. Redirect raw to a file, grep the file.
- **A guard nobody has watched fail is not evidence.** Prove every new check by
  removing what it guards, watching the failure, restoring it, and reporting both
  runs.
- **`pnpm preflight:library` before any push.** It runs the real `ncc` bundle,
  which is the gate `tsc` does not cover.
- **The e2e suite takes ~17s and exits cleanly.** If it ever appears to hang
  again, that is a defect, not the environment: run
  `pnpm --filter @library/api exec jest --config test/jest-e2e.config.js --detectOpenHandles`
  and find the long-lived client nobody closes. A Nest *value* provider cannot
  carry `onModuleDestroy` — it needs a small class provider whose only job is
  shutdown (see `PlanCacheLifecycle` in `modules/plans/internal/plans.module.ts`,
  which cost roughly half this build's wall clock before it was found).

## Never

- `git add -A` — explicit paths only.
- Commit `.env`, `packages/library-db/generated/`, or `apps/library-api/api/`.
- Commit anything under `apps/api/api/` EXCEPT its `.js` entrypoints. Those six
  files are tracked deliberately: `apps/api/vercel.json` declares
  `functions."api/index.js"`, and Vercel validates that pattern against the
  repo's checked-in files BEFORE the build runs — so untracking `index.js`
  fails every deploy at config validation, with an error that names nothing
  useful. The `.d.ts` and `.map` files beside them are gitignored.
- Import Sckools code from the library, or widen a wildcard that lets Sckools
  reach the library. Isolation is enforced in both directions by
  `.dependency-cruiser.library.cjs` and `apps/api/tsconfig.json`.
- Migrate or seed staging from a task. Staging is live and seeded.
