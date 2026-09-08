# Architecture — how Sckools is built

Read with `inventory/packages.md` (versions), `inventory/api-routes.md`, `inventory/data-model.md`. The
older narrative in `docs/ARCHITECTURE.md` explains the *why* of the modular monolith and RLS; this file is
the *what is actually there* as of the stamp in `inventory/STATE.json`.

## 1. Monorepo

pnpm + turbo workspace (`pnpm-workspace.yaml`: `apps/*`, `packages/*`).

| Package | Path | What it is |
|---|---|---|
| `@skoolos/api` | `apps/api` | NestJS REST API — one deployable, one Vercel project (`skoolos-api`, region `bom1`). Modules under `apps/api/src/modules/<name>/` with an `index.ts` public barrel and `internal/` implementation; siblings may only import the barrel (dependency-cruiser in CI). |
| `@skoolos/web` | `apps/web` | Next.js 15 App Router / React 19 (`apps/web/package.json`). Serves the marketing site, every school's public site, the admin console `/app`, teacher `/teacher`, student `/portal`, the owner console `/platform`, the gatehouse `/login`, blog, jobs, library. One Vercel project (`skoolos-web`). |
| `@skoolos/mobile` | `apps/mobile` | Expo (expo-router) app "Sckools" (`com.sckools.app`): family tabs for the STUDENT login and staff tabs for admin/teacher/staff. Same API. |
| `@skoolos/worker` | `apps/worker` | Node worker (BullMQ shape) — provisioning/PDF style jobs; today most async work runs as API cron routes (`/internal/cron/*`) and GitHub scheduled workflows (`outbox-drain.yml`). |
| `@skoolos/db` | `packages/db` | Prisma schema, migrations, `withTenant()`, feature/tier tables, RLS role setup. Shared by api + worker. |
| `@skoolos/types` | `packages/types` | Shared DTO/enum/domain types (e.g. `Profile`, `TimetableSlot`, `CERT_VARIANTS`). |
| `@skoolos/config` | `packages/config` | zod-validated env loader (`packages/config/src/index.ts`) — the list of variables is in `inventory/env.md`. |
| `@library/*` | `apps/library-api`, `apps/library-web`, `packages/library-core`, `packages/library-db` | The **school library microservice** — its own DB + Redis, live on `library.trackyour.in`; `@library/core` is the seam the Sckools counter (`/app/library`) uses. Spec: `docs/superpowers/specs/2026-08-13-school-library-design.md` (the 2026-08-08 one is superseded). Separate CI (`library-ci.yml`) and deploy doc `DEPLOY-LIBRARY.md`. |

## 2. Request path (what happens to one HTTP call)

1. **Host decides the context.** `apps/api/src/modules/tenancy` resolves `X-Skoolos-Host` → `req.hostname` → `Host` into `tenant` (`<slug>.sckools.com` or a verified custom domain), `platform` (`sckools.com`, `owner.sckools.com`) or unknown. The web app sends `X-Skoolos-Host` from `lib/use-api.ts` (`hostHeader`) — every admin query must wait for `useHost()` (`app/app/host-guard.test.ts`, `app/tenant-host.test.ts`).
2. **Guards** (`apps/api/src/common/auth`): `SchoolJwtGuard` (aud `school`, token schoolId must equal the host's), `RolesGuard` (`@Roles` on a handler *replaces* the class list), `RequireFeatureGuard` (`@RequireFeature('KEY')`), `PlatformJwtGuard`/`OwnerHostGuard` for the owner console, `CronSecretGuard` for `/internal/cron/*`. Full table: behaviour spec `references/platform-and-tenancy.md`.
3. **Tenant transaction.** Services call `withTenant(schoolId, tx => …)` (`packages/db/src/index.ts`): a Postgres transaction with `set_config('app.current_tenant', …)` so RLS policies (`tenant_iso`) refuse cross-tenant rows. Not every table has RLS — `inventory/data-model.md` marks the tenant tables without it (their `schoolId` filters are load-bearing).
4. **Response** — DTOs validated with class-validator; errors are `ApiError` codes (`VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`). `LIST_CEILING` (`apps/api/src/common/lists/list-ceiling.ts`) caps every list query (STRUCTURE 500, ACTIVITY 2,000, ROSTER 20,000).
5. **Side effects after commit.** Notifications (`apps/api/src/common/notifications`) are best-effort and post-commit; public-site writes purge the school's cached pages (`SitePurgeInterceptor` in `apps/api/src/modules/cms/internal/site-purge.interceptor.ts`) and can trigger web revalidation (`WEB_REVALIDATE_URL`).

## 3. Identity

- Five roles: `OWNER` (platform, no schoolId), `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`, `STAFF`. **There is no PARENT role** — one STUDENT login is shared by student and guardian; keep copy role-neutral.
- JWT access 15 min + refresh 30 days, Argon2id passwords, lockout 5 attempts / 15 min, audiences `school` vs `platform` are non-interchangeable. Owner may impersonate a school admin (15-min single-use host-bound token; `/login?imp=`).
- App entry gate (mobile + web `/login`): no school code; `/auth/resolve-school` finds the host from an identifier (`apps/api/src/modules/auth/internal/auth.controller.ts`).
- Login page is the school-branded "gatehouse" (`apps/web/app/login/GatehouseLogin.tsx`).

## 4. Data

- PostgreSQL (Supabase in prod/staging; Neon/Railway/Render configs remain in the repo for history), Prisma (`packages/db/prisma/schema.prisma`), hand-written SQL migrations (`packages/db/prisma/migrations`), RLS with roles `skoolos_app` / `skoolos_platform` in prod (staging runs as `postgres`).
- Redis: feature resolution cache (300s), rate limits, lockouts, public-site cache.
- Storage: S3-compatible (Supabase Storage on the same project; MinIO locally) via `apps/api/src/common/storage`.
- Prisma client is generated per workspace; deploys land **before** the production migration is run by hand, so any reader of brand-new tables must tolerate `P2021/P2022` (`isSchemaMissing` in `apps/api/src/common/errors/prisma-errors.ts`) — see the Hall of Fame reader for the pattern.

## 5. Web app shape

- `apps/web/app/page.tsx` branches on host: platform host → marketing site; tenant host → `PublicSite` (`apps/web/components/public/PublicSite.tsx`) or 404 unless the school is `LIVE`.
- Public site rendering: sections in `apps/web/components/public/sections/`, styling in `apps/web/components/public/ps-css.ts` (a CSS string; no backticks in its comments), studio option registries in `apps/web/components/public/site-variants.ts` (section layouts, gestures, festivals, footer, custom sections, band order) and `apps/web/app/app/website/studio-catalogues.ts`.
- Marketing site on `sckools.com` is currently served as **generated static pages** (`apps/web/public/site-preview/*.html`) through host-gated rewrites in `apps/web/next.config.mjs` (see business.md) — the React marketing components (`apps/web/components/marketing`) are the previous version.
- Admin console: `apps/web/app/app/*` with a grouped sidebar (`apps/web/app/app/nav-model.ts`); UI kit `apps/web/components/ui`; theme tokens `apps/web/app/sk-theme.css` (use `var(--sk-*)`, never literal brand hex).
- Middleware `apps/web/middleware.ts`: www → apex normalisation on its matcher only; CSP/security headers in `next.config.mjs` (`securityHeaders`).

## 6. Mobile app shape

expo-router in `apps/mobile/src/app`: `(auth)` login/reset, `(family)` tabs (home, attendance, results, profile) for the STUDENT login, `(staff)` tabs (home/today, attendance, class, notes, tests, requests, messages) for admin/teacher/staff. Theme tokens in `apps/mobile/src/theme/tokens.ts`. Push via Expo tokens registered at `/me/push-token`. Shipping steps: `docs/SHIP-MOBILE.md`; Play target-API bumps via expo-build-properties.

## 7. Deploy topology

| Environment | Branch | Web | API | DB |
|---|---|---|---|---|
| Production | `main` | `sckools.com`, `<slug>.sckools.com`, custom domains, `owner.sckools.com` | `api.sckools.com` | Supabase (prod) — migrations run by hand via `db-migrate.yml` `environment=production` |
| Staging | `staging` | `test.sckools.com`, `<slug>.test.sckools.com`, `owner.test.sckools.com` | `api.test.sckools.com` | Supabase (staging) — migrations auto-apply on push (path-filtered), demo data re-seeds |

Vercel team `team_FaL8TiC55WyNQFLSZ0BcZZdU`; web project `prj_FLMNZFAll14s8xwGYZ77iulD18Pw`. Region `bom1`. School custom domains are attached to the **web** project (`apps/api/src/modules/owner/internal/hosting-provider.service.ts`). Details and runbooks: operations.md.
