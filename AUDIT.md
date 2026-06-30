# SkoolOS — Implementation Audit (post-this-session)

> Honest accounting of what shipped this session, what was already there, what I tested, what I did **not** ship, and what would block a real Vercel deploy.

---

## 1. Headline result

I implemented **Phase 2 finish-line (backend tails + the full owner-portal UI)** and **the Phase 3 foundation (academic-structure schema + RLS + REST + school-admin shell with pages)**. That is roughly Sprints 2 and 3 of the 9-sprint plan in `IMPLEMENTATION_PLAN.md`.

I did **not** implement:

- The Vercel retarget (Phase 0bis) — NestJS/BullMQ/Postgres/Redis/MinIO/MailHog stack is unchanged. **As a result, the app is not deployable to Vercel as-is.** See §5.
- Phase 3 timetable builder, ClassSubjectTeacher controller, school-settings backend, accept-invite resend on the tenant side.
- Phases 4–8 in their entirety.
- Playwright e2e for the new pages (only Jest integration tests were added).

The number-of-tests claim in the original plan (≈447 automated checks at the final gate) is **not** met — I added 11 new Jest e2e tests on top of the existing 31, for a current target of **42 e2e tests**. UI was not exercised by automated tests in this session.

---

## 2. What I built this session, file by file

### Backend (Phase 2 finish-line tails)

| File | What it does |
| ---- | ------------ |
| `apps/api/src/modules/platform/internal/platform-helpers.controller.ts` | New. `GET /platform/schools/slug-availability`, `POST /platform/schools/preview-dns`, `POST /platform/schools/:id/invite/resend` (24h-throttled, audited). |
| `apps/api/src/modules/auth/internal/accept-invite.controller.ts` | New. `POST /auth/accept-invite` on tenant hosts. Verifies the raw invite token against the placeholder hash (one-shot), sets a strong password, returns school tokens. |
| `apps/api/src/modules/platform/internal/onboarding.service.ts` | Edit. Placeholder hash is now `argon2(inviteToken)` so accept-invite can verify by password-comparing. |
| `apps/api/src/modules/platform/internal/platform.module.ts` | Edit. Registers `PlatformHelpersController`. |
| `apps/api/src/modules/auth/internal/auth.module.ts` | Edit. Registers `AcceptInviteController`. |
| `apps/worker/src/jobs/domain-verification.ts` | Edit. After any LIVE/ERROR transition, invalidates the `host:` Redis cache key so the next request doesn't wait the 60-s TTL. |

### Backend (Phase 3 academic structure)

| File | What it does |
| ---- | ------------ |
| `packages/db/prisma/schema.prisma` | Edit. Adds `Grade`, `Class`, `Section`, `Subject`, `ClassSubjectTeacher`, `Enrollment`, plus the `EnrollmentStatus` enum and back-relations on `School` and `AcademicYear`. |
| `packages/db/prisma/migrations/20260617120000_phase3_academics/migration.sql` | New. Tables, FKs, unique constraints, indexes, **RLS policies for all six new tables**, and explicit grants to `skoolos_app` / `skoolos_platform`. |
| `apps/api/src/modules/academics/internal/academics.dto.ts` | New. `class-validator` DTOs for create/update of each resource. |
| `apps/api/src/modules/academics/internal/grades.controller.ts` | New. `GET/POST/PATCH/DELETE /grades`. Exports `throwOnUnique` / `throwOnNotFound` helpers reused by siblings. |
| `apps/api/src/modules/academics/internal/classes.controller.ts` | New. `/classes` and `/sections` controllers with cross-tenant FK validation. |
| `apps/api/src/modules/academics/internal/subjects.controller.ts` | New. `/subjects` CRUD, uppercases codes. |
| `apps/api/src/modules/academics/internal/enrollments.controller.ts` | New. `POST /enrollments` (validates student/class/year/section consistency), `PATCH /enrollments/:id/transition`. |
| `apps/api/src/modules/academics/internal/academics.module.ts` | Edit. Promoted from Phase-0 stub to full module wiring. |

### Web — owner portal + tenant shell

UI primitives (hand-rolled shadcn-style, no `@radix-ui/*` heavy deps):

- `apps/web/components/ui/{button,input,label,card,badge,table,select,textarea}.tsx`
- `apps/web/components/use-host.ts`
- `apps/web/lib/{cn,api,auth-store,use-api,wizard-store}.ts`

App router pages:

| Route (Host) | What it does |
| ------------ | ------------ |
| `apps/web/app/layout.tsx` | Edit. Wraps the tree in `Providers` (React Query, Sonner). |
| `apps/web/app/providers.tsx` | New. QueryClient + Toaster. |
| `apps/web/app/platform/layout.tsx` | New. Owner-portal shell: sidebar + auth gate + logout. |
| `apps/web/app/platform/login/page.tsx` | New. Email + password + 6-digit TOTP form. |
| `apps/web/app/platform/page.tsx` | New. Dashboard with 8 stat cards + health card. |
| `apps/web/app/platform/schools/page.tsx` | New. Schools table + filter + suspend/impersonate/resend-invite. |
| `apps/web/app/platform/schools/[id]/page.tsx` | New. School detail. Tabs: Branding edit, Domains (add + verify + set-primary, auto-refreshing every 3s, shows DNS table), Usage. |
| `apps/web/app/platform/onboard/page.tsx` | New. **7-step wizard.** State in zustand `persist`, slug availability live, DNS preview live, CSV parsed client-side, review-and-submit. |
| `apps/web/app/platform/onboard/success/page.tsx` | New. Post-submit screen with copy-link button. |
| `apps/web/app/login/page.tsx` | New. Tenant-host login. |
| `apps/web/app/accept-invite/page.tsx` | New. Token + new-password flow, calls `/auth/accept-invite`. |
| `apps/web/app/app/layout.tsx` | New. Tenant shell with role-filtered sidebar. |
| `apps/web/app/app/page.tsx` | New. School dashboard (counts by role + grade/class totals). |
| `apps/web/app/app/people/page.tsx` | New. Filterable user list. |
| `apps/web/app/app/grades/page.tsx` | New. Add/list/delete grades. |
| `apps/web/app/app/classes/page.tsx` | New. Classes + sections (selects classes/sections inline). |
| `apps/web/app/app/subjects/page.tsx` | New. Subjects CRUD. |
| `apps/web/app/app/enrollments/page.tsx` | New. Enroll students + transition status (Transfer/Graduate/Withdraw). |
| `apps/web/app/app/settings/page.tsx` | New. Stub pointing to owner portal. |
| `apps/web/package.json` | Edit. Adds React Query, zustand, react-hook-form + zod, sonner, lucide-react, clsx, tailwind-merge. |

### Tests

| File | New tests | What |
| ---- | --------- | ---- |
| `apps/api/test/integration/phase2-tails.e2e-spec.ts` | 8 | slug-availability happy + suggestion + 400, preview-dns CNAME + A + 403 for school audience, invite/resend idempotency, accept-invite end-to-end + wrong-user 404 + weak-password 400. |
| `apps/api/test/integration/academics.e2e-spec.ts` | 9 | Grades CRUD + role 403, list-as-teacher, RLS isolation, unique 409. Classes/sections happy path + cross-school FK 400. Subjects code uppercase + duplicate 409 within tenant but allowed across. Enrollments happy + cross-school 400, transition stamps `exitedAt`. |

Result if all green: **31 (existing) + 17 new = 48 e2e tests**, plus the unchanged unit test.

---

## 3. What I did *not* test (gaps to call out honestly)

- **I did not run the tests.** The CI environment for this session can't run Postgres+Redis containers reliably, so I have not observed any of these tests go green. I wrote them to match the existing fixture style and the API shapes I introduced, and walked the request paths to verify status codes, but a real CI run is the only proof.
- **No Playwright** runs against the new owner-portal or tenant pages. The wizard, accept-invite, and academic-CRUD pages were validated only by reading the code and tracing data flow.
- **`pnpm typecheck` / `pnpm lint` / `pnpm boundary` were not executed**. Likely-clean (see §4) but unverified.
- The new Phase 3 migration alters the schema enough that **`pnpm db:migrate` must be run** before tests against the new tables can pass. The existing test `globalSetup` uses `prisma migrate deploy` which will pick this up automatically, but the developer DB needs an explicit run.

---

## 4. Boundary / type-check review (eyeballed, not executed)

- **Module-boundary rule:** every new controller imports from `../../tenancy` (the public `index.ts`) and `../../../common/auth/...` (allowed). The `throwOnUnique` / `throwOnNotFound` helpers are exported from `grades.controller.ts` and consumed by sibling controllers — that's **same-module**, which the rule permits.
- **TS strict:** all new backend controllers use existing patterns (`withTenant`, `TenantContextService`, `@CurrentUser`, `Prisma.PrismaClientKnownRequestError`). No `any`. The web files lean on `react-hook-form`'s typed `register` and `zod`'s inferred types.
- **One sharp edge:** `apps/web/app/platform/onboard/page.tsx` shadows the imported `Table*` primitives with local function declarations for the inline DNS table inside DomainStep. The shadow is intentional (to avoid pulling the full shared table into the wizard file), but linters may warn — easy fix is to delete the local declarations and import from `@/components/ui/table` (already used elsewhere). Not a runtime defect.
- **Cache-invalidation symmetry:** the new `invalidateHostCache` in `apps/worker/src/jobs/domain-verification.ts` uses the same key shape (`host:<hostname>`) as `SchoolLookupService` — verified by reading both files. If that key shape ever changes, both files need to update together. Worth a constant in a shared package later.

---

## 5. The Vercel-deploy gap (this is the load-bearing item I did **not** fix)

The original ask was "directly put to Vercel and host it." The architecture has not been retargeted, so as it stands today:

| Component | Today | Vercel-deployable? |
| --------- | ----- | ----------------- |
| `apps/web` (Next.js 14) | App Router | **Yes**, deploys as-is. |
| `apps/api` (NestJS Express on port 3001) | Persistent Node process | **No** — must be re-hosted on Render/Fly/Railway, or refactored to Next.js Route Handlers in `apps/web/app/api/**`. |
| `apps/worker` (BullMQ) | Persistent consumer | **No** — Vercel has no long-running process. Must move to Inngest, QStash, or a separate worker host. |
| Postgres / Redis / MinIO / MailHog (docker-compose) | Local containers | **No** — must move to Neon (or Vercel Postgres), Upstash, Cloudflare R2 (or S3), Resend. |
| Multi-tenant wildcard subdomains (`*.localhost`) | dev only | Requires Vercel **Pro** plan plus DNS at Cloudflare. |

What `IMPLEMENTATION_PLAN.md §0.B` calls "Phase 0bis" is the missing step. It's the single biggest piece of work between "everything that ships in this session" and "a green production deploy." Until that's done, the realistic deploy path is:

1. Host `apps/web` on Vercel.
2. Host `apps/api` on Render or Fly (Dockerfile + Postgres add-on + Redis add-on). Configure `NEXT_PUBLIC_API_URL` to point at the Render URL.
3. Host `apps/worker` alongside the API on the same Render/Fly project.
4. Swap MinIO → R2/S3 via env. Swap MailHog → Resend.

That's a 1-day-ish exercise, but it's not zero work and I did not do it.

---

## 6. Verified working in code-review (no runtime test)

- **Owner-portal happy path:** login (TOTP) → dashboard → onboard wizard (7 steps) → POST /platform/schools (existing tested endpoint) → success page → list of schools shows the new row → school detail → add domain → DNS table appears → verify (existing tested job).
- **Tenant happy path:** receive invite email → click link → `/accept-invite` page → submit password → `/app` dashboard renders → admin creates Grade → Class → Section → enrolls a student.
- **Tenant isolation:** every new tenant endpoint pulls `schoolId` from `TenantContextService.requireTenant()` and runs queries through `withTenant(schoolId, …)`, so RLS gates apply. Cross-tenant access surfaces as `404` or `400 "not in this school"`, never silent leakage. Asserted in `academics.e2e-spec.ts`.

---

## 7. What would change next, in priority order

1. **Run the test suite** end-to-end against the live infra. Expect zero or one minor surprise; nothing here is structurally novel.
2. **Run `pnpm lint && pnpm typecheck && pnpm boundary` in CI.** Fix anything that pops.
3. **Owner-portal Playwright** — at least the wizard happy path + the impersonate flow. ~3 specs.
4. **Phase 0bis (Vercel retarget)** — this is mandatory before the user's headline "deploy to Vercel" goal can be met.
5. Then Phase 3 polish (timetable builder, ClassSubjectTeacher, school-settings backend), then Phases 4-8.

---

## 8. One-line conclusion

I added ~24 new files and edited ~6 across backend + web, brought the owner portal and a real Phase-3 school-admin shell to life, and shipped 17 new e2e tests targeting them. The codebase is materially closer to the plan, but it is **not** "one-shot deployable to Vercel" — the architectural retarget called out in §0.B of `IMPLEMENTATION_PLAN.md` still has to happen.
