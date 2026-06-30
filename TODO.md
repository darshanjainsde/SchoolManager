# SkoolOS — Progress & TODO

Multi-tenant school management SaaS. Phase-gated build. Last touched mid-Phase 2.

## Quick resume on a fresh clone

```bash
git clone git@github.com:darshanjainsde/SchoolManager.git
cd SchoolManager
cp .env.example .env
docker compose up -d                 # postgres, redis, minio, mailhog
pnpm install
pnpm db:migrate                       # applies all migrations + RLS + roles
pnpm db:seed                          # seeds 2 schools + platform owner (prints TOTP)
pnpm dev                              # api :3001, web :3000, worker :3002

# Full security suite (creates skoolos_test DB on the fly):
pnpm --filter @skoolos/api test:e2e
```

See `docs/ARCHITECTURE.md` for the big picture. Demo creds + Try-It curls are in `README.md`.

---

## ✅ Phase 0 — Foundation & Scaffold (DONE)

- [x] pnpm monorepo + Turborepo, Node 20, TS strict
- [x] `apps/{api,web,worker}` + `packages/{db,types,config}`
- [x] Docker Compose: Postgres 16, Redis 7, MinIO + bucket init, MailHog (all healthchecked)
- [x] NestJS API with `/health`, `/ready`, Swagger at `/api/docs`, pino logging
- [x] Next.js 14 web with landing page pinging API health
- [x] BullMQ worker with `/health`
- [x] Prisma initialized + first migration applied
- [x] Shared `@skoolos/config` (zod env loader with auto `.env` discovery)
- [x] Shared `@skoolos/types` (DomainEvent / EventHandler)
- [x] In-process EventBus (swappable later to NATS/Rabbit)
- [x] **Module-boundary lint rule** (`.dependency-cruiser.cjs`) — fails CI on cross-module `internal/` imports; negative-test verified
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): install → prisma generate → lint → typecheck → boundary → build → test
- [x] `docs/ARCHITECTURE.md` + README

## ✅ Phase 1 — Auth, RBAC & Multi-Tenant Core (DONE — 23/23 security tests passing)

### Data + DB
- [x] Models: `School`, `CustomDomain`, `User`, `PlatformUser`, profile tables, `ParentStudent`, `RefreshToken`, `PlatformRefreshToken`, `AuditLog`, enums
- [x] Postgres RLS forced on every tenant table
- [x] Dedicated DB roles: `skoolos_app` (RLS-bound), `skoolos_platform` (BYPASSRLS)
- [x] `withTenant(id, fn)` helper that does `SET LOCAL app.current_tenant` per request
- [x] Three DB URLs in env: `DATABASE_URL` (super), `_APP`, `_PLATFORM`

### Auth
- [x] Argon2id passwords (OWASP-2023 defaults)
- [x] Audience-scoped JWTs (school + platform have **distinct secrets** — non-interchangeable)
- [x] Refresh rotation with `familyId` + reuse detection (revokes whole family)
- [x] Failed-login lockout (5 attempts → 15 min) for both school + platform users
- [x] Platform owner login: separate host (`owner.localhost`), **mandatory TOTP**, optional IP allowlist
- [x] Endpoints: `/auth/{login,refresh,logout,me}` + `/platform/auth/{login,refresh,logout,me}`

### Tenancy
- [x] Functional Express middleware resolves Host → schoolId via Redis cache (60s TTL)
- [x] `TenantContextService` over `AsyncLocalStorage`
- [x] `SchoolJwtGuard` re-checks `payload.schoolId === tenant.schoolId` every request
- [x] `PlatformHostGuard` + `PlatformJwtGuard` enforce platform-host boundary
- [x] `RolesGuard` + `@Roles()` + `@CurrentUser()` decorators

### Common
- [x] `@nestjs/throttler` global + tighter per-endpoint limits on auth (with `skipIf` for tests)
- [x] `AuditService` + `AuditInterceptor` on all mutations (via platform Prisma so RLS doesn't block)
- [x] Global `ValidationPipe` with `forbidNonWhitelisted`

### Tests (in `apps/api/test/integration/security.e2e-spec.ts`)
- [x] Tenant isolation (cross-host token replay → 401)
- [x] RLS at the DB level (no tenant set → 0 rows; per-tenant scoping; platform BYPASSRLS)
- [x] IDOR / object-level (404 on un-owned resources, no enumeration)
- [x] Role isolation (student can't list students, parent can't list users)
- [x] Platform boundary (school user can't reach `/platform/*`; spoofed owner host still rejected)
- [x] JWT audience separation (school token rejected at platform endpoints)
- [x] Failed-login lockout
- [x] Refresh rotation + reuse detection

### Dev runner
- [x] Switched API from `tsx watch` to `nodemon + ts-node` — tsx/esbuild was unreliable for NestJS DI `design:paramtypes`

## 🚧 Phase 2 — Owner Portal + Onboarding Wizard (BACKEND DONE, UI PENDING)

### ✅ Done
- [x] Model: `AcademicYear` (school-scoped, `isCurrent` flag) + RLS policy
- [x] `StorageService` (AWS S3 SDK against MinIO locally) + `PlatformUploadsController` for logo/favicon (multipart, 2MB cap, MIME validation)
- [x] `PlatformStatsController` — `/platform/stats` dashboard cards (totals by role, suspended schools, pending domains, MRR placeholder)
- [x] `OnboardingService` + `OnboardingController` — `POST /platform/schools` provisions School + AcademicYear + admin User + optional CustomDomain in one transaction, enqueues provisioning + verification jobs, returns invite token
- [x] `OnboardSchoolDto` with nested DTOs (BrandColors, Address, CsvUser, CustomDomain) and class-validator rules
- [x] `SchoolsMgmtController` — branding PATCH, suspend/unsuspend, **audited impersonation** (15-min school JWT), per-tenant usage view, hard-delete refused
- [x] `DomainsController` — CRUD + `POST /:id/verify` trigger; **returns exact DNS records to paste** (CNAME for SUBDOMAIN, A for APEX) from env-driven targets
- [x] `CsvImportController` — preview + commit, CSV template download, per-row validation with reasons
- [x] Worker: `school-provisioning` queue (bulk-imports CSV users + sends invite email via MailHog)
- [x] Worker: `domain-verification` queue with DNS resolve + HTTP probe, plus a **test mock seam** (`job.data.mock = { resolvable, reachable }`) for deterministic tests
- [x] Status transitions: `PENDING → VERIFYING → LIVE` (with `tlsStatus=ACTIVE`) or `ERROR` (with `lastError`)
- [x] **E2E tests passing (8/8 in `onboarding.e2e-spec.ts`)**:
  - [x] Wizard provisions school + admin + academic year + branding
  - [x] Duplicate slug → 409
  - [x] New tenant isolated from previously-seeded tenants
  - [x] Suspend/unsuspend (audited)
  - [x] Impersonation mints school-audience token (audited)
  - [x] Add domain returns exact DNS records
  - [x] Mocked resolvable → LIVE; unresolvable → ERROR
  - [x] School admin cannot manage platform domains

### ⏳ Pending (Phase 2 finish line)

#### Web app — owner portal
- [ ] **shadcn/ui + React Query + Zustand setup** in `apps/web` (providers, API client with Host header)
- [ ] `/platform` layout — owner-host detection (redirect to login on tenant host)
- [ ] `/platform/login` — password + TOTP form
- [ ] `/platform` dashboard — stats cards from `/platform/stats`
- [ ] `/platform/schools` — list/table with status, plan, primary domain, "Impersonate" + "Suspend" buttons
- [ ] **`/platform/onboard` multi-step wizard**:
  - [ ] Step 1: basics (name, slug — instant subdomain preview)
  - [ ] Step 2: branding (logo upload, favicon upload, brand color, about page rich text)
  - [ ] Step 3: contact (address + map lat/lng picker, phone, email, timezone, currency)
  - [ ] Step 4: plan selection
  - [ ] Step 5: custom domain (optional) — show DNS records preview
  - [ ] Step 6: CSV import (drag-drop, preview valid/invalid rows, downloadable template)
  - [ ] Step 7: review + submit → success page with school subdomain link
- [ ] `/platform/schools/[id]` — branding edit, domain list with DNS instructions + "Verify" + "Set Primary" buttons
- [ ] Toast notifications, optimistic updates via React Query

#### Backend follow-ups
- [ ] Wire `SchoolLookupService` cache invalidation when a domain flips to LIVE (currently relies on TTL)
- [ ] Add `POST /platform/schools/:id/invite/resend` (re-emits the invite email)
- [ ] Add `POST /accept-invite` flow on the tenant side (consume invite token + set password)
- [ ] Phase 2 test gate validation: full `pnpm lint && pnpm typecheck && pnpm boundary && pnpm test && pnpm --filter @skoolos/api test:e2e` green run

---

## 🔜 Phase 3 — School Admin Core (NOT STARTED)
`/app` tenant-themed shell, CRUD + bulk import for teachers/students/parents (+ guardian↔student), `Grade`/`Class`/`Section`/`Subject`, `ClassSubjectTeacher`, `Timetable/Period` builder, `Enrollment`, school-settings page.

## 🔜 Phase 4 — Teaching & Learning (NOT STARTED)
`Attendance` (bulk mark UI with WebSocket live save), `Assignment` + `Submission`, `Exam` + `ExamResult/Mark` + `GradingScheme`, `ReportCard` PDF via worker.

## 🔜 Phase 5 — Admissions CRM + Finance (NOT STARTED)
Kanban `Lead` pipeline → `AdmissionApplication` → enroll. `FeeStructure`/`FeePlanAssignment`/`Invoice`/`Payment`/`Discount`. **Stripe test mode** for fee + per-school subscription.

## 🔜 Phase 6 — Teacher & Student/Parent Portals (NOT STARTED)
`/teacher` (classes, attendance, grading, marks, announcements). `/me` (attendance %, results charts, report cards, fee invoices, profile). Realtime `Announcement` / `Notification` / `Message`.

## 🔜 Phase 7 — Hardening, Observability, Load (NOT STARTED)
OpenTelemetry + Prometheus + Grafana, idempotent retries, k6 load (~100 schools), PgBouncer config, read-replica routing demo, per-tenant usage view (rows + storage), OWASP-style checklist + full regression of all security tests.

## 🔜 Phase 8 — Production Handoff Docs (NOT STARTED)
`docs/PRODUCTION.md` — actionable checklist of what I (the operator) buy/do:
1. Platform domain + **wildcard DNS** for instant subdomains
2. Per-school domain DNS (records the app already prints)
3. Managed Kubernetes + Helm charts + cert-manager + HPA
4. Managed Postgres + read-replica + PgBouncer
5. Managed Redis
6. S3/R2 bucket
7. Transactional email (Postmark/SES/Resend)
8. Stripe live keys
9. Scaling runbook (replica bump = throughput bump, no code change)
10. Backups + monitoring + secrets manager checklist

---

## Test status (last run)

```
security.e2e-spec.ts     23/23 passed   (Phase 1 gates)
onboarding.e2e-spec.ts    8/8  passed   (Phase 2 gates)
health.controller.spec    1/1  passed   (unit)
boundary check            0 violations  (93 modules, 267 deps cruised)
typecheck                 9/9  tasks    green
lint                      6/6  packages green
```

## Key files / starting points

| Concern              | File                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| Stack + scaling      | `docs/ARCHITECTURE.md`                                                       |
| Module boundary rule | `.dependency-cruiser.cjs`                                                    |
| Prisma schema        | `packages/db/prisma/schema.prisma`                                           |
| RLS policies         | `packages/db/prisma/migrations/20260614190200_rls_and_roles/migration.sql`   |
| Tenant resolver      | `apps/api/src/modules/tenancy/internal/tenant.middleware.ts`                 |
| Auth                 | `apps/api/src/modules/auth/internal/auth.service.ts`                         |
| Platform auth        | `apps/api/src/modules/platform/internal/platform-auth.service.ts`            |
| Onboarding service   | `apps/api/src/modules/platform/internal/onboarding.service.ts`               |
| Domains              | `apps/api/src/modules/platform/internal/domains.controller.ts`               |
| Worker — verify      | `apps/worker/src/jobs/domain-verification.ts`                                |
| Worker — provision   | `apps/worker/src/jobs/provisioning.ts`                                       |
| Security tests       | `apps/api/test/integration/security.e2e-spec.ts`                             |
| Onboarding tests     | `apps/api/test/integration/onboarding.e2e-spec.ts`                           |
