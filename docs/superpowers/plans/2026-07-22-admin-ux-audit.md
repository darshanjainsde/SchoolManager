# School-Admin UX Audit & Improvement Plan (2026-07-22)

## Who owns the timetable?
The **school admin** builds it, in `/app/timetable` (gated `@RequireFeature('MANAGEMENT')`).
Teachers only *consume* their assigned slots (teacher portal "My day"). The "who will
create this" picker you saw = choosing which teacher teaches a given slot. Correct model.

## CRITICAL — broken onboarding chain (a fresh school cannot finish setup)
Dependency chain to a working timetable:
  grade + academic-year → class  ;  periods + subjects + teachers + class → timetable

| Prereq | API | UI | Status |
|---|---|---|---|
| Grades | ✓ | ✓ (classes/structure) | OK |
| Subjects | ✓ | ✓ (classes/structure) | OK |
| **Academic year** | ✓ GET/POST /manage/years | ✗ NONE | **BLOCKER** — Add-class form requires academicYearId but there's no way to create one |
| **Periods** | ✓ full CRUD /manage/periods | ✗ NONE | **BLOCKER** — timetable says "add via the API" (dead end) |

Result: on a brand-new school, "Add class" is un-submittable and the timetable is unbuildable.

## Other functional gaps / usability findings
1. **No Settings page** — nowhere for school-wide setup (academic years, periods, bell times).
2. **No setup guidance** — dashboard is a bare "Welcome"; no checklist of what to configure first.
3. **Timetable empty states** dead-end instead of linking to where to fix (periods).
4. **Availability** depends on published timetable + periods → empty until the above exist.
5. Inline add/edit forms push the page down (drawer pattern from the Admin Pro pitch still unbuilt).
6. No server-side search/pagination on students/teachers (fine at demo scale, breaks at 500+).
7. No bulk actions / CSV import (onboarding a real school = typing hundreds of rows).

## Improvement plan (priority order)
### P0 — unblock setup (small, high impact)
- **A. Settings page** `/app/settings` with two sections:
  - **Academic years**: list + add (name, start, end, isCurrent) → /manage/years.
  - **Periods / bell times**: list + add/edit/delete (label, order, start, end) → /manage/periods.
- **B. Fix dead-end empty states**: timetable "No periods" and class-form "No academic years"
  link to the Settings page instead of mentioning the API.
- **C. Add-class form**: if no academic year exists, guide to Settings (don't leave a dead Save).

### P1 — guided setup + polish
- **D. Dashboard setup checklist**: "Academic year ✓ · Periods ✗ · Classes 0 · Teachers 3 …"
  each linking to the right screen; disappears once configured.
- **E. Themed drawers** replacing inline add/edit forms (students, teachers, classes).

### P2 — scale (the Admin Pro functional layer, still unbuilt)
- **F.** Server-side search + pagination (students, teachers).
- **G.** Bulk actions (assign class, send invites, export).
- **H.** CSV import wizard (validate-then-atomic).

## Status ledger (where we are)
DONE: attendance/exam/result APIs; admission-no + username + email-invite login (no temp
pw); notifications+cron; navbar login; student portal; teacher portal; all 5 admin tabs
themed; Classes split from Grades/Subjects; delete confirmations everywhere; light/dark
theme + toggle; real Sckools logo. All on `staging`, deployed to test.sckools.com.
NOT STARTED: P0 A–C (this doc), P1 D–E, P2 F–H, final whole-branch review, staging→main PR.
BLOCKED ON USER: SMTP_PASS (invite emails send but emailSent:false until set); optional S3 keys.
