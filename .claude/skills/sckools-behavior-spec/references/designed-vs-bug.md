# The oracle — "working as designed" vs a real bug

Read this **before** debugging a Sckools report. Each row is a behaviour that reliably gets reported as a
bug and is not one — paired with what a genuine bug in that same area would look like.

## How to use it

1. Find the row matching the report.
2. If the observed behaviour matches "Designed", reply with the reason and the file. Do not "fix" it.
3. If it matches "That WOULD be a bug", escalate — it is a real defect.
4. No matching row → open the cited area file, then the source. **Never guess.**

---

## Attendance and the register

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "Unmarked students show as Present" | Deliberate default so the UI renders one row per roster student. `attendance.service.ts#list` | An unmarked student **missing** from the list entirely |
| "Teacher can't fix yesterday's register" | Registers lock at the end of their own day so the record can be trusted. 409 `REGISTER_LOCKED` | A **future** date being accepted, or an admin also being blocked |
| "The unlock stopped working overnight" | An approval expires at **end of the approving IST day** — self-expiring so no one has to remember to revoke it | An approval expiring **before** end of day, or never expiring |
| "A pending request already unlocked the day" | It must not. The lookup requires `status: 'APPROVED'` **and** `expiresAt > now` strictly | A PENDING request actually unlocking → **critical bug** |
| "Past day shows 26/28 but the class has 30 students now" | When taken, `total` is the number of rows **marked that day**, not the live roster — transfers must not rewrite history | An **untaken** day not falling back to the live roster count |
| "markedBy says 'School admin' not a name" | Admins have no `Teacher` row, so `markedById` holds their `User.id` and can't resolve to a name | A **teacher's** save showing 'School admin' |
| "markedBy shows the wrong teacher on a retaken day" | `save` deletes-and-recreates, so "earliest surviving row" = the marker of the **latest** save | The name not matching the last saver either |
| "Got a 409 saving attendance" | Two teachers retaking the same class+date raced the unique index → retryable 409, not a crash | A **500** in that scenario |
| "No email when I re-saved the same roster" | Absence emails fire only for students who **became** absent in that call. Server-side dedup, holds for every client | No email on a **first** absence mark |
| "No absence email for this student" | Check for a linked login first — students with no `User` produce no recipient and are silently skipped (there is no guardian email column) | No email for a student who **does** have a linked login |
| "Attendance saved but I got an error toast" | Should not happen — notification failure is caught and swallowed post-commit | Save **rolled back** because mail/push failed → real bug |

## Timetable

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "I changed the timetable but last week still shows the old teacher" | Slots are **versioned**; a past date returns the version active then. That's what makes past weeks immutable | The **current** week still showing the old version after a change |
| "I edited a slot twice today and there's only one version" | Versioning is day-granular — a same-day correction updates in place rather than stacking two versions | A change on a **later** day updating in place instead of creating a version |
| "Re-saving the same subject+teacher did nothing" | Identical assign is a no-op by design | It creating a duplicate version |
| "Availability is empty" | A school with no `isCurrent` academic year returns teachers + periods with an empty busy list rather than erroring | A school **with** a current year showing empty busy |
| "An inactive teacher is missing from availability" | Only `isActive` teachers are listed | An **active** teacher missing |

## Substitution and leave

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "The substitute can't post an announcement to that class" | Covering one period ≠ being the class's teacher. Broadcast/exam rights explicitly exclude `covering` | The substitute unable to **take the register** for the covered date |
| "The substitute has access on other days too" | They must not — a substitution is a **one-day grant**. If they do, that's the bug | Access persisting beyond the covered date → **critical** |
| "Cancelling leave didn't restore last week's classes" | Past dates are immutable; only today-or-later are restored. `restoredDates` reflects that | **Future** gaps surviving a cancel |
| "The teacher is still marked ABSENT after cancelling leave" | Cancel only clears a mark that is still `ON_LEAVE`; a hand-changed `ABSENT` is left alone deliberately | An `ON_LEAVE` mark **surviving** a cancel |
| "Approving leave marked them ON_LEAVE for a past date too" | It shouldn't — only today-or-later are marked | Past dates getting marked → real bug |
| "Overlapping leaves created duplicate gaps" | They shouldn't — approve pre-checks each (class, period, date) | Duplicates appearing → real bug |
| "Gaps have no substitute" | `substituteTeacherId: null` **is** the uncovered-gap state, not missing data | A gap not being created at all for an active slot |

## Exams and results

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "Students can't see their marks" | Results are invisible until **published**. Excluded from their rows *and* from the class average | Published results still invisible |
| "The whole mark batch was rejected for one bad value" | Deliberate: validate up front, write nothing, so a bad batch never leaves partial data | A partial write surviving a rejected batch |
| "Publish said 0 and no one was notified" | No saved results → nothing to announce. Telling parents results are out would be a lie | `published > 0` but no notification fired |
| "The class average changed after more marks were published" | The average covers **published** rows only, so it moves as more publish | Unpublished marks influencing the average → **privacy bug** |
| "A student's own mark is missing from results" | If its exam row is foreign/deleted the entry is dropped rather than leaked | A **valid** published result missing |
| "Teacher can't enter marks for a class they're covering" | Substitutes don't schedule, mark or publish | Them unable to do so for a class they actually teach |

## Class notes

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "Another teacher can see my notes" | Notes are scoped to (class, date, subject), **not** to the author — a handover record, not a private diary | A teacher with **no** relation to the class seeing them |
| "Notes disappeared after changing a setting" | `SUBJECT_TEACHERS` filters notes to teachers of that subject. Class teacher always sees everything | Notes vanishing for the **class teacher** |
| "The setting change didn't apply until I logged out" | It should apply on the very next request — visibility is read fresh every call, never cached | Needing a re-login → real bug |
| "A substitute could read a subject they never covered" | They must not — the lookup pins the substitution's **weekday** | It happening → real bug |

## Auth and sessions

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "All my devices got logged out at once" | Presenting a revoked refresh token revokes the **whole family** — reuse detection | Normal rotation revoking the family |
| "Locked out after 5 tries" | 5 failures set a 15-min lock. The 5th failure still answers **401**; the **next** attempt answers **403** because `lockedUntil` is checked before the password | Locking earlier, or never unlocking |
| "Wrong email and wrong password give the same error" | Anti-enumeration, deliberate | Different messages leaking which accounts exist |
| "Staff can log in but see nothing on web" | STAFF has no web portal yet — the login is bounced with a toast and tokens cleared. Mobile routes them to the staff tabs | STAFF falling through to `/app` and getting the **admin console** → **critical** |
| "Owner can't use the mobile app" | Owner is web-only; mobile falls back to login rather than a stuck screen | A **blank/frozen** bootstrap screen |
| "Impersonated session died after 15 minutes" | No refresh token is issued — the session hard-ends at access expiry | It **surviving** past 15 min |
| "The impersonation link only worked once" | Single-use, burned before the session is issued | It working twice → **security bug** |
| "Owner logged in without MFA" | TOTP is optional; a supplied code must verify, but it isn't required | A **wrong** code being accepted |
| "The owner gate returns 503" | `OWNER_GATE_PASSWORD` is unset — the gate is off by default | 503 with the var **set** |
| "API says 'Tenant context required'" | The request didn't carry a resolvable host. From tools, send `X-Skoolos-Host` | A correct host still failing |

## Tiers, features and the public site

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "All nav items flash before some disappear" | Until `/auth/me` resolves, every item shows — deliberate, avoids items flickering away | Items **never** filtering after it resolves |
| "The blog 404s instead of 403" | Public blog and public site 404 on purpose so the page looks absent, not forbidden | A **guarded admin** route 404ing instead of 403 |
| "A new school's website is 404" | Only `LIVE` schools serve a public site; `SETUP` is resolvable so the admin can build it | A `LIVE` school 404ing |
| "Feature toggle took 5 minutes" | Features are Redis-cached for 300s; owner actions invalidate, other paths wait out the TTL | A change never taking effect |
| "Can't delete a school" | Deletion requires `SUSPENDED` first — a deliberate two-step | Suspend→delete still failing |
| "Turning off Gallery on the homepage didn't remove `/gallery`" | Toggles control the **homepage** only; full detail always lives on its own page | The homepage still showing it |

## Blog and syndication

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "My post's canonical points at sckools.com" | Once globally approved, the platform URL is canonical — SEO-intentional | A **non-approved** post pointing at the platform |
| "Slug got `-schoolname` appended" | Global-slug collision resolution | A second collision looping silently instead of 409 |
| "Approval said 409, retry" | A concurrent approval raced the unique constraint — retryable | A **500** there |

## Dates and time

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "'Today' is wrong late at night" | School days are **IST** days everywhere (locks, holidays, timetable versions). `toISOString().slice(0,10)` on a bare Date would roll back after 18:30 IST | Any of those pivoting on **UTC** midnight → real bug |
| "Reminders use UTC, not IST" | The exam-reminder cron is the one deliberate exception — whole-UTC-day T-2/T-1 windows, so a 00:05 UTC exam isn't missed by a 03:00 run | A rolling 48h/24h window silently dropping exams |
| "Past holidays vanished" | `list` returns **upcoming only**, filtered in the query. There is no past-holidays view | An **upcoming** holiday missing |
| "Attendance % dropped after approved leave" | `ON_LEAVE` is excluded from **both** sides of the staff ratio | Leave counting as an absence |
| "A full-leave month shows 0%" | Correct — no non-leave days to divide by. Never NaN, never 100% | NaN or a crash |

## Multi-tenant edge cases

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "Shared device stopped getting school A's notifications after logging into B" | Push tokens are a **per-device** identity; the row reassigns last-writer-wins. Erroring would strand the device on A forever | Both tenants delivering to it, or the device getting stuck |
| "Announcement email named the wrong class" | Each targeted section gets its own payload with its own class name | A merged/incorrect class name |
| "Notification shows 'Your school'" | Fallback when the School row can't be read — never `undefined` in a parent's inbox | It appearing for a school that clearly exists |

---

## When it IS a bug, always

No design rationale covers any of these. Escalate immediately:

1. Any data from another school appearing anywhere.
2. A student seeing another student's individual mark, or an unpublished mark.
3. A teacher writing to a class they neither teach nor cover that day.
4. A PENDING (unreviewed) register-change request unlocking a day.
5. A substitution granting access beyond its single date.
6. STAFF reaching the admin console.
7. An impersonation link working twice, or surviving past 15 minutes.
8. A mutation rolled back because a notification failed.
9. A `500` where a documented `4xx` exists (`REGISTER_LOCKED`, `TEACHER_CONFLICT`, `CLASS_NOT_OWNED`,
   `LEAVE_NOT_PENDING`, `REGISTER_CHANGE_OPEN`, `REGISTER_CHANGE_DECIDED`).
10. Any date rule pivoting on UTC midnight instead of IST (except the exam-reminder cron).

## People who leave (Active Roster)

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "I can't delete a student" | Once a child has attendance, results, diary, library or messages the API refuses with 409 `HAS_HISTORY`; the console opens **Mark as left** instead. `students.service.ts#remove` | Delete refused for a child with **no** history, or a delete that **succeeds** and takes the attendance with it |
| "A child who left is missing from the register / diary / result sheet" | Every roster lists `ACTIVE` students only (`activeStudentsWhere`). Their row and history are on the Students page under **Alumni & left** | A left child still on a register, or an active child missing from one |
| "The alumnus can't log in with the student code any more" | Every leaving status closes the child's login; alumni use the Homecoming door (a claim link), not a child's account | A **TRANSFERRED/LEFT** child who can still refresh a session |
| "Re-admitted child was asked to set a password again" | Sessions were revoked on leaving, so re-admit sends a fresh invite | Re-admit without the login reopening at all |
| "Removed teacher still shows on the website" | Only if the office ticked **Keep them on the website**; by default the featured card is removed and the projection also drops cards linked to a LEFT teacher | A LEFT teacher rendered on the Educators band with the box unticked |
| "Onboarding a teacher says they already have a record here" | 409 `ALREADY_HERE_INACTIVE`: the email belongs to a LEFT row at this school — Reactivate it, don't add a duplicate | The same 409 for an email that belongs to **nobody** here |
| "The app shows 'No longer enrolled' for my child" | The school marked the child as left; the spine stays so the family knows why the diary stopped, with one Remove action | That card for a child the school did **not** mark, or a sibling's diary also going dark |

## Birthdays on the website (Active Roster, Track B)

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "The wall is empty / 38 children never appear" | Only ACTIVE students **with a date of birth** are on the wall; the Celebrations tab counts the ones without one and points to the student form | A child with a `dob` and `showOnWebsite` missing from the window |
| "I turned the audience to Public and it would not save" | 400 `CONSENT_REQUIRED` until the consent box is ticked in the same save — "families only" never becomes "everyone" by an unticked default | Save refused with the box ticked, or a PUBLIC wall live with `consentConfirmed=false` |
| "The wall shows initials, not the child's photo" | A photo needs **both** the school's Photos switch and that child's `photoConsent` | A photo shown for a child without consent |
| "A birthday on 29 Feb is missing" | It shows on 28 Feb in a non-leap year | Missing in a leap year, or shown twice |
| "The page shows an age / the year" | Never designed: rows carry day and month only | Any year, age or student id in `/public/birthdays` |
| "The homepage has no badge / ribbon" | Placement is Page only, nobody is in the window, or the section is off in Homepage → Sections | Placement TEASER_AND_PAGE with names in the window and nothing on the homepage |
| "Portal families see it but the website does not" | Audience FAMILIES: the wall is behind sign-in on purpose | 404 on `/me/birthdays` with audience FAMILIES or BOTH |
| "I can't pick Active students as the source" | Needs the `MANAGEMENT` plan; the tab disables the chip and keeps the typed list | Chip disabled for a school that has MANAGEMENT |

## Sessions — the year end (Active Roster, Track C)

| Reported as | Designed — why | That WOULD be a bug |
|---|---|---|
| "I decided everyone but nobody moved" | Nothing changes until **Start** on step 6; decisions are a draft | A seat that moved before Start |
| "Start says the plan changed" | 409 `PLAN_CHANGED`: someone saved a decision or setting after the review loaded — reload, review again | The same 409 with no save in between |
| "Start is greyed out" | Children in closing classes without a decision (`counts.undecided`) — the review lists them | Start disabled with `undecided = 0` |
| "A child below the pass mark was promoted" | The pass mark only **flags** (amber Review); the office decides | A child moved to a class other than the one chosen |
| "The timetable copied to the wrong class" | It follows the classroom: 5 B's periods become next year's 5 B, not the promoted children's 6 B | 5 B's periods on next year's 6 B, or a LEFT teacher's periods copied |
| "The passed-out children still show as students" | They are ALUMNI on the Students page under Alumni & left, with `alumniBatch` = the closing year; the Alumni page has them only when the ALUMNI wing is on | An ALUMNI child still on a register, or with a working login |
| "New admissions vanished from Students" | The default list is the running year's register; the child sits in a next-year class — tick Show past sessions / pick the session, or they are in the next year already | An ACTIVE child in a current-year class missing from the default list |
| "The scheduled start did not run" | It fires at the school's midnight via the cron (18:30 UTC); until then the plan is SCHEDULED and locked | A SCHEDULED plan with `scheduledFor` in the past and status still SCHEDULED after the cron ran |
| "Promote everyone changed a child I had already decided" | Never designed: the master button only fills rows that do not exist (`skipDuplicates`) | Any decided row rewritten by it |
| "The library books stopped the session from starting" | Never designed: the library panel is information and two optional actions; Start ignores it | Start refused because of open loans |
| "Setting the last due date fined a child who was already late" | Only loans due AFTER the chosen day move; an overdue book keeps its own due date and fine clock | An already-overdue loan's `dueOn` changed by the click, or a day before today accepted |
| "The next year's timetable already exists before Start" | The office opened Preview and adjust on step 5, which copies now; Start keeps it and copies nothing twice | A period doubled after Start |

## Sports wing

| Reported as | Designed behaviour | It IS a bug when |
| --- | --- | --- |
| "The office staff login cannot open /sports" | Only the SPORTS job (and the admin) may; other staff get 403 `NOT_SPORTS_DESK` and are sent to their own portal | A SPORTS-job, active staff row refused, or an OFFICE row let in |
| "The sports teacher cannot publish" | Settings may reserve publishing for the admin, or the teacher's rights (Admin → Sports → Teachers) lack PUBLISH — 403 `SPORTS_PERM` | An admin refused, or a teacher with PUBLISH refused while `publishNeedsAdmin` is off |
| "A student in class 7 could not be entered in the Senior event" | Bands decide the group by class (or age by date of birth); the wizard lists only eligible children and the API refuses the rest by name | An eligible child refused, or an ineligible one accepted |
| "Class 10 had one entrant and no matches" | A lone entrant is that class's champion by walkover and meets the other champions in the band final | A lone entrant dropped, or a one-player draw created |
| "The final is missing from the bracket" | The band final (and the final heat) appears on its own once every class champion (every heat) is in | A final missing after every class has a champion, or built twice |
| "Two matches are at 09:00 on the same court" | Never designed: the scheduler gives each match the earliest free venue and never starts a round before the last one ends; the Clashes view lists any overlap | A venue with two overlapping slots, or a child in two places, after creation |
| "The plan needs three days but the meet has one" | Designed: the reply warns; the extra days are on the board as day 2, 3 … so the office adds a day or a venue | Slots dropped silently |
| "My score was replaced by the other teacher's" | Never designed: a save carries the version it loaded; the second desk gets 409 `MATCH_CHANGED` and reloads | A stale save accepted |
| "21-20 was refused" | A game is won by two (capped at 30); 21-20 is a game in progress and saves as it stands, with no winner | A complete legal game refused, or 31-29 accepted |
| "A football draw at 1-1 could not be saved as finished" | A knockout cannot end level: enter the decider (penalties) as the second number | A decider refused when the first numbers are level |
| "I cannot change last round's result" | Once the winner has played the next round the earlier result is locked (409 `MATCH_LOCKED`); clear the later result first | A result locked while the next slot is unplayed |
| "The house table changed after a correction" | Designed: a re-scored match writes the difference as correction rows; the table is the sum of its ledger | A total edited in place, or a correction that does not net to the new result |
| "9 A beat 9 B and Red house got no points" | A section side has no house; team sports pay no house points | An individual winner's house not paid |
| "The record was not updated when she ran 12.10" | A mark queues an attempt; a record changes only when someone with VERIFY approves it | An approved attempt not standing, or a mark below the standing record queued |
| "12.30 did not beat the record of 12.30" | Records are beaten strictly at the sport's precision | 12.29 not queued |
| "The final heat has five runners on four lanes" | A tie at the cut brings everyone on that mark | More runners than lanes without a tie |
| "Students cannot see the draft" | A draft is never visible to students; publish makes it LIVE | A published LIVE meet missing from `/me/sports` for an entered child |
| "The student saw a tournament from another school" | Never designed: every read is tenant-scoped (RLS) | Any cross-school row |
