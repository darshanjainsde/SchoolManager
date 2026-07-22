# School Day + Staff + Leave — Implementation Plan (approved 2026-07-22)

## Architecture decisions (senior-level)
- **Temporal timetable (immutable past):** `TimetableSlot` becomes effective-dated
  (`effectiveFrom`, `effectiveTo?`). Editing = close current version (set effectiveTo=today),
  insert new version. Render date D = version where `effectiveFrom <= D AND (effectiveTo IS NULL OR effectiveTo > D)`.
  Past weeks are read-only in UI AND correct in data. Uniques include effectiveFrom so versions coexist;
  "one active version" invariant enforced in the service (create new → set old.effectiveTo).
- **One-day changes are sparse dated overrides** (`Substitution`), NOT pattern edits — keeps volume low.
- **Scale:** timetable is bounded+recurring, indexed per (school,class,year); attendance is the only
  high-volume table, always queried (school, person, date-range) on its indexes; no cross-tenant fan-out.
- **Independent components:** each feature = its own service + endpoints + UI; StaffAttendance table is
  polymorphic-lite (works for teacher & staff via a subjectType or separate nullable FKs — decide in T0).

## Tasks (subagent-driven, TDD, on `staging`)
- **T0 · Schema foundation (FIRST, load-bearing):** one additive migration:
  - `Period.kind PeriodKind(CLASS|BREAK) @default(CLASS)`; `School.workingDays Int[] @default([1..6])`.
  - `TimetableSlot.effectiveFrom DateTime`, `effectiveTo DateTime?`; uniques include effectiveFrom.
  - `Substitution` (schoolId, classSectionId, periodId, date, originalTeacherId, substituteTeacherId?, reason).
  - `Staff` (schoolId, firstName, lastName, role StaffRole, email?, userId?, isActive).
  - `StaffAttendance` (schoolId, teacherId?, staffId?, date, status) — unique per person/day; indexed (schoolId, date).
  - `LeaveApplication` (schoolId, teacherId, type, startDate, endDate, reason?, status, reviewedById?, reviewedAt?).
- **T1 · Bell schedule:** period edit endpoint + kind; workingDays in Settings; day-builder UI (working days, quick-generate, breaks).
- **T2 · Timetable:** effective-dated read (render any week correctly), dates+today+week-nav, breaks as bands, past read-only.
- **T3 · Staff tab:** Staff CRUD + admin tab + invite reuse.
- **T4 · Staff attendance:** daily mark screen (teachers+staff) + monthly rollup + CSV.
- **T5 · Attendance card:** per-person month/year query + card.
- **T6 · Leave:** teacher-portal apply + admin Leave Applications tab (approve/reject).
- **T7 · Coverage/realignment:** approve → Substitution gaps → coverage panel (dashboard+timetable notice) with free-teacher dropdown + open-class-timetable per gap.

Status (2026-07-22): ALL DONE on staging.
- T0 schema (1ce90c1) · T1 bell schedule (3305b92) · T2 timetable temporal+week (e04f5cf)
- T3 staff tab (c56244e, +STAFF role) · T4+T5 staff attendance+card (b7b64d7)
- T6+T7 leave+coverage (8aa31f0). Migrations applied to staging. Tests green throughout.
Follow-ups (noted): RLS on new tables (Staff/StaffAttendance/Substitution/Leave) before prod;
management.e2e-spec updated but not DB-run; SMTP_PASS still needed for invite emails.
