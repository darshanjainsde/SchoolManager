# Test dashboard

A localhost-only control room for this repo's checks: every gate and every test
suite side by side, with its own result, run button and coverage.

```bash
pnpm dash          # → http://127.0.0.1:4000
```

## Why it exists

CI runs five steps in order and stops at the first failure. For 87 consecutive
runs the third step (module boundary) failed, so **build and tests never
executed** — the pipeline looked busy while proving nothing. A single red X on
GitHub hid that. A board where each check reports its own state does not.

## What it shows

### Suites tab

- **Test suites** — api, mobile, db, and web. Pass/fail, suites, tests, duration.
- **Gates** — lint, typecheck, module boundary, build. Same treatment, so it is
  obvious when a style gate is standing in front of a correctness gate.
- **Where coverage is thin** — files never executed by any test, files under
  60%, and every currently-failing assertion with the head of its error.
- **Live output** — streamed from the child process over SSE.

> The flags in `JOBS` **must mirror each package's own `test` script**. They
> did not, once: `apps/mobile` pins `--maxWorkers=2`, bare `jest` took seven
> workers, and one async test starved past its timeout — so the board reported
> a regression that `pnpm test` did not have. A dashboard whose verdict
> disagrees with the gate is worse than no dashboard.

### Every test tab

Every test in the repo — currently ~1,440 across ~170 files — grouped
**portal → feature → file → test**, with a drill-down panel per test.

Built by **reading the test files**, not by running them, so the catalogue is
complete even when a gate is red and nothing has executed. For each test it
shows where it lives, what it checks (the matchers it uses), and **why it
exists** — taken from the comment the author wrote above the test, above its
`describe`, or at the assertion it belongs to.

Nothing is generated. A test with no comment anywhere is listed as
*unexplained* rather than given a plausible-sounding description this tool
made up; filter on `Unexplained only` to find them. About a quarter of the
suite currently carries an explanation.

Each test has a **Run this test on its own** button, and the panel prints the
exact command so the same run is reproducible in a terminal.

Verdicts (green/red/grey squares) come from the last suite run. Grey means
*never run* — deliberately not green, because "no result" is not "passing".

### Live environments tab

**The suite that actually runs against staging.** The 1,440 tests above mock
the network — `api.request` is a stub, no HTTP leaves the machine — so
pointing them at staging would change nothing while appearing to prove
something. These are real requests to the deployed environment:

- is it up, and is the database behind it up
- does a hostname still resolve to the **right** school
- is an **unknown** hostname refused rather than served a default (the
  dangerous version of a tenancy bug is not "not found", it is falling back to
  someone else's school)
- is the commit answering traffic the one you think you shipped
- the Phase 5 endpoints, signed in

Signed-in checks need an account:

```bash
DASH_LIVE_IDENTIFIER='someone@school.edu' DASH_LIVE_PASSWORD='…' pnpm dash
```

Without them those checks report **skipped**, never *passed* — a suite that
went green because half of it never ran is the exact failure this tool exists
to make visible. Checks also skip with a reason when the configured account
has the wrong role for the endpoint (`/me/*` is the family's view, `/manage/*`
is staff), rather than reporting a confusing 403.

## Branches & deploys tab

- **Sync state** — whether `main` and `staging` have diverged, and by how much.
- **Environments** — live probes of the site, the API's `/ready`, and a real
  school site, for production and staging. Plus the commit each is *running*
  (from `/api/version`), compared against the branch head, so you can see when
  something is pushed but not deployed.
- **Waiting to ship** — commits on staging that production does not have.
- **Other branches** — ahead/behind main, last activity. Useful for spotting
  work that was never merged and branches that can be deleted.
- **Rollback** — pick a branch and a tag, and it prepares a commit that restores
  that known-good tree. Pushing requires typing the target SHA, because pushing
  to `main` redeploys production.

The rollback is built with `git commit-tree` plumbing: it never checks out a
branch, so it cannot disturb your working tree, and the result is a normal
forward commit — history is preserved and the rollback can itself be rolled
back.

## Coverage is opt-in

The header has a `measure coverage` toggle, off by default. Instrumentation
makes runs several times slower — with it on, three mobile suites blow past
their timeouts and a green suite reports red. A default run mirrors what CI
actually does; tick the box when you want the coverage picture.

## Notes

- Binds to `127.0.0.1` only. It executes repo scripts — never expose it.
- Zero dependencies, so it keeps working when `node_modules` is in whatever
  state the thing you are debugging left it.
- Results are cached in `tools/test-dashboard/.cache/` (gitignored) so the board
  is populated when you open it.
- Port: `DASH_PORT=4100 pnpm dash`.
