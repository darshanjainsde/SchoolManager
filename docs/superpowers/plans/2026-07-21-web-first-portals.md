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
apps/web/components/public/sections/SiteNav.tsx           (MODIFY: add themeable Login link in navbar ONLY — no hero button)
apps/web/app/app/website/design-tab.tsx                   (MODIFY: "Show Login button" toggle + label field)
apps/web/e2e/*                                             (NEW: Playwright functional tests)
playwright.config.ts                                       (NEW at apps/web root)
apps/web/app/portal/attendance/page.tsx                   (NEW)
apps/web/app/portal/results/page.tsx                       (NEW)
apps/web/app/teacher/tests/page.tsx                        (NEW)
apps/web/app/teacher/results/page.tsx                      (NEW)
apps/web/app/teacher/attendance/page.tsx                  (MODIFY: wire to new endpoint if stubbed)
```

Suggested routing: T1–T5 → general-purpose (backend). T6–T10 → general-purpose + frontend-design skill. Parallel pairs: (T2 attendance, T3 exams), (T7 student-portal, T8 teacher-portal).

---

### Task 0: Web functional-test harness (Playwright)

**Why:** `apps/web` has no test runner today (only `apps/api` uses jest). The web UI changes below need real functional coverage — rendering, customization states, navigation, and the login→portal flow. Playwright drives the actual app, which is the honest way to test a Next.js UI.

**Files:** `apps/web/playwright.config.ts` (NEW), `apps/web/e2e/helpers.ts` (NEW), `apps/web/package.json` (add `@playwright/test` devDep + `"e2e": "playwright test"` script), `apps/web/e2e/smoke.spec.ts` (NEW).

**Interfaces (later tasks consume these):**
```ts
// e2e/helpers.ts
export const HOSTS = { site: 'http://acme.localhost:3000', };
export async function loginAs(page, role: 'student'|'teacher'|'admin'): Promise<void>;
// seeded creds on localhost/staging: student SUN-2231 / Passw0rd!, teacher <email>/Passw0rd!, admin admin@acme.test/Passw0rd!
export async function apiSeedReset(): Promise<void>; // optional: hit a test-only reset if present, else no-op
```
- Config: `baseURL` from env `E2E_BASE_URL` (defaults to `http://acme.localhost:3000`), `webServer` runs `pnpm --filter @skoolos/web dev` locally; on CI/staging point `E2E_BASE_URL=https://acme.test.sckools.com`. Projects: chromium + mobile-chrome (the portals must work on phone browsers).

- [ ] Step 1: add dep + config + helpers.
- [ ] Step 2: write `smoke.spec.ts` — visits the school site, asserts the nav renders the school name.
- [ ] Step 3: `pnpm --filter @skoolos/web exec playwright install --with-deps chromium` then `pnpm --filter @skoolos/web e2e` → smoke passes.
- [ ] Step 4: Commit `test(web): Playwright functional-test harness`.

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

### Task 6: Navbar Login button (customization-compliant) + role-slider login page

**Design decision (locked):** the Login entry lives in the **navbar ONLY** — no hero/homepage button. It is a first-class **website customization option**, behaving exactly like the existing "Enquire" CTA in `SiteNav.tsx` (`Cta` component): a themeable nav item that honors the school's `navColor`, `navTextColor`, `navStyle` (CLASSIC/CENTER/GHOST) and accent, is toggleable, and has an editable label. It must not break any existing nav layout or color choice.

**Files:**
- `packages/db/prisma/schema.prisma` — add to `SchoolProfile` (near `navShowCta`/`navCtaLabel`): `navShowLogin Boolean @default(true)` and `navLoginLabel String @default("Login")`. Migration `20260721_020000_nav_login`.
- `apps/web/components/public/sections/SiteNav.tsx` — render a `Login` link beside the `Cta`, in **all three nav layouts** (CLASSIC/CENTER, and the mobile menu). Style it as the **secondary** nav action: use the existing `ps-nav-link` treatment (a subtle outline/ghost that inherits `navTextColor`), NOT `ps-accentbg` (the accent stays reserved for the primary Enquire CTA so the two don't compete). Link `href="/login"`. Respect `data.profile?.navShowLogin === false` → render nothing; label from `navLoginLabel?.trim() || 'Login'`.
- `apps/web/lib/public-api.ts` — include `navShowLogin`, `navLoginLabel` in `PublicSiteData.profile` type + the query select.
- `apps/web/app/app/website/design-tab.tsx` — add a "Show Login button" toggle + label input in the same nav section as the existing CTA controls; PUT to the profile via the existing management endpoint (add the two fields to that DTO in `apps/api`).
- `apps/web/app/login/page.tsx` — role segmented control (Student / Teacher / Admin) swapping identifier label + submit copy; student/teacher show the disabled "Continue with Google" placeholder (Task 9). Submit `{ identifier, password }` → `/auth/login`. Role-routing: STUDENT → `/portal`, TEACHER → `/teacher`, else `/app`.

**Interfaces produced:** `PublicSiteData.profile.navShowLogin: boolean`, `.navLoginLabel: string`; login page posts `{ identifier, password }` (Task 4 backend).

- [ ] **Step 1 (API test):** in `apps/api`, extend the profile-update DTO + service test — updating `navShowLogin=false` persists and the public-site read returns it. Run jest → FAIL → implement → PASS.
- [ ] **Step 2 (migration):** add fields + migration; apply to staging DB; `pnpm db:generate`.
- [ ] **Step 3 (SiteNav render):** implement the Login link across CLASSIC/CENTER + mobile menu; wire `navShowLogin`/`navLoginLabel`.
- [ ] **Step 4 (functional test — customization compliance):** `apps/web/e2e/nav-login.spec.ts`:
  ```ts
  test('login link renders in navbar and honors customization', async ({ page }) => {
    await page.goto(HOSTS.site);                                   // acme homepage
    const login = page.getByRole('link', { name: /login/i });
    await expect(login).toBeVisible();
    await expect(login).toHaveAttribute('href', /\/login$/);
    // not in the hero: only one login control on the page
    await expect(page.getByRole('link', { name: /login/i })).toHaveCount(1);
    await login.click();
    await expect(page).toHaveURL(/\/login$/);
  });
  test('login button hides when navShowLogin=false', async ({ page }) => {
    // admin toggles it off, then public site omits it
    await loginAs(page, 'admin');
    await page.goto(`${HOSTS.site}/app/website`);
    await page.getByLabel(/show login button/i).uncheck();
    await page.getByRole('button', { name: /save|publish/i }).first().click();
    await page.goto(HOSTS.site);
    await expect(page.getByRole('link', { name: /login/i })).toHaveCount(0);
  });
  ```
- [ ] **Step 5 (functional test — role routing):** `apps/web/e2e/login-roles.spec.ts` — student (SUN-2231) → lands on `/portal`; teacher → `/teacher`; admin → `/app`; each asserts a role-specific element is visible.
- [ ] **Step 6:** run `pnpm --filter @skoolos/web e2e` → all pass; `pnpm typecheck && pnpm lint`.
- [ ] **Step 7:** Commit `feat(web): navbar Login button as a website customization + role-slider login`.

**Verification of the "complies with customizations" requirement:** the two nav tests above run under the default theme; additionally assert (Step 4) that switching `navColor` to `DARK` keeps the Login link legible — extend `nav-login.spec.ts` to set `navColor=DARK` via the design tab and assert the link's computed color contrast (or simply that it remains visible and clickable). No new nav layout is introduced; the Login link reuses `ps-nav-link`, so every existing `navStyle`/`navColor`/`navTextColor` combination already covers it.

### Task 7: Student portal — attendance + results/tests

**Files:** `apps/web/app/portal/attendance/page.tsx`, `apps/web/app/portal/results/page.tsx` (NEW); extend portal nav; add portal API reads.

**Interfaces:**
- New portal endpoints: `GET /me/attendance?month=` → per-day statuses + monthly %; `GET /me/results` → published results with class average; `GET /me/exams` → upcoming tests for the student's section. (Add to `portal.controller.ts` / `portal.service.ts`, scoped to the caller's `Student.userId`.)
- Student attendance page: month calendar + %; results page: trend vs class average (small SVG) + list; overview surfaces the next test + latest result (matches the approved artifact).

- [ ] Build endpoints (jest TDD) then pages. **Functional test** `apps/web/e2e/student-portal.spec.ts`: `loginAs('student')` → Attendance tab shows a month grid and a % ; Results tab shows the published UT2 row (13/25) and the trend svg. Run `pnpm --filter @skoolos/web e2e`. Gates. Commit `feat(web): student portal attendance + results`.

### Task 8: Teacher portal — attendance, tests, results

**Files:** `apps/web/app/teacher/attendance/page.tsx` (wire to Task 2), `apps/web/app/teacher/tests/page.tsx`, `apps/web/app/teacher/results/page.tsx` (NEW); teacher nav.

**Interfaces:** consume Tasks 2 & 3. Attendance: roster with Present/Absent/Late toggles + "mark all present" + save. Tests: schedule form (class, subject, date, syllabus, max marks) → confirmation "N students & parents emailed". Results: per-student marks entry + publish.

- [ ] Build. **Functional test** `apps/web/e2e/teacher-flow.spec.ts` (the cross-role proof): `loginAs('teacher')` → mark Aarav Absent → Save → then `loginAs('student')` in a new context → Overview shows today Absent and the monthly % dropped; separately, teacher schedules a test → student Overview shows the countdown, and (locally) the reminder email appears in Mailhog. Run `pnpm --filter @skoolos/web e2e`. Gates. Commit `feat(web): teacher portal attendance, tests, results`.

### Task 9 (fast-follow, gated on user): "Continue with Google"

**Blocked-on-user:** Google Cloud OAuth Client ID + consent screen (see approved artifact). Only start once the user provides `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`.

**Files:** new `apps/api/src/modules/auth/internal/google-auth.controller.ts`; central sign-in origin `accounts.sckools.com` (Vercel domain + route) to sidestep Google's no-wildcard-origin rule; web "Continue with Google" button using Google Identity Services.

**Interfaces:** `POST /auth/google` `{ idToken }` → verify with Google, extract email, find `User` by `(schoolId, email)`, else `403 GOOGLE_NOT_LINKED` (no auto-provision). Password login stays primary.

- [ ] TDD token-verify + link-match (mock Google verify). Implement. Commit `feat(api): Google sign-in via account linking`.

### Task 10: Staging QA + prod PR

- [ ] Run the **full Playwright suite against staging**: `E2E_BASE_URL=https://acme.test.sckools.com pnpm --filter @skoolos/web e2e` — every spec (nav-login, login-roles, student-portal, teacher-flow) green on real infra.
- [ ] Merge 2A to `staging`; test.sckools.com green.
- [ ] Acceptance on `acme.test.sckools.com`: student logs in by admission-no; teacher marks attendance → student sees today Present + monthly %; teacher schedules test → student sees countdown + `[TEST]` reminder email arrives; teacher publishes results → student + parent view marks vs class avg; tenant isolation holds.
- [ ] PR `staging → main`, title "Phase 2A: web login + student/teacher portals". No merge without user approval. Prod: migrate first (Supabase Management API flow), then merge, then flag on.

---

## Self-review

- Covers artifact sections: login button (T6), role slider + admission-no (T4,T6), Google (T9), student portal attendance/results/tests/timetable (T7 + existing /portal timetable), teacher portal (T8), emails working (T5), app-independence (Global Constraints + Task interfaces are plain REST).
- `ApiError` envelope is shared with the admin-pro plan — whichever runs first creates it; the other consumes it.
- Attendance/Exam/Result built here (web) are exactly what Phase 2B (app) consumes — no rework.
