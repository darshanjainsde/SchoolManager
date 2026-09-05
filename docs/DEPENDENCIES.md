# Dependency versions

## The rule

**After changing branches, run `pnpm install`.**

`node_modules` can only ever match one branch. Branches in this repo pin
different major versions, so a tree installed for one branch is silently wrong
for another — and the failure does not look like a dependency problem.

## What this cost once

A branch cut before the Next 15 upgrade was checked out over a `node_modules`
installed from `main`. Nothing warned; `package.json` said Next 14.2.3 while
`node_modules` held Next 15.5.21 and React 19.

The symptoms all pointed somewhere else:

| Symptom | Real cause |
|---|---|
| 20 `tsc` errors in `SiteNav.tsx`: `RefObject<T \| null>` not assignable to `RefObject<T>` | React 19 changed `useRef`'s type |
| `next build` fails: `params` missing `then`/`catch`/`finally` | Next 15 made route `params` a `Promise` |
| ~15 new `no-html-link-for-pages` lint errors in untouched files | `eslint-config-next@15` enforces more than 14 did |

Every one of those was read as "this code is broken" and nearly fixed as such.
The code was fine. Fixing it would have written Next 15 idioms into a Next 14
branch, and the "fix" would have broken on merge.

**A typecheck or build error in a file you did not touch is a dependency-state
question first.** Check the installed version before changing the code:

```bash
node -e "console.log(require('./apps/web/node_modules/next/package.json').version)"
grep '"next"' apps/web/package.json
```

If those disagree, the tree is stale — reinstall, do not edit.

## Pinned versions

`next`, `react` and `react-dom` are pinned to **exact** versions (no `^`), on
purpose: a framework major arriving through a caret range is exactly the drift
above, only without a branch switch to explain it. Upgrading is a deliberate
commit that moves `package.json`, the lockfile and the code together.

## Installing

```bash
pnpm install                      # day to day, and after every branch switch
pnpm install --frozen-lockfile    # CI, and to prove the lockfile is honest
```

`--frozen-lockfile` fails rather than quietly resolving something new. Use it
when reproducing a CI failure locally.

> `apps/web/vercel.json` installs with `--frozen-lockfile=false` so a deploy is
> not blocked by a lockfile that drifted in a PR. That means the lockfile is the
> intent, not the guarantee — which is the other reason the exact pins above
> matter.
