# Active Roster, Celebrations & Sessions — design

Approved in conversation on 2026-09-09 (decisions D1–D12 below). Three tracks that share one foundation:

- **A. Person lifecycle** — a real status on every student, teacher and staff member. "Mark as left" replaces Delete. History stays. Every roster reads active people only.
- **B. Birthdays & Celebrations** — a homepage teaser, a `/birthdays` page and a Celebrations tab in Website settings, reading active students only.
- **C. Sessions** — a year-end tab: open the next session, copy the classes, decide every child (promote · stay · pass out · leaving), start the session in one transaction, tell families, teachers and alumni.

Pitch pages (the reasoning, drawings and edge-case tables):
- Product pitch: https://claude.ai/code/artifact/617e3ed7-2d7e-4417-b5da-93683fdafdcf
- Birthday designs: https://claude.ai/code/artifact/7718bcdf-abb7-45cf-8679-8841a565ecf6

Plans: `docs/superpowers/plans/2026-09-09-active-roster-a-lifecycle.md`, `…-b-birthdays.md`, `…-c-sessions.md`. Run A first; B and C both depend on A's schema and the active-roster helper.

---

## 0. Hard boundaries

- **Revised 2026-09-09 after syncing.** `origin/main` and `origin/staging` were fast-forwarded to the same commit (78969b3). Branch `feat/active-roster` is cut from `origin/staging` in the worktree `/Users/darshanjain/Worktrees/SchoolManager-roster`. Do not work in `/Users/darshanjain/Documents/SchoolManager/SchoolManager` (stale branch, iCloud " 2" duplicates). Never diff against a local `main`/`staging` ref; fetch and compare with `origin/*` (repo `CLAUDE.md` rule 3).
- Ship order: `git push origin HEAD:staging` → verify on `raffles.test.sckools.com` (every login's password is `password`) → PR from `staging` to `main`. Staging applies migrations on push. **Production migrations are additive here (new columns with defaults, new tables), so the user runs them on production BEFORE the merge to main deploys** — old code ignores new columns; new code on an unmigrated database does not.
- Stage files by path. Never `git add -A`. The user gates every push. Run `pnpm preflight` before asking to push.
- Never touch the production Supabase project. Never seed production.
- Follow the repo's standing rules: `CLAUDE.md`, `.claude/skills/sckools-ui-taste/SKILL.md` before any UI, `docs/superpowers/LIBRARY-TRAPS.md`, the mistake ledger. Every list query carries `take: LIST_CEILING.*`; every new `ApiError` code joins the `ErrorCode` union in `common/errors/api-error.ts`; new tables get the `tenant_iso` RLS policy; reads of new tables degrade with `isSchemaMissing` until the migration lands.
- Backend stays lightweight and stateless: no in-memory plan state, no long-lived jobs. Percentages are computed on read; Start is one transaction; the scheduled start is a cron hit that re-reads status.
- Existing wings this design plugs into instead of duplicating: **Homecoming** (`modules/alumni`: `Alumni` records, `graduateBatch`, claim-link login), **Press** (`modules/press`: Transfer Certificates gated on fee dues), **Fees** (ledger balance), **Exam Hall** (the console's three-step plan UI is the pattern for the Sessions steps).
- Every roster or recipient query that lists students goes through `activeStudentsWhere()` (§2.5). A guard test enforces it.
- Copy is plain English for an Indian school office. Buttons say what happens. No emoji inside text nodes that tests assert on.
- Motion respects `animationLevel = NONE` and `prefers-reduced-motion`. Particle positions are constant tables, never `Math.random()` at render.

## 1. Decisions (all approved 2026-09-09)

| # | Decision |
|---|---|
| D1 | Student states: ACTIVE · ALUMNI · TRANSFERRED · LEFT. |
| D2 | Delete is refused once a student has any history (attendance, results, diary, library, messages). |
| D3 | Birthdays audience defaults to **Families only**. Public website is an explicit choice with a consent confirmation. |
| D4 | Photos on the wall show only for students with `photoConsent = true`. Initials coins otherwise. |
| D5 | Birthdays are part of every website. The "Active students" source needs MANAGEMENT; other tiers type a manual list. No new feature key. |
| D6 | Year-end tool ships in track C. Multi-select "Mark as left" ships in track A so a school is never stuck. |
| D7 | First designs: teasers **Cake badge** and **Ribbon**; pages **Party Wall**, **Month Planner**, **Notice Board**. |
| D8 | `/birthdays` is `noindex` by default. |
| D9 | **Revised after sync:** every leaving student's STUDENT login closes, alumni included. Alumni get the Homecoming door instead (an `Alumni` record made by the existing `graduateBatch`, and a claim link emailed as their credential) when the school has the ALUMNI feature. Children's logins are for children; the alumni wing is the adult door, and it already exists. |
| D10 | The pass mark (default 33%) only flags a child for review. It never decides. |
| D11 | Start now and Start on the session start date are both offered. |
| D12 | Alumni emails go to students with an email on record. The office gets a printable list of the rest. |

## 2. Track A — person lifecycle

### 2.1 States

```
Student:  ACTIVE ──Mark as left──▶ ALUMNI | TRANSFERRED | LEFT ──Re-admit──▶ ACTIVE
Teacher:  ACTIVE ──Remove from this school──▶ LEFT ──Reactivate──▶ ACTIVE
Staff:    same as Teacher
```

`isActive` stays on all three models as the fast boolean. It is written **only** by the lifecycle services and always equals `status === 'ACTIVE'`. Existing `isActive: true` filters keep working; new code filters on `status`.

### 2.2 Mark as left (student)

`POST /manage/students/:id/leave` with `{ status, leftOn, reason?, note?, alumniBatch? }`. One `withTenant` transaction:

1. `Student.status`, `leftOn`, `leftReason`, `leftNote`, `alumniBatch` (ALUMNI only; defaults to the current academic year's name), `statusChangedAt = now()`, `statusChangedById = actor`, `isActive = false`.
2. `classSectionId` is **kept** (last class, for history). Rosters filter on status, not on the seat.
3. Login: for every leaving status, `User.isActive = false` and every open refresh token revoked (platform client, same as `TeachersService.release`). Alumni are handed to Homecoming (§4.7), never kept on a child's login (D9, revised).
4. `AuditService.record({ action: 'student.leave', entity: 'Student', entityId, meta: { status, leftOn, reason } })`.

Before confirming, the console shows `GET /manage/students/:id/clearance` → `{ libraryIssuesOut, finesDueRupees, feeDuesRupees, unsignedRemarks, hasHistory }`. `feeDuesRupees` reads the fee ledger through the fees module's exported query service (the same balance the Press uses to gate a TC); 0 when FEES is off. Warn, never block. When PRESS is on, the dialog links to "Order a Transfer Certificate" in the Print Store after marking.

Bulk: the Students page multi-select sends one request per student (sequential, with a progress count). No bulk endpoint.

### 2.3 Re-admit

`POST /manage/students/:id/readmit` `{ classSectionId? }`: status ACTIVE, `isActive = true`, the left* fields cleared, `alumniBatch` cleared, seat set when given. `User.isActive = true` if a login exists; a new set-password invite is sent through `LoginInviteService.sendInvite` because old sessions were revoked. Audit `student.readmit`.

### 2.4 Delete guard

`DELETE /manage/students/:id` first counts `attendance`, `result`, `diaryRecipient`, `diaryAck`, `libraryIssue`, `messageThread` for the student. Any non-zero count → `409 ApiError('HAS_HISTORY', 'This student has history. Mark them as left instead.')`. The console shows Delete only when `GET /manage/students/:id/clearance` reports `hasHistory = false` (the clearance response carries this flag too).

Admission-number clash on create/update: when P2002 hits `admissionNo`, the message names the holder: `"Admission number 0421 belongs to Aarav Mehta (ALUMNI · 2025-26)"`.

### 2.5 The active filter, everywhere

`apps/api/src/modules/management/internal/roster.ts`:

```ts
export function activeStudentsWhere(schoolId: string, extra: Prisma.StudentWhereInput = {}): Prisma.StudentWhereInput {
  return { schoolId, status: 'ACTIVE', ...extra };
}
```

Every query below adopts it (file → what changes):

| File | Query | Change |
|---|---|---|
| `management/students.service.ts` `list()` | roster and full projections | default `status: 'ACTIVE'`; `status=left` → `{ in: ['ALUMNI','TRANSFERRED','LEFT'] }`; `status=all` → no filter |
| `management/attendance.service.ts:58, :379` | section roster, save validation | `activeStudentsWhere(schoolId, { classSectionId })` |
| `management/attendance-bar.service.ts:100, :233` | daily bar recipients | same |
| `management/diary.service.ts:222, :325` | recipients for ALL audience, named shortlist | same |
| `management/exams.service.ts:456` | result sheet roster | same |
| `management/messages.service.ts:59` | thread creation target | `status: 'ACTIVE'` on the `findFirst` |
| `common/notifications/recipients.ts:66, :87, :107` | push recipients | add `status: 'ACTIVE'` |
| `common/notifications/notification-inbox.ts:54` | inbox recipients | add `status: 'ACTIVE'` |
| `auth/internal/school-resolve.service.ts:52` | student-code → school | `status: { in: ['ACTIVE','ALUMNI'] }` |
| `library/internal/*` (4 sites using `isActive: true`) | unchanged; `isActive` mirrors status | none |

Guard: `internal/roster-filter.spec.ts` reads each file above and asserts every `student.findMany(` / `student.findFirst(` inside the listed function bodies carries `status` or `activeStudentsWhere`. It fails the suite when a new roster query forgets.

### 2.6 Login, the gate and the app

- Any leaving status: `User.isActive=false`; `/auth/login` answers the existing "Invalid credentials"; `/auth/refresh` answers "User no longer active".
- `school-resolve` no longer returns a school for a left child's code (`status: 'ACTIVE'` only). The app gate keeps its neutral "check your details" message for an identifier that resolves nowhere — deliberately, so the gate never says whether a code exists (an existing guard test protects this; the first draft of this spec had it wrong).
- Mobile family shelf: when a child's refresh fails with 401 "User no longer active", `family-store` marks that child `closed: true`. The shelf card shows "No longer enrolled at {school}" with a Remove button and does not try to refresh again. Siblings are untouched. An alumni child's card says "Passed out · Class of {batch}" and, when the school has the Alumni wing, "Look for the alumni link in your email".

### 2.7 Teacher: remove from this school

`GET /manage/teachers/:id/release-impact` → `{ classTeacherOf: [{ id, label }], timetableSlots: number, pendingLeave: number, featuredOnWebsite: boolean, libraryIssuesOut: number, openThreads: number }`.

`POST /manage/teachers/:id/release` `{ leftOn, reason?, note?, handover: { classSections: Record<sectionId, teacherId | null>, timetableTeacherId: string | null, keepFeatured: boolean } }`. One transaction:

1. `ClassSection.classTeacherId` per the map (null allowed).
2. Timetable slots of the teacher with `effectiveTo = null`: reassigned to `timetableTeacherId` when given, else `effectiveTo = leftOn` (they end; the timetable shows the period as unassigned).
3. Pending leave applications → `REJECTED`, `reviewedAt = now()`, reason note "Teacher left on {leftOn}".
4. `FeaturedStaff` rows linked to the teacher are deleted unless `keepFeatured`.
5. Teacher `status = LEFT`, left* fields, `isActive = false`. Login closed and sessions revoked (existing code). Audit `teacher.release`.

`POST /manage/teachers/:id/reactivate`: status ACTIVE, `isActive = true`, left* cleared, `User.isActive = true`, fresh invite. `createLogin` at another school already frees on `isActive=false`; it additionally offers Reactivate when an inactive row with the same email exists **in this school** (409 `ALREADY_HERE_INACTIVE` with the teacher id).

Staff: `POST /manage/staff/:id/release` `{ leftOn, reason?, note? }` and `/reactivate`, same fields, no handover.

### 2.8 Public site

`public-site.service` loads featured staff with `OR: [{ teacherId: null }, { teacher: { status: 'ACTIVE' } }]`. Released teachers never render.

## 3. Track B — Birthdays & Celebrations

### 3.1 Configuration

`HomepageContent.showBirthdays Boolean @default(false)` — the fifth checkbox in the Homepage tab's Sections list (label "Birthdays", detail "Who has a birthday · full page at /birthdays").

`SchoolProfile.celebrationsConfig Json?` normalised on write and read to:

```ts
interface CelebrationsConfig {
  source: 'STUDENTS' | 'MANUAL';            // STUDENTS requires MANAGEMENT
  window: 'TODAY' | 'WEEK' | 'MONTH';       // default WEEK
  nameFormat: 'FIRST' | 'FIRST_INITIAL' | 'FULL'; // default FIRST_INITIAL
  showClass: boolean;                        // default true
  showPhotos: boolean;                       // default false
  audience: 'FAMILIES' | 'PUBLIC' | 'BOTH';  // default FAMILIES
  placement: 'TEASER_AND_PAGE' | 'PAGE_ONLY';// default TEASER_AND_PAGE
  teaser: 'CAKE_BADGE' | 'RIBBON';           // default CAKE_BADGE
  page: 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD'; // default PARTY_WALL
  wishLine: string;                          // default "Happy birthday, {first name}! From all of us at {school}."
  consentConfirmed: boolean;                 // must be true to save audience PUBLIC or BOTH
  manual: { name: string; day: number; month: number; classLabel: string | null }[]; // max 500
}
```

Per student: `Student.showOnWebsite` (default true) and `Student.photoConsent` (default false), editable on the Students page and from the Celebrations tab preview.

### 3.2 Data rules

- Included: `status = ACTIVE`, `showOnWebsite = true`, `dob` not null. Manual entries when `source = MANUAL`.
- The wire shape never carries the year: `{ day, month, name, classLabel, photoUrl, key }`. `key` is a stable hash of the student id (for React keys), not the id.
- "Today" is computed in `School.timezone` with `Intl.DateTimeFormat`. 29 February shows on 28 February in a non-leap year. Sort: today first, then by upcoming date, then name.
- Window: TODAY = today; WEEK = today + 6 days; MONTH = the calendar month.
- Name: FIRST → "Aarav"; FIRST_INITIAL → "Aarav M."; FULL → "Aarav Mehta".
- `photoUrl` only when `showPhotos && photoConsent && photoAssetId`.
- The public route sends `Cache-Control: public, max-age=<seconds to the school's next midnight>`.
- Empty state: when nobody today, the teaser reads "Next: Meera, Thursday" and the page shows the coming days.

### 3.3 Surfaces

- `GET /public/birthdays?window=` (tenant host). 404 unless `showBirthdays` and audience is PUBLIC or BOTH.
- `GET /portal/birthdays?window=` (STUDENT jwt). 404 unless `showBirthdays` and audience is FAMILIES or BOTH.
- Public site projection adds `celebrations: { enabled, placement, audience, teaser, page, nameFormat, showClass, wishLine, window }` (no rows; the page fetches rows).
- Homepage teaser (`placement = TEASER_AND_PAGE`, audience PUBLIC/BOTH): Cake badge (corner pill) or Ribbon (strip under the nav). Click → `/birthdays`.
- `/birthdays` page lives under the host route like every school page: `apps/web/app/s/[host]/birthdays/page.tsx` with `revalidate = 60`, `generateStaticParams` returning `[]`, `loadSchoolSite(host)`, and `<PublicSite view="birthdays" birthdays={rows}>`. The path is added to both school-path lists in `apps/web/middleware.ts` (the rewrite list and the cacheable list). `metadata.robots = { index: false, follow: false }`.
- Nav key `birthdays` under "Our school", `has: flags.hasBirthdays`, beside the existing `alumni` key.
- Portal: `/portal/birthdays` renders the same section for signed-in families (the portal already has `nav-items.ts`; add the entry only when the API answers 200). The app card is track-2 work, not here.
- Public styling uses `.ps-*` only, `var(--ps-radius)` for corners, brand through `--ps1/--ps2/--ink/--paper`; `BirthdaysSection` is registered in `section-shape-coverage.test.ts`.

### 3.4 Privacy

Saving audience PUBLIC or BOTH requires `consentConfirmed = true`; the Celebrations tab shows the confirmation text from the pitch once. Photos need `photoConsent`. Default name format hides the surname.

## 4. Track C — Sessions

### 4.1 The plan

A `SessionPlan` is a saved draft from one academic year (`fromYearId`, the current one) to the next (`toYearId`). Statuses: `DRAFT → SCHEDULED → STARTED`, or `CANCELLED`. One non-terminal plan per school at a time. Creating a plan creates the next `AcademicYear` (not current) when it does not exist.

### 4.2 Six steps (each is a screen; each saves on its own)

1. **Next session** — name, startDate, endDate. Defaults: previous end + 1 day, + 1 year, name by pattern "2026-27".
2. **Classes** — `POST /manage/sessions/plan/structure/copy` creates in the next year one `ClassSection` per current section (same grade, same name, same class teacher when that teacher is ACTIVE). Shows the grade ladder (`Grade.order`); the admin confirms it. The default `sectionMap` is built here: each current section → the section with the same name in the next grade (by `order + 1`), else the first section of that grade; top grade → `PASS_OUT`.
3. **Decide students** — per current section, `GET /manage/sessions/plan/students?sectionId=` returns rows (§4.3). `PUT /manage/sessions/plan/decisions` upserts `{ studentId, decision, toSectionId?, leaveStatus?, leaveReason?, note? }[]`.
4. **Roll numbers** — `rollPolicy: 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO'`, applied per target section at Start.
5. **Copy the rest** — `copyTimetable`, `carryLeave` booleans; a link to Holidays.
6. **Review & start** — `GET /manage/sessions/plan/review` (§4.5). `POST /manage/sessions/plan/start` `{ when: 'NOW' | 'ON_START_DATE', version }`.

### 4.3 Decision rows

For each student with `status = ACTIVE` whose `classSectionId` is in the closing year (plus "Unplaced": ACTIVE with `classSectionId = null`):

```ts
interface SessionStudentRow {
  studentId: string; rollNo: string | null; name: string; admissionNo: string;
  attendancePct: number | null;   // PRESENT+LATE over all marks in [fromYear.startDate, fromYear.endDate]
  resultsPct: number | null;      // Σmarks / ΣmaxMarks × 100 over published results of exams in this section (filtered by countExamIds when set)
  review: boolean;                // resultsPct !== null && resultsPct < passMarkPct
  joinedSincePlan: boolean;       // Student.createdAt > plan.createdAt
  decision: 'PROMOTE' | 'STAY' | 'PASS_OUT' | 'LEAVE' | null;
  toSectionId: string | null;     // default from sectionMap for PROMOTE, same-grade next-year section for STAY
}
```

Defaults when no decision row exists: top grade → PASS_OUT, otherwise PROMOTE. Nothing is saved until the admin saves.

### 4.4 Start

Preconditions: plan `DRAFT` or `SCHEDULED`, `version` matches, every ACTIVE student in a closing section has a decision, every PROMOTE/STAY has a `toSectionId` in the next year. Unplaced students without a decision are allowed with a warning.

One `withTenant` transaction:

1. PROMOTE and STAY: `classSectionId = toSectionId`; roll numbers per `rollPolicy`.
2. PASS_OUT: the student leave transition (§2.2) with `status = ALUMNI`, `alumniBatch = fromYear.name`, `leftOn = fromYear.endDate`.
3. LEAVE: the leave transition with the row's `leaveStatus` and `leaveReason`.
4. `fromYear.isCurrent = false`, `toYear.isCurrent = true`.
5. `copyTimetable`: for every slot in the from-year with `effectiveTo = null`, create a slot in the to-year for the section with the same (grade, name), same period/day/subject, same teacher when ACTIVE; slots whose teacher has left are skipped and counted.
6. `carryLeave`: `LeavePolicyService.closeYear(from, to)`.
7. Pending `RegisterChangeRequest` rows on closing sections → `REJECTED`.
8. Each `SessionDecision` gets `fromSectionId` (snapshot) and `appliedAt`. Plan `status = STARTED`, `startedAt`, `startedById`. Audit `session.start` with the counts.

Order inside the transaction: alumni graduation (§4.7 step 2) first, then seats, then leaves, then the year flip, then copies. After commit: login closures for every PASS_OUT and LEAVE row through the platform client (as in `TeachersService.release`), then notifications and emails (§8). Fee terms and plans are per year and are not copied: the review screen links to "Set up fees for {toYear}" when FEES is on.

### 4.5 Review payload

`{ counts: { promote, stay, passOut, leave, newAdmissions, unplaced, undecided }, sectionsWithoutClassTeacher: string[], slotsSkipped: number, alumniWithoutEmail: number, libraryIssuesOut: number, version, scheduledFor }`.

### 4.6 Scheduled start

`when = 'ON_START_DATE'` sets `status = SCHEDULED`, `scheduledFor = toYear.startDate at 00:00 in School.timezone`. `GET|POST /internal/cron/session-start` (CronSecretGuard) runs `SessionsService.startDue()`: every SCHEDULED plan with `scheduledFor <= now()` is started; idempotent because `start` re-checks status inside the transaction. Vercel cron `"30 18 * * *"` (00:00 IST).

### 4.7 Alumni (revised: the Homecoming door)

PASS_OUT does two things inside Start:

1. The student leave transition with `status = ALUMNI`, `alumniBatch = fromYear.name`, `leftOn = fromYear.endDate`. The student login closes after commit like every other leave.
2. When the school has the ALUMNI feature: `AlumniService.graduateBatch(schoolId, { classSectionIds: <the closing sections with at least one PASS_OUT>, batchYear })` where `batchYear = fromYear.endDate.getUTCFullYear()`. It is the existing forward engine, idempotent on `(schoolId, studentId)`, and it runs **before** the students' seats or statuses change so it reads them as the active roster it expects. Without the feature, step 2 is skipped and the review screen says "Turn on the Alumni wing to give the Class of {year} their alumni door."

The journey-complete email, after commit, per new alumnus with an email on record (D12): `AlumniAuthService.mintClaimToken(schoolId, alumniId)` → `MailService.sendAlumniWelcome(to, schoolName, claimUrl, schoolId)` where `claimUrl = https://<school host>/alumni#claim=<token>` (the format `AlumniSection` already reads). Subject "Your journey at {school} is complete". Body: congratulations, "your alumni link is your sign-in; it works once and opens a 90-day session; ask the office for a new one any time". Failures are logged, never thrown. Alumni without an email appear in the review count and in the register's "no email" filter; the office sends their links from the Alumni page as it does today.

No alumni mode in the student portal or the family app. The alumni wing is the adult door.

### 4.8 New admissions around year end

- `GET /manage/classes?academicYearId=` filters; the default (no param) stays all sections, but rows now carry `academicYear: { id, name, isCurrent }`.
- The Add student form shows a **Session** select when more than one non-closed year exists (current + next). Default current, with the banner "Admitting for {next}? Switch the session." Classes listed are that session's.
- Students in next-year sections are "new admissions": excluded from closing-section rows and untouched by Start.
- Rows with `joinedSincePlan` are grouped under "Joined since the plan" with a one-click "Stay in grade".
- After Start, the Students page hides past-session classes unless "Show past sessions" is ticked.

### 4.9 Register

`GET /manage/sessions/:yearId/register` → decisions of the STARTED plan whose `fromYearId = yearId`, joined with names, from/to section labels, decided-by, applied-at. The page prints.

### 4.10 Edge cases (each has a test)

Final-grade fail → STAY in next-year final section. Missing grade order → step 2 blocks with "Set the grade order first". No same-name section in the next grade → first section. Student marked left mid-plan → row disappears (status filter). Class teacher LEFT → copied section has `classTeacherId = null`, flagged. Timetable slot teacher LEFT → skipped, counted. No published results → `resultsPct = null`, no review flag. Version mismatch → 409 `PLAN_CHANGED`. Undecided → 400 `UNDECIDED_STUDENTS` with the count. Cron catch-up → idempotent. Attendance and results history read by `studentId` in the portal, so seat moves never hide history.

## 5. Data model (exact)

```prisma
enum StudentStatus { ACTIVE ALUMNI TRANSFERRED LEFT }
enum StaffStatus { ACTIVE LEFT }
enum SessionPlanStatus { DRAFT SCHEDULED STARTED CANCELLED }
enum SessionDecisionKind { PROMOTE STAY PASS_OUT LEAVE }

// Student additions
status            StudentStatus @default(ACTIVE)
leftOn            DateTime?     @db.Date
leftReason        String?
leftNote          String?
alumniBatch       String?
statusChangedAt   DateTime?
statusChangedById String?       @db.Uuid
showOnWebsite     Boolean       @default(true)
photoConsent      Boolean       @default(false)
@@index([schoolId, status])

// Teacher and Staff additions
status            StaffStatus   @default(ACTIVE)
leftOn            DateTime?     @db.Date
leftReason        String?
leftNote          String?
statusChangedAt   DateTime?
statusChangedById String?       @db.Uuid
@@index([schoolId, status])

// HomepageContent addition
showBirthdays     Boolean @default(false)
// SchoolProfile addition
celebrationsConfig Json?

model SessionPlan {
  id            String            @id @default(uuid()) @db.Uuid
  schoolId      String            @db.Uuid
  fromYearId    String            @db.Uuid
  toYearId      String            @db.Uuid
  status        SessionPlanStatus @default(DRAFT)
  passMarkPct   Int               @default(33)
  countExamIds  String[]          @default([]) @db.Uuid
  sectionMap    Json              @default("{}")   // { [fromSectionId]: toSectionId | "PASS_OUT" }
  rollPolicy    String            @default("KEEP") // KEEP | ALPHABETICAL | ADMISSION_NO
  copyTimetable Boolean           @default(true)
  carryLeave    Boolean           @default(true)
  scheduledFor  DateTime?
  startedAt     DateTime?
  startedById   String?           @db.Uuid
  version       Int               @default(1)
  createdById   String            @db.Uuid
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt
  school        School            @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  fromYear      AcademicYear      @relation("PlanFrom", fields: [fromYearId], references: [id], onDelete: Cascade)
  toYear        AcademicYear      @relation("PlanTo", fields: [toYearId], references: [id], onDelete: Cascade)
  decisions     SessionDecision[]
  @@index([schoolId, status])
}

model SessionDecision {
  id            String              @id @default(uuid()) @db.Uuid
  schoolId      String              @db.Uuid
  planId        String              @db.Uuid
  studentId     String              @db.Uuid
  decision      SessionDecisionKind
  toSectionId   String?             @db.Uuid
  fromSectionId String?             @db.Uuid
  leaveStatus   StudentStatus?
  leaveReason   String?
  note          String?
  decidedById   String              @db.Uuid
  appliedAt     DateTime?
  updatedAt     DateTime            @updatedAt
  school        School              @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  plan          SessionPlan         @relation(fields: [planId], references: [id], onDelete: Cascade)
  student       Student             @relation(fields: [studentId], references: [id], onDelete: Cascade)
  @@unique([planId, studentId])
  @@index([schoolId, planId])
}
```

Migrations: `20260910090000_person_lifecycle` (A), `20260911090000_celebrations` (B), `20260912090000_session_plans` (C). C's migration enables and forces RLS with the `tenant_iso` policy on both new tables, exactly as `20260824090000_rls_coverage_gap` does; `packages/db/src/rls-coverage.spec.ts` fails otherwise.

`NOTIFICATION_KINDS` gains `'SESSION'`.

## 6. API summary

| Route | Role | Track |
|---|---|---|
| `GET /manage/students?status=active\|left\|all&classSectionId=&academicYearId=` | ADMIN (TEACHER: roster, active only) | A, C |
| `POST /manage/students/:id/leave`, `/readmit`, `GET /:id/clearance` | ADMIN | A |
| `DELETE /manage/students/:id` (409 HAS_HISTORY) | ADMIN | A |
| `PUT /manage/students/:id` accepts `showOnWebsite`, `photoConsent` | ADMIN | B |
| `GET /manage/teachers/:id/release-impact`, `POST /:id/release` (body), `POST /:id/reactivate` | ADMIN | A |
| `POST /manage/staff/:id/release`, `/reactivate` | ADMIN | A |
| `PUT /cms/homepage { showBirthdays }`, `GET/PUT /cms/celebrations`, `GET /cms/celebrations/preview` | ADMIN | B |
| `GET /public/birthdays?window=`, `GET /portal/birthdays?window=` | public / STUDENT | B |
| `GET /manage/classes?academicYearId=` | ADMIN, TEACHER | C |
| `GET /manage/sessions`, `POST /manage/sessions/plan`, `GET/PATCH /manage/sessions/plan`, `POST …/plan/structure/copy`, `GET …/plan/students?sectionId=`, `PUT …/plan/decisions`, `GET …/plan/review`, `POST …/plan/start`, `POST …/plan/cancel`, `GET /manage/sessions/:yearId/register` | ADMIN | C |
| `GET\|POST /internal/cron/session-start` | cron secret | C |
| (removed after sync) portal alumni mode — Homecoming is the alumni door | — | — |

## 7. Screens

Console screens use the `.sk-*` kit exactly as the neighbouring page does: `.sk-tabs/.sk-tab` for the status tabs, `.sk-pill[data-tone]` for status chips, `.sk-notice` (amber) for clearance warnings, `.sk-switch` for toggles, `.sk-card` + `.sk-card-h`, `.sk-tbl` inside `.sk-tblwrap`, the local `DialogShell` recipe (extracted once to `components/ui/dialog-shell.tsx` and reused by the students and staff-attendance pages that each carry a copy), and a `.sk-steps` class copied from the Exam Hall's `.sk-eh-steps` recipe for the six-step header. No literal hex; `var(--sk-*)` only. Every new screen is looked at rendered, at desktop and at ~360px, before it is called done.

- **Students** (`/app/students`): status tabs Active · Alumni & left · All; status chip and leave date on rows; row actions Mark as left… / Re-admit / Delete (Delete only when the clearance says no history); multi-select bar with Mark as left; Session select in the Add/Edit form when a next session exists; "Show past sessions" toggle on the class filter; TC link to the Print Store when PRESS is on.
- **Teachers / Staff**: "Remove from this school…" opens the impact sheet (§2.7) with the handover controls; Reactivate on inactive rows.
- **Website → Homepage**: Birthdays checkbox + placement radio. **Website → Celebrations** tab: source, window, show, audience (with the consent confirmation), teaser style, page style, wish line, this-week preview with hide switches, missing-DOB notice.
- **Sessions** (`/app/sessions`, in the People group of `app/app/nav-model.ts` after Classes, icon `CalendarRange`, MANAGEMENT): current session card, the six-step plan, the register for started sessions.
- **Public**: teaser on the homepage, `/birthdays` page under the host route. **Portal**: `/portal/birthdays`.
- **Mobile**: shelf card "No longer enrolled" / "Passed out".
- **Final audit** (its own task at the end of each track): open every new screen on staging at desktop and phone width, check hover, disabled, selected, empty, loading and error states, and fix what is off before the PR to main.

## 8. Notifications and email

- Start: `emitNotifications(kind 'SESSION')` per moved student's user: "{first name} is in Class 6A for 2026-27". Per teacher with a class-teacher or timetable assignment: "Your classes for 2026-27: 6A (class teacher), 7B, 8C". Push through the existing outbox using kind `ANNOUNCEMENT` payloads (no new outbox kind).
- `MailService.sendAlumniWelcome(to, schoolName, claimUrl, schoolId)` (§4.7) and `MailService.sendSessionStarted(to, schoolName, childName, className, sessionName, schoolId)`.

## 9. Tests and guards

- API: jest specs beside each service (txMock pattern from `students.service.spec.ts`). Every transition, every edge case in §4.10, the roster-filter guard, the RLS coverage guard.
- Web: vitest for `celebrations-config.ts`, `birthdays` date helpers mirror, `BirthdaysSection` render per style, the students status tabs, the sessions decide table (decision save, review counts).
- Mobile: family-store `closed` flag and shelf render.
- Behaviour spec (`.claude/skills/sckools-behavior-spec/`) gains the lifecycle, birthdays and sessions invariants. `pnpm preflight` green before any push.

## 10. Order

A (11 tasks) → B (7 tasks) → C (12 tasks). B and C can run in parallel after A's Task 6 (schema, roster helper, lifecycle service, routes) has merged into the branch.

## 11. Not in this project

Teacher self-service "I have left" request and owner-console force release; staff date of birth and staff birthdays; the app's birthday card and the child's own birthday screen; copying fee plans between years; the remaining teaser and page designs (Balloons, Desk calendar, Bunting, Sky Lanterns, Cake & Candles, Ruled Register). Transfer Certificates and the alumni wall already exist (Press, Homecoming) and are linked to, not rebuilt.
