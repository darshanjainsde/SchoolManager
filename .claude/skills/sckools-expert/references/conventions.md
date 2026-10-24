# Conventions, guards and the way work ships

These are the rules the repository enforces or that cost real defects. `CLAUDE.md` at the repo root is the
standing instruction set; the mistake ledger (`~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes/log.mjs list`) is the counted list of what has bitten before.

## Process

- **Branches.** Feature branches start from `origin/main` (fetch first; never diff against a local `staging`/`main` — and `git fetch` in a worktree whose `remote.origin.fetch` only names `main` leaves `origin/staging` stale: fetch the ref explicitly or use `git ls-remote`). Everything ships to `staging` first (`git push origin HEAD:staging`), is verified on `test.sckools.com`, then reaches `main` through a PR. The user gates every merge to `main`; when they say merge, `gh pr merge --merge` after the production migration (operations.md).
- **Read `gh pr checks` before pushing onto a PR.** A red PR blocks the push until it is green or the failure is proven pre-existing on the base. Any tier/ladder change, new table or new controller needs the FULL `pnpm --filter @skoolos/api test:e2e` (with the repo `.env` sourced), not the suites written for the feature — PR #182 sat red for a day because only the feature's own suites were run.
- **Gate before every push: `pnpm preflight`** (`scripts/preflight.sh`): lint, typecheck, build, unit + guard tests for api, web, mobile, db, library. Green preflight is the only evidence accepted; "the build passed" is not.
- **Migrations.** Staging applies them on push (`db-migrate.yml`); production is a manual dispatch the user runs. Code that reads new tables must degrade until then (`isSchemaMissing`). Never run a migration against production yourself; never seed production.
- **Never `git add -A` from the corrupted local checkout** (`/Users/darshanjain/Documents/SchoolManager/SchoolManager` has iCloud " 2" duplicates). Work in a worktree; stage explicit paths.
- **Every feature: spec → build → QA.** Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`; the behaviour spec skill is the QA oracle.
- Log a mistake the moment a correction lands; repeats are counted.

## API rules

- Module barrel only (`modules/<name>/index.ts`); no imports from another module's `internal/`.
- Import Prisma types from `@skoolos/db`, never `@prisma/client` (the deploy bundle only guarantees the workspace client).
- Every tenant query inside `withTenant`; every list capped with `LIST_CEILING`.
- **Check client-supplied foreign ids against the school explicitly** — FK checks bypass RLS.
- `@Roles` on a handler replaces the class list; `@Public()` routes still need a reason.
- **Four guards every new module must satisfy** (all in `apps/api/test` + `apps/api/src/common`): every mounted route is listed in `AUTHZ_REVIEWED` in `apps/api/test/route-manifest.ts` with the spec that asserts its doors (`route-coverage.e2e-spec.ts`); a table without `schoolId` is added to the chosen-exempt list in `rls-coverage.e2e-spec.ts` with a `platform_only` deny-all policy; every FK column has an index leading with it (`fk-indexes.e2e-spec.ts` — FK checks bypass RLS and scan the child table); no relation `_count: { select }` unless the file is in `RELATION_COUNT_ALLOWED` in `src/common/tenant-aggregates.spec.ts` with a reason (platform tables only).
- **Feature-gate fixtures.** Since Plan Ladder v2 a PRO school has every feature, so "a school without X" is `seedMinimalSchool({ tier: 'STANDARD' })` (`apps/api/test/integration/helpers.ts`), never "PRO without the override".
- New tenant table ⇒ RLS `tenant_iso` policy in the migration (copy the DO block from `packages/db/prisma/migrations/20260706_000000_cms_courses_admissions_hof/migration.sql`).
- Data migrations: never drop the source column in the same migration that derives from it; PostgreSQL `substring(x from pattern)` returns the *first parenthesised group*.
- Notifications post-commit and best-effort; kinds in `apps/api/src/common/notifications/notification.types.ts`.
- Designed conflicts return 409 (`REGISTER_LOCKED`, `TEACHER_CONFLICT`, `LEAVE_NOT_PENDING`, `REGISTER_CHANGE_OPEN`).
- School days are IST calendar days (`apps/api/src/modules/management/internal/timetable-date.ts`); the exam-reminder cron is the one UTC exception.

## Web rules

- Authenticated screens: `const host = useHost(); const api = useApi({ audience: 'school', hostHeader: host });` and `enabled: !!host` on every tenant query. Two repo-wide tests enforce it.
- Admin UI: existing kit (`apps/web/components/ui`), `var(--sk-*)` tokens, no literal brand hex in `apps/web/app/sk-theme.css`.
- Public site: sections announce themselves once (masthead vs band); reveal-on-scroll content must have a geometry fallback (background tabs never fire IntersectionObserver); a `position:fixed` overlay under a transformed ancestor is trapped; a restyle axis that forces `background: var(--paper)` breaks bands that bring their own colour.
- Tests are vitest + Testing Library; a new component test does not typecheck by itself — `pnpm typecheck` too. Don't put decorative glyphs in the same text node as an asserted string.
- **Every new console screen goes through `apps/web/audit` before its first push**: a `<name>.test.tsx` that mounts the REAL component with the longest realistic fixtures (full Indian names, lakh figures, a school name that wraps) and writes `audit/<name>.html` (gitignored); `measure.html?file=./<name>.html` must read CLEAN at 360–1920, AND look at the phone screenshot — the harness cannot see a number broken mid-way. Pattern: `audit/pay.test.tsx`, `audit/referrals.test.tsx`.
- Console lists are `RowList/Row/Cell` from `components/ui/kit.tsx` (the list owns the columns); on a phone they stack, so figure cells need a per-list rule (thirds for three figures, halves for four — never a lone tile). A `.sk-pill` carries one word; the sentence goes beside it as text that can wrap. `sk-responsive.test.ts` rejects a bare pixel minimum in a grid track (use `minmax(min(100%, Npx), …)`).
- Section layout variants: register in `apps/web/components/public/site-variants.ts` (`SECTION_KEYS`, `SECTION_VARIANT_DEFS`, default) — the studio lists them automatically.
- The prototype marketing page's `.std` is the pricing Standard card; new marketing CSS uses its own prefixes.

## Mobile rules

- Header widgets that fetch on focus break screen tests (mock the path; capture the right `useFocusEffect`).
- Jest test-path arguments are regexes: escape route-group parentheses.
- `getByText` matches the whole rendered text of a `<Text>` including nested children.

## Naming and brand

- Internal name `skoolos` (package scopes, headers such as `X-Skoolos-Host`, Vercel projects) vs brand **Sckools** (all copy, logo). Do not mass-rename.
- Brand: Tassel-S logo, indigo `#4F46E5`, amber `#F59E0B`. Every deliverable uses the Sckools name.
