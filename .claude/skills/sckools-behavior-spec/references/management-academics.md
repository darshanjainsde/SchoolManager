# Management module (PRO) — academics behaviour

Everything here is gated by `@RequireFeature('MANAGEMENT')` → **PRO tier only** (or a per-school
override). Source: `apps/api/src/modules/management/`, `apps/api/src/modules/portal/`.

## 0. The class-access rule (used by almost everything)

`internal/class-access.ts#requireClassAccess(tx, userId, classSectionId, date)` — a TEACHER may act on a
section on a date iff **one** of:

1. they are the section's `classTeacherId`, **or**
2. they hold a timetable slot in it that is **live as of that date**
   (`effectiveFrom <= asOf AND (effectiveTo IS NULL OR effectiveTo > asOf)`), **or**
3. they are the named substitute for one of its periods **on that exact date**.

Case 3 is a **one-day grant** — this is why `date` is a parameter, not ambient. Returns the caller's
`Teacher.id` (so callers attribute the write) or throws 403 `CLASS_NOT_OWNED`. It never returns a
boolean, so a caller cannot forget to branch.

`SCHOOL_ADMIN` bypasses this everywhere.

**Where "covering" is deliberately dropped:** announcements and exams filter `covering` rows out of
`myClassSections` before checking ownership. Covering one period does not make you the class's teacher,
so it must not grant broadcast rights, exam scheduling, mark entry or publishing.

## 1. Catalog — `/manage/*`

| Entity | Route | Notes |
|---|---|---|
| Academic years | `GET|POST /manage/years` | `isCurrent` drives timetable availability defaults |
| Grades | `GET|POST|PUT|DELETE /manage/grades` | unique per `(schoolId, name)` |
| Subjects | `GET|POST|PUT|DELETE /manage/subjects` | unique per `(schoolId, code)` |
| Periods | `GET|POST|PUT|DELETE /manage/periods` | `order` unique per school; `kind` = `CLASS` or `BREAK` |
| Class sections | `GET|POST|PUT|DELETE /manage/classes` | unique `(schoolId, gradeId, name, academicYearId)`; `GET` also allowed for TEACHER |
| Working days | `GET|PUT /manage/school/working-days` | **SCHOOL_ADMIN only**; ISO weekdays, default `[1,2,3,4,5,6]` (Mon–Sat) |
| Class-note visibility | `GET|PUT /manage/school/class-note-visibility` | **SCHOOL_ADMIN only**; `ALL_TEACHERS` (default) or `SUBJECT_TEACHERS` |
| Availability | `GET /manage/availability` | teachers + periods + busy slots for the grid |

`BREAK` periods never carry a slot — `TeacherDayService` skips slot lookup for them entirely.

`GET /manage/availability` with **no current academic year** returns teachers + periods with an
**empty busy list** rather than erroring. Only `isActive` teachers are listed. "Busy" = holds an ACTIVE
(`effectiveTo IS NULL`) slot in that weekday+period.

## 2. Timetable — versioned, never edited in place

`POST /manage/timetable` (`assign`), `GET /manage/timetable` (class), `/mine`, `/my-day`,
`DELETE /manage/timetable/:id`.

Assign resolves to exactly one of four outcomes for `(classSection, dayOfWeek, period, academicYear)`:

| State | Result |
|---|---|
| No ACTIVE version | Create one, `effectiveFrom = today (IST midnight)` |
| ACTIVE exists, **identical** subject+teacher | **No-op**, returns it unchanged |
| ACTIVE exists, differs, was created **today** | **Update in place** — versioning is day-granular, and the `effectiveFrom` unique index would otherwise collide |
| ACTIVE exists, differs, created earlier | Close it (`effectiveTo = today`) and create a new ACTIVE version. **The old row is kept forever.** |

**Teacher clash** → 409 `TEACHER_CONFLICT` ("already booked in that period"), excluding the very slot
being replaced. A P2002 race after the pre-check is caught and re-mapped to the same 409 (or, if the
constraint target is unclear, a "just updated by someone else — please retry" 400).

**Reads are as-of-date.** `listForClass(schoolId, classSectionId, date?)` returns the versions active on
`date`. Reading a past date returns whatever was active back then — **this is what makes past weeks
immutable**. Everything anchors to IST midnight (`resolveAsOfDate`), never UTC.

`dayOfWeek` is ISO 1–7, Monday-first; Sunday is 7 (`getUTCDay() || 7`).

## 3. Attendance (students) — `/manage/attendance`

Roles: `TEACHER`, `SCHOOL_ADMIN`.

### `GET /manage/attendance?classSectionId&date`
One row per roster student, ordered by `admissionNo`. **An unmarked student defaults to `PRESENT`**, not
omitted — so the UI always renders the full roster.

### `GET /manage/attendance/my-classes?date=`
- `SCHOOL_ADMIN` → **every** section in the school.
- `TEACHER` → sections where they are class teacher **or** hold a slot, **plus** sections they are
  substituting on **that specific date**, flagged `covering: true`.
- A user with no `Teacher` row → `[]`.

### `GET /manage/attendance/status?date=`
Per-class `{ taken, present, total, markedBy, markedAt }`.

- `taken` = at least one `Attendance` row exists for that section+date.
- **When taken, `total` is the number of rows actually marked that day** — not the live roster count.
  A past day's "26/28" must not silently change when a student transfers in or out later.
  Only an untaken day falls back to the live roster count.
- `markedBy` resolves the earliest-surviving row's `markedById` to a teacher name, falling back to
  `'School admin'` when it doesn't resolve to a `Teacher` (an admin's raw `User.id` is stored there).
  Because `save` deletes-and-recreates, "earliest" means *the marker of the latest save*.
- Exactly **two queries** regardless of section count (matters for admins seeing every class).

### `PUT /manage/attendance` (save)

Order of enforcement — a bug report naming the wrong error usually means the wrong rule fired:

1. Section must exist → 404 `CLASS_NOT_FOUND`.
2. **Non-admin**: `requireClassAccess` → 403 `CLASS_NOT_OWNED`.
3. **Non-admin, future date** → 400 "You cannot take attendance for a future date."
4. **Non-admin, past date** → requires an `APPROVED` `RegisterChangeRequest` for that exact
   (class, date) with `expiresAt > now`. Otherwise **409 `REGISTER_LOCKED`** — "That day is closed. Ask
   your admin to reopen it from Requests."
   The query requires `status: 'APPROVED'` **explicitly**, and `expiresAt > now` **strictly** (no
   `OR expiresAt IS NULL` arm) — so a merely-filed PENDING request, or a hand-seeded APPROVED row with a
   null expiry, can never read as a permanent unlock.
5. Every `studentId` must be on that section's roster → 400 VALIDATION. (`Student` has RLS, so a
   foreign-school id can't appear in the roster set — this closes the cross-tenant write hole, since
   `Attendance` has no RLS and its unique key `(studentId, date)` is not school-scoped.)

**Write mechanics:** one `deleteMany` + one `createMany` (not N upserts). Idempotent for the same
class+date. Two teachers retaking the same class+date concurrently can race the unique index — that
surfaces as **409 "just taken by someone else — pull to refresh"**, never a 500.

**Absence emails:** after commit, `ABSENCE_NOTICE` fires only for students who became `ABSENT` in *this*
call (previous stored status ≠ ABSENT, or no row). Re-saving the same roster **never re-emails** a
guardian. De-duplication lives server-side so it holds for every client. One payload **per recipient** —
each guardian's notice names their own child.

**Retake audit:** `ATTENDANCE_RETAKE` is written only when rows were overwritten (never on a first save),
capturing previous vs current counts and markers.

`SCHOOL_ADMIN` bypasses steps 2–4 entirely — the unlock is theirs to grant in the first place.

## 4. Register change requests — `/manage/register-changes`

The lifecycle around the past-day lock.

| Route | Role | Behaviour |
|---|---|---|
| `POST /` | TEACHER | Files a request. Same class-access rule as taking the register (including substitution cover). Trimmed `reason` required. |
| `GET /mine` | TEACHER | Own requests, newest first |
| `GET /` | SCHOOL_ADMIN | PENDING only, oldest first, with requester names |
| `POST /:id/approve` \| `/:id/reject` | SCHOOL_ADMIN | |

- **One open request per (class, date)** → 409 `REGISTER_CHANGE_OPEN`.
- Re-deciding a decided request → 409 `REGISTER_CHANGE_DECIDED`.
- **Approval is the only thing that ever sets `expiresAt`**, and it is set to **end of the approving IST
  day**. The lock reasserts itself automatically — an admin never has to remember to revoke an unlock,
  and a forgotten approval cannot leave a register editable indefinitely.
- Rejection sets `expiresAt = null`.
- Both decisions write an audit entry.

## 5. Exams and results — `/manage/exams`

Roles: `TEACHER`, `SCHOOL_ADMIN`. Teacher ownership excludes `covering` sections.

| Route | Rule |
|---|---|
| `POST /manage/exams` | `maxMarks` must be a positive integer. Section must be owned. Fires `TEST_SCHEDULED` to the section's recipients. |
| `GET /manage/exams?classSectionId` | Split into `upcoming` (`scheduledAt >= now`) and `past`, each ascending |
| `GET /manage/exams/:id/results` | Prefill for the entry screen. Students with no stored mark are simply **absent from the array** |
| `PUT /manage/exams/:id/results` | Batch upsert |
| `POST /manage/exams/:id/publish` | Sets `publishedAt = now()` on **every** result for the exam |

**Ownership is resolved from the stored exam row**, never from caller input — `/results` and `/publish`
don't even accept a `classSectionId`, so a teacher cannot substitute one to bypass the check. The exam is
loaded in its own transaction *before* the ownership check (Prisma interactive transactions must not
nest — the same reason announcements and teacher-day call attendance methods outside their own
`withTenant`).

**Batch validation rejects the whole batch, writing nothing**, on either:
- a `studentId` not on the exam's section roster → 400
- a mark outside `0..maxMarks` inclusive → 400 "marks must be between 0 and N"

**Publish with zero saved results sends no notification** — `published > 0` is checked first, because
telling parents results are out when none exist would be a lie. `RESULTS_PUBLISHED` fires otherwise.

## 6. Leave and substitution — `/manage/leave`, `/manage/substitution`

| Route | Role |
|---|---|
| `POST /manage/leave` | TEACHER (own) |
| `GET /manage/leave/mine` | TEACHER |
| `GET /manage/leave` (`?status=`, default PENDING) | SCHOOL_ADMIN |
| `GET /manage/leave/coverage?from&to` | SCHOOL_ADMIN |
| `POST /manage/leave/:id/approve` \| `/reject` | SCHOOL_ADMIN |
| `POST /manage/leave/:id/cancel` | TEACHER (own) or SCHOOL_ADMIN |
| `POST /manage/substitution/:id/assign` \| `/clear` | SCHOOL_ADMIN |

**Apply:** `endDate >= startDate` or 400. A caller with no linked `Teacher` row (e.g. an admin who isn't
a teacher) gets 403 `NOT_A_TEACHER` rather than a bogus application.

**Approve** (only from PENDING; else 409 `LEAVE_NOT_PENDING`) does three things atomically:
1. Sets APPROVED with reviewer + timestamp.
2. For **every weekday** the leave spans, creates an **unfilled `Substitution` row** (a "coverage gap")
   for each of the teacher's **ACTIVE** slots (`effectiveTo IS NULL`) on that weekday.
3. For every spanned date that is **today-or-later (IST)**, marks the teacher `ON_LEAVE` in
   `StaffAttendance`.

Idempotent **by pre-check read**, not by catching P2002 — a unique violation aborts the whole Postgres
transaction, which would take the APPROVED update down with it. An existing mark is only overwritten if
it is currently `PRESENT`; a deliberate `ABSENT`/`LATE` mark is left alone.

**Cancel** — no approval step, unlike reject.
- `REJECTED` / already `CANCELLED` → 409 `LEAVE_NOT_CANCELLABLE`.
- Not your own leave and not an admin → 403 `LEAVE_CANCEL_FORBIDDEN`.
- `PENDING` → straight to CANCELLED, **no side effects**, `restoredDates: 0`.
- `APPROVED` → for each spanned date **today-or-later only** (past dates are immutable and untouched):
  deletes that teacher's `Substitution` rows for the date (covered or not — removing the override
  restores the original teacher on the recurring timetable with no further write), and clears the
  `ON_LEAVE` mark **only if it is still `ON_LEAVE`** (a hand-changed mark is left alone).
- Returns `restoredDates` = count of today-or-later dates processed.

**Assign a substitute** — the substitute must genuinely be free at that date+period:
- no ACTIVE slot of their own in the same weekday+period → 409 `TEACHER_CONFLICT`
- not already covering a different gap at that exact date+period → 409 `TEACHER_CONFLICT`

`substituteTeacherId: null` **is the uncovered-gap state**, not missing data. `clear` returns a gap to it.

**Coverage list** joins class/period/teacher names in JS (`Substitution` has no Prisma relations beyond
`School`), sorted by date then period order.

## 7. Staff attendance — `/manage/staff-attendance`

`SCHOOL_ADMIN` only. Covers **teachers and non-teaching staff together**.

- `GET ?date=` — every teacher + staff member, each with their mark, **defaulting to `PRESENT` when
  unmarked** (same convention as student attendance).
- `PUT` — upserts keyed on `one_teacher_mark_per_day` / `one_staff_mark_per_day`; idempotent.
  Roster-membership check is load-bearing (`Staff` and `StaffAttendance` have **no RLS**).
- `GET /person?kind=TEACHER|STAFF&id&month=YYYY-MM` — one person's month, for the attendance card.

Statuses: `PRESENT`, `ABSENT`, `LATE`, `ON_LEAVE`.

**`ON_LEAVE` days are excluded from BOTH sides of the percentage** — `present / (present + absent + late)`.
An approved leave must not drag someone's attendance down like an unexcused absence. A month that is
entirely `ON_LEAVE` reports **0%**, not NaN and not 100%.

## 8. Class notes and to-dos — `/manage/class-notes`, `/manage/class-todos`

Scoped to **(class, date, subject)** — deliberately *not* to the author. Two teachers sharing a
section+subject see one another's log. It is a **handover record, not a private diary**.

Read access is governed by `School.classNoteVisibility`, read fresh on **every call** (never cached), so
toggling the setting takes effect on the very next request.

**`ALL_TEACHERS` (default)** — plain class access (class teacher, live slot holder, or that day's sub).

**`SUBJECT_TEACHERS`** — one of, checked cheapest-first:
1. you are the section's **class teacher** — always, regardless of subject ("the class teacher owns the
   whole child");
2. you hold a **live slot for that section AND that subject**;
3. you are the substitute for that section on that date, **covering a period whose slot teaches that
   subject on that weekday**. The weekday pin matters: one `periodId` can teach different subjects on
   different days, so without it a Wednesday substitute could read Monday's subject notes.

`SCHOOL_ADMIN` bypasses entirely. The read check **returns a boolean** (the list endpoint filters rather
than failing), while writes throw 403 `CLASS_NOT_OWNED`.

**Writes re-run the read check against the targeted subject.** Write access is still "any teacher who
holds the class", but under `SUBJECT_TEACHERS` a teacher who holds the section but not that subject
cannot file a note under it. For mutations on existing rows, `subjectId` always comes from the **stored
row**, never caller input.

## 9. Holidays — `/manage/holidays`

`SCHOOL_ADMIN` CRUD; the same list is read by both mobile portals via `GET /me/holidays` (open to
STUDENT, TEACHER, STAFF, SCHOOL_ADMIN).

- `type` ∈ `PUBLIC | FESTIVAL | SCHOOL`, validated at the DTO **and** re-checked in the service.
- `endDate` is optional — a single-day holiday only needs `startDate`.
- **`list` returns upcoming only** (`startDate >= today IST`), ascending. The boundary is applied in the
  query, so a past holiday never leaves the database. There is no "past holidays" view by design.

## 10. Announcements — `/manage/announcements`

| Route | Roles |
|---|---|
| `GET` | SCHOOL_ADMIN |
| `POST` | SCHOOL_ADMIN, TEACHER |
| `PATCH /:id`, `DELETE /:id` | SCHOOL_ADMIN |

- `classSectionId` (legacy singular) and `classSectionIds` (multi) are **merged and de-duplicated**.
  The cap of **30 sections applies to the merged set**, so a caller can't send 30 + 1 to reach 31.
- **TEACHER must target ≥1 of their own sections** (403 `CLASS_NOT_OWNED` if they target none or target
  one they don't own). `covering` sections are excluded.
- **SCHOOL_ADMIN** may omit targets → a single whole-school row (`classSectionId: null`).
- One `Announcement` row is created **per targeted section**.
- Fan-out: per-section recipients get their own class name in the payload; whole-school recipients get
  `className: null`.

Students read announcements via `GET /me/announcements` — whole-school rows **plus** their own section's,
newest first, capped at 50.

## 11. Teacher "Today" — `GET /manage/timetable/my-day?date=`

One call answers "what is my day, and what still needs marking?". **Both web and mobile render straight
from it**, so the two surfaces cannot drift on which period is current or which register is open.

Per period it returns the period metadata, an optional `slot`, and a `register` summary.

- `BREAK` periods never get a slot.
- A user with no `Teacher` row gets the period list with every slot `null` (not an error).
- Covered periods are included, flagged `covering: true` with `coveringFor` = the original teacher's name.
- **A teacher's own slot always wins over a cover in the same period** — you cannot be in two rooms, and
  your own timetable is the stronger claim.
- `register` falls back to `{ taken: false, present: 0, total: 0, markedBy: null }` when no status exists.

## 12. Student portal API — `/me/*`

`@Roles('STUDENT')` at class level, **except** `push-token` and `holidays`, which override it to include
TEACHER, STAFF and SCHOOL_ADMIN (an override *replaces* the class list).

| Route | Behaviour |
|---|---|
| `GET /me/profile` | Own record + resolved photo URL. 404 if the login has no `Student` row |
| `GET /me/timetable` | Own section's slots; `[]` if unassigned |
| `GET /me/announcements` | Whole-school + own section, newest 50 |
| `GET /me/attendance?month=YYYY-MM` | Defaults to the current **IST** month. Half-open UTC range `[1st, 1st of next)`. `percent = 0` (never NaN) when there are no marks |
| `GET /me/exams` | Own section only, `scheduledAt >= now`. `[]` if unassigned |
| `GET /me/results` | **Published only**, newest test first, each with the class average |
| `POST /me/push-token` | Expo token upsert (any role) |
| `GET /me/holidays` | School-wide upcoming (any role) |

**Privacy mechanics for `/me/results`:** `studentId` comes from the JWT, never the client. The class
average is computed with `groupBy` + `_avg` **in the database**, so no peer's individual mark is ever
loaded into the process, let alone serialised. Unpublished results are excluded from the student's rows
**and from the average** — an in-progress marking run must not leak through the mean. A result pointing
at a foreign/deleted exam is dropped, not rendered.

**Push token cross-tenant reassignment:** `token` is globally unique but the upsert is RLS-bound to one
school. A device previously registered under a different school produces a P2002 the tenant-scoped
upsert cannot resolve. A device token is a **per-device identity, not per-tenant**, so the code
deliberately **reassigns the row to the new registrant** (last-writer-wins) using the platform client.
Erroring would strand the device on the old tenant's notifications forever.

## 13. Notifications

Five kinds, each with a typed payload (`notification.types.ts` is authoritative; adding a kind breaks
every channel's `switch` until handled): `TEST_SCHEDULED`, `TEST_REMINDER`, `RESULTS_PUBLISHED`,
`ABSENCE_NOTICE`, `ANNOUNCEMENT`.

Channels: **email** and **Expo push**. `NotificationService.notify` fans out over every configured
channel and **never throws** — a channel that rejects or returns `false` is tallied as `failed`.

**Recipient resolution limitation (by design, not a bug):** `Student` has `guardianName`/`guardianPhone`
but **no guardian email column**. The only reachable address is `User.email` via `Student.userId`.
**Students with no linked login produce no recipient and are silently skipped.**

Every payload carries a `schoolId` because `User.email` is only unique per `(schoolId, email)` — a
channel looking up by email alone (push does) would risk cross-tenant delivery without it.

Fallback strings exist so a missing row never renders `undefined` in a parent's inbox:
`'Your school'`, `'General'` (subject), `'School admin'` (marker), `'Unknown teacher'`, `'Unknown class'`.

## 14. Exam reminder cron — `/internal/cron/exam-reminders`

`@Public()` + `CronSecretGuard` (a cron has no user/school JWT). Runs **across all schools** with the
platform client; every downstream lookup is then explicitly scoped by the exam's own `schoolId`.

- Fires at **T-2 days and T-1 day**, defined as *the whole UTC calendar day* that far out — **not** a
  rolling 48h/24h window. A test at 00:05 UTC two days out is still caught by a 03:00 UTC run.
  (This is the one place that is UTC-based rather than IST.)
- **Hard cap of 200 exams per run** (the function has `maxDuration: 60`). Hitting the cap logs a loud
  warning rather than silently dropping reminders.
- Concurrency 10; one school's failure is logged and never aborts the run for the rest.

## 15. Person lifecycle — the Active Roster (students, teachers, staff)

Student also carries `dob` (date input on the console form, optional), `showOnWebsite` (default true) and
`photoConsent` (default false) — the birthday wall's per-child switches (portals-and-sites §5). Only the
update DTO accepts the two booleans; create leaves them at their defaults.

Every person carries a `status` and an `isActive` mirror (`isActive === (status === 'ACTIVE')`), written
**only** by lifecycle code: `student-lifecycle.service.ts` (`leave` / `readmit`), `teachers.service.ts`
(`release` / `reactivate`), `staff.service.ts` (same). The update DTOs no longer accept `isActive`.

- Students: `ACTIVE` · `ALUMNI` · `TRANSFERRED` · `LEFT`. Teachers and staff: `ACTIVE` · `LEFT`.
- **Every roster and recipient query lists `ACTIVE` students only** through
  `common/roster/active-students.ts#activeStudentsWhere` — attendance, the attendance bar, diary,
  result sheets, push and inbox recipients, and the student-code school lookup. A source-reading guard
  (`common/roster/roster-filter.spec.ts`) fails the suite when a listed file's `student.findMany` forgets.
  `GET /manage/students?status=active|left|all` (default `active`; teachers always get `active`).
- `POST /manage/students/:id/leave` `{ status, leftOn, reason?, note?, alumniBatch? }` — keeps the row
  and every attendance/result/diary/library row under it, keeps `classSectionId` as "last class", sets
  `leftOn`/`leftReason`/`leftNote` (`alumniBatch` defaults to the current year's name for `ALUMNI`),
  **closes the login and revokes every session for every leaving status, alumni included** (the alumni
  door is the Homecoming wing) — in the SAME tenant transaction as the row (`internal/close-login.ts`),
  so the row and its login can never disagree. `AuthService.refresh()` checks the account BEFORE the
  token row, so a closed login is refused as "User no longer active" (the app keys its shelf card on
  it), never as "reuse detected". 409 `NOT_ACTIVE` when already left. Audit `student.leave`.
- `POST /manage/students/:id/readmit` `{ classSectionId? }` — same row back to `ACTIVE`, left fields
  cleared, login reopened and a fresh set-password invite sent (old sessions were revoked). The class id is
  checked against the school (FK checks bypass RLS). 409 `ALREADY_ACTIVE`.
- `GET /manage/students/:id/clearance` — `{ libraryIssuesOut, finesDueRupees, feeDuesRupees,
  unsignedRemarks, hasHistory }`. **Warns, never blocks.** `feeDuesRupees` is DEBIT − CREDIT over the fee
  ledger, the same balance the Press reads before a TC.
- `DELETE /manage/students/:id` — refused with 409 `HAS_HISTORY` once the child has any attendance,
  result, diary, library or message row (Attendance and Result cascade on delete, so this used to wipe a
  record silently). Delete is for a wrong entry only; the console falls through to "Mark as left".
- An admission-number clash names the holder: "Admission number 0421 belongs to Aarav Mehta (alumni ·
  2025-26)".
- Teachers: `GET /manage/teachers/:id/release-impact` lists what they hold; `POST /:id/release`
  `{ leftOn, reason?, note?, handover?: { classSections, timetableTeacherId, keepFeatured } }` hands over
  class-teacher seats (named replacement or emptied), open timetable slots (reassigned — 409
  `TEACHER_CONFLICT` when the replacement already teaches at one of those times — or ended on `leftOn`),
  rejects pending leave, drops the website card unless `keepFeatured` (which UNLINKS it into a manual card,
  since the band never shows a LEFT teacher), then marks `LEFT` and closes the login. Handover ids must
  be uuids and never the leaving teacher. `POST /:id/reactivate` reopens the same row and runs the
  one-school guard (409 `ALREADY_AT_SCHOOL` if they were onboarded elsewhere meanwhile). `createLogin` answers 409
  `ALREADY_HERE_INACTIVE` when the email belongs to a LEFT row at **this** school (reactivate, don't
  duplicate) and the existing 409 `ALREADY_AT_SCHOOL` when it is ACTIVE elsewhere.
- Staff: `POST /manage/staff/:id/release` `{ leftOn, reason?, note? }` and `/:id/reactivate`; the
  librarian guard reads `isActive`, so a released librarian loses `/library` at once.
- Public site: `FeaturedStaff` rows linked to a `LEFT` teacher are never projected onto the Educators band.
- Mobile: a refresh refused with "User no longer active" marks that child `closed` on the family shelf
  (`family-store.ts#markClosed`), the app falls over to the next open sibling, and the spine reads "No
  longer enrolled at {School}" with one Remove action. A student code the school has marked as left resolves
  to no school, and the gate answers its usual neutral "check your details" — it never says why, by
  design (`login.test.tsx` protects that).

## 16. Sessions — the year end (Active Roster, Track C)

`/manage/sessions` (`sessions.service.ts`). **One open plan per school** (DRAFT or SCHEDULED; 409 `PLAN_OPEN`).
Opening a plan needs a current year (400 `NO_CURRENT_YEAR`) and creates the next `AcademicYear` with
`isCurrent=false`. The six steps: next session · classes (`POST plan/structure/copy` copies every closing
section into the next year — same grade, same name, class teacher only if still ACTIVE — and proposes the
section map: same-named section one grade up, else the first of that grade, top grade → `PASS_OUT`; refused
400 `GRADE_ORDER` when two grades share an `order`) · decide students · roll numbers · copy the rest · review.

**Decide rows** (`GET plan/students?sectionId=<closing section>|UNPLACED`) show attendance % (present+late
over marked days of the closing year) and results % (published results of the counted exams; all of the
class's exams when none of that class's ids are in `countExamIds` — the list is plan-wide and holds ids from
several classes, each class reads only its own), computed on read, never stored. `review` = results below
`passMarkPct` — **a flag, never a decision (D10)**. `joinedSincePlan` = admitted after the plan opened.
Decisions are saved per class (`PUT plan/decisions`, all rows): PROMOTE/STAY need a `toSectionId` in the
next year (400 `BAD_TARGET`), LEAVE needs `leaveStatus`; unknown or non-ACTIVE students are refused 404.
Every save bumps `plan.version`; a PATCH to the plan does too. **Promote everyone** (`POST plan/decisions/defaults`)
gives every undecided child in a mapped closing class the map's default (PROMOTE into the mapped class, PASS_OUT
from the top grade) in one `createMany` per class with `skipDuplicates` — a decided child is never touched; classes
without a map entry are named back, not guessed.

**Start** (`POST plan/start { when, version }`): 409 `PLAN_CHANGED` when the version moved; 400
`UNDECIDED_STUDENTS` while any child in a closing section has no row; 400 `BAD_TARGET` if a chosen section
was deleted meanwhile. `when: ON_START_DATE` sets SCHEDULED with `scheduledFor` = midnight of the next
year's first day in the school's timezone; `/internal/cron/session-start` (18:35 UTC) applies due plans as
the person who scheduled them. `when: NOW` is **one transaction** (`applyPlan`), **batched, never per child**
(a few dozen statements whatever the school size): the plan is CLAIMED first (a conditional update to
STARTED — a second click or the cron finds nothing open, 409 `NO_PLAN`), the passing-out CHILDREN (only
those, never a same-class child who stays) graduate through the Homecoming wing first
(`AlumniService.graduateBatchIn(tx, …, studentIds)`, only with the `ALUMNI` feature), seats move one
statement per destination class with roll numbers by `rollPolicy` (KEEP / ALPHABETICAL / ADMISSION_NO),
PASS_OUT → ALUMNI with `alumniBatch` = closing year name, LEAVE → the chosen status (the same fields Track A's
`applyStudentLeave` writes), **every leaver's login closes in the same transaction**, the current year
flips, the timetable copies per classroom (5 B's periods become next year's 5 B; only slots of ACTIVE
teachers; a period the class or the teacher already has in the new year is skipped, never doubled;
`effectiveFrom` = the earlier of today and the session's first day, so an early Start shows the timetable at
once), pending register-change requests on closing sections are REJECTED. After commit, best-effort: leave carry-forward
(`LeavePolicyService.closeYear`), `SESSION` inbox rows for every moved family and every teacher with a
copied class, then in the background the "child is in 6 A" mail per family with an address and the alumni
claim-link mail (`/alumni#claim=<token>`) per new alumnus with an email. Children with no class (unplaced)
and new admissions already seated in next-year sections are untouched by Start.

**Timetable before Start** (`POST plan/timetable/copy`): the same classroom-keyed copy Start does, run now into
the next year effective from its first day, collision-safe and idempotent; the Sessions tab then mounts the shared
`TimetableEditor` (components/timetable) over the next year's classes anchored on that day. Start copies again and
skips what exists.

**Library at the year end** (`GET plan/library`, `POST plan/library/remind`, `POST plan/library/last-due`; the
`LibraryYearEndService` the library wing exports): every open student loan with the fine so far
(`accruedFineRupees` from the school's rules, computed on read); Remind writes one `LIBRARY` bell row and one
`LIBRARY_NOTICE` push row per family with a login and mails the ones with an address; the last-due-date click
brings forward ONLY loans due after the chosen day (never a day before today), so the fine clock starts there
while already-overdue books keep their own due date. Never a condition of Start.

**After Start, who hears what:** moved families get the bell + push (`SESSION_STARTED` outbox row) + mail — "is in
6 A" for a promotion, "continues in 5 B" for a stay; teachers with a copied class get the bell. Leavers' logins are
closed, so the mail is their only channel: the alumni claim link when the ALUMNI wing is on, else the passed-out
letter; transferred/left children get the left letter. No SMS channel exists on the platform.

**Register** (`GET :yearId/register`): every decision of the STARTED plan that closed that year, with the
from/to class labels and who decided. Empty for a year never closed through a plan.

**Console**: Sessions tab (People group, MANAGEMENT); the Students page offers a Session select in the Add
form while a plan is open, groups the class filter by session and hides past sessions behind a toggle
(`GET /manage/students?academicYearId=` keeps unplaced children).

## 17. Sports wing — the desk, tournaments, results, the Book of Records, houses

`/sports/*` (`modules/sports`, feature `SPORTS`, in NO tier — override-only). **Two doors, one desk**: the admin runs
it from `/app/sports` (console tab, sidebar intact); a STAFF login with the job `Staff.role = SPORTS` lands on
`/sports` (`homeForRole`) and gets the identical sections minus Teachers. `SportsDeskGuard` passes SCHOOL_ADMIN with
every permission; STAFF only with the SPORTS job, active, and their `Staff.sportsPerms` (empty = the defaults ENTER,
VERIFY, CREATE, HOUSES); a route tagged `@SportsPerm` also needs that right (403 `SPORTS_PERM`; any other staff 403
`NOT_SPORTS_DESK`). One indexed read per request, never cached. `/sports/admin/coaches` (admin only) lists SPORTS-job
staff and sets their rights; the job itself is set on the Staff page like Librarian, offered only when the school has
the feature. Students and teachers read `/me/sports`.

**Catalogue** (`packages/types/src/sports/catalogue.ts`, ships with the app): 45 sports in eight groups, each with a
kind — MATCH (two sides, a scoreline: GAMES best-of-N to a target with win-by and cap, or SINGLE one number with a named
decider) · MEASURED (a mark: time/distance/height/points, lower- or higher-is-better, precision) · JUDGED — plus slot
minutes, lanes, venue word, categories and the rules book (summary, sections, diagram key). Team sports (`teamSize > 1`)
draw **sections** as sides (`c:<std>-<section>`), individual sports draw students (`s:<studentId>`); sides are text
keys, never FKs, so a result outlives a roster change. A school's own sport is `custom:<preset>:<teamSize>:<slug>`
(measured/judged presets are individual only).

**Settings** (`/sports/settings`, one row per school, created on first read): grouping BANDS (1–6 bands of classes,
no class in two bands, 400 `SPORTS_BAD_BANDS`) or AGE (School Games rule: "under N" = born on or after 1 January of
meetYear − N + 1; needs a date of birth); placing points (default 10-7-5-3-2-1), match win (5), class title (3);
`publishNeedsAdmin`. A tournament keeps the grouping it was created with. The class number comes from the grade name
("9", "Class 9", "Grade IX", "STD-10"; Nursery/LKG/UKG have none) with `Grade.order` as the fallback.

**Create** (`POST /sports/tournaments`, CREATE): name, first/last day (≤ 14 days), day window (default 09:00–16:00,
≥ 1 h), venues (unique names), events — each a sport, group, category (Boys/Girls/Mixed), structure CLASS (a blind
draw per class, lone entrant walks over, then a band final of the class champions; one class present → a plain draw)
or DRAW, venue indexes, entrants, optional slot minutes and lanes. **Everything is checked before the first write**:
entrants must be on the active roll, in a numbered class, and in the event's group (400 with the child's name); a
match event needs two sides (400 `SPORTS_NEED_TWO`). Then **one transaction** writes the tournament (DRAFT), venues,
events (with `structure` as it degenerated: CLASS/DRAW/HEATS/PANEL), entries, draws (standard seeding, byes to the top
of the draw, a bye's winner already placed in round 2), balanced heats by lane count (one heat = the final), and a
venue schedule: each match takes the earliest free venue, a round never starts before the previous round ends, a slot
that would overrun the day rolls to the next day's start (`atMin` = dayIdx × 1440 + minute). The reply says how many
days the plan needs; more than the meet has is a warning, not a refusal. The draw is repeatable from the meet name.

**Board** (`GET /sports/tournaments/:id`): one payload — venues, events with scoring, entries, matches, heats with
lane marks, `sideNames` — and the web derives the day board, brackets, heat sheets and the clash list with the shared
maths; while LIVE the page refetches every 15 s. **Clashes** = a student in two slots at once, or a venue holding two.
**Publish** (PUBLISH; 403 `SPORTS_PERM` when settings reserve it for the admin): DRAFT → LIVE, `published`, one
`SPORTS` bell + one `SPORTS_NOTICE` push per entered child with a login naming their earliest slot; a re-publish tells
nobody twice. **Finish** (CREATE) LIVE → DONE; **delete** DRAFT only (409 `TOURNAMENT_STATE`); **rain delay**
(`POST :id/shift`) moves every unplayed scheduled slot from a minute by a delta in one statement per table; a single
slot moves with `PATCH :id/matches/:m/slot` / `heats/:h/slot` (venue must belong to the meet).

**Results** (`POST /sports/matches/:id/score`, ENTER, LIVE only — 409 `TOURNAMENT_STATE` on a draft or a finished
meet): the body carries the match `version` the desk loaded; a stale version or a lost race on the conditional update
is 409 `MATCH_CHANGED` and the desk reloads — **never a silent overwrite**. A bye has no score (409 `MATCH_LOCKED`);
both sides must be known. Scores are judged by the sport: GAMES — each listed game complete except the last, win by
the margin, the cap ends a game, a game after the match is decided is `EXTRA_GAME`; SINGLE — one number a side, a tie
needs the decider as the second number (`TIE_DECIDER`); illegal scores 400 `BAD_SCORE` with the sport's rule in the
message. An incomplete sheet saves as it stands with no winner. A winner moves into the next slot at once; changing a
decided result is refused once the winner has played on (409 `MATCH_LOCKED`), otherwise the next slot is replaced.
Walkover names the side that turned up and clears the sheet. When the last class champion is known the **band final
builds itself** (placed after the last booked slot on the event's venues); when every heat is ranked the **final heat
builds itself** with the best `lanes` marks (a tie at the cut comes along). **Marks** (`POST /sports/heats/:id/marks`):
lane rows keep their lanes; `done` ranks the heat (ties share a rank, no mark ranks last), sends every mark that beats
the book to the record queue, tells each runner their time and place, and pays final placings.

**House points are a ledger** (`HousePoint` rows, never a total): a match win pays the winner's house, a class title
pays the champion's house, a band-stage loss pays joint third the moment the semi is saved, the final pays 1st/2nd, a
final heat pays placings; a re-scored match or re-ranked heat writes the per-house **difference** ("… (correction)")
so the table is always the sum of its rows. A section side has no house and pays nothing. Manual rows need a non-zero
number and a reason; a house with points cannot be deleted (409 `HOUSE_IN_USE`); names are unique (409 `HOUSE_EXISTS`).

**Book of Records** (`/sports/records`): a line is sport × group × category; STANDING is the holder, BROKEN rows are
history (`untilYear`), VOID rows were withdrawn with a note. **Nothing becomes a record on its own**: a meet mark that
beats the book, or a claim from practice/trial (`POST records/attempts`, ENTER), is a PENDING attempt until someone
with VERIFY approves it — the standing record becomes BROKEN, the attempt becomes the record (holder = the child's
name today), the child gets a bell + push + the reward letter by mail in the background, an audit row is written; an
attempt already decided is 409 `ATTEMPT_DECIDED`; an attempt overtaken by a better approval is rejected, never applied
backwards. Typing in the old register (`POST records`, VERIFY): with `untilYear` it is history; without, it must beat
the standing record (400 with both values) and retires it. Void restores the most recent broken holder. Comparison is
strict at the sport's precision (12.30 does not beat 12.30).

**Notifications**: kind `SPORTS` (bell), outbox kind `SPORTS_NOTICE` (push); student deep link `/portal/sports`,
teacher none. No SMS.

**The Book of Records on the website** (`GET /site/records`, `PUT /site/records`, `GET /site/records/lines` in cms;
`GET /public/records` on the school host; `SchoolProfile.recordsConfig`): the Website builder's Records tab holds the
switch, the consent tick (children's names go public — switching on without it is 400 `CONSENT_REQUIRED`; without the
SPORTS feature 400), the name format (first + initial default / first / full, applied server-side — no ids, classes or
dates of birth ever leave), the page room (Medal cabinet default · Scoreboard · Register · Progression), whether the
all-time top five shows, which groups show, and which lines the homepage picks (newest N of 4/6/8 · pinned lines in the
office's order · every record). The homepage BAND's look is a Studio band (`sectionVariants.records.layout`: Podium
tiles default · Stadium board · Trophy cabinet · Honours strip, which sits under the menu like the birthday ribbon)
and it moves in the band order like every other band. Data is the desk's, never typed twice: `SportsBookService`
(exported by the sports module) builds a line per sport × group × category from STANDING/BROKEN records (VOID never)
plus every mark from a ranked heat — one entry per person, ties share a rank, the record marked apart from the
"all-time bests" in every room. `/public/records` is 404 unless the feature, the switch and consent all hold; cached a
minute in shared caches and served stale for an hour while refreshing. The homepage shows only lines WITH a record;
the page shows every line (a line with marks but no record says so). Nav gets "Records" under Our school; `/records`
is host-routed and cache-headed like `/birthdays`.
