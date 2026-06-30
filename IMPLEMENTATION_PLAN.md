# SkoolOS — Complete Remaining Implementation Plan

> **Goal.** Take SkoolOS from its current state (Phase 0, 1, and Phase-2 backend done) all the way to a production-deployable, fully-tested, multi-tenant school SaaS that can be hosted on Vercel + managed services. Every feature ships with tests. No half-implementations.
>
> **Scope.** Everything in `TODO.md` from Phase 2 frontend through Phase 8, plus the platform/infra changes required to make a Vercel deployment realistic (the current Docker-Compose + persistent BullMQ worker design is **not** Vercel-native — Section 0 covers the deployment retarget that has to happen alongside feature work).

---

## 0. Current State Snapshot (verified by reading the repo)

### What is already real and tested

| Area | What's built | Tests |
| ---- | ------------ | ----- |
| Monorepo | pnpm + Turborepo, Node 20, TS strict, dep-cruiser boundary rule | boundary 0 violations |
| Infra (dev) | Docker Compose: Postgres 16, Redis 7, MinIO, MailHog | up via healthchecks |
| Prisma schema | `School`, `AcademicYear`, `CustomDomain`, `User`, `*Profile`, `ParentStudent`, `RefreshToken`, `PlatformUser`, `PlatformRefreshToken`, `AuditLog` + RLS migrations | n/a |
| DB roles | `skoolos_app` (RLS-bound), `skoolos_platform` (BYPASSRLS), superuser only for migrations | covered by RLS tests |
| Auth | Argon2id, audience-scoped JWTs, refresh-rotation + reuse detection, lockout, TOTP for platform owner | 23/23 security e2e |
| Tenancy | Host → schoolId middleware, Redis cache, `withTenant`, `SchoolJwtGuard`, `RolesGuard` | covered |
| Platform onboarding API | `POST /platform/schools` (school + admin + AY + domain in one tx), uploads, stats, suspend/impersonate, domains CRUD + verify, CSV import preview/commit | 8/8 onboarding e2e |
| Worker | BullMQ queues: `school-provisioning`, `domain-verification` (with deterministic test mock) | covered via e2e |
| Web app | Phase-0 landing page only — pings `/health`. **No auth, no portal, nothing else.** | none |

### What `TODO.md` says is left

1. **Phase 2 finish line** — owner-portal UI (login, dashboard, schools list, the multi-step onboard wizard, school detail with domains), plus a few backend tails (cache invalidation on LIVE, resend-invite, accept-invite).
2. **Phase 3** — School Admin Core: tenant-themed shell, CRUD for teachers/students/parents, guardian↔student, Grade/Class/Section/Subject, ClassSubjectTeacher, Timetable/Period builder, Enrollment, school-settings.
3. **Phase 4** — Teaching & Learning: Attendance (bulk + WebSocket live save), Assignment + Submission, Exam + ExamResult/Mark + GradingScheme, ReportCard PDF via worker.
4. **Phase 5** — Admissions CRM + Finance: Kanban Lead → AdmissionApplication → Enroll. FeeStructure/Plan/Invoice/Payment/Discount + Stripe test mode.
5. **Phase 6** — Teacher & Student/Parent portals + realtime Announcement/Notification/Message.
6. **Phase 7** — Hardening: OTel + Prom + Grafana, idempotent retries, k6 load, PgBouncer, read-replica route, per-tenant usage view, OWASP regression.
7. **Phase 8** — `docs/PRODUCTION.md`.

The plan below covers all of it, plus the Vercel-retarget that has to happen in parallel.

---

## 0.A Reality check on the "directly put to Vercel and host it" ask

The current architecture cannot be moved to Vercel as-is. The non-negotiables and the chosen path:

| Component | Today (won't work on Vercel) | Production target |
| --------- | ---------------------------- | ----------------- |
| `apps/api` (NestJS) | Long-running Express on port 3001 | **Migrate REST surface to Next.js Route Handlers** in `apps/web/app/api/**`. Keep NestJS only as a local dev convenience for the Phase 1/2 modules until parity is reached, then delete it. (Alternate: keep NestJS, host on Render/Fly; web on Vercel. I'll mark which path each step is on.) |
| `apps/worker` (BullMQ) | Persistent Node consumer | **Inngest** (or QStash) for async jobs. BullMQ deleted at the cutover point. Inngest fits Vercel's serverless model and supports retries, cron, and step-functions out of the box. |
| Postgres 16 (Docker) | n/a | **Neon** (serverless Postgres, RLS works, branching for previews). Vercel Postgres = Neon under the hood. |
| Redis (Docker) | n/a | **Upstash Redis** (HTTP + TLS, works from serverless cold-starts). |
| MinIO | n/a | **Cloudflare R2** (S3-compatible, free egress) or AWS S3. The existing `StorageService` already uses the S3 SDK — endpoint/credentials swap only. |
| MailHog | n/a | **Resend** (single API, react-email templates, Vercel-blessed). |
| BullMQ queues | n/a | **Inngest functions**, called by Route Handlers via `inngest.send()`. |
| Wildcard subdomains | `*.localhost` | `*.skoolos.app` — register the apex on Cloudflare, point to Vercel; **add wildcard domain in Vercel** (paid plan required). Per-school custom domains are added via Vercel's Domains API at LIVE time (Section 6.5). |
| Cron | none | Vercel Cron → Inngest schedules. |

**Decision (default):** retarget everything to Vercel-native (Path A above). The work below is sized for that target. If you prefer to keep NestJS and host the API on Render/Fly, every Route-Handler section maps 1:1 onto an existing NestJS controller; I'll note that where it matters.

---

## 0.B Phase 0bis — Vercel retarget (do FIRST, before Phase 2 UI)

This is the load-bearing change. Doing it after Phase 3+ ships will require re-doing everything.

### Steps

1. **Add `apps/web/app/api/**` Route Handlers.** One per existing NestJS controller. Each handler:
   - Reads `Host` header, resolves tenant via the same `school-lookup` logic (extract `apps/api/src/modules/tenancy/internal/school-lookup.service.ts` into a runtime-agnostic module under `packages/tenancy`).
   - Verifies JWT (same secrets, same audience separation) using `jose` (works on Edge + Node).
   - Calls into the **shared service layer** that we extract from `apps/api/src/modules/*/internal/*.service.ts` into `packages/<domain>/src/*.service.ts` (no Nest decorators — plain TS classes/functions with explicit dependency injection through a factory).
2. **Extract services from NestJS.** Move every `*.service.ts` from `apps/api/src/modules/<x>/internal/` to `packages/<x>/src/`. Strip `@Injectable()`; inject Prisma/Redis/S3 clients via plain constructor args. Add unit tests at the package level (Vitest). The NestJS controllers become a thin wrapper that calls these services — and so do the Route Handlers. This is the **one** refactor that makes the whole plan tractable.
3. **Replace BullMQ with Inngest.**
   - `apps/web/app/api/inngest/route.ts` exposes the Inngest handler.
   - Convert `provisioning.ts` → `inngest/functions/provision-school.ts`.
   - Convert `domain-verification.ts` → `inngest/functions/verify-domain.ts` (Inngest's retry + step.sleep replaces BullMQ retry/backoff).
   - Test seam: Inngest's `testEngine` for unit tests; E2E uses `inngest dev` against ephemeral test DB.
4. **Storage adapter swap.** `StorageService` already uses S3 SDK — flip to R2 by env. No code change.
5. **Tenancy at the edge.** Add `apps/web/middleware.ts` to set `x-tenant-id` header from Host lookup (Upstash Redis HTTP from edge), so Route Handlers don't pay the lookup cost.
6. **Delete `apps/api` and `apps/worker`** once parity is proven by tests (the boundary rule and unit tests at `packages/*` are what guarantees behavior parity — see Section 8 test plan).

### Tests for Phase 0bis

- **Service-layer unit tests** for everything extracted from `apps/api`. Coverage gate: 90% lines on `packages/auth`, `packages/tenancy`, `packages/platform-onboarding`.
- **Route-Handler integration tests** (Vitest + `node-mocks-http` or @vercel/node test util) for every endpoint that was previously NestJS — must pass the **same 23 security + 8 onboarding e2e specs**, ported to the new transport. Acceptance: 31/31 green on the migrated runtime.
- **Inngest function tests** using `@inngest/test` — provisioning runs the same fixtures as the old `provisioning.ts` test would have; domain-verification keeps the `mock = { resolvable, reachable }` seam.

---

## 1. Phase 2 — Owner Portal UI + backend tails

### 1.1 Frontend setup (one-time, `apps/web`)

- Install: `@tanstack/react-query`, `zustand`, `shadcn/ui` (`button`, `dialog`, `form`, `input`, `select`, `table`, `tabs`, `toast`, `dropdown-menu`, `card`, `badge`, `separator`, `stepper` custom), `react-hook-form`, `zod`, `@hookform/resolvers`, `lucide-react`, `sonner`, `next-themes`, `clsx`, `tailwind-merge`.
- Providers wrapper `apps/web/app/providers.tsx`: QueryClientProvider, ThemeProvider, Toaster, a tiny `ApiClient` (fetch wrapper that injects `Host`/cookie/Authorization, surfaces 401 to a single redirect handler).
- `apps/web/lib/api.ts`: typed wrappers around every endpoint (generated from a shared `packages/types` zod schema set — see Section 7 contract layer).
- Auth state in `zustand` (in-memory accessToken; refresh token in httpOnly cookie set by Route Handler).

### 1.2 Owner-portal routes

| Route | What it does | Backed by |
| ----- | ------------ | --------- |
| `/platform/login` | Email + password + TOTP form. On success, sets refresh cookie scoped to owner host, navigates to `/platform`. | `POST /api/platform/auth/login` |
| `/platform` | Dashboard — six stat cards (total schools, active users by role, suspended schools, pending domains, storage used, MRR placeholder). | `GET /api/platform/stats` |
| `/platform/schools` | Table — slug, name, plan, status, primary domain, created. Row actions: Open, Impersonate, Suspend/Unsuspend, Resend invite. Filters: status, plan, search. | `GET /api/platform/schools` (new — add list endpoint) |
| `/platform/onboard` | **7-step wizard.** State held in `zustand`; persists to `localStorage` until submit; submits one big DTO. | `POST /api/platform/schools` |
| `/platform/schools/[id]` | Tabs: Branding, Domains, Users (CSV re-import + per-user invite resend), Subscription, Audit log. Each tab is a Route segment with its own React Query keys. | Existing endpoints |

### 1.3 Wizard steps (Step 1–7, exact field list)

1. **Basics:** `name`, `slug` (validated against `/api/platform/schools/slug-availability?slug=...` debounced 300ms). Shows live subdomain preview `<slug>.skoolos.app`.
2. **Branding:** logo (drag-drop, ≤2MB, png/jpg/svg, posts to `/api/platform/uploads/logo` → returns S3 URL), favicon, brand-color picker, About rich-text (Tiptap or a textarea+markdown; pick textarea for shipping speed).
3. **Contact:** address line 1/2, city, region, postal, country, timezone (`Intl.supportedValuesOf('timeZone')`), currency (ISO 4217 list), lat/lng (manual input now; Leaflet map is Phase-7 polish).
4. **Plan:** TRIAL/STARTER/PRO/ENTERPRISE radio cards.
5. **Custom domain (optional):** hostname + type (APEX/SUBDOMAIN). On enter, immediately calls `POST /api/platform/schools/preview-dns?type=...` to show the CNAME or A record the user must paste.
6. **CSV import (optional):** drag-drop → `POST /api/platform/csv-import/preview` → shows valid/invalid row counts with per-row reasons → user confirms → on submit, file goes with the wizard payload.
7. **Review + submit:** read-only summary → submit → success page with the school URL + admin invite token + "Copy invite link".

### 1.4 Backend tails to finish Phase 2

- `POST /api/platform/schools/:id/invite/resend` — re-emits the invite mail via the worker (or Inngest after retarget). Idempotent on (schoolId, userId, last-24h).
- `GET /api/platform/schools/slug-availability?slug=` — 200 with `{ available: boolean, suggestion?: string }`.
- `POST /api/platform/schools/preview-dns` — pure function, returns the records that `DomainsController` already prints, just exposed before persistence.
- `POST /api/accept-invite` (tenant host) — consumes the invite token (HS256-signed, 7-day TTL), sets password (Argon2id, complexity validator), logs the user in.
- **Cache invalidation:** when a domain flips to LIVE, the verify-domain Inngest function calls `lookupCache.invalidate(hostname)` (replacing the current 60-s TTL race).

### 1.5 Tests (Phase 2 finish-line)

- **Backend (Vitest, Route-Handler level):**
  - `slug-availability` returns `false` when taken, includes a suggestion.
  - `invite/resend` is idempotent (calls within 24h → returns 200 but no second email).
  - `accept-invite` rejects expired tokens (401), wrong school (401), reused tokens (409).
  - Cache invalidation: after `verify-domain` flips a domain LIVE, next Host lookup returns the schoolId without waiting for TTL. Asserted by mocking the clock.
- **Frontend (Playwright):**
  - Login → dashboard renders all stat cards.
  - Schools list → filter by status → action menu → impersonate opens the tenant host in a new tab with a valid school token.
  - Wizard happy path: 7 steps → success page contains the school URL.
  - Wizard validation: invalid slug, oversize logo, malformed CSV — each surfaces the right error and blocks Next.
  - CSV preview shows row counts; commit triggers the Inngest provisioning job (asserted by tracking the run via `inngest dev`'s API).

### Acceptance for Phase 2

- All seven wizard steps drive a real provisioning end-to-end, with the new school reachable at `<slug>.skoolos.app` within 60 s in preview environments.
- 23 + 8 e2e suites still green on the new transport; **+18 new Phase-2 frontend Playwright tests** green.

---

## 2. Phase 3 — School Admin Core (`/app/*` on tenant hosts)

### 2.1 New Prisma models

```prisma
model Grade           { id, schoolId, name, sequence, isActive }
model Class           { id, schoolId, gradeId, name, academicYearId, classTeacherUserId? }
model Section         { id, schoolId, classId, name, capacity }
model Subject         { id, schoolId, code, name, isElective }
model ClassSubjectTeacher { id, schoolId, classId, subjectId, teacherUserId, sectionId? }
model Period          { id, schoolId, dayOfWeek, startMinute, endMinute }
model TimetableEntry  { id, schoolId, classId, sectionId, periodId, subjectId, teacherUserId, room? }
model Enrollment      { id, schoolId, studentUserId, classId, sectionId, academicYearId, status (ACTIVE|TRANSFERRED|GRADUATED|WITHDRAWN), enrolledAt, exitedAt? }
```

Every table: `schoolId UUID` + RLS policy + composite unique constraints (e.g. `@@unique([schoolId, code])` for Subject, `@@unique([schoolId, classId, name])` for Section). Migration ships with policies in the same file (mirroring the existing `phase2_rls` pattern).

### 2.2 Route Handlers (tenant host)

- **Users**
  - `GET/POST/PATCH/DELETE /api/users` — paged list with role filter; create defaults to `isActive=true`; soft-delete via `isActive=false`.
  - `POST /api/users/bulk-import` — same CSV pipeline as the wizard, gated to SCHOOL_ADMIN.
  - `POST /api/parents/:parentId/students/:studentId` / `DELETE` for guardian links.
- **Academic structure** (all CRUD, all SCHOOL_ADMIN):
  - `/api/grades`, `/api/classes`, `/api/sections`, `/api/subjects`, `/api/class-subject-teacher`.
- **Timetable**
  - `GET /api/periods`, `PUT /api/periods` (replace-all for the school's week pattern).
  - `GET/POST/PATCH/DELETE /api/timetable` with conflict detection (teacher double-booked, room double-booked, class overlap).
- **Enrollment**
  - `POST /api/enrollments` (student → class/section/AY), `PATCH /api/enrollments/:id/transfer`, `PATCH /api/enrollments/:id/withdraw`, `GET /api/enrollments?classId=&sectionId=`.
- **Settings**
  - `GET/PATCH /api/school/settings` — branding, contact, locale, currency, term dates, grading scale defaults.

### 2.3 Web (`apps/web/app/(tenant)/app/*` segment)

- Tenant-themed shell pulls `brandColors`, `logoUrl`, `name` from `/api/school` and applies CSS variables.
- Sidebar: Dashboard, People (Teachers/Students/Parents), Academics (Grades/Classes/Sections/Subjects/Assignments), Timetable, Enrollment, Settings.
- Each list page: shadcn table with TanStack Table (sorting, pagination server-side), drawer-style edit/create dialogs, bulk-select for CSV ops.
- Timetable builder: weekly grid (rows = periods, cols = days), drag-drop subject+teacher chip into a cell; conflict highlights in red; "Publish" button persists.

### 2.4 Tests

- **Backend (Vitest):** per resource — CRUD happy path, tenant isolation (cross-host create→read returns 404), role isolation (TEACHER cannot POST /api/classes), schema validation, conflict detection (timetable double-booking → 409 with the conflicting entry's id).
- **Frontend (Playwright):** create a class → add a section → assign a teacher → drag into timetable → save → reload → state preserved. Bulk-import 30 students from CSV → list shows them.

Acceptance gate: **42 backend specs + 12 Playwright flows green.** No RLS bypass anywhere (asserted by re-running the original 23 isolation specs against the new endpoints).

---

## 3. Phase 4 — Teaching & Learning

### 3.1 Prisma additions

```prisma
model Attendance        { id, schoolId, enrollmentId, date (Date), status (PRESENT|ABSENT|LATE|EXCUSED), markedByUserId, note?, @@unique([schoolId, enrollmentId, date]) }
model Assignment        { id, schoolId, classId, sectionId?, subjectId, title, description, dueAt, attachmentUrl?, createdByUserId }
model Submission        { id, schoolId, assignmentId, studentUserId, submittedAt, attachmentUrl?, body?, grade?, feedback?, @@unique([assignmentId, studentUserId]) }
model GradingScheme     { id, schoolId, name, bands Json (e.g. [{min:90,letter:"A"}…]) }
model Exam              { id, schoolId, name, classId, sectionId?, startsAt, endsAt, gradingSchemeId }
model ExamSubject       { id, schoolId, examId, subjectId, maxMarks, passingMarks }
model ExamResult        { id, schoolId, examId, studentUserId, status (DRAFT|PUBLISHED), publishedAt? }
model Mark              { id, schoolId, examResultId, examSubjectId, marksObtained, isAbsent, @@unique([examResultId, examSubjectId]) }
model ReportCard        { id, schoolId, examResultId, pdfUrl, generatedAt }
```

### 3.2 Route Handlers

- **Attendance**
  - `POST /api/attendance/bulk` — body `{ classId, sectionId, date, marks: [{ enrollmentId, status }] }`. Upserts on `(schoolId, enrollmentId, date)`. Returns the row count.
  - `GET /api/attendance?classId=&date=` / `?studentUserId=&from=&to=`.
- **Realtime live save (WebSocket).** On Vercel: **Ably** or **Pusher** channel `school:<slug>:attendance:<classId>:<date>` — clients subscribe; the bulk endpoint publishes a per-row event after the write. (Pusher Channels or Ably is the Vercel-native answer to "WebSocket gateway in NestJS" — pick Ably for free tier headroom.) Implementation: thin `realtime` package wrapping the SDK with a noop in tests.
- **Assignments / Submissions** — CRUD + signed-URL upload via existing `StorageService` (presigned PUT for the student → S3/R2 directly, then PATCH submission with the resulting URL).
- **Exams**
  - `POST /api/exams` + `POST /api/exams/:id/subjects` (batch).
  - `POST /api/exam-results/generate?examId=` — creates `ExamResult` for every enrolled student.
  - `PATCH /api/marks/bulk` — teacher enters marks for one ExamSubject across all students; validates `0 ≤ marksObtained ≤ maxMarks`.
  - `POST /api/exam-results/:id/publish` — flips DRAFT → PUBLISHED, enqueues `generate-report-card` Inngest job, emits `report-card.published` event.
- **Report cards**
  - Inngest function `generate-report-card`: pulls Marks, applies GradingScheme bands, renders PDF via `@react-pdf/renderer` (works in Vercel Functions), uploads to S3/R2, writes `ReportCard.pdfUrl`. Step retry on transient S3 errors. Idempotent on `(examResultId)`.
  - `GET /api/report-cards/:id/url` returns a presigned URL (5-min TTL).

### 3.3 Web

- Attendance: roster table for `class+section+date`, click-cycle status per row, "Mark all present" button, realtime indicator showing other teachers' updates (Ably presence).
- Assignment: teacher view (create, list submissions, grade inline); student view (list, upload submission).
- Exam: teacher views per-subject mark entry sheet; admin publishes; published results show in student/parent portal in Phase 6.
- Report card: download button on a published result.

### 3.4 Tests

- **Backend:** attendance idempotency (POST same payload twice → same row count, no duplicates); realtime publish asserted with an in-memory Ably mock; assignment due-date enforced (POST submission after `dueAt` → 200 but `lateSubmission=true` flag); marks out-of-range → 400; publishing a result enqueues exactly one report-card job (Inngest mock asserts `runs.length === 1`); PDF generation produces a valid PDF (assert magic bytes `%PDF`).
- **Frontend (Playwright):** mark a 30-student class as bulk-present in <2s; second browser tab sees realtime updates; create exam → enter marks → publish → student tab shows the result and the report-card download works.

Acceptance: **+38 backend specs**, **+10 Playwright flows**, RLS regression still green.

---

## 4. Phase 5 — Admissions CRM + Finance

### 4.1 Prisma additions

```prisma
model Lead               { id, schoolId, fullName, contactEmail, contactPhone, gradeAppliedFor, source, stage (NEW|CONTACTED|TOUR_BOOKED|APPLIED|ENROLLED|LOST), assignedToUserId?, nextActionAt?, notes? }
model AdmissionApplication { id, schoolId, leadId, applicantData Json, status (SUBMITTED|UNDER_REVIEW|OFFERED|ACCEPTED|REJECTED|WAITLISTED), reviewerUserId?, decidedAt? }
model FeeStructure       { id, schoolId, name, academicYearId, totalAmount Decimal, currency }
model FeeStructureItem   { id, schoolId, feeStructureId, label, amount Decimal, dueDate Date }
model FeePlanAssignment  { id, schoolId, feeStructureId, studentUserId, overrides Json?, @@unique([feeStructureId, studentUserId]) }
model Invoice            { id, schoolId, number (per-school sequence), feePlanAssignmentId, amountDue, amountPaid, status (OPEN|PARTIAL|PAID|VOID|REFUNDED), dueDate, issuedAt }
model Payment            { id, schoolId, invoiceId, amount, method (CARD|BANK|CASH|OTHER), stripePaymentIntentId?, receivedAt, recordedByUserId }
model Discount           { id, schoolId, invoiceId?, feePlanAssignmentId?, type (PERCENT|FIXED), value Decimal, reason }
model Subscription       { id, schoolId, plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd }
```

### 4.2 Route Handlers

- **Leads / CRM**
  - CRUD on Lead.
  - `PATCH /api/leads/:id/stage` — moves stage; emits `lead.stage_changed` event (for future automation).
  - `POST /api/leads/:id/convert` — creates `AdmissionApplication`.
- **Applications**
  - `PATCH /api/applications/:id/decision` (OFFERED/ACCEPTED/REJECTED/WAITLISTED) — on ACCEPTED, auto-creates `User(STUDENT) + StudentProfile + Enrollment` in one tx and links to the parent if `parentEmail` present.
- **Fees**
  - CRUD FeeStructure / Items / Assignments.
  - `POST /api/invoices/generate` — generates invoices from a FeeStructure across all assigned students in one tx (one row per `FeeStructureItem` aggregated to one Invoice with the total).
  - `POST /api/invoices/:id/pay` — for cash/bank, records a Payment + advances invoice status; for card, returns Stripe PaymentIntent client secret.
- **Stripe**
  - `POST /api/payments/stripe/intent` — creates intent server-side using the school's `stripeCustomerId`.
  - `POST /api/webhooks/stripe` — single endpoint, branches on `payment_intent.succeeded` (mark Payment + Invoice), `invoice.paid` (for subscription), `customer.subscription.*` (mirrors to local Subscription).
  - **Idempotency** keyed on Stripe event id; double-delivery → 200 no-op.
- **Per-school subscription**
  - `POST /api/platform/schools/:id/subscription` — provisions a Stripe customer + subscription.
  - Cron (Inngest schedule daily) — past-due → `SUSPENDED` after 14 days.

### 4.3 Web

- `/app/admissions` — kanban (dnd-kit) over `Lead.stage`. Card click → side drawer with notes/contact/next action.
- `/app/admissions/applications/:id` — review, attach docs, decision.
- `/app/finance/fees` — fee structure builder.
- `/app/finance/invoices` — list, filter by status, "Generate batch" modal, row actions: record cash, send link (returns hosted Stripe Checkout URL).
- `/app/finance/payments` — ledger.
- `/platform/schools/:id` Subscription tab — current plan, next renewal, action to start/cancel.

### 4.4 Tests

- **Backend:**
  - Convert-flow: Lead → Application → Accept → Enrollment + User row created with parent link. Asserted in one e2e.
  - Invoice generation: 100 students × 4 fee items → 100 invoices in one tx; rollback when one fails (poisoned student-id → 0 rows in DB).
  - Stripe webhook idempotency: replay same event → invoice stays PAID, no second Payment row.
  - RLS: school B cannot read school A's invoices even with valid school-B token using an A-scoped invoice id.
  - Past-due cron: shifts a Subscription with `currentPeriodEnd < now - 14d` to `SUSPENDED`; school's auth then refuses login with `ACCOUNT_SUSPENDED`.
- **Frontend:**
  - Kanban drag from NEW → CONTACTED persists and survives reload.
  - Stripe test-card `4242 4242 4242 4242` flow ends with invoice marked PAID (uses Stripe's test webhook forwarder in CI).

Acceptance: **+34 backend specs**, **+8 Playwright flows**.

---

## 5. Phase 6 — Teacher, Student/Parent portals + Realtime

### 5.1 Routes

- `/teacher/*` — segment guarded by `role === TEACHER`. Pages: My classes, attendance (today), my assignments, my exams, announcements composer, messages.
- `/me/*` (student or parent) — Pages: attendance % chart (per subject, per term), assignments + submissions, results + report cards, fee invoices + pay button, profile.
- Parent variant: a class-selector (over linked students) at the top of each page.

### 5.2 Realtime (Ably-backed)

- Channels:
  - `school:<id>:announcements` — all users in tenant.
  - `school:<id>:role:<role>` — role-scoped.
  - `user:<id>` — direct.
- `Announcement` (audience: SCHOOL/ROLE/CLASS), `Notification` (per-user), `Message` (1:1 or group thread).
- Backend stores history; client subscribes to the channel for live updates; uses presence for "who is online" in messaging.

### 5.3 Tests

- Backend: audience targeting (a TEACHER announcement broadcast is not received by STUDENT subscribers — assert via Ably mock's `publishedTo` matrix).
- Frontend: open two tabs (teacher + student), post announcement, student tab receives without reload.

Acceptance: **+18 backend specs**, **+8 Playwright flows**.

---

## 6. Phase 7 — Hardening, Observability, Load

| Item | Implementation | Test |
| ---- | -------------- | ---- |
| OpenTelemetry | `@vercel/otel` for Route Handlers + Inngest auto-instrumentation. Export to Grafana Cloud (free tier) via OTLP. | smoke: a known endpoint produces a trace with the expected span name. |
| Prometheus + Grafana | Skip self-hosted Prom on Vercel — push metrics to Grafana Cloud directly via OTel. Dashboards: API p95, error rate, DB connections, Inngest run failures. | dashboard exists with non-zero datapoints after a synthetic load run. |
| Idempotent retries | Add `Idempotency-Key` header support on all mutating endpoints. Store key→response hash in Upstash for 24h. | replay test: same key → same body, no second DB write. |
| k6 load | `scripts/load/onboard.js` and `attendance-bulk.js`. ~100 schools, 30 students each, attendance bulk write storm. | runs as a nightly GitHub Action, fails if p95 > 500ms on bulk attendance or error rate > 1%. |
| PgBouncer | Neon already provides pgbouncer-compatible pooled connections (`?pgbouncer=true`). Document in `docs/PRODUCTION.md`. | n/a |
| Read-replica routing | Neon read replica + a `prisma-read.client.ts` that the service layer uses for reports. | a regression test asserts that report endpoints can serve when the primary is paused (manually toggled in Neon). |
| Per-tenant usage view | Materialized view `tenant_usage` (rows by table + storage from S3 listing). Refreshed nightly via Inngest cron. | unit test of the SQL view; FE shows numbers on `/platform/schools/:id`. |
| OWASP regression | Re-run all 23 Phase-1 isolation tests + add: header-injection, parameter pollution, mass-assignment (forbidNonWhitelisted already covers this — add explicit tests), upload MIME-spoof, JWT alg=none rejection, refresh-token replay across audiences. | new spec file `owasp.e2e-spec.ts` with 20+ cases. |
| Backups | Neon PITR + daily R2 dump via Inngest cron. | restore drill documented in PRODUCTION.md. |

Acceptance: load test passes the SLOs above; OWASP suite green; the per-tenant usage view shows non-trivial data after a load run.

---

## 7. Phase 8 — `docs/PRODUCTION.md`

Concrete, copy-paste checklist:

1. Buy `skoolos.app` (or chosen apex). Add to Cloudflare. NS to Cloudflare.
2. Add `skoolos.app` and `*.skoolos.app` to Vercel project → verify DNS.
3. Provision Neon project (Production + Preview branches). Set `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM` in Vercel.
4. Provision Upstash Redis (Production + Preview). Set `REDIS_URL` / `UPSTASH_REDIS_REST_URL` + token.
5. Provision Cloudflare R2 bucket + API token. Set `S3_*` envs.
6. Provision Resend, verify sender domain, set `RESEND_API_KEY`.
7. Provision Inngest project, set `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
8. Provision Ably, set `ABLY_API_KEY`.
9. Stripe live keys + webhook endpoint → `https://owner.skoolos.app/api/webhooks/stripe`.
10. Add all secrets to **Production** and **Preview** Vercel envs.
11. Connect GitHub → Vercel → enable preview deploys; protect production deploys behind branch `main`.
12. Run `pnpm db:migrate` against Production once (via Vercel deploy hook running `pnpm db:migrate deploy`).
13. Run `pnpm db:seed:platform-owner` (a new minimal seed: just the platform owner, prints TOTP, no demo schools).
14. Smoke: log in at `owner.skoolos.app` → onboard test school `demo` → verify `demo.skoolos.app` resolves.
15. Backups + monitoring: Neon PITR on, Grafana Cloud alerts wired (error rate > 1%, p95 > 1s), Slack/email notification channel.
16. Scaling runbook: Neon compute autoscaling, Vercel Function regions pinned to closest to DB, Inngest concurrency limits per function.

---

## 8. Test plan summary (final gate)

| Suite | Count | Where |
| ----- | ----- | ----- |
| Phase 0 boundary | 0 violations | `pnpm boundary` |
| Phase 1 security e2e (ported) | 23 | `apps/web/test/e2e/security.spec.ts` |
| Phase 2 onboarding e2e (ported) | 8 | `apps/web/test/e2e/onboarding.spec.ts` |
| Phase 2 frontend Playwright | 18 | `apps/web/test/e2e/owner-portal.spec.ts` |
| Phase 3 backend + frontend | 42 + 12 | per-module spec + `school-admin.spec.ts` |
| Phase 4 backend + frontend | 38 + 10 | `attendance.spec.ts`, `assessments.spec.ts`, etc. |
| Phase 5 backend + frontend | 34 + 8 | `crm.spec.ts`, `finance.spec.ts` |
| Phase 6 backend + frontend | 18 + 8 | `portals.spec.ts`, `realtime.spec.ts` |
| Phase 7 OWASP + load | 20 + k6 SLO | `owasp.e2e-spec.ts` + nightly k6 |
| Service-layer unit (packages/*) | ≥ 200 | Vitest, 90% lines gate |

**Total: ~447 automated checks** before main is allowed to merge.

CI workflow (`.github/workflows/ci.yml` rewrite):

1. install + generate prisma
2. lint + typecheck + boundary
3. Vitest unit on packages (90% coverage gate)
4. Vitest integration on Route Handlers (against ephemeral Neon branch via `neonctl branches create`)
5. Playwright e2e (against the Vercel preview deployment for the PR, using `vercel deploy` to get the preview URL)
6. Inngest function tests
7. (nightly) k6 load + OWASP regression

A PR is mergeable only when all six are green. Production deploy = Vercel promote, no separate step.

---

## 9. Concrete sequencing (so you can run it as-is)

| Sprint | Focus | Definition of done |
| ------ | ----- | ------------------ |
| 1 | **Phase 0bis** — extract service layer, port to Route Handlers, replace BullMQ with Inngest, swap to Neon/Upstash/R2/Resend in dev via env. | All Phase 1 + Phase 2 backend tests green on the new transport. `apps/api` and `apps/worker` deleted. |
| 2 | Phase 2 UI + backend tails. | Wizard provisions a school visible at `<slug>.skoolos.app` on a Vercel preview. 18 Playwright tests green. |
| 3 | Phase 3 — academic structure + people CRUD + timetable. | 54 new tests green. Tenant can create class → section → enroll a student → see them in a roster. |
| 4 | Phase 4 — attendance (incl. Ably realtime) + assignments. | 28 new tests green. Realtime asserted in two-tab Playwright. |
| 5 | Phase 4 cont. — exams + marks + report-card PDF. | 20 new tests green. PDF downloadable; bytes are valid PDF. |
| 6 | Phase 5 — CRM + finance + Stripe. | 42 new tests green. Stripe test-card flow ends in PAID. |
| 7 | Phase 6 — teacher + student/parent portals + announcements. | 26 new tests green. |
| 8 | Phase 7 — OTel + Idempotency-Key + k6 + OWASP regression + per-tenant usage. | All gates green nightly. |
| 9 | Phase 8 — `docs/PRODUCTION.md` + the actual production deploy + smoke. | `owner.skoolos.app` live; demo tenant `demo.skoolos.app` live; backups proven by a restore-drill. |

---

## 10. Risks called out

- **NestJS→Route-Handler port** is the single biggest risk. Mitigated by extracting services into pure `packages/*` first (Section 0bis Step 2). If we tried to do it inline it would be ugly and slow; the package extraction makes both transports cheap.
- **Vercel Function timeouts** (10s on Hobby, 60s on Pro, 900s on Enterprise). Long jobs (CSV imports, report-card PDFs) all run inside Inngest functions, which don't share the Function timeout. The Route Handler just calls `inngest.send()` and returns 202.
- **Stripe live mode** must be the LAST thing turned on. CI uses Stripe test mode end-to-end.
- **Wildcard domain on Vercel** requires Pro plan. Document this in `docs/PRODUCTION.md`. There is no free way around it that also gives instant per-school subdomains.
- **RLS regressions** are the easiest way to break tenant isolation. The 23 Phase-1 security specs must be ported and kept green at every phase boundary — they are the canary. CI fails if any of them fails.
- **Cold starts on serverless Postgres.** Neon's serverless Postgres pauses; the first request after idle pays ~300ms. Mitigated with Neon's "always on" on production compute + a `/api/keepalive` pinged every 4 minutes by Vercel Cron.

---

## 11. What "one-shot, no error, directly deploy to Vercel" actually requires

Concretely, before a single `git push` to `main` that you'd be willing to call production:

- [ ] Section 0bis done (NestJS deleted, Route Handlers green on all ported specs).
- [ ] All `.env.example` keys covered by a Vercel project env (Production + Preview).
- [ ] All 447 automated checks green on the PR that introduces production-deploy config.
- [ ] One successful Vercel preview deploy on a real Neon Preview branch.
- [ ] `docs/PRODUCTION.md` walked top-to-bottom on a fresh laptop by someone who has not seen the repo.

When all five are checked, `vercel --prod` is a no-op promote of the last green preview. That is the bar this plan is sized for.
