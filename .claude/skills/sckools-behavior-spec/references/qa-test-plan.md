# QA test plan — full scope

Hand this to a tester. Scope by **tier × role × surface**, not by screen. Every "Expected" here is the
designed behaviour; anything else is a bug (cross-check `designed-vs-bug.md` first).

## 0. Environment and fixtures

**Before anything else, confirm the tester can reach each host.** Most "it's broken" reports at this
layer are actually host/header problems.

| Need | Value |
|---|---|
| Tenant host | `<slug>.sckools.com` (prod) / `<slug>.localhost:3000` (local) |
| Platform host | `sckools.com` / `localhost:3000` |
| Owner host | `owner.sckools.com` / `owner.localhost:3000` |
| API direct calls | **must** send `X-Skoolos-Host: <the host you're pretending to be>` |

**Fixture tenants required — do not test everything on one school:**

1. A **PRO, LIVE** school with full data (the `Raffles` sample tenant serves this role; logins are all
   `password`).
2. A **BASIC, LIVE** school — proves tier gating.
3. A **STANDARD, LIVE** school — proves BLOG/EVENTS on, MANAGEMENT off.
4. A **SETUP** school — proves public-site 404 while admin login works.
5. A **SUSPENDED** school — proves deletion gating.
6. A **second PRO school** — required for every cross-tenant test.

**Accounts per PRO school:** 1 admin, ≥3 teachers (one class teacher, one subject-only teacher, one who
teaches nothing), 1 staff (non-teaching), ≥2 students with logins, ≥1 student **without** a login.

**Data:** ≥2 grades × 2 sections, ≥3 subjects, ≥6 periods incl. one `BREAK`, a full week of timetable,
a current academic year, some past attendance, ≥1 exam with saved-but-unpublished results.

## 1. Auth and session

| # | Test | Expected |
|---|---|---|
| A1 | Login by email | Success; lands per role (see A6) |
| A2 | Login by username | Success (case-insensitive) |
| A3 | Login by admission number | Success (case-insensitive), student portal |
| A4 | Wrong password ×5, then a **6th** attempt (even with the correct password) | Attempts 1–5 all return **401** "Invalid credentials" (the 5th sets the lock but still 401). The **6th** returns **403 "Account temporarily locked"** — the `lockedUntil` check runs before password verification. Lock lasts 15 min |
| A5 | Unknown email vs known email + wrong password | **Identical** 401 message — no enumeration |
| A6 | Role routing | STUDENT→`/portal`, TEACHER→`/teacher`, SCHOOL_ADMIN→`/app`, **STAFF→bounced with a toast, tokens cleared** |
| A7 | Pick "Teacher" tab, log in with a student account | Lands on `/portal` — the API's role wins, not the tab |
| A8 | Idle 15 min, then act | Silent refresh, no logout |
| A9 | Replay an already-used refresh token | 401 **and the whole token family is revoked** — every session on that family dies |
| A10 | Logout, then reuse the old refresh token | 401 |
| A11 | Inactive user (`isActive: false`) logs in | 401 |
| A12 | Forgot password → link → reset | Works once; second use of the same link fails; link expires at 30 min |
| A13 | Deactivate a user mid-session, then refresh | 401 "User no longer active" |

### Cross-tenant (highest severity — any failure is critical)

| # | Test | Expected |
|---|---|---|
| A14 | Log into school A, replay the access token against school B's host | **401** "Token does not match this tenant" |
| A15 | As A's teacher, call a `/manage/*` endpoint with B's `classSectionId` | 403 `CLASS_NOT_OWNED` or 404 — **never** B's data |
| A16 | As A's admin, save attendance for a B student id | 400 VALIDATION, nothing written |
| A17 | As A's teacher, `GET /manage/exams/:id/results` with B's examId | 404 |
| A18 | As A's student, `GET /me/results` | Only own marks; averages present; no peer marks anywhere in the payload |

## 2. Tier and feature gating

| # | Test | Expected |
|---|---|---|
| F1 | BASIC school admin opens `/app` | Only Dashboard, Website, **Enquiries**, Announcements visible (BASIC has `ENQUIRY`) |
| F2 | BASIC school, `GET /manage/students` directly | **403** `Feature MANAGEMENT not enabled` |
| F3 | STANDARD school | Blog + Events + Enquiries visible; Management items hidden and 403 |
| F4 | BASIC school, `GET /public/blog` | **404** (not 403) |
| F5 | Owner enables `MANAGEMENT` override on a BASIC school | Works immediately (cache invalidated); re-verify after 5 min |
| F6 | Owner disables `BLOG` on a PRO school | Blog nav gone, `/cms/blog/*` 403, `/public/blog` 404 |
| F7 | Slow `/auth/me` (throttle network) | **All** nav items show until it resolves, then filter — not a bug |

## 3. Catalog and timetable (PRO)

| # | Test | Expected |
|---|---|---|
| T1 | Create year / grade / subject / period / section | Created; duplicates rejected on their unique keys |
| T2 | Assign a slot | Created with `effectiveFrom` = today IST |
| T3 | Re-assign the **same** subject+teacher | No-op, no new version |
| T4 | Change a slot **created today** | Updated **in place** — still one version |
| T5 | Change a slot created **on an earlier day** | Old row closed (`effectiveTo` = today), new ACTIVE row created |
| T6 | After T5, read the timetable for **last week** | Shows the **old** teacher/subject — past weeks are immutable |
| T7 | Assign a teacher already booked that weekday+period | 409 `TEACHER_CONFLICT` |
| T8 | `GET /manage/availability` on a school with no current year | Teachers + periods, **empty busy list** — not an error |
| T9 | Availability listing | Only `isActive` teachers |
| T10 | A `BREAK` period on Today | Rendered as a break, never carrying a slot |

## 4. Attendance and the register lock (PRO) — the core loop

| # | Test | Expected |
|---|---|---|
| R1 | Teacher opens today's register | Full roster, every unmarked student pre-set to **PRESENT** |
| R2 | Mark and save | `saved` = roster size, `absentees` correct |
| R3 | Save the same day again | Idempotent — no duplicate rows |
| R4 | Teacher saves for **tomorrow** | 400 "You cannot take attendance for a future date." |
| R5 | Teacher saves for **yesterday** | **409 `REGISTER_LOCKED`** with the "Ask your admin to reopen it" message |
| R6 | **Admin** saves for yesterday | Succeeds — admin bypasses the lock |
| R7 | Teacher files a register-change request | Created PENDING |
| R8 | File a **second** request for the same class+date | 409 `REGISTER_CHANGE_OPEN` |
| R9 | Admin approves it; teacher retries the past-day save | Succeeds |
| R10 | Wait past **end of the approving IST day**, retry | **409 `REGISTER_LOCKED` again** — the unlock self-expires |
| R11 | Admin rejects a request; teacher retries | 409 `REGISTER_LOCKED` |
| R12 | Admin approves an already-decided request | 409 `REGISTER_CHANGE_DECIDED` |
| R13 | Teacher B (no relation to the class) saves it | 403 `CLASS_NOT_OWNED` |
| R14 | Teacher B is that day's **substitute**, saves it | **Succeeds** |
| R15 | Same substitute tries the **next** day | 403 — a substitution is a one-day grant |
| R16 | Mark a student ABSENT, save | Guardian gets one `ABSENCE_NOTICE` |
| R17 | Save the **same** roster again unchanged | **No second email** |
| R18 | Change the student to PRESENT, save, then back to ABSENT, save | A new email — they became absent again |
| R19 | Student has **no linked login** and is marked absent | No email, no error — silently skipped |
| R20 | Two teachers retake the same class+date simultaneously | One wins; loser gets **409 "just taken by someone else — pull to refresh"**, not a 500 |
| R21 | After a retake, check `AuditLog` | An `ATTENDANCE_RETAKE` row with previous vs current counts |
| R22 | First-ever save of a day | **No** `ATTENDANCE_RETAKE` row (only the generic audit row) |
| R23 | Take a day, then transfer a student out, then re-open `/status` for that past day | `total` still shows what was **marked that day**, not the new roster size |
| R24 | Admin marks a register, then check `markedBy` | `'School admin'` (admins have no Teacher row) |

## 5. Exams and results (PRO)

| # | Test | Expected |
|---|---|---|
| E1 | Teacher schedules an exam for an owned class | Created; `TEST_SCHEDULED` fans out |
| E2 | Teacher schedules for a class they only **cover** as a substitute | 403 `CLASS_NOT_OWNED` |
| E3 | `maxMarks` = 0 or negative or non-integer | 400 |
| E4 | Enter marks; include one student from another section | **Whole batch rejected**, nothing written |
| E5 | Enter a mark above `maxMarks` | Whole batch rejected, 400 "marks must be between 0 and N" |
| E6 | Re-open the results screen | Prefilled with saved marks (students with none are absent from the array) |
| E7 | Student checks `/portal/results` before publish | Exam **not listed** |
| E8 | Publish; student re-checks | Listed, with own marks + class average |
| E9 | Publish an exam with **zero** saved results | `published: 0` and **no notification sent** |
| E10 | Class average after publish | Excludes any still-unpublished result rows |
| E11 | Teacher B publishes another teacher's exam | 403 |
| E12 | Exam list | `upcoming` / `past` split on `scheduledAt >= now`, each ascending |

## 6. Leave and substitution (PRO)

| # | Test | Expected |
|---|---|---|
| L1 | Teacher applies for 3 days | PENDING |
| L2 | `endDate` before `startDate` | 400 |
| L3 | Admin (not a teacher) applies | 403 `NOT_A_TEACHER` |
| L4 | Admin approves | APPROVED; a `Substitution` **gap per active slot per weekday** in range; teacher marked `ON_LEAVE` for today-or-later dates |
| L5 | Approve an already-approved application | 409 `LEAVE_NOT_PENDING` |
| L6 | Two overlapping approved leaves | No duplicate gaps for the shared dates |
| L7 | Assign a substitute who is free | Assigned |
| L8 | Assign one who has their own class that period | 409 `TEACHER_CONFLICT` |
| L9 | Assign one already covering another gap that period | 409 `TEACHER_CONFLICT` |
| L10 | The substitute opens **Today** on the covered date | Sees the class, flagged as covering, with the original teacher's name |
| L11 | Substitute tries to post an **announcement** to that class | 403 — covering ≠ owning |
| L12 | Teacher cancels their own PENDING leave | CANCELLED, `restoredDates: 0`, no side effects |
| L13 | Teacher cancels an APPROVED leave spanning past **and** future dates | Future gaps + `ON_LEAVE` marks removed; **past dates untouched**; `restoredDates` counts only today-or-later |
| L14 | Cancel an APPROVED leave where a day's mark was hand-changed to ABSENT | That mark is **left alone** |
| L15 | Teacher cancels **another** teacher's leave | 403 `LEAVE_CANCEL_FORBIDDEN` |
| L16 | Cancel an already-REJECTED application | 409 `LEAVE_NOT_CANCELLABLE` |
| L17 | Clear a substitute | `substituteTeacherId` back to `null` = uncovered gap |

## 7. Staff attendance (PRO, admin only)

| # | Test | Expected |
|---|---|---|
| S1 | Open the day | Teachers **and** non-teaching staff, all defaulting to PRESENT |
| S2 | Save, re-save | Idempotent |
| S3 | Save with a foreign school's teacherId | 400 |
| S4 | Person card for a month with 10 present, 2 absent, 5 on leave | **83%** — `10/(10+2)`; leave excluded from both sides |
| S5 | A month that is entirely `ON_LEAVE` | **0%**, not NaN, not 100% |
| S6 | Teacher tries `/manage/staff-attendance` | 403 |

## 8. Class notes and to-dos (PRO)

Run this suite **twice** — once with `classNoteVisibility: ALL_TEACHERS`, once with `SUBJECT_TEACHERS`.

| # | Test | Expected (ALL_TEACHERS) | Expected (SUBJECT_TEACHERS) |
|---|---|---|---|
| N1 | Class teacher reads any subject's notes | ✅ | ✅ (class teacher always) |
| N2 | Subject teacher reads their own subject | ✅ | ✅ |
| N3 | Teacher who holds the section but **not** that subject | ✅ | **❌ filtered out of the list** |
| N4 | Same teacher tries to **write** a note under that subject | ✅ | **403** |
| N5 | Substitute covering Wednesday P3 reads that subject's notes | ✅ | ✅ |
| N6 | Same substitute passes **Monday's** subject for P3 | ✅ | **❌** — the weekday pin blocks it |
| N7 | Co-teacher of the same section+subject | Sees the other's notes (handover record, not private) | Same |
| N8 | Toggle the setting, then immediately re-read | Takes effect on the **very next request** — never cached |
| N9 | Empty/whitespace note body | 400 "A note cannot be empty." |

## 9. Holidays and announcements

| # | Test | Expected |
|---|---|---|
| H1 | Admin adds a future holiday | Appears for teachers and students |
| H2 | Admin adds a **past** holiday | **Not listed anywhere** — `list` returns upcoming only, by design |
| H3 | Single-day holiday (no `endDate`) | Accepted |
| H4 | Invalid `type` | 400 (must be PUBLIC/FESTIVAL/SCHOOL) |
| H5 | Teacher/student/staff call `GET /me/holidays` | All succeed — not STUDENT-only |
| N10 | Admin posts with no target | One whole-school announcement |
| N11 | Teacher posts with no target | **403** — teachers must target ≥1 owned section |
| N12 | Teacher targets a section they only cover | 403 |
| N13 | Post to 3 sections | 3 rows created; each recipient's email names **their own** class |
| N14 | Send `classSectionId` + 30 in `classSectionIds` | 400 — the 30 cap applies to the **merged** set |
| N15 | Student view | Whole-school + own section only, newest 50 |

## 10. Student portal & mobile

| # | Test | Expected |
|---|---|---|
| P1 | Student with no section | Timetable `[]`, exams `[]` — not errors |
| P2 | Brand-new school, student attendance | `percent: 0`, not NaN |
| P3 | `?month=2026-02` | That month only; half-open range, no boundary double-count |
| P4 | Invalid month (`2026-13`, `abc`) | 400 |
| P5 | No `month` param at 23:00 IST on the last day of the month | Uses the **IST** month, not UTC |
| M1 | Mark a full class **in airplane mode** | Queued locally, UI confirms |
| M2 | Restore network, flush | Synced; classified `synced` |
| M3 | Flush a queued save for a now-locked day | `rejected`, server message shown verbatim |
| M4 | Queue a 40-student roster | Survives (chunked across SecureStore keys) |
| M5 | Try to queue notes/todos/leave offline | **Fails loudly** — attendance only, by design |
| M6 | Log in as OWNER on mobile | Falls back to login/connect; **never** a blank stuck screen |
| M7 | Log in as STAFF on mobile | Reaches the staff tabs (unlike web, which bounces) |
| M8 | Same device logs in under school A then school B | Push token **reassigns** to B; A stops receiving |
| M9 | Dark mode: system / light / dark | All three honoured |
| M10 | Logout | Server-side session actually ends |

## 11. Public site, CMS, blog

| # | Test | Expected |
|---|---|---|
| W1 | `SETUP` school's public URL | **404**, but its admin can still log in and edit |
| W2 | Owner sets it `LIVE` | Site serves |
| W3 | `SUSPENDED` school's public URL | 404 |
| W4 | Toggle off Gallery on the homepage | Gone from `/`, **still present at `/gallery`** |
| W5 | Change hero layout | Legacy `heroStyle` stays in sync |
| W6 | Upload >5 hero images | Capped at 5; slot 1 mirrors `heroAssetId` |
| W7 | `showFeesPublicly: false` | Fees hidden on the public site |
| W8 | Submit a public enquiry | Lands in `/app/enquiries` |
| B1 | School publishes a post | Live on `<school>/blog`, canonical = **its own** host |
| B2 | Submit for global; owner approves | Canonical flips to the **platform** URL |
| B3 | Another school selects the syndicated post | Renders with an author block; canonical = platform URL |
| B4 | Two schools submit the same slug | Second gets `<slug>-<schoolSlug>`; a further collision → 409 |
| B5 | Approve a non-PENDING post | 409 |
| B6 | Set `blogHeroLimit: 2` | Exactly 2 heroes; the rest fall into the grid |
| B7 | Reorder in the Layout tab | Admin preview and live site agree |

## 12. Owner console

| # | Test | Expected |
|---|---|---|
| O1 | Reach `/owner` from a **tenant** host | 403 `Owner host required` |
| O2 | Gate login with `OWNER_GATE_PASSWORD` unset | **503** |
| O3 | Owner email login without TOTP | **Succeeds** — MFA is optional |
| O4 | Owner email login with a **wrong** TOTP | Fails |
| O5 | Create a school | School + PENDING domain + admin (temp password returned) + profile + homepage + default grades/courses |
| O6 | Delete a `LIVE` school | **409** "Suspend the school first" |
| O7 | Suspend then delete | Cascades; media removed |
| O8 | Impersonate | Opens the school host as its **oldest active admin**, "Owner view" banner |
| O9 | Use the impersonation link **twice** | Second use fails |
| O10 | Wait 16 min, then use it | Fails |
| O11 | Stay in an impersonated session past 15 min | Session ends hard — **no refresh** |
| O12 | Impersonate a school with no active admin | 409 |
| O13 | Change tier | Features update; verify immediately and after 5 min |

## 13. Notifications

| # | Test | Expected |
|---|---|---|
| Z1 | Break SMTP, then save attendance with absentees | **Save still succeeds**; failure logged only |
| Z2 | Break SMTP, then create an exam | Exam still created |
| Z3 | Trigger the exam-reminder cron **without** the secret | Rejected |
| Z4 | Exam scheduled at 00:05 UTC two days out; run the cron at 03:00 UTC | **Reminder sent** (whole-UTC-day window, not rolling 48h) |
| Z5 | >200 exams in the window | Capped at 200 with a **loud warning** in logs |
| Z6 | One school's mail fails mid-run | Other schools still get theirs |
| Z7 | Any notification with a missing school/subject row | Renders `'Your school'` / `'General'` — **never** the literal `undefined` |

## 14. Regression must-runs before any release

1. A4, A9, A14–A18 (auth + tenant isolation)
2. R5, R9, R10, R13, R16–R20 (register lock + absence email dedup)
3. E4, E5, E7, E8, E9 (results privacy + batch validation)
4. L4, L13 (leave side effects, past immutability)
5. F2, F4, F5 (tier gating both ways)
6. M1–M3 (offline attendance)
7. W1, W3 (public-site status gate)
8. `pnpm preflight` — **mandatory before any push**; local gate ≠ cloud gate is why green tests still
   break deploys.

## Sports wing (staging: raffles.test.sckools.com; feature `SPORTS` must be overridden on for the school)

1. Admin → Staff: set a staff member's job to **Sports teacher** (offered only with the feature), create the login; sign in as them → lands on `/sports` with Tournaments · Records · Houses · Rules · Settings (no Teachers). An office login typing `/sports` bounces to `/staff`.
2. Admin → Sports → Teachers: untick everything but Enter → Save; as the teacher, New tournament is hidden and `POST /sports/tournaments` answers 403 `SPORTS_PERM`.
3. Settings: put class 8 in two bands → the red line and Save disabled; Age groups → the wizard's Players step lists by date of birth and names a child without one.
4. Wizard: name, 2 days, Court 1 + Track, pick Badminton (Senior Boys, class rounds), 100 m (Junior Girls, lanes 4, 7 runners), Football (one draw, 3 sections); Review shows sides; Create → the board has every match/heat on a court with a time, byes have none, a warning if days are short.
5. Board: rain delay 30 → every unplayed slot after now moves; the Clashes view is empty; drag-free check: `PATCH …/slot` to Court 1 at the same time as another → clash listed.
6. Publish as the teacher with PUBLISH off in Settings → 403; as admin → LIVE, the entered child's phone/web bell says the first slot; publish again → nobody told twice.
7. Two desks: open the same semi on two browsers; save 21-15 21-19 on one; on the other save anything → "Someone else saved this match first", board reloads with the result; the winner sits in the final; the house table shows +5 for the winner's house.
8. Final of class 9 and class 10 saved → the band final appears with both champions and a time after the last booked slot; re-score the class 9 final with the other winner while the band final is unplayed → the band final's side swaps and the ledger shows the correction rows.
9. Heats: type 13.42, 13.10, blank; Save & rank → ranks 2, 1, — ; every heat ranked → the final heat appears with the best 4; a mark below the book's standing record → Records shows it "Waiting for a signature"; approve → the book updates, the child hears; approve again → 409.
10. Records: type in a past record with an end year → History shows it under the standing holder; a standing entry that does not beat the book is refused with both values; void the standing record → the previous holder stands again.
11. Houses: add Red/Blue, assign class 9 to Red; delete a house with points → 409; award −5 with a reason → the ledger shows the minus.
12. Student portal `/portal/sports`: Up next names the final and court; the semi shows W with the scoreline; the sprint shows 1st · 13.10 s; the house chip is Red.
13. Rules: every group lists its sports; Badminton shows the court drawing with labels inside the frame at 390 px; search "kho" finds Kho-Kho.
14. Cross-tenant: another school's tournament id on `/sports/tournaments/:id` → 404; `/me/sports` never lists it.
15. Website → Records: switch on without the consent tick → the API's consent message; tick, choose Scoreboard, "Lines I pick", pin the 100 m line, Save → `/records` on the school site shows the Scoreboard room and the homepage band shows the 100 m record; Studio → Per-section layout → Book of Records → Honours strip → the strip sits under the menu; Editorial shape → the cabinet cards go square.
16. Void the standing 100 m record on the desk → within a minute the site shows the previous holder (or "no record yet"); switch the book off → `/records` is 404 and the nav entry is gone.
17. Wizard v2: step 1 add Court 1, Field, Track and type "Badminton court 3"; press its type badge and watch it cycle. Step 2: pick Senior, tick Boys+Girls, press Badminton, Chess, 100 m, Football → 8 lines appear filled in; badminton binds to the named court only, chess shows "no board" in red and the count line says how many lines lack a venue; Edit one line, tick a venue by hand, press "Back to the sport's own".
18. Step 3: every class of the group is a shut row and no child is listed until one is opened; the class chip enters that class in one sport without opening it; "All N into Badminton" enters the whole group; "Every eligible child into all N events" fills the meet. Open class 9 → only class 9's children, All/None per row, a child in four events badged. Football's panel suggests a basis with the team count on each chip; enter only one class with one section → "Only 1 team under sections" with the working fix. Create and open the board: no child appears twice at the same minute, and the Clashes view is empty.
19. Step 3, a big field: set the day to 09:00–10:00 with one court and enter the whole group in Badminton → the cost line reads "2 needed · 1 booked" and "Over by 1 day"; press "Make it 2 days" → "It all fits". On a 100 m line with more entrants than lanes, the funnel card reads Class heats → Band final; press "Open qualifying" and it becomes Qualifying heats → Final; the number through per class changes the field.
20. Days & courts (on a created meet): the tab shows a row per day with a bar per court and the events that run; a meet whose plan spilled shows the extra day marked "not booked" and the Day board carries the same warning. Press "Book N days" → the tab redraws with the warning gone and no played slot has moved. Add "Court 2" → every event of that type gains it and the plan re-lays. Hold Chess to day 1 → its slots move to that day; set it back to "Wherever it fits" → it spreads again. On a LIVE meet the hours and the rest gap are disabled while the last day and Add venue still work; on a DONE meet every one of them answers 409.
