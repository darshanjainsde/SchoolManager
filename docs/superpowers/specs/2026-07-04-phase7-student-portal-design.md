# Phase 7 — Student Portal Design

**Status:** Approved for planning (extends the platform design spec; scope + schema decisions confirmed with the product owner 2026-07-04).

## 1. Goal

A deliberately minimal, per-student portal (spec §"Student portal — deliberately minimal"). A student logs in on their school's subdomain and sees: their weekly **timetable**, **announcements** addressed to them, and a read-only **profile**. Nothing else — no attendance, grades, or homework (those aren't in the data model).

## 2. Confirmed decisions

- **Student login provisioning:** School admins create a login for an existing student. Add a nullable, unique `userId` to `Student`; a "Create login" action on the school-admin students page creates a `STUDENT`-role `User` (with a generated temp password) and links it to the student via `Student.userId`. This mirrors how owner-created schools provision their `SCHOOL_ADMIN` (temp password via `randomBytes(8).base64url` → `PasswordService.hash`).
- **Announcements targeting:** `Announcement.classSectionId` is nullable. `null` = whole school; set = one class. A student sees school-wide announcements **plus** those for their own class.
- **Portal feature set:** timetable + announcements + read-only profile (name, class, roll no, photo).

## 3. Data model changes

- **`Student.userId String? @unique @db.Uuid`** — links a student to their login `User`. Nullable (a student may have no login yet). Unique (one login ↔ one student). No FK relation object is strictly required, but add the relation to `User` for clarity if it stays cheap.
- **New `Announcement`** — `id, schoolId, classSectionId (nullable), title, body, createdByUserId (nullable), createdAt`. RLS: `tenant_iso` (own-tenant read/write) — a student reads only their own school's announcements, filtered in the service to school-wide + own-class. Indexes: `[schoolId]`, `[schoolId, classSectionId]`.

## 4. API surface

All under the school audience (`SchoolJwtGuard`), tenant-resolved by host. Role enforcement via the existing `RolesGuard` + `@Roles(...)`.

- **School-admin (SCHOOL_ADMIN):**
  - `POST /manage/students/:id/login` → creates the linked `STUDENT` user, returns `{ email, tempPassword }`. 409 if the student already has a login. Gated `@RequireFeature('MANAGEMENT')` (student management is a Pro capability) + `@Roles('SCHOOL_ADMIN')`.
  - `GET/POST/PATCH/DELETE /manage/announcements` — announcement CRUD (school-wide or per-class). `@Roles('SCHOOL_ADMIN')`. (Not feature-gated behind MANAGEMENT — announcements are useful to any school; but a student portal only matters if students have logins, which requires MANAGEMENT. Keep announcements ungated by feature to stay simple; the portal itself only exists where admins created student logins.)
- **Student (STUDENT):** all `@Roles('STUDENT')`, resolve the caller's `Student` via `userId = req.user.sub`.
  - `GET /me/profile` → `{ firstName, lastName, admissionNo, rollNo, className, photoUrl }`.
  - `GET /me/timetable` → the student's class timetable (reuse `TimetableService.listForClass(schoolId, classSectionId)`; empty if the student has no class).
  - `GET /me/announcements` → school-wide + own-class announcements, newest first.

**Isolation invariants (unchanged from prior phases):** `schoolId` only from `TenantContextService.requireTenant()`; all tenant DB access via `withTenant`; no `getPlatformPrisma` in the student/announcement paths. A student can only ever resolve their **own** `Student` row (matched by `userId = req.user.sub` within `withTenant`), so cross-student data access is impossible.

## 5. Web surface

- **School-admin:** the existing `/app/students` page gains a "Create login" action per student (shows the temp password once). A new `/app/announcements` page: list + create (title, body, optional class target) + delete.
- **Student portal:** a new route group `/portal` (school subdomain, STUDENT login). Login reuses the existing school login flow (`/login`) — after login, role `STUDENT` lands on `/portal`. Pages: `/portal` (today's timetable + recent announcements dashboard), `/portal/timetable` (full week grid), `/portal/announcements` (list), `/portal/profile` (read-only). Uses `useApi({ audience:'school', hostHeader: useHost() })` with `hostHeader` on every call (the hard-won tenant-host rule).

## 6. Testing

E2E (`student.e2e-spec.ts`, HTTP against a running API, `DATABASE_URL_TEST` = dev DB, API booted with `DISABLE_THROTTLER=true`):
- Admin creates a student login → 201 `{email, tempPassword}`; second call → 409.
- Student logs in with the temp password → gets a STUDENT token.
- `GET /me/profile` returns that student's data (className resolved).
- `GET /me/timetable` returns the student's class slots.
- Announcement targeting: school-wide announcement visible to the student; a same-class announcement visible; a **different-class** announcement NOT visible.
- Isolation: a STUDENT token cannot hit `POST /manage/announcements` (403) or another student's data; a SCHOOL_ADMIN cannot hit `/me/*` (403, wrong role).

## 7. Out of scope (YAGNI)

Attendance, grades, homework, messaging/replies, push notifications, parent accounts, student self-editing of profile. Announcements are one-way and minimal.
