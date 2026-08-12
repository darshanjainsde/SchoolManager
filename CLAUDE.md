# Working in this repo

Standing instructions. These are not suggestions — each one exists because
skipping it already cost real time or shipped a real defect.

## Before touching anything

1. **Read `docs/superpowers/LIBRARY-TRAPS.md`.** 16 checks, each paid for by a
   defect on this service. Re-hitting one is a logged repeat, not a discovery.
2. **Read the mistake ledger.** `node ~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes/log.mjs list`
   — anything marked ⚠️ (2+) is a pattern that has already bitten twice.
3. **Check the branch.** Local checkouts drift behind `main`, and `main` is what
   production runs. `git log --oneline HEAD..origin/main | head`.

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

## Dispatching subagents

Measured over 65 dispatches (15h35m): **reviews are 15% of wall time, dying
dispatches are 52%.** When a build feels slow, that is the ratio to act on.
Full rules in `.claude/skills/long-build-dispatch/SKILL.md`.

- **At most two pieces per dispatch, smallest first.** Dispatches that died
  averaged 44 minutes; ones that shipped averaged 6.
- **Never let an agent wait on the e2e suite.** Say so explicitly in the prompt
  and run the gate yourself afterwards. This single instruction was the highest-
  value change in the whole build.
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
- **`set -a && source .env && set +a`** first. `pnpm --filter` does not load the
  root `.env`.
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
- Commit `.env`, `packages/library-db/generated/`, `apps/library-api/api/`, or
  `apps/api/api/`.
- Import Sckools code from the library, or widen a wildcard that lets Sckools
  reach the library. Isolation is enforced in both directions by
  `.dependency-cruiser.library.cjs` and `apps/api/tsconfig.json`.
- Migrate or seed staging from a task. Staging is live and seeded.
