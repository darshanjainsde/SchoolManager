# Conventions, guards and the way work ships

These are the rules the repository enforces or that cost real defects. `CLAUDE.md` at the repo root is the
standing instruction set; the mistake ledger (`~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes/log.mjs list`) is the counted list of what has bitten before.

## Process

- **Branches.** Feature branches start from `origin/main` (fetch first; never diff against a local `staging`/`main`). Everything ships to `staging` first (`git push origin HEAD:staging`), is verified on `test.sckools.com`, then reaches `main` through a PR from `staging`. The user gates every merge to `main`.
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
- Section layout variants: register in `apps/web/components/public/site-variants.ts` (`SECTION_KEYS`, `SECTION_VARIANT_DEFS`, default) — the studio lists them automatically.
- The prototype marketing page's `.std` is the pricing Standard card; new marketing CSS uses its own prefixes.

## Mobile rules

- Header widgets that fetch on focus break screen tests (mock the path; capture the right `useFocusEffect`).
- Jest test-path arguments are regexes: escape route-group parentheses.
- `getByText` matches the whole rendered text of a `<Text>` including nested children.

## Naming and brand

- Internal name `skoolos` (package scopes, headers such as `X-Skoolos-Host`, Vercel projects) vs brand **Sckools** (all copy, logo). Do not mass-rename.
- Brand: Tassel-S logo, indigo `#4F46E5`, amber `#F59E0B`. Every deliverable uses the Sckools name.
