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

- **Test suites** — api, mobile, db, and web. Pass/fail, suites, tests, duration.
  `web` is deliberately listed with **0 tests**: it has no harness, and hiding
  that would defeat the point.
- **Gates** — lint, typecheck, module boundary, build. Same treatment, so it is
  obvious when a style gate is standing in front of a correctness gate.
- **Where coverage is thin** — files never executed by any test, files under
  60%, and every currently-failing assertion with the head of its error.
- **Live output** — streamed from the child process over SSE.

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
