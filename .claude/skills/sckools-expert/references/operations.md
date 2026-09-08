# Operations — environments, deploys, migrations, data

Secrets never appear here or in chat. Names of variables: `inventory/env.md`. Workflows: `inventory/workflows.md`.

## Environments and hosts

| | Production (`main`) | Staging (`staging`) |
|---|---|---|
| Marketing | `sckools.com` (www → apex) | `test.sckools.com` (noindex header) |
| Schools | `<slug>.sckools.com` + custom domains | `<slug>.test.sckools.com` |
| API | `api.sckools.com` | `api.test.sckools.com` |
| Owner console | `owner.sckools.com` | `owner.test.sckools.com` |
| Health | `GET /ready` on the API | same |
| Demo tenants | `raffles` (full PRO sample seeded 2026-07-24; never delete), `riverdale`; sample slugs are excluded from the sitemap (`apps/web/app/sitemap.ts`) | `acme` (STANDARD), `beacon` (PRO), `raffles` — every Raffles login uses the password `password` by design (see `CLAUDE.md`) |

Certificates: Let's Encrypt wildcards via Vercel (`*.sckools.com`, `*.test.sckools.com`). HSTS + CSP set in `apps/web/next.config.mjs`.

## Deploys

- Push to `staging` → Vercel builds `skoolos-web` and `skoolos-api` previews bound to the `test.` domains; `db-migrate.yml` applies new migrations; `demo-data.yml` re-seeds when seed files change.
- Merge to `main` → production builds. **Then** the user dispatches `db-migrate.yml` with `environment=production` (and `inspect_only=true` to answer "what does the DB have?" without credentials).
- `db-drift.yml` (scheduled) reports schema drift; `db-backup.yml` nightly; `db-restore-drill.yml` proves restores; `outbox-drain.yml` drains the notification outbox on a schedule.
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
- Uploads 500 on staging = `S3_ENDPOINT` pointing at a removed Supabase project (noted in `CLAUDE.md`, 3 Sept 2026).
- A school site 404 = the school is not `LIVE` (SETUP/SUSPENDED) — admin login still works.
- Hall of Fame / any new table missing after a deploy = production migration not yet run; readers hide instead of failing.
