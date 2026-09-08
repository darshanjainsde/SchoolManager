---
name: sckools-behavior-spec
description: Use when scoping or running QA on Sckools, writing a test plan, or deciding whether an observed behaviour is a real bug or the designed rule — covers every feature across API, admin console, teacher/student portals, mobile app, public site, blog and owner console, with the exact invariant and the file that enforces it.
---

# Sckools — Behaviour Spec & QA Oracle

The authoritative, code-derived description of **what this system does and why**, for two jobs:

1. **QA scoping** — hand a tester the full feature surface with expected results per role/tier.
2. **Bug triage** — answer "is this working as designed, or is it a real bug?" without re-reading the codebase.

Derived from `main` @ `c427b2c`. Every claim below is traceable to a named file. When code and this
skill disagree, **the code wins** — fix the skill in the same PR.

## How to use it

| Situation | Do this |
|---|---|
| "Give QA a test plan" | Read `references/qa-test-plan.md`. Scope by tier + role, not by screen. |
| "Is this a bug?" | Read `references/designed-vs-bug.md` FIRST. ~30 surprising behaviours are deliberate. |
| "How does X work?" | Find X's area file below, then open the file it cites before answering. |
| "Who can do X?" | `references/platform-and-tenancy.md` (roles/guards) + the area file's permission rule. |
| Writing a new feature | Read the area file; match the existing invariant rather than inventing a new one. |

**Do not answer a behaviour question from this file alone if money, marks, attendance records, or
tenant isolation are involved** — open the cited source and confirm. This skill is a map, not the territory.

## Reference files

| File | Covers |
|---|---|
| `references/platform-and-tenancy.md` | Hosts, tiers, feature flags, the 5 roles, JWT/session, RLS, guards, lockout, impersonation, invites |
| `references/management-academics.md` | The PRO module: catalog, timetable versioning, attendance + register lock, exams/results, leave → substitution, staff attendance, class notes, holidays, announcements |
| `references/portals-and-sites.md` | Admin console, teacher portal, student portal, mobile app, public school site + CMS, blog platform, owner console, marketing site |
| `references/qa-test-plan.md` | Test matrix: setup, per-role suites, tier gating, cross-tenant, notification, offline |
| `references/designed-vs-bug.md` | The oracle — surprising-but-intentional behaviours, and what a REAL bug looks like next to each |

## The ten invariants everything else hangs off

Break one of these and it is always a bug, no discussion:

1. **Tenant is the host, never the payload.** `X-Skoolos-Host` → `req.hostname` → `Host`. A JWT minted for
   school A replayed on school B's host is a 401 (`school-jwt.guard.ts`).
2. **Feature access = tier + per-school override.** BASIC⊂STANDARD⊂PRO; `FeatureOverride` can add or
   remove any key. Cached in Redis 300s (`features.ts`, `feature-resolver.service.ts`).
3. **A register belongs to its own day.** Past days lock for teachers; only an `APPROVED`, unexpired
   `RegisterChangeRequest` reopens exactly one (class, date). Admin bypasses (`attendance.service.ts`).
4. **A substitution is a one-day grant.** It never widens access on any other date, and never confers
   broadcast/exam rights (`internal/class-access.ts`).
5. **Teachers act only on their own classes.** Class teacher OR live timetable slot OR that day's
   substitute. Enforced server-side, not just by hiding UI.
6. **A student only ever reads their own row.** `studentId` comes from the JWT `sub`, never the client.
   Class averages are computed in-DB so no peer's mark is ever loaded (`portal.service.ts`).
7. **Unpublished results do not exist** to students — excluded from their rows *and* from the average.
8. **Notifications are best-effort and post-commit.** A mail/push failure never rolls back or fails the
   write that triggered it (`run-in-background.ts`).
9. **Timetables are versioned, not edited.** Reading a past date returns the version active then.
10. **Only a `LIVE` school serves a public site.** `SETUP`/`SUSPENDED` → 404, while admin login still works.

## Roles at a glance

`OWNER` (platform, no schoolId) · `SCHOOL_ADMIN` · `TEACHER` · `STUDENT` · `STAFF`

There is **no PARENT role**. One `STUDENT` login is shared by student and guardian by design — keep all
copy role-neutral. `STAFF` can be invited and can log in, but the web login **bounces them with a toast**
and clears their tokens; they have no web portal (mobile routes them to the staff tabs).

## Tier → features

| Feature | BASIC | STANDARD | PRO |
|---|---|---|---|
| `PUBLIC_SITE`, `GALLERY`, `ENQUIRY`, `SOCIAL` | ✅ | ✅ | ✅ |
| `ABOUT_CONTACT`, `EVENTS`, `BLOG` | — | ✅ | ✅ |
| `MANAGEMENT` (all academics) | — | — | ✅ |

Missing feature on a guarded route → **403** (`RequireFeatureGuard`). Except the public blog and public
site, which **404** on purpose so the page looks absent rather than forbidden.

## Common mistakes when reasoning about this system

- **Assuming the UI is the rule.** Hidden nav ≠ blocked endpoint. Every ownership rule is duplicated
  server-side; test the endpoint directly.
- **Assuming UTC.** School days are **IST calendar days**. "Today", register locks, holiday lists and
  timetable versions all pivot on IST midnight (`internal/timetable-date.ts`). The exam-reminder cron is
  the one deliberate exception — it uses UTC day windows (`reminder-window.ts`).
- **Assuming RLS covers everything.** It does not. `Attendance`, `Exam`, `Result`*, `Substitution`,
  `Staff`, `StaffAttendance`, `LeaveApplication`, `ClassNote`, `ClassTodo`, `RegisterChangeRequest`,
  `BlogPost` and the CMS course tables have **no RLS** — their `schoolId` filters are load-bearing.
  (*`Result` gained RLS later; still filtered explicitly.)
- **Treating a 409 as a crash.** `REGISTER_LOCKED`, `TEACHER_CONFLICT`, `LEAVE_NOT_PENDING`,
  `REGISTER_CHANGE_OPEN` and the attendance retake race are all designed conflict responses.
