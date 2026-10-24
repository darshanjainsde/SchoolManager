# Operations — environments, deploys, migrations, data

Secrets never appear here or in chat. Names of variables: `inventory/env.md`. Workflows: `inventory/workflows.md`.

## Environments and hosts

| | Production (`main`) | Staging (`staging`) |
|---|---|---|
| Marketing | `sckools.com` (www → apex) | `test.sckools.com` (noindex header) |
| Schools | `<slug>.sckools.com` + custom domains | `<slug>.test.sckools.com` |
| API | `api.sckools.com` | `api.test.sckools.com` |
| Owner console | `owner.sckools.com` (served by the `*.sckools.com` wildcard + `NEXT_PUBLIC_PLATFORM_OWNER_HOST`; the apex `sckools.com/owner` → `/platform` works too — decided 2026-10-24 to keep the subdomain for its separate browser origin) | `owner.test.sckools.com` |
| Health | `GET /ready` on the API | same |
| Demo tenants | `raffles` (full PRO sample seeded 2026-07-24; never delete), `riverdale`; sample slugs are excluded from the sitemap (`apps/web/app/sitemap.ts`) | `acme` (STANDARD), `beacon` (PRO), `raffles` — every Raffles login uses the password `password` by design (see `CLAUDE.md`) |

Certificates: Let's Encrypt wildcards via Vercel (`*.sckools.com`, `*.test.sckools.com`). HSTS + CSP set in `apps/web/next.config.mjs`.

## Deploys

- Push to `staging` → Vercel builds `skoolos-web` and `skoolos-api` previews bound to the `test.` domains; `db-migrate.yml` applies new migrations; `demo-data.yml` re-seeds when seed files change.
- **Production order (learned 2026-10-24): migrate FIRST, then merge.** Dispatch `db-migrate.yml` with `environment=production` **from the ref that carries the migration files** (`gh workflow run db-migrate.yml --ref staging -f environment=production`), wait for it, then merge the PR; the merge triggers the production builds. The reverse order 500s every reader of a new column (the API selects whole rows). Migrations must therefore be additive with defaults so the OLD code keeps working between the two steps. `inspect_only=true` answers "what does the DB have?" without credentials. The sandbox's permission classifier refuses the production dispatch from Claude — Darshan runs it (`! gh workflow run …` in the session).
- Merging: `gh pr merge <n> --merge` once the user says so; every PR check (build, api e2e, migrate, both Vercel deploys) must be green first. `ci.yml` = one `build` job (lint → typecheck → module boundary → build → unit tests) + `api e2e` (37 suites / 1,610 tests against a real Postgres, ~4 min). Unit totals on 2026-10-23: api 2,909 · mobile 2,050 · web 231 files · db 33 · types 200.
- `db-drift.yml` runs `prisma migrate status` (read-only) against BOTH databases daily at 06:30 IST and fails loudly when either lags the repo; `db-backup.yml` nightly; `db-restore-drill.yml` proves restores; `outbox-drain.yml` drains the notification outbox every 10 min; `demo-data.yml` re-seeds staging.
- API crons (`apps/api/vercel.json`, `CronSecretGuard`): exam-reminders, notification-outbox, cover-nudge (×2), fee-due-soon, library-due-soon, session-start, school-backups (daily, weekly, snapshots).
- Vercel API access from the API (`VERCEL_*` env) attaches school domains to the web project and registers the www 308.
- Mobile: EAS builds → Google Play (`docs/SHIP-MOBILE.md`); target API bumps via `expo-build-properties`; verify the built APK with `aapt2 badging`.

## Verification habits

- After a staging push: poll the API/web for a marker of the new build, then exercise the endpoint with a real login (Raffles staging), then look at the page. The Chrome extension can hang on heavy school pages — fall back to server-rendered HTML checks (`curl`).
- Load tests live in `scripts/loadtest`; dispatch metrics in `scripts/dispatch-metrics.mjs`.

## Data facts that matter

- Student identifiers: `Student.code == admissionNo == User.username`, format `AAA-00000` (validators are strict; the data conforms, never widen the regex).
- Academic years: `AcademicYear.isCurrent`; the Hall of Fame "current batch" and leave quotas pivot on it.
- Timetables are versioned, registers lock after the day, substitutions are one-day grants (behaviour spec invariants 3, 4, 9).
- Marketing prices live in `MarketingConfig` (six Int columns: basic/std/pro × usd/inr) edited in the owner console `/platform/settings`, read by `GET /marketing/config`.

## When something is wrong

- 401 turning into 429 at request 11 on login = the shared lockout/rate-limit counter working (`docs/RUNBOOK.md`).
- Uploads 500 on staging = `S3_ENDPOINT` pointing at a removed Supabase project (noted in `CLAUDE.md`, 3 Sept 2026; not re-verified since). Production school-logo storage returned 404 in the Oct 2026 site audit — infra, still open.
- A PR red on `api e2e` after a tier change or a new table/controller: the guards (`route-coverage`, `rls-coverage`, `fk-indexes`, `tenant-aggregates`) and the feature-gate fixtures need telling — see conventions.md. On 2026-10-23 that was nine failures nobody had looked at for a day.
- **State on 2026-10-24:** production and staging both run `e8b337a` (PR #182); every migration through `20261023_130000_referral_task_referral_idx` is applied to both; production holds dummy data only (per Darshan), so the plan-ladder protect script was skipped.
- A school site 404 = the school is not `LIVE` (SETUP/SUSPENDED) — admin login still works.
- Hall of Fame / any new table missing after a deploy = production migration not yet run; readers hide instead of failing.
