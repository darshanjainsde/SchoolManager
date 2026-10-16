# Syllabus tracker — where every class has reached (2026-10-16)

Feature key `COURSE_MANAGEMENT` (in no tier; the owner switches it on per school from
`owner.sckools.com` → school → features). School-facing word: **Syllabus**, because that
is what a teacher says ("syllabus kitna ho gaya"); "course" is the website's marketing
`Course` table and is not reused.

## 0. What exists (so we add, not build)

- `Grade` + `ClassSection(academicYearId)` — the two-level class model; sections are year-bound.
- `TimetableSlot(classSectionId, subjectId, teacherId, academicYearId, effectiveFrom/To)` —
  who teaches what, where. `Substitution(date, substituteTeacherId)` — a one-day cover.
- `requireClassAccess` (register) — class teacher / any slot / today's substitute.
- `AcademicYear(isCurrent, startDate, endDate)` + `school-calendar.ts` (`workingDates`) —
  what "how much of the year has gone" means.
- `/me/*` resolves the student from the login; never from a parameter.

## 1. The rule that removes the "import" step

**Chapters belong to a GRADE + SUBJECT. Progress belongs to a CLASS SECTION.** Every
section of Class 9 teaches the same Maths chapters, this year and next; what 9-A has
reached is 9-A's alone. So a new session has nothing to import: next year's sections
see the same chapters with no progress rows. Chapters are retired, never deleted, so
old progress and notes keep their row.

## 2. Tables (migration `20261016_000000_syllabus_tracker`, expand-only, RLS `tenant_iso`)

| Table | Keys | Notes |
|---|---|---|
| `SyllabusChapter` | schoolId, gradeId, subjectId, parentId?, title, order, retiredAt | one level of sub-topics; bucket `setup` |
| `SyllabusProgress` | unique (classSectionId, chapterId); status, note, updatedById→Teacher | absent row = NOT_STARTED; bucket `day` |
| `SyllabusStudentNote` | unique (studentId, chapterId); body | private to the child; bucket `day` |

`enum SyllabusStatus { NOT_STARTED, TEACHING, DONE }`.

## 3. The arithmetic (`syllabus-stats.ts`, pure, 16 specs)

- A **leaf** is a sub-topic, or a chapter with none. A chapter with sub-topics carries no
  status of its own: DONE when all leaves are, TEACHING once any is touched.
- `pct` = done leaves ÷ leaves. `expectedPct` = working days gone ÷ working days in the
  section's year (holidays and Sundays move nobody behind).
- Pace: slip = expected − taught; ≤ 5 on pace, ≤ 15 slightly behind, else behind; no
  leaves = none.
- `now` = the leaf being taught, else the first untouched, null when all done.
- "Reached here" = every leaf before the target DONE, target TEACHING, later leaves untouched.

## 4. Doors and who marks (`syllabus-access.ts`)

| Route | Who | Notes |
|---|---|---|
| `GET /manage/syllabus/mine` | TEACHER | class-teacher sections (every subject planned or taught there) + own slots |
| `GET /manage/syllabus/overview` | SCHOOL_ADMIN | every current-year section × subject (from slots ∪ chapters) |
| `GET/PUT/POST /manage/syllabus/tracks/:cs/:subj[/progress/:ch | /reach/:ch]` | TEACHER (reads: admin too) | marking needs class teacher or a live slot for THAT subject; today's substitute reads only |
| `GET/POST/PATCH/DELETE /manage/syllabus/chapters` | TEACHER, SCHOOL_ADMIN | teacher edits a grade+subject list when they teach it in any section of the grade or hold a section of the grade |
| `GET /me/syllabus`, `GET /me/syllabus/subjects/:id`, `PUT /me/syllabus/notes/:ch` | STUDENT | own section only; a note is read by that student alone |

Every door 403s with the feature off; anonymous 401; a login with no student row 404.

## 5. Screens

- **Web console** `/app/syllabus`: dropdowns Class → Section → Subject → Teacher → Status;
  hero (two rings: taught vs expected by today) with "N of M behind"; needs-attention
  list with the gap in points; every section worst first; a row opens a read-only drawer;
  `/app/syllabus/chapters` edits the lists.
- **Teacher web** `/teacher/syllabus` cards → track page: three status buttons per leaf,
  "Reached here", class note, chapter editor.
- **Student web** `/portal/syllabus` (taught vs revised rings) → subject page with the
  teacher's note, my note, "to revise" filter.
- **App** (Expo): teacher Syllabus tile → cards → track with a bottom sheet per topic +
  add-a-chapter sheet; family Syllabus tile → subjects → note sheet. Admin is web-only.

Two rings, never three; the legend names each; numbers are ink. Revised ring is blue
(`--sk-t1` / palette `blue`), taught green, expected indigo.

## 6. Edge cases the tests are named after (`syllabus-authz.e2e-spec.ts`, 24 on the booted API)

feature off → 403 everywhere · every role on every door · a teacher with no slot/class is
403, never an empty page · admin reads, cannot mark · parent with sub-topics takes a note
but no status · reach refuses a parent / another grade's chapter · substitute reads not
marks · sibling section opens blank with the same chapters · a finished year measures
against ITS year · chapter editing rights by grade · retire keeps progress rows · a
classmate never sees my note · no section → empty home, not an error · RLS forge rejected.

## 7. Not in this build (said out loud)

Photos on notes (device-side shrink + private bucket, as pitched) · NCERT starter chapter
lists · locking a chapter list · teacher photos. The data model needs no change for any of
them.
