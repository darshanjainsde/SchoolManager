# Phase 4 — School Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a **Pro-tier** school admin the management layer — grades/classes, subjects, teachers (with photos), students mapped to a class, periods, a timetable builder with clash detection, and a teacher-availability view.

**Architecture:** New NestJS `management` module — tenant-scoped (`SchoolJwtGuard` + `withTenant`/RLS) AND feature-gated (`RequireFeature('MANAGEMENT')`, so Standard/Basic schools get 403). All models already exist in the schema (Phase 1). Timetable clash detection leans on the DB unique constraints `class_slot` + `teacher_slot` (P2002 → 409). Rebuilt Next.js management pages under `apps/web/app/app/*`.

**Tech Stack:** NestJS 10, Prisma 5 (`withTenant` RLS), `RequireFeature` guard (Phase 1 `features` module), Next.js 14, React Query, Tailwind.

## Global Constraints

- Every management route: `@UseGuards(SchoolJwtGuard)` + `@RequireFeature('MANAGEMENT')` + `RequireFeatureGuard`. schoolId ONLY from `TenantContextService.requireTenant().schoolId`. All data via `withTenant()`. NEVER `getPlatformPrisma()`.
- Feature gate: Acme (STANDARD, no MANAGEMENT) must get **403** on every management route; Beacon (PRO) must succeed. The e2e MUST assert both.
- Models already exist (Phase 1 schema — do NOT change it): `AcademicYear`, `Grade`, `ClassSection`, `Subject`, `Teacher`, `TeacherSubject`, `Student`, `Period`, `TimetableSlot`. Scoped uniques: `Grade(schoolId,name)`, `Subject(schoolId,code)`, `Student(schoolId,admissionNo)`, `Period(schoolId,order)`, `ClassSection(schoolId,gradeId,name,academicYearId)`, `TimetableSlot` has `class_slot` = `(schoolId,classSectionId,dayOfWeek,periodId,academicYearId)` and `teacher_slot` = `(schoolId,teacherId,dayOfWeek,periodId,academicYearId)`.
- `dayOfWeek` is 1–7 (Mon=1). A P2002 on `class_slot` → "This class already has a subject in that period"; on `teacher_slot` → "That teacher is already booked in that period" (inspect `error.meta.target` to distinguish; both → 409 ConflictException).
- Teacher/Student photos reuse the Phase 3 media endpoint (`POST /site/media?kind=STAFF` exists; add `STUDENT` is NOT a MediaKind — use `STAFF` for teachers; for students, reuse `STAFF` kind or skip photos — students photos are optional this phase; DO NOT change the enum).
- Reuse: `RequireFeature`/`RequireFeatureGuard` (`apps/api/src/modules/features`), `withTenant`, `TenantContextService`, `SchoolJwtGuard`, `apps/web/components/ui/*`. Design ref: `mockups/school-admin.html` (Classes, Teachers, Students, Timetable, Teacher availability tabs).
- **CRITICAL web rule (learned in Phase 3):** every school-admin page under `/app` that calls the API MUST pass the tenant host header, or the API can't resolve the tenant and returns 401. Use the repo's hook: `import { useHost } from '@/components/use-host'; const host = useHost(); const api = useApi({ audience: 'school', hostHeader: host });`. NEVER call `useApi({ audience: 'school' })` without `hostHeader` — the browser fetch goes to the API origin (`localhost:3001`), not the school subdomain, so the host must be sent explicitly. Every `/me/*` and `/teacher/*` page does this — match them.
- Spec §5.3 (`docs/superpowers/specs/2026-07-03-skoolos-school-website-platform-design.md`).

---

## File structure (Phase 4)

**API — new module `apps/api/src/modules/management/`:**
- `index.ts` (`ManagementModule`), `internal/management.module.ts`, `internal/management.dto.ts`
- `internal/catalog.service.ts` + `catalog.controller.ts` — academic years, grades, subjects, periods (simple CRUD)
- `internal/teachers.service.ts` + `teachers.controller.ts`
- `internal/classes.service.ts` + `classes.controller.ts` — class sections
- `internal/students.service.ts` + `students.controller.ts`
- `internal/timetable.service.ts` + `timetable.controller.ts` — slots (clash detection) + availability
- tests + `apps/api/test/management.e2e-spec.ts`

**API — modify:** `apps/api/src/app.module.ts` (register `ManagementModule`).

**Web — under `apps/web/app/app/`:**
- Add nav items to `layout.tsx`: Classes, Teachers, Students, Timetable, Availability (only visible if the school has MANAGEMENT — fetch effective features or just show and let 403s guard; simplest: show them; a non-Pro school won't be on this plan).
- `classes/page.tsx`, `teachers/page.tsx`, `students/page.tsx`, `timetable/page.tsx`, `availability/page.tsx`.

---

### Task 1: Management module scaffold + catalog CRUD (academic years, grades, subjects, periods)

**Files:** create `management.module.ts`, `index.ts`, `management.dto.ts`, `catalog.service.ts`, `catalog.controller.ts`; modify `app.module.ts`.

**Interfaces:**
- Produces: `CatalogService` with `listYears/createYear`, `listGrades/createGrade/updateGrade/deleteGrade`, `listSubjects/createSubject/updateSubject/deleteSubject`, `listPeriods/createPeriod/updatePeriod/deletePeriod` — all `(schoolId, ...)`, all `withTenant`. Controller routes under `/manage/*` guarded by `SchoolJwtGuard` + `RequireFeatureGuard` with `@RequireFeature('MANAGEMENT')` at class level.

- [ ] **Step 1: DTOs** — `CreateGradeDto {name, order}`, `CreateSubjectDto {name, code}`, `CreatePeriodDto {order, label, startTime, endTime}`, `CreateYearDto {name, startDate, endDate, isCurrent?}`. class-validator; unique-violation (P2002) → `ConflictException` in the service.

- [ ] **Step 2: `catalog.service.ts`** — each method wraps `withTenant(schoolId, tx => ...)`. Example grade create:
```ts
async createGrade(schoolId: string, dto: CreateGradeDto) {
  try { return await withTenant(schoolId, (tx) => tx.grade.create({ data: { ...dto, schoolId } })); }
  catch (e) { if (isP2002(e)) throw new ConflictException('A grade with that name already exists'); throw e; }
}
```
Add a shared `isP2002(e): boolean` helper (`e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'`) in a small `internal/prisma-errors.ts`. update/delete verify ownership via `withTenant` findUnique + null→`NotFoundException` (RLS already scopes; explicit check is defense-in-depth), `ParseUUIDPipe` on `:id`.

- [ ] **Step 3: `catalog.controller.ts`** — `@Controller('manage')`, `@UseGuards(SchoolJwtGuard, RequireFeatureGuard)`, `@RequireFeature('MANAGEMENT')` at class level. Routes: `GET/POST /manage/years`, `GET/POST/PUT/DELETE /manage/grades[...]`, same for `subjects`, `periods`. `sid()` helper via `TenantContextService.requireTenant().schoolId`.

- [ ] **Step 4: Register `ManagementModule` (imports `FeaturesModule`, `TenancyModule`) in `app.module.ts`. Typecheck.**

- [ ] **Step 5: Boot + curl the FEATURE GATE** — login as **beacon** admin (PRO): `POST /manage/grades {name:'Grade 7',order:7}` → 201. Login as **acme** admin (STANDARD): same call → **403**. This proves `RequireFeature`. Commit `feat(api): management catalog CRUD (grades/subjects/periods/years) feature-gated`.

---

### Task 2: Teachers CRUD

**Files:** `teachers.service.ts`, `teachers.controller.ts`; DTOs in `management.dto.ts`; register in module.

**Interfaces:** `TeachersService.list/create/update/remove(schoolId, ...)`. `Teacher` fields: firstName, lastName, email?, phone?, photoAssetId?, primarySubjectId?, bio?, isActive. `CreateTeacherDto` validates firstName/lastName required, email optional email, etc.

- [ ] **Step 1–3:** DTO + service (withTenant, ownership checks) + controller `/manage/teachers` (guards + `@RequireFeature('MANAGEMENT')`, `ParseUUIDPipe`).
- [ ] **Step 4:** Boot + curl CRUD as beacon; acme → 403. Isolation: unknown id → 404. Commit `feat(api): teachers CRUD (feature-gated, tenant-scoped)`.

---

### Task 3: Class sections CRUD

**Files:** `classes.service.ts`, `classes.controller.ts`; DTOs; register.

**Interfaces:** `ClassesService.list/create/update/remove`. `ClassSection` = gradeId + name + academicYearId + classTeacherId?. `CreateClassDto {gradeId, name, academicYearId, classTeacherId?}`. Create validates the referenced grade/year/teacher belong to the same school (findUnique via withTenant → 400/404 if missing). P2002 on `(schoolId,gradeId,name,academicYearId)` → 409.

- [ ] **Step 1–3:** DTO + service + controller `/manage/classes`. `list` includes grade name + classTeacher name + student count (`_count`).
- [ ] **Step 4:** Boot + curl (create a class under beacon referencing a real grade+year; duplicate → 409; acme → 403). Commit `feat(api): class sections CRUD`.

---

### Task 4: Students CRUD (mapped to class)

**Files:** `students.service.ts`, `students.controller.ts`; DTOs; register.

**Interfaces:** `StudentsService.list(schoolId, {classSectionId?})/create/update/remove`. `Student` = admissionNo, firstName, lastName, classSectionId?, rollNo?, dob?, gender?, guardianName?, guardianPhone?, photoAssetId?. `CreateStudentDto` — admissionNo + names required; classSectionId optional but if present must belong to the school. P2002 on `(schoolId, admissionNo)` → 409.

- [ ] **Step 1–3:** DTO + service + controller `/manage/students` (list supports `?classSectionId=` filter; validate classSection ownership on create/update). `list` includes classSection label (grade+name).
- [ ] **Step 4:** Boot + curl (create student mapped to a class; duplicate admissionNo → 409; filter by class; acme → 403). Commit `feat(api): students CRUD mapped to class sections`.

---

### Task 5: Timetable slots with clash detection

**Files:** `timetable.service.ts`, `timetable.controller.ts`; DTOs; register.

**Interfaces:** `TimetableService.listForClass(schoolId, classSectionId)`, `assign(schoolId, dto)`, `unassign(schoolId, id)`. `AssignSlotDto {classSectionId, dayOfWeek(1-7), periodId, subjectId, teacherId, academicYearId}`. `assign` = `tx.timetableSlot.create(...)`; catch P2002 and inspect `error.meta.target` (array of column names) to return the right 409 message:
- target includes `teacherId` → `ConflictException('That teacher is already booked in that period')`
- else (class_slot) → `ConflictException('This class already has a subject in that period')`

- [ ] **Step 1: DTO** with `@IsInt() @Min(1) @Max(7) dayOfWeek` and uuid fields.
- [ ] **Step 2: service** — `assign` wraps `withTenant`, try/catch mapping P2002 per target (add `isP2002` + a `p2002Target(e): string[]` helper). Validate all referenced ids belong to the school first (findMany count) to give 400 instead of a FK 500. `listForClass` returns slots with period/subject/teacher/day joined.
- [ ] **Step 3: controller** `/manage/timetable` — `GET /manage/timetable?classSectionId=`, `POST /manage/timetable`, `DELETE /manage/timetable/:id`.
- [ ] **Step 4: Boot + curl the CLASH cases** (beacon): create a class + periods + subject + teacher + year; assign a slot → 201; assign a DIFFERENT subject to the SAME class+day+period → 409 "class already has..."; assign the SAME teacher to a DIFFERENT class at the same day+period → 409 "teacher is already booked...". Commit `feat(api): timetable slot assignment with clash detection`.

---

### Task 6: Teacher availability + management e2e

**Files:** add `availability` to `timetable.service.ts`/controller; create `apps/api/test/management.e2e-spec.ts`.

**Interfaces:** `TimetableService.availability(schoolId, {dayOfWeek?, academicYearId})` → for each active teacher, the set of periodIds they are booked in that day (or across the week) → the web derives free/busy. Shape: `{ teachers: {id, firstName, lastName}[], periods: {id, order, label}[], busy: { teacherId, dayOfWeek, periodId }[] }`.

- [ ] **Step 1:** implement `availability` (query TimetableSlot grouped) + `GET /manage/availability?academicYearId=`.
- [ ] **Step 2:** e2e `management.e2e-spec.ts` (API booted; model on `owner.e2e-spec.ts`): as **beacon** admin — create grade/subject/period/teacher/year/class, assign a slot, GET availability shows the teacher busy in that period; assert the clash 409s; **feature gate**: same calls as **acme** admin → 403 on every management route; **isolation**: beacon token on acme host → 401. Clean up created rows in afterAll.
- [ ] **Step 3:** run e2e (booted API) + confirm cms + owner + tenant-isolation e2e still green. Commit `test(api): management e2e (feature gate + clash + availability + isolation)`.

---

### Task 7: Web — management nav + Classes + Teachers pages

**Files:** modify `apps/web/app/app/layout.tsx` (add nav: Classes, Teachers, Students, Timetable, Availability); create `classes/page.tsx`, `teachers/page.tsx`.

- [ ] **Step 1:** Add the 5 nav items to the shell (icons per lucide). 
- [ ] **Step 2:** `teachers/page.tsx` — grid of teacher cards (photo via a `?kind=STAFF` media lookup like the CMS staff tab, name, subject); "Add teacher" modal (firstName, lastName, email, photo upload → kind=STAFF → photoAssetId) → `POST /manage/teachers`; edit/delete. React Query `['teachers']`.
- [ ] **Step 3:** `classes/page.tsx` — list class cards (grade+name, class teacher, student count from the API `_count`); "Add class" modal (grade select from `/manage/grades`, section name, academic year select, class-teacher select from `/manage/teachers`) → `POST /manage/classes`. Also a small "Grades" and "Subjects" management section (add grade/subject inline) since classes depend on them.
- [ ] **Step 4:** typecheck + boot + `/app/teachers` & `/app/classes` → 200. Commit `feat(web): management nav + teachers + classes pages`.

---

### Task 8: Web — Students page

**Files:** `students/page.tsx`.

- [ ] **Step 1:** table of students (roll, name, class badge, guardian, contact) from `GET /manage/students`; filter by class (dropdown from `/manage/classes`).
- [ ] **Step 2:** "Add student" modal (name, admissionNo, roll, class select — the mapping, guardian name+phone) → `POST /manage/students`; edit/delete. Invalidate `['students']`.
- [ ] **Step 3:** typecheck + boot + `/app/students` → 200. Commit `feat(web): students management page`.

---

### Task 9: Web — Timetable builder

**Files:** `timetable/page.tsx`.

- [ ] **Step 1:** class selector (from `/manage/classes`); a grid of Periods (rows) × Mon–Fri (cols) from `/manage/periods` + `GET /manage/timetable?classSectionId=`. Empty cells show "＋".
- [ ] **Step 2:** clicking a cell opens an assign modal (subject select, teacher select) → `POST /manage/timetable`; on 409 show the clash message as an error toast (do NOT optimistically fill); on success fill the cell. Delete a slot via a cell action → `DELETE /manage/timetable/:id`.
- [ ] **Step 3:** typecheck + boot + `/app/timetable` → 200; manually assign a slot + trigger a clash. Commit `feat(web): timetable builder with clash handling`.

---

### Task 10: Web — Teacher availability + full verify

**Files:** `availability/page.tsx`.

- [ ] **Step 1:** grid Teacher (rows) × Period (cols) for a chosen day from `GET /manage/availability`; green = free, grey = busy (derive from the `busy` set). A day selector (Mon–Fri).
- [ ] **Step 2: full flow verify** (as beacon admin at `beacon.localhost:3000/app`): add a grade → subject → period → teacher → class → student mapped to it → assign a timetable slot → see the teacher busy in Availability → trigger a clash. Confirm web+api typecheck clean and management + cms + owner + tenant-isolation e2e all pass.
- [ ] **Step 3:** Commit `feat(web): teacher availability view; phase 4 management complete`.

---

## Self-review notes (author)

- **Spec coverage (§5.3):** grades/subjects/periods/years → Task 1; teachers → Tasks 2,7; class sections → Tasks 3,7; students → Tasks 4,8; timetable + clash → Tasks 5,9; availability → Tasks 6,10; feature gate + isolation → all API tasks + Task 6 e2e.
- **Feature gating is the theme:** every `/manage/*` route is `RequireFeature('MANAGEMENT')`; the e2e proves Acme (Standard) gets 403 and Beacon (Pro) succeeds. This exercises the Phase 1 feature system + Phase 2 tier/override end-to-end.
- **Deferred:** student portal (Phase 7); attendance/exams/grading (out of scope per the pivot); bulk CSV import of students; drag-drop timetable UX (click-to-assign is enough).
- **Assumptions to verify during execution:** `RequireFeatureGuard` composes correctly with `SchoolJwtGuard` (both class-level — guard order: SchoolJwtGuard first to establish tenant, then RequireFeatureGuard which reads the tenant's features); `error.meta.target` on P2002 distinguishes `teacher_slot` vs `class_slot` (it contains the constraint's column names — verify the exact shape and adjust the check); seed adds a current `AcademicYear` for beacon (Phase 1 seed created "2026-27" for beacon PRO — confirm; if acme lacks one it doesn't matter since acme has no MANAGEMENT).
