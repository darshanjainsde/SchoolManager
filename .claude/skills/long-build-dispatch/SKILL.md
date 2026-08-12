---
name: long-build-dispatch
description: Use when running a multi-task build through subagent dispatches (superpowers SDD, batched implementation phases, any loop of dispatch → review → fix). Sizes dispatches so they survive, keeps work when they don't, and records where time actually goes. Derived from 15h35m of measured dispatch data, not intuition.
---

# Long-build dispatch

Rules for running a long, multi-task build through subagents without losing
half the wall clock. Every number below is measured from
`scripts/dispatch-metrics.mjs` over 65 real dispatches — not estimated.

## The finding that should change your behaviour

```
65 dispatches · 15h35m · 8.5M tokens

reviews + re-reviews        15% of wall time
implementation dispatches   70% of wall time

produced NOTHING            20%   ← 4 dispatches, 3h05m
needed manual rescue        32%   ← 7 dispatches, 4h59m
                            ───
lost or rescued             52%
```

**Reviews are not the bottleneck. Dying dispatches are.** Cutting review
would have saved ~15% of wall time and cost every defect it caught. Fixing
dispatch survival recovers up to 52%.

If you feel a build is slow and reach for "fewer tests" or "skip the review,"
you are optimising the wrong 15%. Measure first.

## Sizing rule

Observed: dispatches that died or stalled averaged **44 minutes**; ones that
shipped averaged **6 minutes**. Death is a function of dispatch *lifetime*,
not task difficulty.

- **One or two coherent pieces per dispatch.** Three or more is where the
  data turns bad — a 4-piece batch killed two agents back to back with zero
  commits between them.
- **Order smallest first**, so a commit lands within minutes. The three
  worst tasks (`T7 import`, `Batch C`, `T10 guards`) all began with a large
  piece and burned 1h35m–2h21m across three dispatches each.
- **Never let a dispatch wait on a slow suite.** The single highest-value
  instruction in this whole build was: *do not run the full e2e suite; I run
  the gate myself afterwards.* Agents were burning their entire lifetime
  waiting on a multi-minute suite and dying before writing anything.

## Survival rules for the dispatch prompt

Put these in the prompt itself; they are what separated recovered work from
lost work.

1. **"Commit each increment the moment it is green."** State the count:
   *"N agents on this project have been killed mid-task; every one that
   committed increments kept its work."* Concrete beats polite.
2. **"Do not run <the slow suite>."** Name it. Say you will run it yourself.
3. **"If you run low on room, commit what is green and report."** Gives a
   graceful exit instead of a silent death.
4. **Point at a traps file, don't restate traps inline.** Rediscovery is
   most of what long dispatches spend their time on.

## After every interrupted dispatch — read the tree first

**Do not assume a dead agent produced nothing.** Measured: of 11 deaths,
**7 had real work on disk**, and in one case the *entire* implementation was
written and only the report was missing. Re-dispatching without looking
repeats work that already exists.

```bash
git log --oneline <base>..HEAD     # did it commit?
git status --short                 # is there uncommitted work?
git diff                           # is the tree mid-edit?
```

Then run the gate before trusting any of it. Twice, a dead agent left the
repo in a state that *looked* fine and wasn't:

- a schema field flipped to `Cascade`, mid deliberate-break proof
- a security check commented out behind a `TRAP-16-PROBE` marker

Both were caught by running the suite, neither by reading the diff.

## When to stop delegating

If a task has burned **three dispatches with nothing committed**, do it
yourself. Measured cost of not doing this: `T7 import` took 2h21m across
three deaths, and the implementation had actually been written by the first
one and sat uncommitted through two retries. Reading the file took two
minutes.

The signal is *three dispatches with no commits*, not "this feels hard."

## Recording

Log every dispatch — the `outcome` field is the whole point, because a
dispatch that died after 90 minutes costs exactly what one that shipped a
feature costs, and nothing else distinguishes them.

```bash
node scripts/dispatch-metrics.mjs log --phase 1a --task "Batch B" \
  --kind impl --tokens 232953 --tools 110 --seconds 1675 --outcome shipped
node scripts/dispatch-metrics.mjs report
```

The numbers come straight off each Agent result (`subagent_tokens`,
`tool_uses`, `duration_ms`). Log it immediately — after three more dispatches
you will not remember which one stalled.

outcomes: `shipped` · `shipped-after-fix` · `died-nothing` · `died-partial` · `stalled`

## What NOT to optimise away

The review loop found, in this build alone: a live cross-tenant write, an
RLS audit passing against an empty schema, a health check hanging 11 minutes,
a serverless bundle that never built, a migration that would have failed the
first production deploy, and a quota race that survived being "inside a
transaction." None would have failed a test.

Reviews cost 15%. Keep them.
