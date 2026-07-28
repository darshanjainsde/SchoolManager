# Portal Parity Round 1 — Phase 1: Server foundation & safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two authorization holes and add every server capability the synced teacher screens need, so that Phases 2–4 (web UI, mobile UI, shell) are pure client work against a finished, tested API.

**Architecture:** All work lives in `apps/api/src/modules/management` plus one Prisma migration in `packages/db`. Every new read is a single tenant-scoped transaction via `withTenant`, following the existing `AttendanceService` pattern. Contracts that both clients consume are declared once in `packages/types` so a mismatch becomes a compile error rather than a runtime divergence (item P7).

**Tech Stack:** NestJS 10, Prisma, PostgreSQL with row-level security, Jest + ts-jest for unit specs, Jest + a real `skoolos_test` database for e2e.

## Global Constraints

- **Attendance stays one register per class per day.** The `Attendance` model keeps `@@unique([studentId, date], name: "one_mark_per_student_day")`. No task may add a period dimension to attendance.
- **Every tenant-scoped read/write goes through `withTenant(schoolId, tx => …)`** from `@skoolos/db`. Never use `getPlatformPrisma()` in a request path.
- **Errors use `ApiError(code, message, status, field?)`** from `apps/api/src/common/errors/api-error.ts`, or the Nest exception the surrounding code already throws. The client renders `message` verbatim, so it must read as a sentence a teacher understands.
- **Dates crossing the wire are `YYYY-MM-DD` strings** validated against `/^\d{4}-\d{2}-\d{2}$/`. Server-side "today" is IST, via the existing helpers in `apps/api/src/modules/management/internal/timetable-date.ts`.
- **New role guards use `@Roles(...)` + `RolesGuard`.** `RolesGuard` uses `getAllAndOverride`, so a method-level `@Roles` **replaces** the class-level list rather than adding to it.
- **Unit specs are `*.spec.ts` beside the service**, mocking `@skoolos/db`'s `withTenant` exactly as `attendance-status.service.spec.ts` does. They run with `pnpm --filter @skoolos/api test` and need no database.
- **E2E specs are `test/*.e2e-spec.ts`** and need Postgres on `localhost:5432` with the `skoolos` superuser. Start it with `docker compose up -d` from the repo root before running `pnpm --filter @skoolos/api test:e2e`.
- **Commit after every task**, message prefixed `feat(api):`, `fix(api):`, or `feat(db):`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | Adds `ClassNote`, `ClassTodo`, `RegisterChangeRequest` models + `RegisterChangeStatus` enum |
| `packages/db/prisma/migrations/*/migration.sql` | The generated migration, plus hand-added RLS policies for the three new tables |
| `packages/types/src/index.ts` | Re-exports the contract types both clients consume |
| `apps/api/src/modules/management/classes.controller.ts` | Gains `RolesGuard` + per-handler `@Roles` |
| `apps/api/src/modules/management/timetable.controller.ts` | Gains `RolesGuard` + per-handler `@Roles`, and the two teacher read endpoints |
| `apps/api/src/modules/management/attendance.service.ts` | `myClassSections` gains substitution cover; `save` gains ownership + past-day lock enforcement |
| `apps/api/src/modules/management/internal/class-access.ts` | **New.** The single definition of "may this teacher act on this class on this date", used by attendance, notes and register-change |
| `apps/api/src/modules/management/teacher-day.service.ts` | **New.** Builds a teacher's day: periods + slots + substitutions + register status in one call |
| `apps/api/src/modules/management/class-notes.service.ts` | **New.** Notes and to-dos for a class on a date |
| `apps/api/src/modules/management/class-notes.controller.ts` | **New.** `manage/class-notes`, `manage/class-todos` |
| `apps/api/src/modules/management/register-change.service.ts` | **New.** Request / approve / reject a past-register unlock |
| `apps/api/src/modules/management/register-change.controller.ts` | **New.** `manage/register-changes` |
| `apps/api/src/modules/management/management.module.ts` | Registers the three new services and two new controllers |

Notes and to-dos share a service and controller because they are the same shape, are always read together by the Today screen, and always change together. The register-change flow is its own unit because it has a distinct lifecycle (request → review) and its own audit obligations.

---

## Task 1: Lock down the unguarded management controllers

Closes item **P3**. `ClassesController` and `TimetableController` mount `SchoolJwtGuard` and `RequireFeatureGuard` but no `RolesGuard`, so any authenticated user of the school — including a STUDENT — can create, rename and delete class sections and timetable slots.

**Files:**
- Modify: `apps/api/src/modules/management/classes.controller.ts:19-21`
- Modify: `apps/api/src/modules/management/timetable.controller.ts:19-21`
- Test: `apps/api/test/management-authz.e2e-spec.ts` (create)

**Interfaces:**
- Consumes: `RolesGuard`, `Roles` from `apps/api/src/common/auth/`
- Produces: nothing new. `GET /manage/classes` stays readable by `TEACHER` and `SCHOOL_ADMIN` because Task 4's teacher screens still read it; all writes become `SCHOOL_ADMIN` only.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/management-authz.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

describe('management authorization', () => {
  let app: INestApplication;
  let schoolId: string;
  let host: string;
  let studentToken: string;
  let teacherToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const as = (token: string) =>
    ({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': host });

  it('a STUDENT cannot list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(studentToken))
      .expect(403);
  });

  it('a STUDENT cannot create a class section', async () => {
    await request(app.getHttpServer())
      .post('/manage/classes')
      .set(as(studentToken))
      .send({ gradeId: '00000000-0000-0000-0000-000000000001', name: 'Z' })
      .expect(403);
  });

  it('a TEACHER cannot delete a class section', async () => {
    await request(app.getHttpServer())
      .delete('/manage/classes/00000000-0000-0000-0000-000000000001')
      .set(as(teacherToken))
      .expect(403);
  });

  it('a TEACHER can still list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(teacherToken))
      .expect(200);
  });

  it('a SCHOOL_ADMIN can list class sections', async () => {
    await request(app.getHttpServer())
      .get('/manage/classes')
      .set(as(adminToken))
      .expect(200);
  });

  it('a STUDENT cannot assign a timetable slot', async () => {
    await request(app.getHttpServer())
      .post('/manage/timetable')
      .set(as(studentToken))
      .send({})
      .expect(403);
  });

  it('a TEACHER cannot assign a timetable slot', async () => {
    await request(app.getHttpServer())
      .post('/manage/timetable')
      .set(as(teacherToken))
      .send({})
      .expect(403);
  });
});
```

If `test/integration/helpers.ts` does not already export `signSchoolToken` and `seedMinimalSchool`, create them first by copying the token-signing and seeding code out of `test/management.e2e-spec.ts` — read that file and lift the existing helpers rather than inventing new ones, so both suites seed identically.

- [ ] **Step 2: Run the test to verify it fails**

```bash
docker compose up -d          # from the repo root; e2e needs Postgres on :5432
cd apps/api && pnpm test:e2e -- management-authz
```

Expected: the STUDENT and TEACHER write tests FAIL with `200`/`400`/`404` instead of `403`, because no role guard is applied.

- [ ] **Step 3: Add the guards**

In `apps/api/src/modules/management/classes.controller.ts`, add the imports and change the decorators:

```ts
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';

@Controller('manage/classes')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class ClassesController {
```

Then widen only the read, mirroring how `students.controller.ts` does it:

```ts
  // Teachers read the class list to pick a section on the attendance and
  // tests screens. Every mutation stays admin-only.
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get()
  list() {
    return this.classes.list(this.sid());
  }
```

Leave `@Post`, `@Put(':id')` and `@Delete(':id')` without a method-level `@Roles`, so they inherit the class-level `SCHOOL_ADMIN`.

In `apps/api/src/modules/management/timetable.controller.ts`, apply the same treatment:

```ts
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';

@Controller('manage/timetable')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class TimetableController {
```

and widen the class read, which the admin timetable screen and Task 4 both use:

```ts
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get()
  listForClass(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date?: string,
  ) {
    return this.timetable.listForClass(this.sid(), classSectionId, date);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && pnpm test:e2e -- management-authz
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full existing suites to check nothing regressed**

```bash
cd apps/api && pnpm test && pnpm test:e2e
```

Expected: all previously-passing suites still pass. If an existing e2e suite now 403s, it was relying on the missing guard — fix the suite to use an admin token, not the guard.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/management/classes.controller.ts \
        apps/api/src/modules/management/timetable.controller.ts \
        apps/api/test/management-authz.e2e-spec.ts \
        apps/api/test/integration/helpers.ts
git commit -m "fix(api): require SCHOOL_ADMIN to mutate class sections and timetable slots

Both controllers mounted SchoolJwtGuard and RequireFeatureGuard but no
RolesGuard, so any authenticated user of the school - including a STUDENT -
could create, rename and delete class sections and timetable slots. Reads
stay open to TEACHER because the teacher screens need them."
```

---

## Task 2: Attendance ownership, including substitution cover

Closes item **T10**. `AttendanceService.save` validates that the marked students belong to the section, but never that the section belongs to the caller — so any teacher can mark any class by id. Your note also requires that a teacher covering a substituted period *can* mark that class for that day.

**Files:**
- Modify: `apps/api/src/modules/management/attendance.service.ts:115-141` (`myClassSections`) and `:253-284` (`save`)
- Test: `apps/api/src/modules/management/attendance-ownership.spec.ts` (create)

**Interfaces:**
- Consumes: `Substitution` model (already exists: `classSectionId`, `periodId`, `date`, `originalTeacherId`, `substituteTeacherId`).
- Produces:
  - `AttendanceService.myClassSections(schoolId, userId, role, opts?: { date?: string })` — `date` defaults to today (IST); when given, sections the caller substitutes for on that date are included.
  - `AttendanceService.assertCanMark(tx, schoolId, teacherId, classSectionId, date): Promise<void>` — private; throws `ApiError('FORBIDDEN', …, 403)`.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/management/attendance-ownership.spec.ts`:

```ts
const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  substitution: { findMany: jest.fn(), findFirst: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AttendanceService } from './attendance.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_USER = 'user-teacher-1';
const TEACHER_ID = 'teacher-1';
const MINE = 'section-mine';
const NOT_MINE = 'section-not-mine';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('AttendanceService ownership', () => {
  const notifications = { notify: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
    txMock.classSection.findFirst.mockResolvedValue({ id: NOT_MINE });
    txMock.student.findMany.mockResolvedValue([{ id: 'stu-1' }]);
    txMock.attendance.findMany.mockResolvedValue([]);
    txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
    txMock.attendance.createMany.mockResolvedValue({ count: 1 });
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
  });

  const dto = (classSectionId: string, date = today()) => ({
    classSectionId,
    date,
    marks: [{ studentId: 'stu-1', status: 'PRESENT' as const }],
  });

  it('rejects a save for a section the teacher neither owns nor covers', async () => {
    // Not the class teacher, holds no slot, has no substitution today.
    txMock.classSection.findMany.mockResolvedValue([]);

    await expect(svc.save(SCHOOL, TEACHER_USER, dto(NOT_MINE))).rejects.toMatchObject({
      status: 403,
    });
    expect(txMock.attendance.createMany).not.toHaveBeenCalled();
  });

  it('allows a save for a section the teacher owns', async () => {
    txMock.classSection.findMany.mockResolvedValue([
      { id: MINE, name: 'B', grade: { name: '7' }, _count: { students: 1 } },
    ]);
    txMock.classSection.findFirst.mockResolvedValue({ id: MINE });

    const res = await svc.save(SCHOOL, TEACHER_USER, dto(MINE));

    expect(res.saved).toBe(1);
    expect(txMock.attendance.createMany).toHaveBeenCalled();
  });

  it('allows a save for a section the teacher is substituting on that date', async () => {
    txMock.classSection.findMany.mockResolvedValue([]); // not theirs normally
    txMock.classSection.findFirst.mockResolvedValue({ id: NOT_MINE });
    txMock.substitution.findMany.mockResolvedValue([
      { classSectionId: NOT_MINE, substituteTeacherId: TEACHER_ID },
    ]);

    const res = await svc.save(SCHOOL, TEACHER_USER, dto(NOT_MINE));

    expect(res.saved).toBe(1);
  });

  it('a SCHOOL_ADMIN may mark any section', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null); // admins usually have no Teacher row
    txMock.classSection.findFirst.mockResolvedValue({ id: NOT_MINE });

    const res = await svc.save(SCHOOL, 'user-admin-1', dto(NOT_MINE), 'SCHOOL_ADMIN');

    expect(res.saved).toBe(1);
  });

  it('myClassSections includes sections covered by substitution today', async () => {
    txMock.classSection.findMany.mockResolvedValueOnce([
      { id: MINE, name: 'B', grade: { name: '7' }, _count: { students: 30 } },
    ]);
    txMock.substitution.findMany.mockResolvedValue([
      { classSectionId: NOT_MINE, substituteTeacherId: TEACHER_ID },
    ]);
    txMock.classSection.findMany.mockResolvedValueOnce([
      { id: NOT_MINE, name: 'A', grade: { name: '9' }, _count: { students: 26 } },
    ]);

    const rows = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER');

    expect(rows.map((r) => r.classSectionId).sort()).toEqual([MINE, NOT_MINE].sort());
    expect(rows.find((r) => r.classSectionId === NOT_MINE)?.covering).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && pnpm test -- attendance-ownership
```

Expected: FAIL — `save` currently takes three arguments and performs no ownership check, so the first test resolves instead of rejecting and the fourth fails on arity.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/management/attendance.service.ts`, extend the `MyClassSection` interface:

```ts
export interface MyClassSection {
  classSectionId: string;
  name: string;
  studentCount: number;
  /** True when the caller holds this section only as a substitute on the queried date. */
  covering: boolean;
}
```

Update the mapper to accept the flag:

```ts
  private static toMyClassSection(
    c: { id: string; name: string; grade: { name: string }; _count: { students: number } },
    covering = false,
  ): MyClassSection {
    return {
      classSectionId: c.id,
      name: `${c.grade.name}-${c.name}`,
      studentCount: c._count.students,
      covering,
    };
  }
```

Replace `myClassSections` with a version that folds in substitutions:

```ts
  /**
   * The sections a caller may take/view attendance for on `date` (default
   * today, IST). SCHOOL_ADMIN sees every section. A TEACHER sees the sections
   * where they are the class teacher OR hold a timetable slot, PLUS any
   * section they are covering as a substitute on that specific date — a
   * substitution is a one-day grant, so it never widens any other day.
   */
  async myClassSections(
    schoolId: string,
    userId: string,
    role: string,
    opts: { date?: string } = {},
  ): Promise<MyClassSection[]> {
    const date = opts.date ?? istTodayISO();
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }

    return withTenant(schoolId, async (tx) => {
      if (role === 'SCHOOL_ADMIN') {
        const sections = await tx.classSection.findMany({
          select: AttendanceService.CLASS_SELECT,
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        });
        return sections.map((c) => AttendanceService.toMyClassSection(c));
      }

      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) return [];

      const owned = await tx.classSection.findMany({
        where: {
          OR: [
            { classTeacherId: teacher.id },
            { timetableSlots: { some: { teacherId: teacher.id } } },
          ],
        },
        select: AttendanceService.CLASS_SELECT,
        orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
      });
      const ownedIds = new Set(owned.map((c) => c.id));

      const subs = await tx.substitution.findMany({
        where: { date: new Date(date), substituteTeacherId: teacher.id },
        select: { classSectionId: true },
      });
      const coveredIds = [...new Set(subs.map((s) => s.classSectionId))].filter(
        (id) => !ownedIds.has(id),
      );

      const covered = coveredIds.length
        ? await tx.classSection.findMany({
            where: { id: { in: coveredIds } },
            select: AttendanceService.CLASS_SELECT,
            orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
          })
        : [];

      return [
        ...owned.map((c) => AttendanceService.toMyClassSection(c, false)),
        ...covered.map((c) => AttendanceService.toMyClassSection(c, true)),
      ];
    });
  }
```

Add the IST-today helper to `apps/api/src/modules/management/internal/timetable-date.ts`, which already owns this module's IST date logic — **not** to `attendance.service.ts`, because Task 4's controller needs it too and a second private copy would be the exact duplication item P7 exists to stop:

```ts
/**
 * Today's calendar date in IST as `YYYY-MM-DD` — the timezone a school day is
 * judged in. Not `toISOString().slice(0,10)` on a bare `new Date()`, which
 * reports the UTC day and rolls backwards for any IST evening after 18:30.
 */
export function istTodayISO(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
```

and import it in `attendance.service.ts`:

```ts
import { istTodayISO } from './internal/timetable-date';
```

Add a spec for it in `apps/api/src/modules/management/internal/timetable-date.spec.ts` (or extend the existing one if present):

```ts
import { istTodayISO } from './timetable-date';

describe('istTodayISO', () => {
  it('reports the IST calendar day, not the UTC one', () => {
    // 2026-08-03T19:00:00Z is 2026-08-04 00:30 IST — the next school day.
    expect(istTodayISO(new Date('2026-08-03T19:00:00Z'))).toBe('2026-08-04');
  });

  it('does not roll forward before the IST midnight boundary', () => {
    // 2026-08-03T18:00:00Z is 2026-08-03 23:30 IST — still the same day.
    expect(istTodayISO(new Date('2026-08-03T18:00:00Z'))).toBe('2026-08-03');
  });
});
```

Create the shared access rule at `apps/api/src/modules/management/internal/class-access.ts`. Three services need this exact question answered — attendance (Task 2), class notes (Task 5) and register changes (Task 6) — so it is defined once. Three copies of an authorization predicate is precisely the drift item P7 exists to prevent, and the copy that gets forgotten is a security hole rather than a cosmetic difference:

```ts
import { ApiError } from '../../../common/errors/api-error';

/** The slice of a tenant transaction this rule needs. Structural, so callers pass their `tx` unchanged. */
export interface ClassAccessTx {
  teacher: { findFirst(args: unknown): Promise<{ id: string } | null> };
  classSection: { findFirst(args: unknown): Promise<{ id: string } | null> };
  substitution: { findFirst(args: unknown): Promise<{ id: string } | null> };
}

/**
 * Resolves `userId` to a Teacher and asserts they may act on `classSectionId`
 * on `date`. "May act" means one of three things, and nothing else:
 *
 *   1. they are the section's class teacher,
 *   2. they hold at least one timetable slot in it, or
 *   3. they are the named substitute for one of its periods on that date.
 *
 * Case 3 is a ONE-DAY grant: a substitution never widens access to any other
 * date, which is why `date` is part of the question rather than ambient.
 *
 * Returns the caller's `Teacher.id` so callers can attribute the write.
 * Throws `ApiError(..., 403)` otherwise — never returns a boolean, so a
 * caller cannot forget to branch on it.
 */
export async function requireClassAccess(
  tx: ClassAccessTx,
  userId: string,
  classSectionId: string,
  date: string,
  action = 'take attendance for',
): Promise<string> {
  const teacher = await tx.teacher.findFirst({ where: { userId } });
  if (!teacher) {
    throw new ApiError('FORBIDDEN', `Only a teacher can ${action} a class.`, 403);
  }

  const owned = await tx.classSection.findFirst({
    where: {
      id: classSectionId,
      OR: [
        { classTeacherId: teacher.id },
        { timetableSlots: { some: { teacherId: teacher.id } } },
      ],
    },
    select: { id: true },
  });
  if (owned) return teacher.id;

  const covering = await tx.substitution.findFirst({
    where: { classSectionId, date: new Date(date), substituteTeacherId: teacher.id },
    select: { id: true },
  });
  if (covering) return teacher.id;

  throw new ApiError(
    'FORBIDDEN',
    `You can only ${action} your own classes.`,
    403,
    'classSectionId',
  );
}
```

Give it its own spec at `apps/api/src/modules/management/internal/class-access.spec.ts`:

```ts
import { requireClassAccess } from './class-access';

const tx = () => ({
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
});

const DATE = '2026-08-03';

describe('requireClassAccess', () => {
  it('returns the teacher id when they are the class teacher or hold a slot', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue({ id: 'sec-1' });

    await expect(requireClassAccess(t, 'user-1', 'sec-1', DATE)).resolves.toBe('teacher-1');
    expect(t.substitution.findFirst).not.toHaveBeenCalled();
  });

  it('returns the teacher id when they are the substitute on that date', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).resolves.toBe('teacher-1');
  });

  it('scopes the substitution grant to the exact date asked about', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-1', 'sec-9', DATE)).rejects.toMatchObject({ status: 403 });
    expect(t.substitution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ date: new Date(DATE), substituteTeacherId: 'teacher-1' }),
      }),
    );
  });

  it('403s a caller with no Teacher row', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue(null);

    await expect(requireClassAccess(t, 'user-admin', 'sec-1', DATE)).rejects.toMatchObject({ status: 403 });
  });

  it('names the action in the message so each caller reads naturally', async () => {
    const t = tx();
    t.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    t.classSection.findFirst.mockResolvedValue(null);
    t.substitution.findFirst.mockResolvedValue(null);

    await expect(
      requireClassAccess(t, 'user-1', 'sec-9', DATE, 'add notes to'),
    ).rejects.toMatchObject({ message: 'You can only add notes to your own classes.' });
  });
});
```

Change `save`'s signature to accept the caller's role, and call the assertion right after the section lookup:

```ts
  async save(
    schoolId: string,
    callerUserId: string,
    dto: SaveAttendanceDto,
    callerRole = 'TEACHER',
  ): Promise<SaveAttendanceResult> {
```

and inside the transaction, immediately after the existing `if (!section) { … }` block:

```ts
      const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });

      // A SCHOOL_ADMIN may mark any section; a TEACHER may not. This is the
      // server-side twin of the client only showing their own classes —
      // without it, knowing a classSectionId was enough to write its register.
      if (callerRole !== 'SCHOOL_ADMIN') {
        await requireClassAccess(tx, callerUserId, dto.classSectionId, dto.date);
      }
```

with the import at the top of `attendance.service.ts`:

```ts
import { requireClassAccess } from './internal/class-access';
```

Delete the later `const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });` line (now hoisted above) and keep `const markedById = teacher?.id ?? callerUserId;` where it is.

Update the controller to pass the role — in `apps/api/src/modules/management/attendance.controller.ts`:

```ts
  @Put()
  save(@Body() dto: SaveAttendanceDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.attendance.save(this.sid(), u.sub, dto, u.role);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && pnpm test -- attendance-ownership
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the existing attendance suites**

```bash
cd apps/api && pnpm test -- attendance
```

Expected: `attendance.service.spec.ts` and `attendance-status.service.spec.ts` still pass. `myClassSections` now returns a `covering` field, so update any assertion in `attendance-status.service.spec.ts` that compares whole objects with `toEqual` — add `covering: false` to the expected shape rather than loosening the assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/management/attendance.service.ts \
        apps/api/src/modules/management/attendance.controller.ts \
        apps/api/src/modules/management/attendance-ownership.spec.ts \
        apps/api/src/modules/management/attendance-status.service.spec.ts
git commit -m "fix(api): a teacher can only mark registers for their own or covered classes

save() checked that the marked students belong to the section but never that
the section belongs to the caller, so any teacher could write any class's
register by id. Ownership now means class teacher, timetable slot holder, or
named substitute for that specific date; SCHOOL_ADMIN is unrestricted."
```

---

## Task 3: Notes, to-dos and register-change models

Adds the tables Tasks 5–7 need. Closes the schema half of **T1** (per-class notes and to-dos) and **T11** (past-register change requests).

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_class_notes_todos_register_changes/migration.sql` (generated, then hand-edited for RLS)
- Test: `apps/api/test/new-models-rls.e2e-spec.ts` (create)

**Interfaces:**
- Produces: Prisma models `ClassNote`, `ClassTodo`, `RegisterChangeRequest`, and enum `RegisterChangeStatus`.

- [ ] **Step 1: Add the models**

Append to `packages/db/prisma/schema.prisma`, next to the other management models:

```prisma
enum RegisterChangeStatus {
  PENDING
  APPROVED
  REJECTED
}

/// A teacher's running notes about one class on one day. Scoped to the class
/// and the date, not to the teacher, so a co-teacher of the same section sees
/// the same log — the point is continuity for the class, not a private diary.
model ClassNote {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @db.Uuid
  classSectionId String   @db.Uuid
  date           DateTime @db.Date
  body           String
  authorTeacherId String  @db.Uuid
  createdAt      DateTime @default(now())
  school         School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection   ClassSection @relation(fields: [classSectionId], references: [id], onDelete: Cascade)

  @@index([schoolId, classSectionId, date])
}

/// A tickable task a teacher sets for one class on one day.
model ClassTodo {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @db.Uuid
  classSectionId String   @db.Uuid
  date           DateTime @db.Date
  body           String
  done           Boolean  @default(false)
  authorTeacherId String  @db.Uuid
  createdAt      DateTime @default(now())
  school         School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection   ClassSection @relation(fields: [classSectionId], references: [id], onDelete: Cascade)

  @@index([schoolId, classSectionId, date])
}

/// A request to reopen a past day's register. Registers lock at the end of
/// their own day; an APPROVED request re-opens exactly one (class, date)
/// until `expiresAt`, after which it locks again without needing revocation.
model RegisterChangeRequest {
  id             String               @id @default(uuid()) @db.Uuid
  schoolId       String               @db.Uuid
  classSectionId String               @db.Uuid
  date           DateTime             @db.Date
  requestedByTeacherId String         @db.Uuid
  reason         String
  status         RegisterChangeStatus @default(PENDING)
  reviewedByUserId String?            @db.Uuid
  reviewedAt     DateTime?
  expiresAt      DateTime?
  createdAt      DateTime             @default(now())
  school         School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection   ClassSection @relation(fields: [classSectionId], references: [id], onDelete: Cascade)

  @@index([schoolId, status])
  @@index([schoolId, classSectionId, date])
}
```

Add the back-relations these require. On `model School`, add:

```prisma
  classNotes             ClassNote[]
  classTodos             ClassTodo[]
  registerChangeRequests RegisterChangeRequest[]
```

On `model ClassSection`, add:

```prisma
  classNotes             ClassNote[]
  classTodos             ClassTodo[]
  registerChangeRequests RegisterChangeRequest[]
```

- [ ] **Step 2: Generate the migration**

```bash
docker compose up -d
cd packages/db && pnpm exec prisma migrate dev --name class_notes_todos_register_changes
```

Expected: a new folder under `packages/db/prisma/migrations/`.

- [ ] **Step 3: Add RLS policies to the migration**

Every tenant table in this schema carries row-level security. Open the generated `migration.sql`, read how an existing migration enables RLS for a tenant table (grep the migrations folder for `ENABLE ROW LEVEL SECURITY` and copy the exact pattern and role names used there), and append the equivalent for all three new tables. The policy predicate must be the same `schoolId = current_setting(...)::uuid` form the existing tables use.

- [ ] **Step 4: Write the RLS test**

Create `apps/api/test/new-models-rls.e2e-spec.ts`:

```ts
import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';

describe('RLS on the new management tables', () => {
  let acmeId: string;
  let beaconId: string;
  let acmeSection: string;
  let beaconSection: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const acme = await p.school.upsert({
      where: { slug: 'rls-acme' },
      update: {},
      create: { slug: 'rls-acme', name: 'Acme', tier: 'STANDARD', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'rls-beacon' },
      update: {},
      create: { slug: 'rls-beacon', name: 'Beacon', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;
    // Build one class section per school. Read test/management.e2e-spec.ts for
    // the exact academicYear/grade scaffolding this needs and reuse it.
    acmeSection = await makeSection(p, acmeId, 'A');
    beaconSection = await makeSection(p, beaconId, 'B');

    await p.classNote.create({
      data: { schoolId: acmeId, classSectionId: acmeSection, date: new Date('2026-08-03'),
              body: 'acme note', authorTeacherId: acmeId },
    });
    await p.classNote.create({
      data: { schoolId: beaconId, classSectionId: beaconSection, date: new Date('2026-08-03'),
              body: 'beacon note', authorTeacherId: beaconId },
    });
  });

  afterAll(async () => { await disconnectAll(); });

  it('a tenant sees only its own class notes', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.classNote.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0].body).toBe('acme note');
  });

  it('a tenant cannot forge a note owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.classNote.create({
          data: { schoolId: beaconId, classSectionId: beaconSection,
                  date: new Date('2026-08-03'), body: 'x', authorTeacherId: acmeId },
        }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('a tenant sees only its own register change requests', async () => {
    await withTenant(acmeId, (tx) =>
      tx.registerChangeRequest.create({
        data: { schoolId: acmeId, classSectionId: acmeSection, date: new Date('2026-07-31'),
                requestedByTeacherId: acmeId, reason: 'late slip' },
      }),
    );
    const mine = await withTenant(acmeId, (tx) => tx.registerChangeRequest.findMany());
    const theirs = await withTenant(beaconId, (tx) => tx.registerChangeRequest.findMany());
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(0);
  });
});
```

Write the `makeSection` helper at the bottom of the file, creating an `AcademicYear`, a `Grade` and a `ClassSection` for the given school — copy the field requirements from `packages/db/prisma/schema.prisma` so nothing is guessed.

- [ ] **Step 5: Run the test**

```bash
cd apps/api && pnpm test:e2e -- new-models-rls
```

Expected: PASS, 3 tests. A failure on the "cannot forge" test means the RLS policy is missing its `WITH CHECK` clause.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/test/new-models-rls.e2e-spec.ts
git commit -m "feat(db): ClassNote, ClassTodo and RegisterChangeRequest models with RLS

Notes and to-dos are scoped to a class and a date rather than to a teacher, so
a co-teacher of the same section sees the same log. An approved register change
reopens exactly one class+date until expiresAt, so the lock reasserts itself
without needing revocation."
```

---

## Task 4: The teacher's day — periods, cover and register status in one call

The Today screen needs, in a single request: today's periods in order with their clock times, which class sits in each, whether the caller is covering it, and whether that class's register is already taken. Closes the server half of **T1**, **T2** and **T22**.

**Files:**
- Create: `apps/api/src/modules/management/teacher-day.service.ts`
- Modify: `apps/api/src/modules/management/timetable.controller.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`
- Test: `apps/api/src/modules/management/teacher-day.service.spec.ts` (create)

**Interfaces:**
- Consumes: `AttendanceService.dayStatus(schoolId, userId, role, date)` (unchanged).
- Produces:

```ts
export interface TeacherDayEntry {
  periodId: string;
  label: string;          // "P4"
  startTime: string;      // "10:35"
  endTime: string;        // "11:20"
  kind: 'CLASS' | 'BREAK';
  /** null for a BREAK period, or a CLASS period the teacher does not teach. */
  slot: {
    classSectionId: string;
    className: string;    // "8-C"
    subjectName: string;
    covering: boolean;
    coveringFor: string | null;
  } | null;
  /** null when `slot` is null. */
  register: { taken: boolean; present: number; total: number; markedBy: string | null } | null;
}

export interface TeacherDay {
  date: string;           // YYYY-MM-DD
  dayOfWeek: number;      // 1 = Monday … 7 = Sunday
  entries: TeacherDayEntry[];
}
```

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/management/teacher-day.service.spec.ts`:

```ts
const txMock = {
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  period: { findMany: jest.fn() },
  timetableSlot: { findMany: jest.fn() },
  substitution: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { TeacherDayService } from './teacher-day.service';
import type { AttendanceService } from './attendance.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const MONDAY = '2026-08-03';

describe('TeacherDayService', () => {
  const attendance = { dayStatus: jest.fn() };
  const svc = new TeacherDayService(attendance as unknown as AttendanceService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.period.findMany.mockResolvedValue([
      { id: 'per-1', order: 1, label: 'P1', startTime: '08:00', endTime: '08:45', kind: 'CLASS' },
      { id: 'per-b', order: 2, label: 'Break', startTime: '08:45', endTime: '09:05', kind: 'BREAK' },
      { id: 'per-2', order: 3, label: 'P2', startTime: '09:05', endTime: '09:50', kind: 'CLASS' },
    ]);
    txMock.timetableSlot.findMany.mockResolvedValue([
      {
        periodId: 'per-1',
        classSectionId: 'sec-8c',
        classSection: { id: 'sec-8c', name: 'C', grade: { name: '8' } },
        subject: { name: 'Mathematics' },
        teacherId: TID,
      },
    ]);
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.teacher.findMany.mockResolvedValue([]);
    attendance.dayStatus.mockResolvedValue([]);
  });

  it('returns every period in order, including breaks', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries.map((e) => e.label)).toEqual(['P1', 'Break', 'P2']);
    expect(day.entries[1].kind).toBe('BREAK');
    expect(day.entries[1].slot).toBeNull();
  });

  it('reports the day of week for the requested date', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.dayOfWeek).toBe(1);
    expect(day.date).toBe(MONDAY);
  });

  it('attaches the class the teacher teaches in a period', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[0].slot).toMatchObject({
      classSectionId: 'sec-8c',
      className: '8-C',
      subjectName: 'Mathematics',
      covering: false,
    });
  });

  it('leaves a period the teacher does not teach empty', async () => {
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[2].slot).toBeNull();
  });

  it('adds a covered period, naming the teacher being covered for', async () => {
    txMock.substitution.findMany.mockResolvedValue([
      { periodId: 'per-2', classSectionId: 'sec-9a', substituteTeacherId: TID, originalTeacherId: 'teacher-9' },
    ]);
    txMock.timetableSlot.findMany.mockResolvedValue([
      {
        periodId: 'per-1', classSectionId: 'sec-8c',
        classSection: { id: 'sec-8c', name: 'C', grade: { name: '8' } },
        subject: { name: 'Mathematics' }, teacherId: TID,
      },
      {
        periodId: 'per-2', classSectionId: 'sec-9a',
        classSection: { id: 'sec-9a', name: 'A', grade: { name: '9' } },
        subject: { name: 'Mathematics' }, teacherId: 'teacher-9',
      },
    ]);
    txMock.teacher.findMany.mockResolvedValue([
      { id: 'teacher-9', firstName: 'Ravi', lastName: 'Kumar' },
    ]);

    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);

    expect(day.entries[2].slot).toMatchObject({
      classSectionId: 'sec-9a',
      className: '9-A',
      covering: true,
      coveringFor: 'Ravi Kumar',
    });
  });

  it('merges the register status for each class period', async () => {
    attendance.dayStatus.mockResolvedValue([
      { classSectionId: 'sec-8c', name: '8-C', taken: true, present: 27, total: 28, markedBy: 'Anita Rao', markedAt: null },
    ]);
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries[0].register).toEqual({
      taken: true, present: 27, total: 28, markedBy: 'Anita Rao',
    });
  });

  it('rejects a malformed date', async () => {
    await expect(svc.forTeacher(SCHOOL, USER, 'TEACHER', '03-08-2026')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('keeps the version window AND the ownership filter in the slot query', async () => {
    // Regression guard: both conditions must sit under `AND`. Declaring a
    // second top-level `OR` key replaces the first, which would silently
    // return superseded timetable versions.
    txMock.substitution.findMany.mockResolvedValue([
      { periodId: 'per-2', classSectionId: 'sec-9a', substituteTeacherId: TID, originalTeacherId: 'teacher-9' },
    ]);

    await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);

    const where = txMock.timetableSlot.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR).toEqual([
      { effectiveTo: null },
      { effectiveTo: { gt: new Date(MONDAY) } },
    ]);
  });

  it('returns an empty day for a caller with no Teacher row', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    const day = await svc.forTeacher(SCHOOL, USER, 'TEACHER', MONDAY);
    expect(day.entries.every((e) => e.slot === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && pnpm test -- teacher-day
```

Expected: FAIL — `Cannot find module './teacher-day.service'`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/management/teacher-day.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { AttendanceService } from './attendance.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TeacherDayEntry {
  periodId: string;
  label: string;
  startTime: string;
  endTime: string;
  kind: 'CLASS' | 'BREAK';
  slot: {
    classSectionId: string;
    className: string;
    subjectName: string;
    covering: boolean;
    coveringFor: string | null;
  } | null;
  register: { taken: boolean; present: number; total: number; markedBy: string | null } | null;
}

export interface TeacherDay {
  date: string;
  dayOfWeek: number;
  entries: TeacherDayEntry[];
}

/**
 * One call that answers "what is my day, and what still needs marking?".
 * The Today screen on both clients renders straight from this, so the two
 * surfaces cannot drift on which period is current or which register is open.
 */
@Injectable()
export class TeacherDayService {
  constructor(private readonly attendance: AttendanceService) {}

  async forTeacher(
    schoolId: string,
    userId: string,
    role: string,
    date: string,
  ): Promise<TeacherDay> {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    // getUTCDay() on a date-only string is timezone-stable; 0 (Sunday) maps to 7
    // so the value matches TimetableSlot.dayOfWeek's 1-7 Monday-first encoding.
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

    const status = await this.attendance.dayStatus(schoolId, userId, role, date);
    const bySection = new Map(status.map((s) => [s.classSectionId, s]));

    const entries = await withTenant(schoolId, async (tx) => {
      const periods = await tx.period.findMany({
        where: { schoolId },
        orderBy: { order: 'asc' },
        select: { id: true, label: true, startTime: true, endTime: true, kind: true },
      });

      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) {
        return periods.map((p) => ({
          periodId: p.id,
          label: p.label,
          startTime: p.startTime,
          endTime: p.endTime,
          kind: p.kind as 'CLASS' | 'BREAK',
          slot: null,
          register: null,
        }));
      }

      const subs = await tx.substitution.findMany({
        where: { date: new Date(date), substituteTeacherId: teacher.id },
        select: { periodId: true, classSectionId: true, originalTeacherId: true },
      });
      const subByPeriod = new Map(subs.map((s) => [s.periodId, s]));

      // One query covering both the teacher's own slots and the slots being
      // covered, rather than a query per period.
      //
      // Both conditions go under `AND` with their own nested `OR`. A sibling
      // `OR` key at the top level would silently REPLACE the version-window
      // `OR` — the same object key twice — and quietly return superseded
      // timetable versions.
      const asOf = new Date(date);
      const slots = await tx.timetableSlot.findMany({
        where: {
          dayOfWeek,
          effectiveFrom: { lte: asOf },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] },
            subs.length
              ? {
                  OR: [
                    { teacherId: teacher.id },
                    {
                      periodId: { in: subs.map((s) => s.periodId) },
                      classSectionId: { in: subs.map((s) => s.classSectionId) },
                    },
                  ],
                }
              : { teacherId: teacher.id },
          ],
        },
        select: {
          periodId: true,
          classSectionId: true,
          teacherId: true,
          subject: { select: { name: true } },
          classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
        },
      });

      const originalIds = [...new Set(subs.map((s) => s.originalTeacherId))];
      const originals = originalIds.length
        ? await tx.teacher.findMany({
            where: { id: { in: originalIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const originalNames = new Map(originals.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));

      const slotByPeriod = new Map<string, (typeof slots)[number]>();
      for (const s of slots) {
        const sub = subByPeriod.get(s.periodId);
        const isCover = !!sub && sub.classSectionId === s.classSectionId;
        // Own slot wins over a cover in the same period — a teacher cannot be
        // in two rooms, and their own timetable is the stronger claim.
        if (s.teacherId === teacher.id || isCover) {
          const existing = slotByPeriod.get(s.periodId);
          if (!existing || existing.teacherId !== teacher.id) slotByPeriod.set(s.periodId, s);
        }
      }

      return periods.map((p) => {
        const s = p.kind === 'BREAK' ? undefined : slotByPeriod.get(p.id);
        if (!s) {
          return {
            periodId: p.id, label: p.label, startTime: p.startTime, endTime: p.endTime,
            kind: p.kind as 'CLASS' | 'BREAK', slot: null, register: null,
          };
        }
        const sub = subByPeriod.get(p.id);
        const covering = s.teacherId !== teacher.id;
        const st = bySection.get(s.classSectionId);
        return {
          periodId: p.id, label: p.label, startTime: p.startTime, endTime: p.endTime,
          kind: p.kind as 'CLASS' | 'BREAK',
          slot: {
            classSectionId: s.classSectionId,
            className: `${s.classSection.grade.name}-${s.classSection.name}`,
            subjectName: s.subject.name,
            covering,
            coveringFor: covering && sub ? (originalNames.get(sub.originalTeacherId) ?? null) : null,
          },
          register: st
            ? { taken: st.taken, present: st.present, total: st.total, markedBy: st.markedBy }
            : { taken: false, present: 0, total: 0, markedBy: null },
        };
      });
    });

    return { date, dayOfWeek, entries };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && pnpm test -- teacher-day
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Expose it and the week view on the controller**

In `apps/api/src/modules/management/timetable.controller.ts`, add the two teacher reads. Declare them **above** the existing `@Get()` so Nest matches the static paths first:

```ts
  /**
   * The caller's own day. Declared above `@Get()` so the static path matches
   * before the class-scoped read.
   */
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get('my-day')
  myDay(@CurrentUser() u: SchoolJwtPayload, @Query('date') date?: string) {
    return this.teacherDay.forTeacher(this.sid(), u.sub, u.role, date ?? istTodayISO());
  }

  /** The caller's own week, for the timetable grid. */
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get('mine')
  myWeek(@CurrentUser() u: SchoolJwtPayload, @Query('date') date?: string) {
    return this.timetable.listForTeacher(this.sid(), u.sub, date);
  }
```

Add `listForTeacher` to `TimetableService`, mirroring `listForClass`'s versioning rules:

```ts
  /**
   * The caller's own active slots for the whole week, as of `date`
   * (default today). Same effectiveFrom/effectiveTo versioning as
   * `listForClass`, so a past date returns the timetable as it stood then.
   */
  async listForTeacher(schoolId: string, userId: string, date?: string) {
    const asOf = resolveAsOfDate(date, new Date());
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) return [];
      return tx.timetableSlot.findMany({
        where: {
          schoolId,
          teacherId: teacher.id,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
        include: SLOT_INCLUDE,
      });
    });
  }
```

Register `TeacherDayService` in `apps/api/src/modules/management/management.module.ts` — add it to both `providers` and, if the module exports services, `exports`.

- [ ] **Step 6: Write and run the controller e2e test**

Add to `apps/api/test/management-authz.e2e-spec.ts`:

```ts
  it('a TEACHER can read their own day', async () => {
    const res = await request(app.getHttpServer())
      .get('/manage/timetable/my-day?date=2026-08-03')
      .set(as(teacherToken))
      .expect(200);
    expect(res.body).toHaveProperty('entries');
    expect(res.body.dayOfWeek).toBe(1);
  });

  it('a STUDENT cannot read a teacher day', async () => {
    await request(app.getHttpServer())
      .get('/manage/timetable/my-day')
      .set(as(studentToken))
      .expect(403);
  });

  it('my-day is matched before the class-scoped read', async () => {
    // A bare GET /manage/timetable without classSectionId must still 400,
    // proving the static route did not swallow it.
    await request(app.getHttpServer())
      .get('/manage/timetable')
      .set(as(teacherToken))
      .expect(400);
  });
```

```bash
cd apps/api && pnpm test:e2e -- management-authz
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/management/teacher-day.service.ts \
        apps/api/src/modules/management/teacher-day.service.spec.ts \
        apps/api/src/modules/management/timetable.service.ts \
        apps/api/src/modules/management/timetable.controller.ts \
        apps/api/src/modules/management/management.module.ts \
        apps/api/test/management-authz.e2e-spec.ts
git commit -m "feat(api): GET /manage/timetable/my-day and /mine for teachers

my-day returns every period in order with clock times, the class the caller
teaches or covers in each, and that class's register status - one call, so the
web and phone Today screens cannot drift on which period is current."
```

---

## Task 5: Class notes and to-dos

Closes the rest of **T1**. Both lists are scoped to a class and a date so a co-teacher of the same section sees the same log.

**Files:**
- Create: `apps/api/src/modules/management/class-notes.service.ts`
- Create: `apps/api/src/modules/management/class-notes.controller.ts`
- Modify: `apps/api/src/modules/management/management.dto.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`
- Test: `apps/api/src/modules/management/class-notes.service.spec.ts` (create)

**Interfaces:**
- Produces:
  - `ClassNotesService.list(schoolId, classSectionId, date): Promise<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }>`
  - `ClassNotesService.addNote(schoolId, userId, dto): Promise<ClassNoteRow>`
  - `ClassNotesService.addTodo(schoolId, userId, dto): Promise<ClassTodoRow>`
  - `ClassNotesService.setTodoDone(schoolId, userId, id, done): Promise<ClassTodoRow>`
  - `ClassNotesService.removeNote(schoolId, userId, id): Promise<void>`
  - Routes: `GET /manage/class-notes?classSectionId&date`, `POST /manage/class-notes`, `DELETE /manage/class-notes/:id`, `POST /manage/class-todos`, `PATCH /manage/class-todos/:id`, `DELETE /manage/class-todos/:id`.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/management/class-notes.service.spec.ts`:

```ts
const txMock = {
  classSection: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  classNote: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  classTodo: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { ClassNotesService } from './class-notes.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const DATE = '2026-08-03';

describe('ClassNotesService', () => {
  const svc = new ClassNotesService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.classNote.findMany.mockResolvedValue([]);
    txMock.classTodo.findMany.mockResolvedValue([]);
  });

  it('reads notes and to-dos for one class and date together', async () => {
    txMock.classNote.findMany.mockResolvedValue([
      { id: 'n1', body: 'Finished 7.3', createdAt: new Date('2026-08-03T09:40:00Z'), authorTeacherId: TID },
    ]);
    txMock.classTodo.findMany.mockResolvedValue([
      { id: 't1', body: 'Collect worksheets', done: false, createdAt: new Date(), authorTeacherId: TID },
    ]);

    const out = await svc.list(SCHOOL, SECTION, DATE);

    expect(out.notes).toHaveLength(1);
    expect(out.todos).toHaveLength(1);
    expect(txMock.classNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classSectionId: SECTION, date: new Date(DATE) } }),
    );
  });

  it('rejects a malformed date', async () => {
    await expect(svc.list(SCHOOL, SECTION, '3-8-2026')).rejects.toMatchObject({ status: 400 });
  });

  it('adds a note attributed to the calling teacher', async () => {
    txMock.classNote.create.mockResolvedValue({ id: 'n2', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await svc.addNote(SCHOOL, USER, { classSectionId: SECTION, date: DATE, body: 'x' });

    expect(txMock.classNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorTeacherId: TID, classSectionId: SECTION, body: 'x' }),
      }),
    );
  });

  it('refuses to write a note for a class the teacher does not hold', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);

    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: 'sec-other', date: DATE, body: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(txMock.classNote.create).not.toHaveBeenCalled();
  });

  it('lets a substitute write a note for the day they are covering', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    txMock.substitution.findFirst.mockResolvedValue({ id: 'sub-1' });
    txMock.classNote.create.mockResolvedValue({ id: 'n3', body: 'x', createdAt: new Date(), authorTeacherId: TID });

    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: 'sec-9a', date: DATE, body: 'x' }),
    ).resolves.toBeDefined();
  });

  it('toggles a to-do', async () => {
    txMock.classTodo.findFirst.mockResolvedValue({ id: 't1', classSectionId: SECTION, date: new Date(DATE) });
    txMock.classTodo.update.mockResolvedValue({ id: 't1', body: 'x', done: true, createdAt: new Date(), authorTeacherId: TID });

    const out = await svc.setTodoDone(SCHOOL, USER, 't1', true);

    expect(out.done).toBe(true);
    expect(txMock.classTodo.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { done: true } }),
    );
  });

  it('404s toggling a to-do that does not exist in this tenant', async () => {
    txMock.classTodo.findFirst.mockResolvedValue(null);
    await expect(svc.setTodoDone(SCHOOL, USER, 'nope', true)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an empty note body', async () => {
    await expect(
      svc.addNote(SCHOOL, USER, { classSectionId: SECTION, date: DATE, body: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && pnpm test -- class-notes
```

Expected: FAIL — `Cannot find module './class-notes.service'`.

- [ ] **Step 3: Add the DTOs**

Append to `apps/api/src/modules/management/management.dto.ts`, matching the validation style already used in that file:

```ts
export class CreateClassNoteDto {
  @IsUUID()
  classSectionId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
  date!: string;

  @IsString()
  @Length(1, 1000)
  body!: string;
}

export class CreateClassTodoDto extends CreateClassNoteDto {}

export class UpdateClassTodoDto {
  @IsBoolean()
  done!: boolean;
}
```

Add `Matches` and `IsBoolean` to the `class-validator` import at the top of the file if they are not already imported.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/modules/management/class-notes.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { requireClassAccess } from './internal/class-access';
import type { CreateClassNoteDto, CreateClassTodoDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ClassNoteRow {
  id: string;
  body: string;
  createdAt: string;
  authorTeacherId: string;
}

export interface ClassTodoRow extends ClassNoteRow {
  done: boolean;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Notes and to-dos a teacher keeps against one class on one day. Deliberately
 * scoped to (class, date) rather than to the author: two teachers who share a
 * section see one another's log, which is the point — it is a handover record
 * for the class, not a private diary.
 */
@Injectable()
export class ClassNotesService {
  private assertDate(date: string): Date {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    return new Date(date);
  }

  /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
  private requireTeacherFor(tx: Tx, userId: string, classSectionId: string, date: string) {
    return requireClassAccess(tx, userId, classSectionId, date, 'add notes to');
  }

  async list(
    schoolId: string,
    classSectionId: string,
    date: string,
  ): Promise<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }> {
    const day = this.assertDate(date);
    return withTenant(schoolId, async (tx) => {
      const [notes, todos] = await Promise.all([
        tx.classNote.findMany({
          where: { classSectionId, date: day },
          orderBy: { createdAt: 'asc' },
        }),
        tx.classTodo.findMany({
          where: { classSectionId, date: day },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      return {
        notes: notes.map((n) => ({
          id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), authorTeacherId: n.authorTeacherId,
        })),
        todos: todos.map((t) => ({
          id: t.id, body: t.body, done: t.done, createdAt: t.createdAt.toISOString(), authorTeacherId: t.authorTeacherId,
        })),
      };
    });
  }

  async addNote(schoolId: string, userId: string, dto: CreateClassNoteDto): Promise<ClassNoteRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A note cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      const row = await tx.classNote.create({
        data: { schoolId, classSectionId: dto.classSectionId, date: day, body, authorTeacherId: teacherId },
      });
      return { id: row.id, body: row.body, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async addTodo(schoolId: string, userId: string, dto: CreateClassTodoDto): Promise<ClassTodoRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A task cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      const row = await tx.classTodo.create({
        data: { schoolId, classSectionId: dto.classSectionId, date: day, body, authorTeacherId: teacherId },
      });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async setTodoDone(schoolId: string, userId: string, id: string, done: boolean): Promise<ClassTodoRow> {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      const row = await tx.classTodo.update({ where: { id }, data: { done } });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async removeNote(schoolId: string, userId: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classNote.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That note no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      await tx.classNote.delete({ where: { id } });
    });
  }

  async removeTodo(schoolId: string, userId: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      await tx.classTodo.delete({ where: { id } });
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && pnpm test -- class-notes
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Add the controller**

Create `apps/api/src/modules/management/class-notes.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { ClassNotesService } from './class-notes.service';
import { CreateClassNoteDto, CreateClassTodoDto, UpdateClassTodoDto } from './management.dto';

@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class ClassNotesController {
  constructor(
    private readonly svc: ClassNotesService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('class-notes')
  list(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date: string,
  ) {
    return this.svc.list(this.sid(), classSectionId, date);
  }

  @Post('class-notes')
  addNote(@Body() dto: CreateClassNoteDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.addNote(this.sid(), u.sub, dto);
  }

  @Delete('class-notes/:id')
  @HttpCode(204)
  removeNote(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.removeNote(this.sid(), u.sub, id);
  }

  @Post('class-todos')
  addTodo(@Body() dto: CreateClassTodoDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.addTodo(this.sid(), u.sub, dto);
  }

  @Patch('class-todos/:id')
  setDone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassTodoDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.setTodoDone(this.sid(), u.sub, id, dto.done);
  }

  @Delete('class-todos/:id')
  @HttpCode(204)
  removeTodo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.removeTodo(this.sid(), u.sub, id);
  }
}
```

Register `ClassNotesController` in `controllers` and `ClassNotesService` in `providers` in `apps/api/src/modules/management/management.module.ts`.

**Route-collision check:** `CatalogController` is also mounted on `manage`. Confirm it declares no `class-notes` or `class-todos` path before wiring this up — `rg "@(Get|Post|Patch|Delete)\('class" apps/api/src/modules/management/catalog.controller.ts` must return nothing.

- [ ] **Step 7: Run the full API suite**

```bash
cd apps/api && pnpm test && pnpm typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/management/class-notes.service.ts \
        apps/api/src/modules/management/class-notes.controller.ts \
        apps/api/src/modules/management/class-notes.service.spec.ts \
        apps/api/src/modules/management/management.dto.ts \
        apps/api/src/modules/management/management.module.ts
git commit -m "feat(api): per-class, per-day notes and to-dos for teachers

Scoped to (class, date) rather than to the author so co-teachers of a section
share one handover log. Write access follows the same rule as the register,
including substitution cover."
```

---

## Task 6: Register lock and change requests

Closes **T11**. A register locks once its own day is over; reopening it needs an admin-approved request, which the Requests tab surfaces.

**Files:**
- Create: `apps/api/src/modules/management/register-change.service.ts`
- Create: `apps/api/src/modules/management/register-change.controller.ts`
- Modify: `apps/api/src/modules/management/attendance.service.ts` (`save`)
- Modify: `apps/api/src/modules/management/management.dto.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`
- Test: `apps/api/src/modules/management/register-change.service.spec.ts` (create)
- Test: `apps/api/src/modules/management/attendance-lock.spec.ts` (create)

**Interfaces:**
- Produces:
  - `RegisterChangeService.request(schoolId, userId, dto): Promise<RegisterChangeRow>`
  - `RegisterChangeService.mine(schoolId, userId): Promise<RegisterChangeRow[]>`
  - `RegisterChangeService.pending(schoolId): Promise<RegisterChangeRow[]>`
  - `RegisterChangeService.review(schoolId, reviewerUserId, id, approve: boolean): Promise<RegisterChangeRow>`
  - `RegisterChangeService.isUnlocked(tx, classSectionId, date): Promise<boolean>`
  - Routes: `GET /manage/register-changes/mine`, `POST /manage/register-changes`, `GET /manage/register-changes` (admin), `POST /manage/register-changes/:id/approve`, `POST /manage/register-changes/:id/reject`.

- [ ] **Step 1: Write the failing lock test**

Create `apps/api/src/modules/management/attendance-lock.spec.ts`:

```ts
const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn(), findMany: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { AttendanceService } from './attendance.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const SECTION = 'sec-8c';

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
}

describe('AttendanceService past-day lock', () => {
  const notifications = { notify: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.student.findMany.mockResolvedValue([{ id: 'stu-1' }]);
    txMock.attendance.findMany.mockResolvedValue([]);
    txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
    txMock.attendance.createMany.mockResolvedValue({ count: 1 });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
  });

  const dto = (date: string) => ({
    classSectionId: SECTION,
    date,
    marks: [{ studentId: 'stu-1', status: 'PRESENT' as const }],
  });

  it("allows saving today's register", async () => {
    const res = await svc.save(SCHOOL, USER, dto(istToday()));
    expect(res.saved).toBe(1);
  });

  it('refuses a past day with no approved unlock', async () => {
    await expect(svc.save(SCHOOL, USER, dto(istDaysAgo(3)))).rejects.toMatchObject({ status: 409 });
    expect(txMock.attendance.createMany).not.toHaveBeenCalled();
  });

  it('allows a past day when an approved unlock is live', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue({
      id: 'rc-1', status: 'APPROVED', expiresAt: new Date(Date.now() + 3600_000),
    });
    const res = await svc.save(SCHOOL, USER, dto(istDaysAgo(3)));
    expect(res.saved).toBe(1);
  });

  it('refuses a future date outright', async () => {
    const future = new Date(Date.now() + 5.5 * 3600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(svc.save(SCHOOL, USER, dto(future))).rejects.toMatchObject({ status: 400 });
  });

  it('a SCHOOL_ADMIN can still correct a past day directly', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    const res = await svc.save(SCHOOL, 'user-admin', dto(istDaysAgo(3)), 'SCHOOL_ADMIN');
    expect(res.saved).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && pnpm test -- attendance-lock
```

Expected: FAIL — past and future dates currently save fine.

- [ ] **Step 3: Implement the lock in `save`**

In `apps/api/src/modules/management/attendance.service.ts`, inside the transaction, directly after the ownership assertion added in Task 2:

```ts
      // A register belongs to its own day. Past days close so the record can
      // be trusted; an APPROVED, unexpired RegisterChangeRequest reopens
      // exactly one (class, date) and nothing else. SCHOOL_ADMIN bypasses
      // both, because the unlock is theirs to grant in the first place.
      if (callerRole !== 'SCHOOL_ADMIN') {
        const today = istTodayISO();
        if (dto.date > today) {
          throw new ApiError(
            'VALIDATION',
            'You cannot take attendance for a future date.',
            400,
            'date',
          );
        }
        if (dto.date < today) {
          const unlock = await tx.registerChangeRequest.findFirst({
            where: {
              classSectionId: dto.classSectionId,
              date: new Date(dto.date),
              status: 'APPROVED',
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { id: true },
          });
          if (!unlock) {
            throw new ApiError(
              'REGISTER_LOCKED',
              'That day is closed. Ask your admin to reopen it from Requests.',
              409,
              'date',
            );
          }
        }
      }
```

- [ ] **Step 4: Run the lock test**

```bash
cd apps/api && pnpm test -- attendance-lock
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing request/review test**

Create `apps/api/src/modules/management/register-change.service.spec.ts`:

```ts
const txMock = {
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { RegisterChangeService } from './register-change.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const PAST = '2026-07-31';

describe('RegisterChangeService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new RegisterChangeService(audit as unknown as AuditService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findMany.mockResolvedValue([]);
  });

  const row = (over = {}) => ({
    id: 'rc-1', classSectionId: SECTION, date: new Date(PAST), reason: 'late slip',
    status: 'PENDING', requestedByTeacherId: TID, reviewedByUserId: null,
    reviewedAt: null, expiresAt: null, createdAt: new Date(), ...over,
  });

  it('creates a pending request for a class the teacher holds', async () => {
    txMock.registerChangeRequest.create.mockResolvedValue(row());
    const out = await svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: 'late slip' });
    expect(out.status).toBe('PENDING');
  });

  it('refuses a request for a class the teacher does not hold', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: 'other', date: PAST, reason: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a second pending request for the same class and date', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: 'again' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('requires a reason', async () => {
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: '  ' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('approving sets an expiry so the lock reasserts itself', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    txMock.registerChangeRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(row({ ...data })),
    );

    const out = await svc.review(SCHOOL, 'user-admin', 'rc-1', true);

    expect(out.status).toBe('APPROVED');
    expect(out.expiresAt).not.toBeNull();
    expect(new Date(out.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REGISTER_CHANGE_APPROVED' }),
    );
  });

  it('rejecting records who rejected it and grants no unlock', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    txMock.registerChangeRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(row({ ...data })),
    );

    const out = await svc.review(SCHOOL, 'user-admin', 'rc-1', false);

    expect(out.status).toBe('REJECTED');
    expect(out.expiresAt).toBeNull();
    expect(out.reviewedByUserId).toBe('user-admin');
  });

  it('404s reviewing a request that is not in this tenant', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
    await expect(svc.review(SCHOOL, 'user-admin', 'nope', true)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to review a request that is already decided', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row({ status: 'APPROVED' }));
    await expect(svc.review(SCHOOL, 'user-admin', 'rc-1', true)).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 6: Implement the service and controller**

Create `apps/api/src/modules/management/register-change.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { RegisterChangeRow } from '@skoolos/types';
import { AuditService } from '../../common/audit/audit.service';
import { ApiError } from '../../common/errors/api-error';
import { requireClassAccess } from './internal/class-access';
import type { CreateRegisterChangeDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * An approval is good until the end of the approving day, IST. Time-boxing it
 * means the lock reasserts itself on its own — an admin never has to remember
 * to revoke an unlock, and a forgotten approval cannot leave a register
 * editable indefinitely.
 */
function endOfIstDay(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

@Injectable()
export class RegisterChangeService {
  constructor(private readonly audit: AuditService) {}

  /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
  private requireTeacherFor(tx: Tx, userId: string, classSectionId: string, date: string) {
    return requireClassAccess(tx, userId, classSectionId, date, 'request changes to');
  }

  private static toRow(r: {
    id: string;
    classSectionId: string;
    date: Date;
    reason: string;
    status: string;
    requestedByTeacherId: string;
    reviewedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
    classSection?: { name: string; grade: { name: string } } | null;
    reviewedByUserId?: string | null;
  }, requestedByName: string | null = null): RegisterChangeRow & { reviewedByUserId: string | null } {
    return {
      id: r.id,
      classSectionId: r.classSectionId,
      className: r.classSection ? `${r.classSection.grade.name}-${r.classSection.name}` : '',
      date: r.date.toISOString().slice(0, 10),
      reason: r.reason,
      status: r.status as RegisterChangeRow['status'],
      requestedByTeacherId: r.requestedByTeacherId,
      requestedByName,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      reviewedByUserId: r.reviewedByUserId ?? null,
    };
  }

  private static readonly ROW_INCLUDE = {
    classSection: { select: { name: true, grade: { select: { name: true } } } },
  } as const;

  async request(schoolId: string, userId: string, dto: CreateRegisterChangeDto) {
    if (!DATE_RE.test(dto.date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new ApiError('VALIDATION', 'Tell your admin why the register needs changing.', 400, 'reason');
    }

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);

      // One open request per class+date. A second one would give the admin two
      // identical rows to review and two unlocks to reason about.
      const open = await tx.registerChangeRequest.findFirst({
        where: { classSectionId: dto.classSectionId, date: new Date(dto.date), status: 'PENDING' },
        select: { id: true },
      });
      if (open) {
        throw new ApiError(
          'CONFLICT',
          'You already have a request open for that day.',
          409,
          'date',
        );
      }

      const row = await tx.registerChangeRequest.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          date: new Date(dto.date),
          requestedByTeacherId: teacherId,
          reason,
          status: 'PENDING',
        },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      return RegisterChangeService.toRow(row);
    });
  }

  async mine(schoolId: string, userId: string) {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) return [];
      const rows = await tx.registerChangeRequest.findMany({
        where: { requestedByTeacherId: teacher.id },
        orderBy: { createdAt: 'desc' },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      return rows.map((r) => RegisterChangeService.toRow(r));
    });
  }

  async pending(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.registerChangeRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        include: RegisterChangeService.ROW_INCLUDE,
      });
      const teacherIds = [...new Set(rows.map((r) => r.requestedByTeacherId))];
      const teachers = teacherIds.length
        ? await tx.teacher.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const names = new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));
      return rows.map((r) =>
        RegisterChangeService.toRow(r, names.get(r.requestedByTeacherId) ?? null),
      );
    });
  }

  async review(schoolId: string, reviewerUserId: string, id: string, approve: boolean) {
    const row = await withTenant(schoolId, async (tx) => {
      const existing = await tx.registerChangeRequest.findFirst({ where: { id } });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'That request no longer exists.', 404, 'id');
      }
      if (existing.status !== 'PENDING') {
        throw new ApiError(
          'CONFLICT',
          'That request has already been decided.',
          409,
          'status',
        );
      }
      return tx.registerChangeRequest.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          expiresAt: approve ? endOfIstDay() : null,
        },
        include: RegisterChangeService.ROW_INCLUDE,
      });
    });

    await this.audit.record({
      schoolId,
      actorUserId: reviewerUserId,
      action: approve ? 'REGISTER_CHANGE_APPROVED' : 'REGISTER_CHANGE_REJECTED',
      entity: 'RegisterChangeRequest',
      entityId: id,
      meta: {
        classSectionId: row.classSectionId,
        date: row.date.toISOString().slice(0, 10),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      },
    });

    return RegisterChangeService.toRow(row);
  }
}
```

Note the spec asserts `out.reviewedByUserId` on reject — `toRow` therefore returns it alongside the shared `RegisterChangeRow` fields. Keep that intersection type rather than widening the shared contract: the reviewer's user id is an admin-side detail no client screen renders.

Create `apps/api/src/modules/management/register-change.controller.ts` on `@Controller('manage/register-changes')` with `SchoolJwtGuard, RequireFeatureGuard, RolesGuard` and `@RequireFeature('MANAGEMENT')`. Declare `@Get('mine')` **above** `@Get()` so the static path wins. Per-handler roles: `mine` and `POST /` are `@Roles('TEACHER')`; `GET /`, `:id/approve` and `:id/reject` are `@Roles('SCHOOL_ADMIN')`.

Add to `management.dto.ts`:

```ts
export class CreateRegisterChangeDto {
  @IsUUID()
  classSectionId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
  date!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;
}
```

Register both in `management.module.ts`.

- [ ] **Step 7: Run the tests**

```bash
cd apps/api && pnpm test -- register-change attendance-lock && pnpm typecheck
```

Expected: 8 + 5 tests PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/management/register-change.service.ts \
        apps/api/src/modules/management/register-change.controller.ts \
        apps/api/src/modules/management/register-change.service.spec.ts \
        apps/api/src/modules/management/attendance-lock.spec.ts \
        apps/api/src/modules/management/attendance.service.ts \
        apps/api/src/modules/management/management.dto.ts \
        apps/api/src/modules/management/management.module.ts
git commit -m "feat(api): registers lock overnight, reopened only by an approved request

A register belongs to its own day. Past days return REGISTER_LOCKED unless an
APPROVED, unexpired RegisterChangeRequest covers that exact class and date;
approval expires at the end of the approving day so the lock reasserts itself
without needing revocation. Future dates are refused outright."
```

---

## Task 7: Publish the contracts both clients will import

Closes the Phase 1 slice of **P7**. Today the response shapes are hand-copied into `apps/mobile/src/lib/*.ts` and re-declared per page in `apps/web` — which is why `LATE` exists on one client and not the other.

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `apps/api/src/modules/management/attendance.service.ts` (import the shared types instead of declaring them)
- Modify: `apps/api/src/modules/management/teacher-day.service.ts` (same)
- Test: `packages/types/src/contracts.spec.ts` (create)

**Interfaces:**
- Produces, from `@skoolos/types`: `AttendanceStatusValue`, `AttendanceMark`, `SaveAttendanceRequest`, `SaveAttendanceResponse`, `MyClassSection`, `ClassDayStatus`, `TeacherDay`, `TeacherDayEntry`, `ClassNoteRow`, `ClassTodoRow`, `RegisterChangeRow`, `RegisterChangeStatusValue`, and the constant `ATTENDANCE_STATUSES`.

- [ ] **Step 1: Write the failing test**

Create `packages/types/src/contracts.spec.ts`:

```ts
import { ATTENDANCE_STATUSES, type AttendanceStatusValue, type TeacherDayEntry } from './index';

describe('shared portal contracts', () => {
  it('declares exactly the three attendance states the API accepts', () => {
    expect([...ATTENDANCE_STATUSES].sort()).toEqual(['ABSENT', 'LATE', 'PRESENT']);
  });

  it('AttendanceStatusValue admits every declared status and nothing else', () => {
    const ok: AttendanceStatusValue[] = ['PRESENT', 'ABSENT', 'LATE'];
    expect(ok).toHaveLength(3);
    // @ts-expect-error HALF_DAY is not an attendance state
    const bad: AttendanceStatusValue = 'HALF_DAY';
    expect(bad).toBe('HALF_DAY');
  });

  it('a break entry carries no slot and no register', () => {
    const entry: TeacherDayEntry = {
      periodId: 'p', label: 'Lunch', startTime: '11:20', endTime: '12:00',
      kind: 'BREAK', slot: null, register: null,
    };
    expect(entry.slot).toBeNull();
  });
});
```

`packages/types` has no jest config yet. Add one at `packages/types/jest.config.js` copying `apps/api/jest.config.js` and dropping the `moduleNameMapper`, and add `"test": "jest"` to `packages/types/package.json` scripts.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/types && pnpm test
```

Expected: FAIL — `ATTENDANCE_STATUSES` is not exported.

- [ ] **Step 3: Declare the contracts**

Append to `packages/types/src/index.ts`:

```ts
// ── Portal contracts ────────────────────────────────────────────────────────
// One declaration per wire shape, imported by the API, the web app and the
// mobile app. Anything both clients render belongs here: a divergence then
// fails the build instead of shipping as two different products.

/** The only three states `PUT /manage/attendance` accepts. */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE'] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceMark {
  studentId: string;
  status: AttendanceStatusValue;
}

export interface SaveAttendanceRequest {
  classSectionId: string;
  /** YYYY-MM-DD, the school's local calendar day. */
  date: string;
  marks: AttendanceMark[];
}

export interface SaveAttendanceResponse {
  saved: number;
  absentees: number;
}

export interface MyClassSection {
  classSectionId: string;
  name: string;
  studentCount: number;
  /** True when held only as a substitute on the queried date. */
  covering: boolean;
}

export interface ClassDayStatus {
  classSectionId: string;
  name: string;
  total: number;
  present: number;
  taken: boolean;
  markedBy: string | null;
  markedAt: string | null;
}

export interface TeacherDayEntry {
  periodId: string;
  label: string;
  /** "HH:MM", the school's local clock. */
  startTime: string;
  endTime: string;
  kind: 'CLASS' | 'BREAK';
  slot: {
    classSectionId: string;
    className: string;
    subjectName: string;
    covering: boolean;
    coveringFor: string | null;
  } | null;
  register: { taken: boolean; present: number; total: number; markedBy: string | null } | null;
}

export interface TeacherDay {
  date: string;
  /** 1 = Monday … 7 = Sunday, matching TimetableSlot.dayOfWeek. */
  dayOfWeek: number;
  entries: TeacherDayEntry[];
}

export interface ClassNoteRow {
  id: string;
  body: string;
  createdAt: string;
  authorTeacherId: string;
}

export interface ClassTodoRow extends ClassNoteRow {
  done: boolean;
}

export const REGISTER_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RegisterChangeStatusValue = (typeof REGISTER_CHANGE_STATUSES)[number];

export interface RegisterChangeRow {
  id: string;
  classSectionId: string;
  className: string;
  date: string;
  reason: string;
  status: RegisterChangeStatusValue;
  requestedByTeacherId: string;
  requestedByName: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Point the API at the shared declarations**

In `attendance.service.ts`, delete the local `MyClassSection` and `ClassDayStatus` interfaces and import them instead, re-exporting so existing importers keep working:

```ts
import type { ClassDayStatus, MyClassSection } from '@skoolos/types';
export type { ClassDayStatus, MyClassSection };
```

Do the same in `teacher-day.service.ts` for `TeacherDay` and `TeacherDayEntry`, and in `class-notes.service.ts` for `ClassNoteRow` and `ClassTodoRow`.

Verify `@skoolos/types` resolves from the API — `apps/api/jest.config.js` and `apps/api/tsconfig.json` already map it.

- [ ] **Step 5: Run everything**

```bash
cd packages/types && pnpm test
cd ../../apps/api && pnpm test && pnpm typecheck
```

Expected: all PASS. The `@ts-expect-error` line in the contracts spec must not report "unused" — if it does, the union is too wide.

- [ ] **Step 6: Commit**

```bash
git add packages/types apps/api/src/modules/management
git commit -m "feat(types): one declaration of the portal wire contracts

The API, the web app and the mobile app now import the same shapes. This is
the structural fix for LATE existing on one client and not the other: a
divergence becomes a compile error instead of a support ticket."
```

---

## Task 8: Phase 1 verification gate

Nothing new is built here. This task proves the phase is sound before any client work starts on top of it.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-portal-parity-r1-phase1-server.md` (tick the boxes)

- [ ] **Step 1: Run every suite from a clean state**

```bash
docker compose up -d
cd /Users/darshanjain/Worktrees/SchoolManager-parity
pnpm --filter @skoolos/db test
pnpm --filter @skoolos/types test
pnpm --filter @skoolos/api test
pnpm --filter @skoolos/api test:e2e
pnpm typecheck
pnpm lint
```

Expected: every command exits 0. Record the actual test counts — do not claim a pass without the output in front of you.

- [ ] **Step 2: Check the module boundary rule still holds**

```bash
pnpm boundary
```

Expected: exit 0. The new services live inside `modules/management` and import only from `common/`, `modules/tenancy`, `modules/features` and `@skoolos/db` / `@skoolos/types`, so no boundary is crossed.

- [ ] **Step 3: Confirm the route table has no collisions**

```bash
cd apps/api && rg "@Controller\('manage" -A2 src/modules/management/*.controller.ts
```

Read the output and confirm that `manage/class-notes`, `manage/class-todos`, `manage/register-changes`, `manage/timetable/my-day` and `manage/timetable/mine` each appear once, and that no dynamic `:id` route on a shared prefix is declared before them.

- [ ] **Step 4: Commit the ticked plan**

```bash
git add docs/superpowers/plans/2026-07-28-portal-parity-r1-phase1-server.md
git commit -m "docs: Phase 1 server foundation complete and verified"
```

---

## What Phase 1 deliberately does not do

Named here so nobody looks for them in this plan:

- **No UI.** Every web and mobile screen is Phase 2 (attendance parity), Phase 3 (Today screen) and Phase 4 (timetable, requests, palette, dark mode, offline, server-side logout).
- **No offline queue.** Item T5's offline save is entirely client-side; the server is already idempotent for a re-save of the same class and date, which is what makes the replay safe.
- **No push on publish.** Items S6/S7 are Round 2, and need the `NotificationOutbox` table rather than anything here.
- **No parent accounts, messaging or assignments.** Those are Round 3 and get their own specs.
