# Library Wing — build plan (2026-08-16)

Approved spec: the "Library Wing Playground" artifact
(https://claude.ai/code/artifact/e4509f83-0867-4976-9e59-31fced43bdfc). This build
matches it exactly. The earlier `feat/library-service` microservice/counter work is
explicitly **not** the spec (user instruction); this is a fresh in-app feature on
`feat/library-wing` off `origin/main` (a892dd8).

## Decisions (approved by the user)

- Tabs: **Dashboard · Hall · Counter · New books · Fines · Settings** ("Counter" is the
  issue/return tab's name).
- Defaults: 2 books/student, 5/teacher, 14-day loan, ₹5/day after 1 grace day, lost
  fee ₹120, teacher fines OFF, due-soon reminders ON. Editable by the librarian
  (portal gear) AND the school admin.
- Limits **warn, not block**: at-limit / already-holds-title returns a 409 the client
  resolves with an explicit `override: true` ("Issue anyway").
- Fines **accrue while a book is out** (computed, never stored) and **crystallize into
  a `LibraryFine` row at return or write-off** (collect / waive / collect later).
- Lost copy: flat replacement fee, copy retired (`lostAt`), never issuable again.
- Theme: Reading Room (existing sk-theme tokens) light + dark via the existing
  `ThemeToggle`; librarian portal is a top-level `/library` segment.

## Repo facts this build follows (verified by exploration)

- Tenancy: every table gets `schoolId` + `tenant_iso` RLS policy; all IO inside
  `withTenant(schoolId, tx ⇒ …)` (packages/db/src/index.ts:61). Migrations are
  hand-authored SQL (template: migrations/20260805030000_hiring).
- `Staff.role StaffRole` has no LIBRARIAN → **add enum value**; librarian login =
  `UserRole.STAFF` + `Staff.role = LIBRARIAN`.
- Feature key **LIBRARY** added to packages/db/src/features.ts (union + ALL_KEYS +
  PRO bundle) + owner-console mirror list (apps/web/app/platform/schools/[id]).
- API: fully-encapsulated module (`modules/library/index.ts` + `internal/`), guard
  stack `SchoolJwtGuard, RequireFeatureGuard, RolesGuard`, errors via `ApiError`
  codes, DTOs class-validator, colocated jest specs mocking `withTenant`.
- Races: copy double-issue prevented by a **partial unique index** on open issues
  (`copyId WHERE returnedOn IS NULL`, precedent: student-code partial index) with
  P2002→409; the loan-limit count-then-insert is serialized with
  `pg_advisory_xact_lock(hashtext(schoolId), hashtext(borrowerId))` inside the
  `withTenant` transaction (documented deviation — a limit-of-N cannot be a unique
  index; this exact race shipped as a bug once before).
- Notifications: email immediately via `NotificationService.notify(..., ['email'])`,
  push via `NotificationOutbox` rows (drained by the existing cron) — the house rule
  that prevents double-sends. Due-soon reminders: new daily cron
  `/internal/cron/library-due-soon` (`@Public()` + `CronSecretGuard`, vercel.json).
- Dates are IST-anchored `@db.Date` (helpers in management/internal/timetable-date.ts).
- Web: `/library` is a new top-level segment (root layout only — no admin sidebar);
  add `/library/:path*` to the CSP matcher in apps/web/middleware.ts; login landing
  via `homeForRole(role, staffRole?)` in lib/role-routes.ts (staffRole surfaced in
  `GET /auth/me`); teacher nav in app/teacher/nav-items.ts, student nav inlined in
  app/portal/layout.tsx; theme = `.skosx` + `--sk-*` tokens + existing ThemeToggle;
  data via `useApi` + TanStack Query; tests colocated `page.test.tsx` with
  `renderWithProviders`, never importing `lib/fonts.ts`.

## Schema (packages/db)

New enums `LibraryFineReason {LATE,LOST}`, `LibraryFineStatus {DUE,PAID,WAIVED}`,
`LibraryHallSource {SYNCED,RETAKEN}`; `StaffRole` gains `LIBRARIAN`.

Models (all `schoolId` + RLS): `LibrarySettings` (1:1 school, the defaults above),
`LibraryBookTitle` (title/author/shelf), `LibraryBookCopy` (accessionNo
`B-00001…` unique per school, `lostAt`), `LibraryIssue` (copyId, studentId XOR
teacherId, issuedOn/dueOn/returnedOn `@db.Date`, `wasLost`, issuedById/returnedById
User attribution), `LibraryFine` (issueId, borrower copy, amountRupees, reason,
status, settledById/At), `LibraryHallVisit` (classSectionId, date, periodId?,
source, savedById; unique per class+day) + `LibraryHallMark` (visitId, studentId,
AttendanceStatus).

Money is whole rupees (`Int`). Accession numbers allocated like student codes
(lexicographic max + 1 inside the tx, unique index as the backstop).

## API surface (`modules/library`)

Librarian/admin (`/library/*`, `@RequireFeature('LIBRARY')`, LibrarianGuard =
SCHOOL_ADMIN or STAFF with Staff.role LIBRARIAN):
- `GET /library/dashboard` — counts + the five drill lists
- `GET /library/settings` / `PATCH /library/settings`
- `GET /library/titles?q=` (search + availability) · `POST /library/titles`
  (new title, first copy) · `POST /library/titles/:id/copies` (add copy)
- `GET /library/members?q=` (students by code/name + teachers) — member card with
  holdings + dues
- `POST /library/issues` `{copyId|titleId, studentId|teacherId, override?}` →
  409 `LIBRARY_LIMIT` / `LIBRARY_DUPLICATE_TITLE` unless override; 409
  `LIBRARY_UNAVAILABLE` when no free copy
- `POST /library/issues/:id/return` · `POST /library/issues/:id/reopen` (undo
  return) · `DELETE /library/issues/:id` (void an open, mistyped issue) ·
  `POST /library/issues/:id/lost`
- `GET /library/fines` (accruing + fixed, grouped) · `POST /library/fines/:id/collect`
  · `POST /library/fines/:id/waive` · `POST /library/fines/:id/reopen` ·
  `POST /library/fines/remind` `{classSectionId|staff}` (email now, push via outbox)
- `GET /library/hall` (current period+class via timetable "library" subject match,
  else class picker; today's roster with synced attendance + who took it) ·
  `POST /library/hall/visits` (save marks, source SYNCED|RETAKEN)

Reader (`/me/library`, STUDENT + TEACHER): holdings (dueOn, accruing fine when
applicable), limit, history, fines due. Teachers see fine fields only when
`fineTeachers` is on.

Cron: `GET|POST /internal/cron/library-due-soon` — issues due in ≤3 days →
email + outbox push, once per issue per day.

`/auth/me` gains `staffRole` for STAFF logins.

## Web

- `app/library/` — layout (skosx shell, spine-tab rail, ThemeToggle, guard:
  STAFF-librarian or SCHOOL_ADMIN else `homeForRole` redirect) and pages:
  dashboard (`page.tsx`), `hall/`, `counter/`, `books/`, `fines/`, `settings/`.
- `lib/role-routes.ts`: `homeForRole(role, staffRole)` → librarian lands `/library`;
  call sites: GatehouseLogin + four layout guards; tests extended.
- Teacher tab `app/teacher/library/` + nav-items entry; student tab
  `app/portal/library/` + inline nav entry (ribbon countdown UI). Both hidden when
  the LIBRARY feature is absent, and their pages show a quiet not-enabled state.
- middleware.ts CSP matcher += `/library/:path*`.

## Test plan

Unit (jest, mocked `withTenant`): circulation (limit warn/override, duplicate-title,
unavailable, fine math incl. grace boundary and teacher-fines toggle, lost fee,
reopen/void invariants), accession + fine-status transitions, hall sync
source rules, settings clamps. Web (vitest): portal pages render + key flows with
ApiStub; nav guard tests pick up new hrefs automatically; role-routes test.
E2E additions (not in preflight): RLS on the seven new tables mirrors
new-models-rls.e2e-spec.

Gate: `pnpm preflight` (lint → typecheck → boundary → build incl. ncc → test).
**No push — the user gates every push.** Deploy needs `pnpm db:migrate:deploy`
before code (migrate before deploy rule).
