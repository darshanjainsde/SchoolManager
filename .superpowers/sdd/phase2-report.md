# Phase 2 — Version bump (Next 14→15 / React 18→19)

Branch: `feat/web-next15`. Base commit before this phase: `d629c8c` (Phase 1: async request-API
forward-compat). This phase performs the actual dependency bump plus fallout fixes.

## Final installed versions (`apps/web/package.json` + resolved by `pnpm-lock.yaml`)

| dep | old | new (declared) | resolved |
|---|---|---|---|
| next | 14.2.3 | 15.5.21 | 15.5.21 |
| react | 18.3.1 | 19.2.8 | 19.2.8 |
| react-dom | 18.3.1 | 19.2.8 | 19.2.8 |
| eslint-config-next | 14.2.3 | 15.5.21 | 15.5.21 |
| @types/react (dev) | ^18.3.2 | ^19.2.17 | 19.2.17 |
| @types/react-dom (dev) | ^18.3.0 | ^19.2.3 | 19.2.3 |
| lucide-react | ^0.395.0 | ^1.26.0 | 1.26.0 (latest; peer now includes `^19.0.0`) |
| sonner | ^1.5.0 | ^2.0.7 | 2.0.7 (latest; peer `^18 \|\| ^19 \|\| ^19.0.0-rc`) |
| zustand | ^4.5.2 | ^5.0.14 | 5.0.14 |
| @tanstack/react-query | ^5.40.0 (unchanged) | ^5.40.0 | 5.101.1 |
| react-hook-form | ^7.51.5 (unchanged) | ^7.51.5 | 7.80.0 |
| @hookform/resolvers | ^3.4.2 (unchanged) | ^3.4.2 | 3.10.0 |

`next`/`eslint-config-next` were deliberately pinned to the latest **stable 15.x** release
(`15.5.21`), not the registry's overall `latest` dist-tag — at the time of this upgrade the
`latest` tag on npm already points to a 16.x release; the instructions were explicit about
targeting Next 15, so 15.5.21 (confirmed via `npm view next versions`, filtered to stable
`15.x.y` semver, no prerelease suffix) is correct and intentional, not an oversight.

## Peer-dependency verification

Ran `pnpm install` at the repo root after the bump. **Zero unmet-peer warnings** — no
`ERR_PNPM_PEER_DEP_ISSUES`, nothing in a `grep -i peer` of the install output. `lucide-react`
and `sonner` (previously flagged by the audit as lacking a React 19 peer at their old versions)
were bumped to `latest` per instructions and now declare `^19.0.0` peers cleanly.

Per instructions, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers` were left
with their existing carets and NOT bumped — `pnpm list --filter web` confirms they resolved to
`5.101.1` / `7.80.0` / `3.10.0` respectively, all well above the audit's React-19 cutover
thresholds (`≥5.60`, `≥7.54`, `≥3.9.1`), and install was clean, so no bump was needed.

`zustand` v5: the 3 store files (`lib/wizard-store.ts`, `lib/use-api.ts`, `lib/auth-store.ts`)
already used the modern named `create<T>()(...)` / `create<T>((set) => ...)` curried-generic
pattern (not the removed default export or deprecated overloads), so no code changes were
needed there — confirmed by `tsc --noEmit` passing clean.

## Blog `[slug]` params type (finishing Phase 1's TODO)

`apps/web/app/blog/[slug]/page.tsx`:
```diff
-// TODO(next15): params type → Promise<{ slug: string }>
-interface Props { params: { slug: string } }
+interface Props { params: Promise<{ slug: string }> }
```
The `await params` destructuring was already in place from Phase 1, so this was a type-only
change. Verified `searchParams` prop usage is genuinely absent from the app (`grep -rn
"searchParams" app --include="*.tsx" --include="*.ts"` returns nothing except client-side
`useSearchParams()` hook calls, which are a different, unaffected API) — the audit's claim held.

## React 19 fallout: `useRef(null)` / `RefObject<T>` typing (2 files, 3 signatures)

React 19's `@types/react` changed `useRef<T>(null)` to return `RefObject<T | null>` (previously,
with the old overload resolution, `useRef<HTMLDivElement>(null)` produced a `RefObject<T>`
narrowed as non-null once assigned). Three helper-function parameter types across the codebase
declared the narrower `RefObject<T>` (no `| null`) and broke once the actual `useRef` call sites
(all of which pass an explicit `null` initial value, confirmed clean by the pre-bump audit)
started returning the wider type. `tsc --noEmit` caught these, `next build`'s eslint/type pass
did not add anything new beyond that.

Fix: widened the 3 parameter/prop type declarations to match the real `useRef(null)` return
type — a type-only change, zero behavior change (the underlying DOM ref objects and their
`.current` access are identical at runtime):

- `apps/web/components/marketing/MarketingSite.tsx:78` — `useMarketingMotion(root:
  React.RefObject<HTMLDivElement>)` → `React.RefObject<HTMLDivElement | null>`.
- `apps/web/components/public/sections/SiteNav.tsx:208` — `HamburgerButton`'s `buttonRef` prop
  type `React.RefObject<HTMLButtonElement>` → `React.RefObject<HTMLButtonElement | null>`.
- `apps/web/components/public/sections/SiteNav.tsx:267` — `MobileMenu`'s `panelRef` prop type
  `React.RefObject<HTMLDivElement>` → `React.RefObject<HTMLDivElement | null>`.

No other React-19-breaking patterns surfaced — consistent with the audit's "~0 breaking usages"
prediction. `PricingCards.tsx`'s one callback-ref (flagged by the audit as the single riskiest
spot) compiled without any change, as predicted.

## Next 15 fallout: `no-html-link-for-pages` newly enforced for the App Router (8 files, 20 sites)

Not predicted by either audit (out of scope — it's an eslint-plugin behavior change, not a
React/Next runtime API change), but surfaced by `next build`'s lint step and turned a warning
into a hard `Failed to compile.` build error.

Root cause (verified by diffing the installed `@next/eslint-plugin-next` rule implementation
between 14.2.3 and 15.5.21): the `no-html-link-for-pages` rule's internal route resolver used to
only scan a Pages-Router `pages/` directory (`getUrlFromPagesDirectories`) — this repo is 100%
App Router with no `pages/` dir, so the rule was structurally a no-op here under Next 14. Next 15
added `getUrlFromAppDirectory`, so the rule now also matches literal `<a href="...">` targets
against real `app/` routes and flags them as errors under the `core-web-vitals` config this repo
already extends (`.eslintrc.json` → `"extends": "next/core-web-vitals"`, unchanged) — that config
has always escalated this specific rule from `warn` to `error` (confirmed identical in both
plugin versions); only the App-Router-awareness is new in 15.

The flagged sites were all literal same-origin, same-Next-app internal navigation — no
cross-tenant/cross-host hrefs among them (verified `schoolHref()`/cross-host redirect helpers are
not involved in any of these components; the platform marketing nav, the platform/tenant blog
topbar, and the tenant public-site nav are all navigating within the single running Next app on
its current host). Fix: converted each to `next/link`'s `<Link>`, preserving `href`,
`className`, `style`, and children exactly — this is the officially recommended fix for the rule
and is a strict behavioral improvement (client-side navigation/prefetch) with no risk, since nothing
in this app relies on a full-page reload for these particular links. Added `import Link from
'next/link';` to each file that lacked it.

Only the specific errored `<a>` tags were converted — visually-adjacent `<a href="/pricing">`,
`<a href="/gallery">`, `<a href="/academics">`, hash-only anchors like `href="#events"`, etc. were
**not** flagged by the linter (its literal-href/appDirUrls matching has some quirks not fully
diagnosed — e.g. `/pricing` was never flagged anywhere despite `app/pricing/page.tsx` existing)
and were deliberately left untouched to keep the diff minimal and scoped to what the gate
actually required.

| # | File:Line(s) | href(s) converted |
|---|---|---|
| 1 | `app/blog/[slug]/page.tsx:185,187` | `/`, `/blog` |
| 2 | `app/blog/page.tsx:69,71` | `/`, `/blog` |
| 3 | `app/school-website-builder/page.tsx:78,80,96,186` | `/`, `/blog`, `/#feats`, `/` |
| 4 | `components/blog/PlatformBlogNav.tsx:14,15` | `/`, `/blog` |
| 5 | `components/marketing/MarketingSite.tsx:271` | `/blog` |
| 6 | `components/marketing/PricingCards.tsx:51-55` | `/`, `/#feats`, `/#events`, `/#switch`, `/blog` |
| 7 | `components/public/PublicSite.tsx:452,671` | `/`, `/blog` |
| 8 | `components/public/sections/SiteNav.tsx:133,485` | `/blog` (×2) |

## Other observations (no action taken)

- A pre-existing, unrelated jsx-ast-utils warning (`The prop value with an expression type of
  TSNonNullExpression could not be resolved...`) prints during every build/lint run, sourced from
  `components/public/sections/ContactSection.tsx:86` (`href={s.href!}`). It printed identically
  before and after this phase's changes — not new, does not fail the build, left untouched.
- `apps/web/next-env.d.ts` was auto-regenerated by `next build` (adds `/// <reference
  path="./.next/types/routes.d.ts" />` and updates the docs-link comment) — standard Next 15
  codegen, committed alongside the version bump.
- `packages/db`'s postinstall printed a Prisma 5→7 major-update notice; out of scope for this
  worktree/phase (no React/Next coupling), not actioned.

## Gate output

- **`pnpm install`** (root): clean. `Lockfile is up to date` on the verification re-run;
  0 peer-dependency warnings/errors in either run.
- **`pnpm --filter web exec tsc --noEmit`**: 0 errors (empty output) after the 3 `RefObject`
  fixes above.
- **`pnpm --filter web run build`**: succeeds. `✓ Compiled successfully`, `✓ Generating static
  pages (64/64)` — same page count as Phase 1's pre-bump baseline. Dynamic (`ƒ`) routes unchanged:
  `/`, `/academics`, `/admissions`, `/blog`, `/blog/[slug]`, `/connect`, `/contact`, `/gallery`,
  `/pricing`, `/school-website-builder`, `/platform/schools/[id]`, `/sitemap.xml`. Only
  pre-existing warnings remain (unused vars in `app/app/website/hof-tab.tsx` and
  `components/public/PublicSite.tsx`, `<img>` vs `next/image` in 5 files, one
  `react-hooks/exhaustive-deps` in `app/app/blog/editor-tab.tsx`) — identical set to what Phase 1
  documented as pre-existing; nothing new.
- **`pnpm --filter web run lint`**: passes, same pre-existing warning set restricted to `--dir
  app` scope (hook-deps + `<img>` warnings only, `components/` isn't in this script's scan path).
  Prints Next 15's "`next lint` is deprecated, will be removed in Next.js 16" notice — informational,
  not an error, not actioned (out of scope for this phase).
- **`pnpm --filter @skoolos/worker typecheck`**: 0 errors (empty output).
- **`pnpm --filter api exec tsc --noEmit -p .`**: 0 errors (empty output).

## Files touched

- `apps/web/package.json` (version bumps)
- `pnpm-lock.yaml`
- `apps/web/next-env.d.ts` (auto-regenerated by `next build`)
- `apps/web/app/blog/[slug]/page.tsx` (params type + 2 `<a>`→`<Link>`)
- `apps/web/app/blog/page.tsx` (2 `<a>`→`<Link>`)
- `apps/web/app/school-website-builder/page.tsx` (4 `<a>`→`<Link>`)
- `apps/web/components/blog/PlatformBlogNav.tsx` (2 `<a>`→`<Link>`)
- `apps/web/components/marketing/MarketingSite.tsx` (1 `<a>`→`<Link>`, 1 `RefObject` type widen)
- `apps/web/components/marketing/PricingCards.tsx` (5 `<a>`→`<Link>`)
- `apps/web/components/public/PublicSite.tsx` (2 `<a>`→`<Link>`)
- `apps/web/components/public/sections/SiteNav.tsx` (2 `<a>`→`<Link>`, 2 `RefObject` type widens)
