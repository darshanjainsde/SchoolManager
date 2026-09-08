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
