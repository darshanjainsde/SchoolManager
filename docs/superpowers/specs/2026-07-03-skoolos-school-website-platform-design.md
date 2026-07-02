# SkoolOS — Multi-Tenant School Website Platform (Design Spec)

**Date:** 2026-07-03
**Status:** Approved for planning (mockups + architecture confirmed)
**Supersedes:** the existing academic-ERP build (finance, admissions, exams, attendance, assessment, report cards) — most of which is removed.

---

## 1. What we are building

A SaaS platform where **one owner operates many schools' websites** — each on its own domain — and can grant each school an increasing set of capabilities via **tiers**. Schools optionally get a **management** layer (classes, teachers, students, timetables). A cross-school **Connect** feature lets events appear on every school's public site.

The product is a **website builder + light school-management system**, not an ERP. Payments/finance, admissions pipelines, exams, attendance, and report cards are **out of scope** and are being deleted.

### Primary surfaces
1. **Public school website** — what a visitor sees at `exampleschool.com`. Modern, animated, content-driven. One branded template; each school customizes logo, colors, hero, gallery, text, staff, menu.
2. **Owner portal** — provision schools, pick a tier, toggle features, override any school's content, moderate Connect events.
3. **School admin portal** — edit own website content + (if Pro) manage classes, teachers, students, timetable, teacher availability.
4. **Student portal** — deliberately minimal (timetable + announcements). Later phase.

### Tiers (feature bundles)
| Tier | Includes |
|---|---|
| **Basic** | Public homepage, gallery, enquiry form, social links |
| **Standard** | Basic + About & Contact pages + **Connect events** |
| **Pro** | Standard + **Management** (classes, teachers, students, timetable, availability) |

Tier sets defaults; individual **feature overrides** per school are supported (e.g. a Basic school that also wants events).

---

## 2. Non-goals (explicitly removed)

- Payments, invoices, fee structures, Stripe, subscriptions-as-billing
- Admissions applications pipeline (we keep only a simple **Enquiry** capture)
- Exams, marks, grading schemes, report cards
- Attendance tracking
- Rich messaging/inbox (announcements stay minimal for the student portal only)

The corresponding Prisma models, API modules, and web routes are deleted.

---

## 3. Architecture

### 3.1 Services (kept, stripped down)
- **`apps/web`** — Next.js (App Router). Serves **all** surfaces: public sites (by domain), owner portal, school-admin portal, student portal.
- **`apps/api`** — NestJS REST API. Auth, tenancy, all business logic. Reuses existing **auth**, **tenancy**, and **domain-routing** modules; ERP modules removed.
- **`apps/worker`** — BullMQ worker for async jobs (media processing, cache revalidation fan-out, domain verification, email).
- **`packages/db`** — Prisma schema + client + migrations + RLS.
- **`packages/config`** — env loading/validation.
- **`packages/types`** — shared DTO/types.

### 3.2 Infrastructure
- **Postgres** (primary + read replica path) — system of record.
- **Redis** — hostname→school cache, page cache, feature-flag cache, rate limiting, BullMQ queues.
- **S3 / MinIO** — media (images) under per-school key prefixes.
- **PgBouncer** — connection pooling in front of Postgres.
- **CDN** — in front of the public sites.

### 3.3 Request → tenant resolution
1. Request arrives with a `Host` (or `X-Forwarded-Host`).
2. `SchoolLookupService` resolves hostname → `school_id` (Redis-cached, Postgres fallback, back-fill). Reuses existing code.
3. Tenant context (`school_id`) is stored in an async-local context for the request and pushed into Postgres as `SET app.current_school_id = <uuid>` on the pooled connection.
4. The **owner/platform** host (`owner.<domain>`) resolves to a platform context that uses a privileged DB role.

---

## 4. Multi-tenancy & isolation (core requirement)

**Model: shared database, shared schema, `school_id` on every tenant-owned row, with defense in depth.**

### 4.1 Three isolation layers
1. **Application scoping** — a tenant-aware Prisma middleware/repository guarantees every read/write is filtered by the current `school_id`. No tenant query executes without a tenant context; attempting to do so throws.
2. **Postgres Row-Level Security (RLS)** — every tenant table has a policy:
   ```sql
   USING (school_id = current_setting('app.current_school_id')::uuid)
   ```
   The API connects as role **`skoolos_app`** which is **NOT** `BYPASSRLS`. Even a buggy query cannot cross tenants. The **platform** path uses role **`skoolos_platform`** (`BYPASSRLS`) for owner-wide reads (dashboards, moderation).
3. **CI leak tests** — automated tests set tenant A's context and assert that tenant B's rows are invisible for every table and every endpoint.

### 4.2 Cross-tenant reads that ARE allowed
The **Connect** feature needs approved *network* events from other schools to appear on a school's public site. This is the one deliberate exception, expressed as an explicit RLS policy on `events`:
```sql
USING (
  school_id = current_setting('app.current_school_id')::uuid
  OR (scope = 'NETWORK' AND status = 'APPROVED')
)
```
Nothing else crosses the boundary.

### 4.3 Performance isolation (no noisy neighbors)
- Every index **leads with `school_id`**; every unique constraint is **scoped by `school_id`**.
- **PgBouncer** transaction pooling; `app.current_school_id` set per transaction.
- **Per-tenant rate limiting** in Redis (keyed by `school_id`) so one school's traffic can't starve others.
- **Per-tenant page/data caching** in Redis keyed by `school_id` (+ content version).
- **Object storage** isolated by key prefix `schools/{school_id}/…`; access via short-lived signed URLs.
- **Background jobs** carry `school_id`; heavy jobs (e.g. bulk media) run on separate queues so a big school's batch doesn't block interactive jobs.

### 4.4 Scale-out path (no redesign)
- Add Postgres **read replicas**; route public-site reads to replicas.
- If a "whale" school outgrows shared infra, its `school_id` can be **relocated to a dedicated database** behind the same `SchoolLookupService` indirection — the app already resolves a connection per tenant context, so this is a routing change, not a rewrite.

---

## 5. Data model (normalized)

Design principles: real foreign keys (no data hidden in JSON), `school_id` on every tenant row, unique constraints scoped per school, composite indexes leading with `school_id`. Media is never stored inline — always a `MediaAsset` FK.

### 5.1 Tenancy & access
- **School** — `id, name, slug, tier(BASIC|STANDARD|PRO), status(SETUP|LIVE|SUSPENDED), timezone, locale, createdAt, updatedAt`
- **Domain** — `id, schoolId, hostname (unique), type(SUBDOMAIN|CUSTOM), status(PENDING|LIVE|ERROR), isPrimary` — a school may have several; one primary.
- **FeatureOverride** — `id, schoolId, featureKey, enabled` — per-school exceptions to tier defaults. Unique `(schoolId, featureKey)`.
- **User** — `id, schoolId (NULL = platform owner), email, passwordHash, role(OWNER|SCHOOL_ADMIN|TEACHER|STUDENT), status, mfaSecret (nullable), lastLoginAt`. Unique `(schoolId, email)`.
- **RefreshToken** — rotating refresh tokens (reuse existing family/rotation design).
- **AuditLog** — `id, schoolId (nullable), actorUserId, action, entity, entityId, meta(jsonb), createdAt`.

### 5.2 Website content (CMS)
- **SchoolProfile** (1:1 School) — `logoAssetId, faviconAssetId, brandColorPrimary, brandColorSecondary, phone, email, addressLine1, addressLine2, city, region, postalCode, country, geoLat, geoLng, mapEmbedUrl`.
- **HomepageContent** (1:1 School) — `heroAssetId, headline, subheadline, aboutText, principalName, principalMessage, principalPhotoAssetId`.
- **StatItem** — `id, schoolId, label, value, order` — the hero counters (normalized, not JSON).
- **SocialLink** — `id, schoolId, platform(FACEBOOK|INSTAGRAM|YOUTUBE|X|LINKEDIN), url, order`.
- **MenuItem** — `id, schoolId, label, slug, order, parentId (nullable, self-FK), kind(CLASS|PAGE|CUSTOM), refId (nullable → Grade for CLASS)`. Default menu is generated class-wise from `Grade`; admin can rename/reorder/nest/add.
- **MediaAsset** — `id, schoolId, kind(LOGO|FAVICON|HERO|GALLERY|STAFF|EVENT|PRINCIPAL), storageKey, url, caption, order, width, height, byteSize, createdAt`. Per-school S3 prefix.
- **FeaturedStaff** — `id, schoolId, teacherId (nullable → Teacher when Pro), name, role, photoAssetId, order`. Non-Pro schools fill name/role/photo directly; Pro schools may link a real `Teacher`.

### 5.3 Management (Pro tier)
- **AcademicYear** — `id, schoolId, name, startDate, endDate, isCurrent`.
- **Grade** — `id, schoolId, name, order` — e.g. "Nursery", "Grade 5". Drives default public menu.
- **ClassSection** — `id, schoolId, gradeId, name, classTeacherId (nullable → Teacher), academicYearId`. A "class" = grade + section ("Grade 5 · A"). Unique `(schoolId, gradeId, name, academicYearId)`.
- **Subject** — `id, schoolId, name, code`. Unique `(schoolId, code)`.
- **Teacher** — `id, schoolId, userId (nullable), firstName, lastName, email, phone, photoAssetId, primarySubjectId (nullable), bio, status`.
- **TeacherSubject** — `teacherId, subjectId` — M:N qualifications.
- **Student** — `id, schoolId, admissionNo, firstName, lastName, classSectionId, rollNo, dob, gender, guardianName, guardianPhone, photoAssetId, status`. Unique `(schoolId, admissionNo)`.
- **Period** — `id, schoolId, order, label, startTime, endTime` — timetable rows.
- **TimetableSlot** — `id, schoolId, classSectionId, dayOfWeek(1–7), periodId, subjectId, teacherId, academicYearId`.
  - Unique `(schoolId, classSectionId, dayOfWeek, periodId, academicYearId)` — one subject per class/slot.
  - **Clash detection** via unique `(schoolId, teacherId, dayOfWeek, periodId, academicYearId)` — a teacher can't be double-booked.
  - **Availability view** = derived by querying, per period/day, which teachers have no slot.

### 5.4 Community
- **Event** — `id, schoolId (host), title, description, coverAssetId, startAt, endAt, venue, scope(SCHOOL|NETWORK), status(DRAFT|PENDING|APPROVED|REJECTED), createdByUserId, approvedByUserId, approvedAt`.
  - `scope=SCHOOL` → shows only on host school's site.
  - `scope=NETWORK` + `status=APPROVED` → shows on **all** schools' sites (owner-moderated). Owner can also create network events directly (auto-approved).
- **Enquiry** — `id, schoolId, parentName, phone, email, gradeInterest, message, status(NEW|CONTACTED|CLOSED), createdAt`. Fed by the public enquiry form; visible in admin.

---

## 6. Feature-flag / tier system

- `Feature` keys (constants): `PUBLIC_SITE`, `GALLERY`, `ENQUIRY`, `SOCIAL`, `ABOUT_CONTACT`, `EVENTS`, `MANAGEMENT`.
- Tier → default feature set is a static map. Effective features = tier defaults **merged with** `FeatureOverride` rows.
- Resolved feature set is **cached in Redis** per school (invalidated on tier/override change).
- **Enforcement is two-layered:** API guards reject calls to disabled features (e.g. management endpoints for a Basic school return 403); the UI hides nav/sections for disabled features. Never rely on UI alone.

---

## 7. Public site rendering & caching

- Next.js resolves **hostname → school_id** (Redis-cached lookup).
- Page data is fetched tenant-scoped; the rendered page is **cached** (Next ISR + Redis/CDN) under a key including `school_id` and a **content version** integer.
- On any content edit, the API **bumps the school's content version** and enqueues an on-demand **revalidation** so the next request re-renders. Stale content never lingers.
- Media served from CDN/S3. Images responsive & lazy-loaded.
- Target: public sites are effectively static-fast, personalized per domain, and cheap to serve at thousands of domains.

---

## 8. Auth & roles

- Roles: `OWNER` (platform, `schoolId = NULL`), `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`.
- Two JWT audiences (reuse existing): **platform** (owner, MFA/TOTP required) and **school** (tenant users).
- Owner actions on a specific school run through the platform role but are **audit-logged** with the target `school_id` ("owner override").
- Rotating refresh tokens with reuse detection (reuse existing implementation).

---

## 9. Security

- Defense-in-depth tenant isolation (§4).
- Feature-flag enforcement server-side (§6).
- Signed, short-lived URLs for media; uploads validated (type/size) and processed off the request path.
- Per-tenant + per-IP rate limiting.
- Full audit log for owner overrides and destructive actions.
- Secrets via env/config validation (reuse `packages/config`).

---

## 10. Testing strategy

- **Unit** — services (feature resolution, timetable clash detection, menu generation).
- **Integration** — API + Postgres with RLS **enabled**, asserting tenant scoping on every module.
- **Cross-tenant leak suite** — for every table/endpoint, set tenant A context, attempt tenant B access, assert empty/403.
- **E2E** — key flows: add-school wizard, content edit → public site reflects it, add teacher/student, build timetable + clash, submit event → owner approves → appears on sites, enquiry capture.
- **Load/isolation smoke** — hammer one tenant, assert others' latency unaffected (rate-limit + pooling validation).

---

## 11. Migration / cutover from current build

The product is pre-production (only seed data). Approach:
1. New Prisma schema replaces the old; ERP tables dropped. Migrations reset to a clean baseline.
2. Reuse: auth, tenancy middleware, `SchoolLookupService`, domain model for `School`/`Domain`/`User`, config, worker infra, docker-compose services.
3. Delete API modules: `finance`, `admissions`, `assessment`, `attendance`; trim `comms` to minimal announcements; rebuild `academics` as the lighter management module; add new `content`/`cms`, `events`, `enquiry`, `features` modules.
4. Rebuild web routes around the four surfaces; the public site adopts the approved animated template.

---

## 12. Rollout phases (to be expanded by the implementation plan)

1. **Foundation** — strip ERP, new normalized Prisma schema, RLS + roles, tenant middleware, feature/tier system, seed.
2. **Owner portal** — schools CRUD, add-school wizard (tiers), feature toggles/overrides, content override entry points.
3. **School-admin CMS** — profile/branding, homepage, gallery, about/contact, social, featured staff, menu editor.
4. **Management (Pro)** — grades/classes, subjects, teachers, students (mapped to class), periods, timetable builder + clash detection, availability view.
5. **Public site** — SSR by domain, all sections from the approved template, caching + on-demand revalidation, enquiry capture.
6. **Connect events** — submit → owner-moderate → cross-network display; owner-authored network events.
7. **Student portal** (later) — timetable + announcements.
8. **Cross-cutting** — media pipeline, audit log, rate limiting, full test suites, observability.

---

## 13. Open questions / assumptions

- **Announcements** for the student portal: assumed minimal (school-admin posts, students read). Confirm if teachers should post too.
- **Custom domain onboarding** stays manual (owner points DNS), matching your workflow; the app verifies and flips `Domain.status` to `LIVE`.
- **Media limits** (per-school storage caps) — assumed generous defaults, revisit if abuse appears.
