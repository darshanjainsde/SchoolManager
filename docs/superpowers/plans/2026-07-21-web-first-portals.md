# Web-First Portals (Phase 2A) — Login + Student/Teacher tracking on the web

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the full school product on the **web**, independent of the mobile app: a Login button on each school's public site, a role-slider login (student by admission-no or email), and student + teacher portals that do real attendance, tests, results and email reminders. The Android app (separate plan) reuses this exact backend later.

**Architecture:** Additive to the existing NestJS API + Next.js web. The `/login`, `/portal` (student), `/teacher`, `/accept-invite`, `/forgot-password` routes and live `@sckools.com` SMTP already exist. This plan adds the missing domain (Attendance, Exam, Result, plus email reminders), surfaces it in the two portals, and adds the public-site Login entry + role slider. Design reference: approved artifact "SkoolOS Web — The Whole Product".

**Tech Stack:** NestJS + Prisma (`withTenant`), Next.js 14 app router, TanStack Query v5, existing `MailService`, existing `SchoolJwtGuard`/`RolesGuard`.

## Global Constraints

- Branching: feature branches off `staging`; merge to `staging` (auto-deploys test.sckools.com). NEVER merge to `main`; NEVER `git add -A` (iCloud " 2" junk) — explicit paths only.
- Tenant data ONLY via `withTenant(schoolId, tx => …)`. Error envelope `{ code, message, field? }` (see admin-pro plan Task 1 — that `ApiError` is a dependency; if this plan runs first, build it here).
- Emails MUST keep working: reuse `MailService.send()`; on staging they arrive `[TEST]`-prefixed (Phase 0 Task 2). Sending is async/best-effort — never block a mutation on SMTP; record send state.
- Gates each task: `pnpm typecheck && pnpm lint && pnpm boundary && pnpm --filter @skoolos/api test`.
- Migrations additive only; run on staging DB before merging the code that needs them.
- **App-independence rule:** every endpoint here is a plain REST endpoint the future Expo app will also call. No web-only coupling in the API layer.

## Sequencing (the resequenced roadmap)

```
Phase 0  Staging env (test.sckools.com)                        [separate plan — in progress]
Phase 2A THIS PLAN — web login + student/teacher portals       ← ship to real schools
Phase 2  Admin Pro console (5 tabs)                            [separate plan — parallelizable]
Phase 2B Android app (Expo)                                    [after Google-account clocks; reuses 2A API]
```

The app is now a **launch event, not a blocker**. Nothing below waits on the Play Store.

## File Structure

```
packages/db/prisma/schema.prisma              (MODIFY: Attendance, Exam, Result, +Exam/Result relations)
migration 20260721_010000_attendance_exams_results
apps/api/src/modules/management/attendance.controller.ts   (NEW: teacher writes)
apps/api/src/modules/management/attendance.service.ts      (NEW)
apps/api/src/modules/management/exams.controller.ts        (NEW: schedule test, enter results)
apps/api/src/modules/management/exams.service.ts           (NEW)
apps/api/src/modules/portal/portal.controller.ts           (MODIFY: +GET me/attendance, me/results, me/exams)
apps/api/src/modules/portal/portal.service.ts              (MODIFY)
apps/api/src/modules/auth/internal/auth.service.ts:36      (MODIFY: login by admissionNo OR email)
apps/api/src/common/mail/mail.service.ts                   (MODIFY: sendTestReminder, sendResultsPublished)
apps/api/src/common/queue/*                                 (MODIFY: reminder scheduler — reuse existing queue)
apps/web/app/login/page.tsx                                (MODIFY: role slider + admissionNo field)
apps/web/components/<tenant-public-site>/…                 (MODIFY: add Login button to nav + hero)
apps/web/app/portal/attendance/page.tsx                   (NEW)
apps/web/app/portal/results/page.tsx                       (NEW)
apps/web/app/teacher/tests/page.tsx                        (NEW)
apps/web/app/teacher/results/page.tsx                      (NEW)
apps/web/app/teacher/attendance/page.tsx                  (MODIFY: wire to new endpoint if stubbed)
```

Suggested routing: T1–T5 → general-purpose (backend). T6–T10 → general-purpose + frontend-design skill. Parallel pairs: (T2 attendance, T3 exams), (T7 student-portal, T8 teacher-portal).

---

### Task 1: Domain models — Attendance, Exam, Result

**Files:** `packages/db/prisma/schema.prisma`; migration `20260721_010000_attendance_exams_results`.

**Interfaces (other tasks depend on these exact shapes):**
```prisma
enum AttendanceStatus { PRESENT ABSENT LATE }

model Attendance {
  id             String  @id @default(uuid()) @db.Uuid
  schoolId       String  @db.Uuid
  studentId      String  @db.Uuid
  classSectionId String  @db.Uuid
  date           DateTime @db.Date
  status         AttendanceStatus
  markedById     String  @db.Uuid   // Teacher.id
  createdAt      DateTime @default(now())
  school  School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  @@unique([studentId, date], name: "one_mark_per_student_day")
  @@index([schoolId, classSectionId, date])
}

model Exam {
  id             String  @id @default(uuid()) @db.Uuid
  schoolId       String  @db.Uuid
  classSectionId String  @db.Uuid
  subjectId      String  @db.Uuid
  title          String
  scheduledAt    DateTime
  syllabus       String?
  maxMarks       Int
  createdById    String  @db.Uuid
  createdAt      DateTime @default(now())
  results Result[]
  @@index([schoolId, classSectionId, scheduledAt])
}

model Result {
  id          String  @id @default(uuid()) @db.Uuid
  examId      String  @db.Uuid
  studentId   String  @db.Uuid
  marks       Float
  publishedAt DateTime?
  exam    Exam    @relation(fields: [examId], references: [id], onDelete: Cascade)
  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  @@unique([examId, studentId], name: "one_result_per_exam_student")
}
```
Add back-relations on `School`/`Student` as Prisma requires.

- [ ] Step 1: edit schema; `prisma migrate dev --name attendance_exams_results --create-only`; review SQL.
- [ ] Step 2: apply to staging DB (`migrate deploy` w/ staging DIRECT_URL), `pnpm db:generate`, gates pass.
- [ ] Step 3: Commit `feat(db): attendance, exam, result models`.

### Task 2: Attendance API (teacher writes)

**Files:** `attendance.controller.ts`, `attendance.service.ts` (NEW), extend `management.module.ts`, spec.

**Interfaces:**
- `GET /manage/attendance?classSectionId=&date=` → `{ studentId, status }[]` (existing marks for that day, defaulting PRESENT for unmarked).
- `PUT /manage/attendance` body `{ classSectionId, date, marks: { studentId, status }[] }` → upserts all in one `withTenant` tx (idempotent via `one_mark_per_student_day`); returns `{ saved: number, absentees: number }`. Guard `SchoolJwtGuard + RolesGuard('TEACHER','SCHOOL_ADMIN') + RequireFeature('MANAGEMENT')`.
- On save, enqueue absentee-parent emails (Task 5) — do not block the response.

- [ ] TDD: test upsert idempotency + absentee count. Implement. Gates. Commit `feat(api): attendance capture endpoint`.

### Task 3: Exams + Results API (schedule test, enter/publish marks)

**Files:** `exams.controller.ts`, `exams.service.ts` (NEW), DTOs, spec.

**Interfaces:**
- `POST /manage/exams` `{ classSectionId, subjectId, title, scheduledAt, syllabus?, maxMarks }` → creates Exam; enqueues "test scheduled" + reminder emails (Task 5) to that section's students/guardians only.
- `GET /manage/exams?classSectionId=` → upcoming + past.
- `PUT /manage/exams/:id/results` `{ marks: { studentId, marks }[] }` → upsert Results (unpublished); `POST /manage/exams/:id/publish` → set `publishedAt`, enqueue "results published" emails. Marks clamped `0..maxMarks` else `VALIDATION`.

- [ ] TDD each; implement; gates; Commit `feat(api): exams + results endpoints with class-scoped notifications`.

### Task 4: Login by admission number OR email

**Files:** `apps/api/src/modules/auth/internal/auth.service.ts:36` (`login`); DTO already `{ email, password }` → accept `{ identifier, password }` (keep `email` as alias for back-compat).

**Interfaces:**
- `login(schoolId, identifier, password)`: if `identifier` contains `@` → lookup by `(schoolId, email)` (existing path); else → resolve `Student` by `(schoolId, admissionNo)` case-insensitive, follow `Student.userId` to the User, then verify password. Unknown → same generic 401 (no admission-no enumeration).

- [ ] Step 1: failing test — student logs in with `SUN-2231` + password. Step 2: FAIL. Step 3: implement resolver. Step 4: pass + gates. Step 5: Commit `feat(api): login by admission number for students`.

### Task 5: Email reminders + notifications (channel-ready)

**Files:** `mail.service.ts` (+`sendTestScheduled`, `sendTestReminder`, `sendResultsPublished`, `sendAbsenceNotice`); reuse existing queue in `apps/api/src/common/queue` for scheduled sends; a small `NotificationService` wrapper so WhatsApp can slot in later.

**Interfaces:**
- `NotificationService.notify(kind, recipients, payload)` → today dispatches via `MailService` only; the interface is what the future WhatsApp channel implements. Reminder scheduling: on exam create, enqueue jobs at `scheduledAt - 2d` and `-1d` (guard against past dates). Recipients = students in the section with an email + their guardianPhone-less guardians' emails where present.
- All sends best-effort; failures recorded, never thrown (existing MailService already logs-not-throws).

- [ ] TDD the scheduler math + recipient filtering (mock queue + mail). Implement. Gates. Commit `feat(api): notification service — email reminders for tests/results/absence`.

### Task 6: Public-site Login button + role-slider login page

**Files:** the tenant public-site nav/hero component (locate via the components rendering `sunrise.sckools.com` homepage — grep for the public site layout); `apps/web/app/login/page.tsx`.

**Interfaces:**
- Public site: a `Login` button in the site header (and a secondary in the hero) → `/login`. Shown on every tenant public page; styled with the school's accent.
- Login page: a role segmented control (Student / Teacher / Admin) that swaps the identifier label (Admission no.-or-email vs Email), the submit copy, and (for student/teacher) shows the future "Continue with Google" button (disabled placeholder until Task 9). Submits `{ identifier, password }` to `/auth/login`; role-routing already exists (STUDENT → `/portal`, else `/app`; add TEACHER → `/teacher`).

- [ ] Implement; typecheck+lint; manual check on localhost (all three roles route correctly). Commit `feat(web): public-site login button + role-slider login`.

### Task 7: Student portal — attendance + results/tests

**Files:** `apps/web/app/portal/attendance/page.tsx`, `apps/web/app/portal/results/page.tsx` (NEW); extend portal nav; add portal API reads.

**Interfaces:**
- New portal endpoints: `GET /me/attendance?month=` → per-day statuses + monthly %; `GET /me/results` → published results with class average; `GET /me/exams` → upcoming tests for the student's section. (Add to `portal.controller.ts` / `portal.service.ts`, scoped to the caller's `Student.userId`.)
- Student attendance page: month calendar + %; results page: trend vs class average (small SVG) + list; overview surfaces the next test + latest result (matches the approved artifact).

- [ ] Build endpoints (TDD) then pages; gates; manual QA. Commit `feat(web): student portal attendance + results`.

### Task 8: Teacher portal — attendance, tests, results

**Files:** `apps/web/app/teacher/attendance/page.tsx` (wire to Task 2), `apps/web/app/teacher/tests/page.tsx`, `apps/web/app/teacher/results/page.tsx` (NEW); teacher nav.

**Interfaces:** consume Tasks 2 & 3. Attendance: roster with Present/Absent/Late toggles + "mark all present" + save. Tests: schedule form (class, subject, date, syllabus, max marks) → confirmation "N students & parents emailed". Results: per-student marks entry + publish.

- [ ] Build; gates; manual QA (teacher marks attendance → student portal reflects it; schedules test → student sees it + email in Mailhog locally / `[TEST]` on staging). Commit `feat(web): teacher portal attendance, tests, results`.

### Task 9 (fast-follow, gated on user): "Continue with Google"

**Blocked-on-user:** Google Cloud OAuth Client ID + consent screen (see approved artifact). Only start once the user provides `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`.

**Files:** new `apps/api/src/modules/auth/internal/google-auth.controller.ts`; central sign-in origin `accounts.sckools.com` (Vercel domain + route) to sidestep Google's no-wildcard-origin rule; web "Continue with Google" button using Google Identity Services.

**Interfaces:** `POST /auth/google` `{ idToken }` → verify with Google, extract email, find `User` by `(schoolId, email)`, else `403 GOOGLE_NOT_LINKED` (no auto-provision). Password login stays primary.

- [ ] TDD token-verify + link-match (mock Google verify). Implement. Commit `feat(api): Google sign-in via account linking`.

### Task 10: Staging QA + prod PR

- [ ] Merge 2A to `staging`; test.sckools.com green.
- [ ] Acceptance on `acme.test.sckools.com`: student logs in by admission-no; teacher marks attendance → student sees today Present + monthly %; teacher schedules test → student sees countdown + `[TEST]` reminder email arrives; teacher publishes results → student + parent view marks vs class avg; tenant isolation holds.
- [ ] PR `staging → main`, title "Phase 2A: web login + student/teacher portals". No merge without user approval. Prod: migrate first (Supabase Management API flow), then merge, then flag on.

---

## Self-review

- Covers artifact sections: login button (T6), role slider + admission-no (T4,T6), Google (T9), student portal attendance/results/tests/timetable (T7 + existing /portal timetable), teacher portal (T8), emails working (T5), app-independence (Global Constraints + Task interfaces are plain REST).
- `ApiError` envelope is shared with the admin-pro plan — whichever runs first creates it; the other consumes it.
- Attendance/Exam/Result built here (web) are exactly what Phase 2B (app) consumes — no rework.
