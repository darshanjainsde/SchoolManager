# Active Roster · Track A: Person Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every student, teacher and staff member a real status (Active / Alumni / Transferred / Left; Active / Left), replace Delete with "Mark as left", keep history, close or keep logins by rule, and make every roster and recipient query read active people only.

**Architecture:** New Prisma enums and columns with `isActive` kept as a mirrored boolean written only by lifecycle code. One shared `activeStudentsWhere()` helper in `common/roster` used by every roster query, enforced by a source-reading guard test. A `StudentLifecycleService` and extensions to `TeachersService`/`StaffService` own every transition; controllers stay thin. Console pages get status tabs and transition dialogs; the mobile shelf learns a "closed" child.

**Tech Stack:** NestJS 10 + Prisma (`withTenant`, `getPlatformPrisma`), class-validator DTOs, jest (txMock pattern), Next 15 / React 19 console with TanStack Query + sonner, vitest, Expo (family-store, SecureStore).

**Spec:** `docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md` (§2, §5, §6, §7)

## Global Constraints

- Work only in `/Users/darshanjain/Worktrees/SchoolManager-roster` on branch `feat/active-roster` (cut from `origin/staging` at 78969b3). Stage files by path; never `git add -A`; never push. Ship: `git push origin HEAD:staging` after `pnpm preflight`, verify on `raffles.test.sckools.com`, then a PR from `staging` to `main` after the user has run the production migration.
- Read `CLAUDE.md`, `.claude/skills/sckools-ui-taste/SKILL.md` and `docs/superpowers/LIBRARY-TRAPS.md` in the worktree before the first edit. Every list query carries `take: LIST_CEILING.ROSTER` (people) or `LIST_CEILING.STRUCTURE` (sections, grades) from `apps/api/src/common/lists/list-ceiling.ts`. Every new `ApiError` code is added to the `ErrorCode` union in `apps/api/src/common/errors/api-error.ts` with a one-line comment, as the Homecoming codes are.
- **Every** leaving status closes the student login (spec D9 revised). Alumni are handed to the Homecoming wing in Track C.
- `isActive` is written only by lifecycle code and always equals `status === 'ACTIVE'`.
- Every student roster/recipient query carries `status` via `activeStudentsWhere()`; `common/roster/roster-filter.spec.ts` must stay green.
- No new feature key. Every new manage route stays behind `SchoolJwtGuard, RequireFeatureGuard('MANAGEMENT'), RolesGuard('SCHOOL_ADMIN')`.
- Copy: plain English. Buttons: "Mark as left", "Re-admit", "Remove from this school", "Reactivate".
- Tests: API `pnpm --filter @skoolos/api test -- <path>`; web `pnpm --filter @skoolos/web test -- <path>`; db `pnpm --filter @skoolos/db test`. Before asking to push: `pnpm preflight`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01LnThnQezQx8WL5Wg1quGqh`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | enums `StudentStatus`, `StaffStatus`; lifecycle columns on Student/Teacher/Staff |
| `packages/db/prisma/migrations/20260910090000_person_lifecycle/migration.sql` | DDL + backfill from `isActive` |
| `apps/api/src/common/roster/active-students.ts` | `activeStudentsWhere()` |
| `apps/api/src/common/roster/roster-filter.spec.ts` | guard: listed queries carry the status filter |
| `apps/api/src/modules/management/internal/close-login.ts` | `closeLogin(userId)` / `reopenLogin(userId)` on the platform client |
| `apps/api/src/modules/management/internal/student-transitions.ts` | `applyStudentLeave(tx, …)`, `applyStudentReadmit(tx, …)`, `studentHistoryCounts(tx, …)` — pure tx functions reused by track C |
| `apps/api/src/modules/management/student-lifecycle.service.ts` (+ `.spec.ts`) | leave / readmit / clearance with audit and login handling |
| `apps/api/src/modules/management/students.controller.ts`, `students.service.ts`, `management.dto.ts` | routes, status filter, delete guard, clash message |
| `apps/api/src/modules/management/teachers.service.ts`, `teachers.controller.ts`, `staff.service.ts`, `staff.controller.ts` | release-impact, release with handover, reactivate |
| `apps/api/src/modules/public/public-site.service.ts` | featured staff of left teachers dropped |
| `apps/api/src/modules/auth/internal/school-resolve.service.ts` | code lookup filters status |
| `apps/api/src/modules/portal/portal.service.ts` | profile carries `status`, `alumniBatch` |
| `apps/mobile/src/lib/family-store.ts`, `apps/mobile/src/lib/api.ts`, `apps/mobile/src/app/(family)/(tabs)/home/shelf.tsx` | closed child state |
| `apps/web/app/app/students/page.tsx` + `students/leave-dialog.tsx` | tabs, Mark as left, Re-admit, delete guard, multi-select |
| `apps/web/app/app/teachers/page.tsx` + `teachers/release-sheet.tsx`, `apps/web/app/app/staff/page.tsx` | Remove from this school, Reactivate |
| `.claude/skills/sckools-behavior-spec/…` | invariants |

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Student ~line 858, Teacher ~823, Staff ~970, enums after `ClassNoteVisibility`)
- Create: `packages/db/prisma/migrations/20260910090000_person_lifecycle/migration.sql`
- Test: `packages/db/src/rls-coverage.spec.ts` (existing, must stay green)

**Interfaces:**
- Produces: Prisma types `StudentStatus`, `StaffStatus`; columns listed in spec §5.

- [ ] **Step 1: Add enums and columns to schema.prisma**

After `enum ClassNoteVisibility { … }` add:

```prisma
/// Where a student stands with the school. `isActive` on the row mirrors
/// `status === ACTIVE` and is written only by lifecycle code (Track A).
enum StudentStatus {
  ACTIVE
  ALUMNI
  TRANSFERRED
  LEFT
}

enum StaffStatus {
  ACTIVE
  LEFT
}
```

In `model Student`, after `isActive Boolean @default(true)`:

```prisma
  status            StudentStatus @default(ACTIVE)
  leftOn            DateTime?     @db.Date
  leftReason        String?
  leftNote          String?
  alumniBatch       String?
  statusChangedAt   DateTime?
  statusChangedById String?       @db.Uuid
  showOnWebsite     Boolean       @default(true)
  photoConsent      Boolean       @default(false)
```

and add `@@index([schoolId, status])` next to the existing indexes.

In `model Teacher` and `model Staff`, after `isActive`:

```prisma
  status            StaffStatus @default(ACTIVE)
  leftOn            DateTime?   @db.Date
  leftReason        String?
  leftNote          String?
  statusChangedAt   DateTime?
  statusChangedById String?     @db.Uuid
```

and `@@index([schoolId, status])` on both.

- [ ] **Step 2: Write the migration**

`packages/db/prisma/migrations/20260910090000_person_lifecycle/migration.sql`:

```sql
-- Person lifecycle (Track A). New columns only; RLS is already on these tables.
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'ALUMNI', 'TRANSFERRED', 'LEFT');
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'LEFT');

ALTER TABLE "Student"
  ADD COLUMN "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn" DATE,
  ADD COLUMN "leftReason" TEXT,
  ADD COLUMN "leftNote" TEXT,
  ADD COLUMN "alumniBatch" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID,
  ADD COLUMN "showOnWebsite" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "photoConsent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Teacher"
  ADD COLUMN "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn" DATE,
  ADD COLUMN "leftReason" TEXT,
  ADD COLUMN "leftNote" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID;

ALTER TABLE "Staff"
  ADD COLUMN "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn" DATE,
  ADD COLUMN "leftReason" TEXT,
  ADD COLUMN "leftNote" TEXT,
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID;

-- Backfill: rows already switched off keep their meaning.
UPDATE "Student" SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;
UPDATE "Teacher" SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;
UPDATE "Staff"   SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;

CREATE INDEX "Student_schoolId_status_idx" ON "Student"("schoolId", "status");
CREATE INDEX "Teacher_schoolId_status_idx" ON "Teacher"("schoolId", "status");
CREATE INDEX "Staff_schoolId_status_idx"   ON "Staff"("schoolId", "status");
```

- [ ] **Step 3: Validate and generate**

Run: `pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db exec prisma generate`
Expected: "The schema … is valid" and the client generates.

- [ ] **Step 4: Run the db guard suite**

Run: `pnpm --filter @skoolos/db test`
Expected: PASS (no new tables, so RLS coverage is unchanged).

- [ ] **Step 5: Typecheck the API**

Run: `pnpm --filter @skoolos/api typecheck`
Expected: PASS. (Every new column is optional or defaulted, so nothing downstream breaks yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260910090000_person_lifecycle/migration.sql
git commit -m "feat(db): student and staff lifecycle status columns (Track A)"
```

---

### Task 2: The active-roster helper and its guard test

**Files:**
- Create: `apps/api/src/common/roster/active-students.ts`
- Create: `apps/api/src/common/roster/roster-filter.spec.ts`

**Interfaces:**
- Produces: `activeStudentsWhere(schoolId: string, extra?: Prisma.StudentWhereInput): Prisma.StudentWhereInput`; `LEFT_STATUSES: readonly ['ALUMNI','TRANSFERRED','LEFT']`.

- [ ] **Step 1: Write the guard test (it must fail first)**

`apps/api/src/common/roster/roster-filter.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every query that LISTS students for a roster or a recipient list must carry a
 * status filter. Before Track A nothing did, so a child who left kept getting
 * attendance rows, diary entries and pushes. This test reads the source and
 * fails when a listed file has a `student.findMany(` / `student.findFirst(`
 * whose `where` block does not mention `status` or `activeStudentsWhere`.
 */
const API = join(__dirname, '..', '..');
const FILES = [
  'modules/management/students.service.ts',
  'modules/management/attendance.service.ts',
  'modules/management/attendance-bar.service.ts',
  'modules/management/diary.service.ts',
  'modules/management/exams.service.ts',
  'modules/management/messages.service.ts',
  'common/notifications/recipients.ts',
  'common/notifications/notification-inbox.ts',
  'modules/auth/internal/school-resolve.service.ts',
];

/** Returns the text of each `student.findMany(…)`/`findFirst(…)` call up to its closing `)`. */
function studentQueries(src: string): string[] {
  const out: string[] = [];
  const re = /student\.(findMany|findFirst)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      if (src[i] === ')') depth--;
      i++;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

describe('roster queries filter on student status', () => {
  for (const rel of FILES) {
    it(rel, () => {
      const src = readFileSync(join(API, rel), 'utf8');
      const queries = studentQueries(src);
      expect(queries.length).toBeGreaterThan(0);
      const missing = queries.filter((q) => !/status|activeStudentsWhere/.test(q));
      expect(missing).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @skoolos/api test -- common/roster/roster-filter.spec.ts`
Expected: FAIL for every file except none (each lists queries without `status`).

- [ ] **Step 3: Write the helper**

`apps/api/src/common/roster/active-students.ts`:

```ts
import type { Prisma } from '@skoolos/db';

/** The three "no longer here" states. ACTIVE is the only enrolled state. */
export const LEFT_STATUSES = ['ALUMNI', 'TRANSFERRED', 'LEFT'] as const;

/**
 * The ONE way to ask for the students who are actually in the school. Every
 * roster and recipient query goes through here so a child who has left never
 * appears on a register, a diary page or a push list. See roster-filter.spec.
 */
export function activeStudentsWhere(
  schoolId: string,
  extra: Prisma.StudentWhereInput = {},
): Prisma.StudentWhereInput {
  return { schoolId, status: 'ACTIVE', ...extra };
}
```

- [ ] **Step 4: Commit the helper and the (still failing) guard**

```bash
git add apps/api/src/common/roster/active-students.ts apps/api/src/common/roster/roster-filter.spec.ts
git commit -m "feat(api): activeStudentsWhere helper + roster-filter guard (red)"
```

---

### Task 3: Apply the filter to every roster and recipient query

**Files:**
- Modify: `apps/api/src/modules/management/students.service.ts:60-95`
- Modify: `apps/api/src/modules/management/attendance.service.ts:58, :379`
- Modify: `apps/api/src/modules/management/attendance-bar.service.ts:100, :233`
- Modify: `apps/api/src/modules/management/diary.service.ts:222, :325`
- Modify: `apps/api/src/modules/management/exams.service.ts:456`
- Modify: `apps/api/src/modules/management/messages.service.ts:59`
- Modify: `apps/api/src/common/notifications/recipients.ts:66, :87, :107`
- Modify: `apps/api/src/common/notifications/notification-inbox.ts:54`
- Modify: `apps/api/src/modules/auth/internal/school-resolve.service.ts:52`
- Test: `apps/api/src/common/roster/roster-filter.spec.ts`, existing specs of each service

**Interfaces:**
- Consumes: `activeStudentsWhere`, `LEFT_STATUSES` (Task 2).
- Produces: `StudentsService.list(schoolId, { classSectionId?, projection?, status?: 'active'|'left'|'all' })`.

- [ ] **Step 1: students.service list() gets the status filter**

Replace the `ListFilters` interface and the `where` construction:

```ts
import { activeStudentsWhere, LEFT_STATUSES } from '../../common/roster/active-students';

export type StudentListStatus = 'active' | 'left' | 'all';

interface ListFilters {
  classSectionId?: string;
  projection?: StudentProjection;
  status?: StudentListStatus;
}

// inside list():
const extra = filters.classSectionId ? { classSectionId: filters.classSectionId } : {};
const where =
  filters.status === 'all'
    ? { schoolId, ...extra }
    : filters.status === 'left'
      ? { schoolId, status: { in: [...LEFT_STATUSES] }, ...extra }
      : activeStudentsWhere(schoolId, extra);
```

- [ ] **Step 2: attendance.service.ts**

Line 58 (`list`): `where: activeStudentsWhere(schoolId, { classSectionId })`. Line 379 (`save` roster check): `where: activeStudentsWhere(schoolId, { classSectionId: dto.classSectionId })`. Add the import.

- [ ] **Step 3: attendance-bar.service.ts, diary.service.ts, exams.service.ts**

At each listed line the query today reads `student.findMany({ where: { classSectionId /* or schoolId + classSectionId, or id: { in: ids } */, … } })`. Rewrite each as:

```ts
// attendance-bar.service.ts:100 and :233 (both list a section's students)
where: activeStudentsWhere(schoolId, { classSectionId }),
// diary.service.ts:222 (named shortlist for a SELECTED audience)
where: activeStudentsWhere(schoolId, { id: { in: ids }, classSectionId }),
// diary.service.ts:325 (ALL audience)
where: activeStudentsWhere(schoolId, { classSectionId }),
// exams.service.ts:456 (result sheet roster)
where: activeStudentsWhere(schoolId, { classSectionId: exam.classSectionId }),
```

Keep every `select`/`orderBy` as it is. If a query's local variable names differ (`sectionId`, `dto.classSectionId`), use the local name; the shape stays `activeStudentsWhere(schoolId, { …section filter… })`.

- [ ] **Step 4: messages.service.ts:59**

The thread-target lookup adds `status: 'ACTIVE'` to its `where` so a new thread can never be opened to a child who left.

- [ ] **Step 5: recipients.ts and notification-inbox.ts**

Each `student.findMany({ where: { schoolId, …, userId: { not: null } } })` gains `status: 'ACTIVE'`. These files are in `common/`, so import from `'../roster/active-students'` is allowed; using the literal is also accepted by the guard.

- [ ] **Step 6: school-resolve.service.ts:52**

```ts
where: { code: id.toUpperCase(), status: { in: ['ACTIVE', 'ALUMNI'] }, school: { status: { not: 'SUSPENDED' } } },
```

Alumni keep their login (D9), so their code must still find the school.

- [ ] **Step 7: Run the guard and every touched suite**

Run: `pnpm --filter @skoolos/api test -- common/roster modules/management/students.service modules/management/attendance modules/management/diary modules/management/exams modules/auth`
Expected: PASS. Existing specs that asserted an exact `where` (e.g. `attendance.service.spec.ts`) must be updated to expect `status: 'ACTIVE'` in the object — update the expectation, not the filter.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/management apps/api/src/common/notifications apps/api/src/modules/auth/internal/school-resolve.service.ts
git commit -m "fix(api): rosters, recipients and code lookup read active students only"
```

---

### Task 4: Student transitions and the lifecycle service

**Files:**
- Create: `apps/api/src/modules/management/internal/close-login.ts`
- Create: `apps/api/src/modules/management/internal/student-transitions.ts`
- Create: `apps/api/src/modules/management/student-lifecycle.service.ts`
- Create: `apps/api/src/modules/management/student-lifecycle.service.spec.ts`
- Modify: `apps/api/src/modules/management/management.dto.ts` (append DTOs)
- Modify: `apps/api/src/modules/management/management.module.ts` (provider)

**Interfaces:**
- Produces:
  - `closeLogin(userId: string): Promise<void>`; `reopenLogin(userId: string): Promise<void>` (platform client).
  - `applyStudentLeave(tx: TenantTx, input: { schoolId; actorUserId; studentId; status: 'ALUMNI'|'TRANSFERRED'|'LEFT'; leftOn: Date; reason?: string|null; note?: string|null; alumniBatch?: string|null }): Promise<{ userId: string | null; status: StudentStatus }>` — track C calls this inside its own transaction.
  - `applyStudentReadmit(tx, { schoolId; actorUserId; studentId; classSectionId?: string|null }): Promise<{ userId: string | null }>`.
  - `studentHistoryCounts(tx, studentId): Promise<{ attendance; results; diary; library; threads; hasHistory }>`.
  - `StudentLifecycleService.leave(schoolId, actorUserId, studentId, dto: LeaveStudentDto)`, `.readmit(schoolId, actorUserId, studentId, dto: ReadmitStudentDto)`, `.clearance(schoolId, studentId): Promise<StudentClearance>`.
  - `StudentClearance = { libraryIssuesOut: number; finesDueRupees: number; unsignedRemarks: number; hasHistory: boolean }`.

- [ ] **Step 1: Write the failing spec**

`apps/api/src/modules/management/student-lifecycle.service.spec.ts`:

```ts
import 'reflect-metadata';

const txMock = {
  student: { findFirst: jest.fn(), update: jest.fn() },
  attendance: { count: jest.fn() },
  result: { count: jest.fn() },
  diaryRecipient: { count: jest.fn() },
  diaryAck: { count: jest.fn() },
  libraryIssue: { count: jest.fn() },
  libraryFine: { aggregate: jest.fn() },
  messageThread: { count: jest.fn() },
  academicYear: { findFirst: jest.fn() },
};
const platformMock = {
  user: { update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
  getPlatformPrisma: () => platformMock,
  Prisma: jest.requireActual('@prisma/client').Prisma,
}));

import { StudentLifecycleService } from './student-lifecycle.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function service() {
  const audit = { record: jest.fn() };
  const invites = { sendInvite: jest.fn().mockResolvedValue(true) };
  return { svc: new StudentLifecycleService(audit as never, invites as never), audit, invites };
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: 'u1', status: 'ACTIVE', code: 'RAF-00042' });
  txMock.student.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: STUDENT, ...data }));
  txMock.academicYear.findFirst.mockResolvedValue({ name: '2025-26' });
});

describe('leave', () => {
  it('TRANSFERRED sets status, mirrors isActive=false, closes the login and audits', async () => {
    const { svc, audit } = service();
    await svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'TRANSFERRED', leftOn: '2026-03-31', reason: 'Moved city' });
    const data = txMock.student.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'TRANSFERRED', isActive: false, leftReason: 'Moved city', statusChangedById: ACTOR });
    expect(data.leftOn).toEqual(new Date('2026-03-31'));
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(platformMock.refreshToken.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'student.leave', entityId: STUDENT }));
  });

  it('ALUMNI closes the login too and fills the batch from the current year', async () => {
    const { svc } = service();
    await svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'ALUMNI', leftOn: '2026-03-31' });
    expect(txMock.student.update.mock.calls[0][0].data).toMatchObject({ status: 'ALUMNI', alumniBatch: '2025-26', isActive: false });
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
  });

  it('refuses when the student is not ACTIVE', async () => {
    const { svc } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: null, status: 'LEFT' });
    await expect(svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'LEFT', leftOn: '2026-03-31' })).rejects.toMatchObject({ code: 'NOT_ACTIVE' });
  });
});

describe('readmit', () => {
  it('reactivates, clears left fields, reopens the login and re-invites', async () => {
    const { svc, invites } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: 'u1', status: 'LEFT', code: 'RAF-00042' });
    await svc.readmit(SCHOOL, ACTOR, STUDENT, { classSectionId: 'sec-6a' });
    expect(txMock.student.update.mock.calls[0][0].data).toMatchObject({
      status: 'ACTIVE', isActive: true, leftOn: null, leftReason: null, leftNote: null, alumniBatch: null, classSectionId: 'sec-6a',
    });
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: true } });
    expect(invites.sendInvite).toHaveBeenCalledWith('u1', 'RAF-00042');
  });
});

describe('clearance', () => {
  it('counts books out, fines due, unsigned remarks and history', async () => {
    const { svc } = service();
    txMock.libraryIssue.count.mockResolvedValue(2);
    txMock.libraryFine.aggregate.mockResolvedValue({ _sum: { amountRupees: 150 } });
    txMock.diaryRecipient.count.mockResolvedValue(1);
    txMock.diaryAck.count.mockResolvedValue(0);
    txMock.attendance.count.mockResolvedValue(40);
    txMock.result.count.mockResolvedValue(0);
    txMock.messageThread.count.mockResolvedValue(0);
    const c = await svc.clearance(SCHOOL, STUDENT);
    expect(c).toEqual({ libraryIssuesOut: 2, finesDueRupees: 150, feeDuesRupees: 0, unsignedRemarks: 1, hasHistory: true });
  });
});
```

(`feeDuesRupees` comes from the fees module's exported query service — open `apps/api/src/modules/fees/fee-query.service.ts`, find the method the Press's `certificate.service.ts` mirrors for `ledgerBalanceMinor`, and call that; the spec above passes a `fees` mock returning 0. Balances in the ledger are in minor units; divide by 100 and round.)

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @skoolos/api test -- modules/management/student-lifecycle.service.spec.ts`
Expected: FAIL "Cannot find module './student-lifecycle.service'".

- [ ] **Step 3: close-login.ts**

```ts
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Login shutdown is cross-cutting auth state, so it runs on the PLATFORM
 * client, after the tenant transaction commits — the same revoke-all pattern
 * TeachersService.release() already uses.
 */
export async function closeLogin(userId: string): Promise<void> {
  const platform = getPlatformPrisma();
  await platform.$transaction([
    platform.user.update({ where: { id: userId }, data: { isActive: false } }),
    platform.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function reopenLogin(userId: string): Promise<void> {
  await getPlatformPrisma().user.update({ where: { id: userId }, data: { isActive: true } });
}
```

- [ ] **Step 4: student-transitions.ts**

```ts
import type { StudentStatus, TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';

export type LeaveStatus = Extract<StudentStatus, 'ALUMNI' | 'TRANSFERRED' | 'LEFT'>;

export interface StudentLeaveInput {
  schoolId: string;
  actorUserId: string;
  studentId: string;
  status: LeaveStatus;
  leftOn: Date;
  reason?: string | null;
  note?: string | null;
  alumniBatch?: string | null;
}

/**
 * The single write that takes a student out of the active roster. Pure tx
 * function so the Sessions "Start" (Track C) can run hundreds of these inside
 * ONE transaction. Login closure is the caller's job, after commit.
 */
export async function applyStudentLeave(tx: TenantTx, input: StudentLeaveInput): Promise<{ userId: string | null; status: LeaveStatus }> {
  const s = await tx.student.findFirst({ where: { id: input.studentId }, select: { id: true, userId: true, status: true } });
  if (!s) throw new ApiError('NOT_FOUND', 'Student not found', 404);
  if (s.status !== 'ACTIVE') throw new ApiError('NOT_ACTIVE', 'This student is not active', 409, 'status');

  let alumniBatch: string | null = null;
  if (input.status === 'ALUMNI') {
    alumniBatch = input.alumniBatch?.trim() || null;
    if (!alumniBatch) {
      const year = await tx.academicYear.findFirst({ where: { schoolId: input.schoolId, isCurrent: true }, select: { name: true } });
      alumniBatch = year?.name ?? null;
    }
  }

  await tx.student.update({
    where: { id: input.studentId },
    data: {
      status: input.status,
      isActive: false,
      leftOn: input.leftOn,
      leftReason: input.reason?.trim() || null,
      leftNote: input.note?.trim() || null,
      alumniBatch,
      statusChangedAt: new Date(),
      statusChangedById: input.actorUserId,
    },
  });
  return { userId: s.userId, status: input.status };
}

export async function applyStudentReadmit(
  tx: TenantTx,
  input: { schoolId: string; actorUserId: string; studentId: string; classSectionId?: string | null },
): Promise<{ userId: string | null; code: string | null }> {
  const s = await tx.student.findFirst({ where: { id: input.studentId }, select: { id: true, userId: true, status: true, code: true } });
  if (!s) throw new ApiError('NOT_FOUND', 'Student not found', 404);
  if (s.status === 'ACTIVE') throw new ApiError('ALREADY_ACTIVE', 'This student is already active', 409, 'status');
  await tx.student.update({
    where: { id: input.studentId },
    data: {
      status: 'ACTIVE',
      isActive: true,
      leftOn: null,
      leftReason: null,
      leftNote: null,
      alumniBatch: null,
      statusChangedAt: new Date(),
      statusChangedById: input.actorUserId,
      ...(input.classSectionId ? { classSectionId: input.classSectionId } : {}),
    },
  });
  return { userId: s.userId, code: s.code };
}

export interface StudentHistoryCounts {
  attendance: number; results: number; diary: number; library: number; threads: number; hasHistory: boolean;
}

export async function studentHistoryCounts(tx: TenantTx, studentId: string): Promise<StudentHistoryCounts> {
  const [attendance, results, diaryR, diaryA, library, threads] = await Promise.all([
    tx.attendance.count({ where: { studentId } }),
    tx.result.count({ where: { studentId } }),
    tx.diaryRecipient.count({ where: { studentId } }),
    tx.diaryAck.count({ where: { studentId } }),
    tx.libraryIssue.count({ where: { studentId } }),
    tx.messageThread.count({ where: { studentId } }),
  ]);
  const diary = diaryR + diaryA;
  return { attendance, results, diary, library, threads, hasHistory: attendance + results + diary + library + threads > 0 };
}
```

- [ ] **Step 5: DTOs (append to management.dto.ts)**

```ts
export class LeaveStudentDto {
  @IsIn(['ALUMNI', 'TRANSFERRED', 'LEFT'])
  status!: 'ALUMNI' | 'TRANSFERRED' | 'LEFT';

  @IsDateString()
  leftOn!: string;

  @IsOptional() @IsString() @Length(0, 120)
  reason?: string;

  @IsOptional() @IsString() @Length(0, 2000)
  note?: string;

  @IsOptional() @IsString() @Length(0, 40)
  alumniBatch?: string;
}

export class ReadmitStudentDto {
  @IsOptional() @IsUUID()
  classSectionId?: string;
}
```

(Add `IsDateString`, `IsIn` to the class-validator import if absent.)

- [ ] **Step 6: The service**

`apps/api/src/modules/management/student-lifecycle.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { AuditService } from '../../common/audit/audit.service';
import { LoginInviteService } from './internal/login-invite.service';
import { closeLogin, reopenLogin } from './internal/close-login';
import { applyStudentLeave, applyStudentReadmit, studentHistoryCounts } from './internal/student-transitions';
import type { LeaveStudentDto, ReadmitStudentDto } from './management.dto';

export interface StudentClearance {
  libraryIssuesOut: number;
  finesDueRupees: number;
  /** Fee ledger balance in rupees (0 when FEES is off) — the same balance the Press reads before a TC. */
  feeDuesRupees: number;
  unsignedRemarks: number;
  hasHistory: boolean;
}

@Injectable()
export class StudentLifecycleService {
  constructor(
    private readonly audit: AuditService,
    private readonly invites: LoginInviteService,
  ) {}

  async leave(schoolId: string, actorUserId: string, studentId: string, dto: LeaveStudentDto) {
    const leftOn = new Date(dto.leftOn);
    const { userId, status } = await withTenant(schoolId, (tx) =>
      applyStudentLeave(tx, { schoolId, actorUserId, studentId, status: dto.status, leftOn, reason: dto.reason, note: dto.note, alumniBatch: dto.alumniBatch }),
    );
    // A child's login ends with their time at the school. Alumni get the
    // Homecoming door instead (Track C) — never a child's account kept open.
    if (userId) await closeLogin(userId);
    await this.audit.record({ schoolId, actorUserId, action: 'student.leave', entity: 'Student', entityId: studentId, meta: { status, leftOn: dto.leftOn, reason: dto.reason ?? null } });
    return { id: studentId, status, leftOn: dto.leftOn };
  }

  async readmit(schoolId: string, actorUserId: string, studentId: string, dto: ReadmitStudentDto) {
    const { userId, code } = await withTenant(schoolId, (tx) =>
      applyStudentReadmit(tx, { schoolId, actorUserId, studentId, classSectionId: dto.classSectionId }),
    );
    if (userId) {
      await reopenLogin(userId);
      // Old sessions were revoked on leaving; a fresh set-password link is the only way back in.
      await this.invites.sendInvite(userId, code ?? '');
    }
    await this.audit.record({ schoolId, actorUserId, action: 'student.readmit', entity: 'Student', entityId: studentId, meta: { classSectionId: dto.classSectionId ?? null } });
    return { id: studentId, status: 'ACTIVE' as const };
  }

  async clearance(schoolId: string, studentId: string): Promise<StudentClearance> {
    return withTenant(schoolId, async (tx) => {
      const [issuesOut, fines, remarks, acked, history] = await Promise.all([
        tx.libraryIssue.count({ where: { studentId, returnedOn: null } }),
        tx.libraryFine.aggregate({ where: { studentId, status: 'DUE' }, _sum: { amountRupees: true } }),
        tx.diaryRecipient.count({ where: { studentId, entry: { kind: 'REMARK' } } }),
        tx.diaryAck.count({ where: { studentId, signedAt: { not: null }, entry: { kind: 'REMARK' } } }),
        studentHistoryCounts(tx, studentId),
      ]);
      return {
        libraryIssuesOut: issuesOut,
        finesDueRupees: fines._sum.amountRupees ?? 0,
        unsignedRemarks: Math.max(0, remarks - acked),
        hasHistory: history.hasHistory,
      };
    });
  }
}
```

- [ ] **Step 7: Register the provider**

In `management.module.ts` import `StudentLifecycleService` and add it to `providers`. `AuditService` comes from `../../common/audit/audit.service`; check `management.module.ts` imports the module that provides it (grep `AuditService` in `apps/api/src/app.module.ts`); if it is provided globally nothing else is needed, otherwise add `AuditService` to `providers`.

- [ ] **Step 8: Run the spec**

Run: `pnpm --filter @skoolos/api test -- modules/management/student-lifecycle.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/management/internal/close-login.ts apps/api/src/modules/management/internal/student-transitions.ts apps/api/src/modules/management/student-lifecycle.service.ts apps/api/src/modules/management/student-lifecycle.service.spec.ts apps/api/src/modules/management/management.dto.ts apps/api/src/modules/management/management.module.ts
git commit -m "feat(api): student leave / readmit / clearance transitions"
```

---

### Task 5: Student routes, status filter, delete guard, clash message

**Files:**
- Modify: `apps/api/src/modules/management/students.controller.ts`
- Modify: `apps/api/src/modules/management/students.service.ts` (`remove`, `create`/`update` P2002 message)
- Test: `apps/api/src/modules/management/students.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: `StudentLifecycleService`, `studentHistoryCounts`, `StudentListStatus`.
- Produces: `GET /manage/students?status=`, `POST /manage/students/:id/leave`, `POST /manage/students/:id/readmit`, `GET /manage/students/:id/clearance`; `DELETE` → 409 `HAS_HISTORY`.

- [ ] **Step 1: Failing spec cases (append to students.service.spec.ts)**

```ts
describe('remove (delete guard)', () => {
  it('refuses with HAS_HISTORY when the student has attendance', async () => {
    txMock.attendance = { count: jest.fn().mockResolvedValue(3) } as never;
    txMock.result = { count: jest.fn().mockResolvedValue(0) } as never;
    txMock.diaryRecipient = { count: jest.fn().mockResolvedValue(0) } as never;
    txMock.diaryAck = { count: jest.fn().mockResolvedValue(0) } as never;
    txMock.libraryIssue = { count: jest.fn().mockResolvedValue(0) } as never;
    txMock.messageThread = { count: jest.fn().mockResolvedValue(0) } as never;
    txMock.student.delete = jest.fn();
    await expect(svc.remove(SCHOOL, 'st-1')).rejects.toMatchObject({ code: 'HAS_HISTORY', status: 409 });
    expect(txMock.student.delete).not.toHaveBeenCalled();
  });
});

describe('list status filter', () => {
  it('defaults to ACTIVE and maps left to the three left states', async () => {
    txMock.student.findMany.mockResolvedValue([]);
    await svc.list(SCHOOL);
    expect(txMock.student.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
    await svc.list(SCHOOL, { status: 'left' });
    expect(txMock.student.findMany.mock.calls[1][0].where.status).toEqual({ in: ['ALUMNI', 'TRANSFERRED', 'LEFT'] });
  });
});
```

(`svc` is the `StudentsService` the file already constructs; extend `txMock` at the top of the file with the six counters if the `as never` assignments read awkwardly.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @skoolos/api test -- modules/management/students.service.spec.ts`
Expected: FAIL on both new cases.

- [ ] **Step 3: Delete guard in students.service.remove()**

```ts
async remove(schoolId: string, id: string) {
  try {
    await withTenant(schoolId, async (tx) => {
      const history = await studentHistoryCounts(tx, id);
      if (history.hasHistory) {
        throw new ApiError('HAS_HISTORY', 'This student has history. Mark them as left instead.', 409);
      }
      await tx.student.delete({ where: { id } });
    });
  } catch (e) {
    if (isP2025(e)) throw new NotFoundException('Student not found');
    if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this student');
    throw e;
  }
}
```

Import `studentHistoryCounts` from `./internal/student-transitions`.

- [ ] **Step 4: Admission-number clash names the holder**

In `create()` and `update()` replace the generic P2002 admission message with a lookup:

```ts
private async admissionClashMessage(schoolId: string, admissionNo: string | undefined): Promise<string> {
  if (!admissionNo) return 'A student with that admission number already exists';
  const holder = await withTenant(schoolId, (tx) =>
    tx.student.findFirst({ where: { schoolId, admissionNo }, select: { firstName: true, lastName: true, status: true, alumniBatch: true } }),
  );
  if (!holder) return 'A student with that admission number already exists';
  const tag = holder.status === 'ACTIVE' ? 'active' : `${holder.status}${holder.alumniBatch ? ` · ${holder.alumniBatch}` : ''}`;
  return `Admission number ${admissionNo} belongs to ${holder.firstName} ${holder.lastName} (${tag})`;
}
```

and `throw new ConflictException(await this.admissionClashMessage(schoolId, dto.admissionNo));` in both catch blocks (keep the `code` branch first in `create()`).

- [ ] **Step 5: Controller routes**

```ts
@Get()
@Roles('SCHOOL_ADMIN', 'TEACHER')
list(
  @CurrentUser() u: SchoolJwtPayload,
  @Query('classSectionId', new ParseUUIDPipe({ optional: true })) classSectionId?: string,
  @Query('status') status?: string,
) {
  const st: StudentListStatus = status === 'left' || status === 'all' ? status : 'active';
  if (u.role !== 'SCHOOL_ADMIN') {
    if (!classSectionId) throw new ApiError('VALIDATION', 'classSectionId is required', 400, 'classSectionId');
    // Teachers only ever see the active roster of one section.
    return this.students.list(this.sid(), { classSectionId, projection: 'roster', status: 'active' });
  }
  return this.students.list(this.sid(), { classSectionId, projection: 'full', status: st });
}

@Post(':id/leave')
leave(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveStudentDto) {
  return this.lifecycle.leave(this.sid(), u.sub, id, dto);
}

@Post(':id/readmit')
readmit(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReadmitStudentDto) {
  return this.lifecycle.readmit(this.sid(), u.sub, id, dto);
}

@Get(':id/clearance')
clearance(@Param('id', ParseUUIDPipe) id: string) {
  return this.lifecycle.clearance(this.sid(), id);
}
```

Inject `private readonly lifecycle: StudentLifecycleService` in the constructor and import the DTOs and `StudentListStatus`.

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter @skoolos/api test -- modules/management/students`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/management/students.controller.ts apps/api/src/modules/management/students.service.ts apps/api/src/modules/management/students.service.spec.ts
git commit -m "feat(api): student leave/readmit/clearance routes, status filter, delete guard"
```

---

### Task 6: Teacher release with handover; staff release; reactivate

**Files:**
- Modify: `apps/api/src/modules/management/teachers.service.ts` (`release`, add `releaseImpact`, `reactivate`, `createLogin` same-school branch)
- Modify: `apps/api/src/modules/management/teachers.controller.ts`
- Modify: `apps/api/src/modules/management/staff.service.ts`, `staff.controller.ts`
- Modify: `apps/api/src/modules/management/management.dto.ts`
- Test: `apps/api/src/modules/management/teachers.service.spec.ts` (create if absent), `staff.service.spec.ts`

**Interfaces:**
- Produces:
  - `ReleaseTeacherDto { leftOn: string; reason?: string; note?: string; handover?: { classSections?: Record<string, string | null>; timetableTeacherId?: string | null; keepFeatured?: boolean } }`
  - `ReleaseStaffDto { leftOn: string; reason?: string; note?: string }`
  - `TeachersService.releaseImpact(schoolId, id): Promise<ReleaseImpact>` with `ReleaseImpact = { classTeacherOf: { id: string; label: string }[]; timetableSlots: number; pendingLeave: number; featuredOnWebsite: boolean; libraryIssuesOut: number; openThreads: number }`
  - `TeachersService.release(schoolId, actorUserId, id, dto: ReleaseTeacherDto)`; `TeachersService.reactivate(schoolId, actorUserId, id)`
  - `StaffService.release(schoolId, actorUserId, id, dto)`, `StaffService.reactivate(schoolId, actorUserId, id)`
  - `createLogin` throws `ApiError('ALREADY_HERE_INACTIVE', …, 409)` with `meta.teacherId` when an inactive same-email row exists in this school.

- [ ] **Step 1: Failing spec**

`apps/api/src/modules/management/teachers.service.spec.ts` (new file, same mock scaffold as Task 4 with these tables on `txMock`: `teacher`, `classSection`, `timetableSlot`, `leaveApplication`, `featuredStaff`, `libraryIssue`, `messageThread`, `subject`):

```ts
describe('release with handover', () => {
  it('reassigns class-teacher seats, ends timetable slots, rejects pending leave, drops featured, closes login', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 'T1', userId: 'u1', status: 'ACTIVE' });
    txMock.classSection.updateMany.mockResolvedValue({ count: 1 });
    txMock.timetableSlot.updateMany.mockResolvedValue({ count: 4 });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 2 });
    txMock.featuredStaff.deleteMany.mockResolvedValue({ count: 1 });
    await svc.release(SCHOOL, ACTOR, 'T1', {
      leftOn: '2026-03-31',
      reason: 'Resigned',
      handover: { classSections: { 'sec-5a': 'T2', 'sec-6b': null }, timetableTeacherId: null, keepFeatured: false },
    });
    expect(txMock.classSection.update).toHaveBeenCalledWith({ where: { id: 'sec-5a' }, data: { classTeacherId: 'T2' } });
    expect(txMock.classSection.update).toHaveBeenCalledWith({ where: { id: 'sec-6b' }, data: { classTeacherId: null } });
    expect(txMock.timetableSlot.updateMany).toHaveBeenCalledWith({ where: { teacherId: 'T1', effectiveTo: null }, data: { effectiveTo: new Date('2026-03-31') } });
    expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teacherId: 'T1', status: 'PENDING' } }));
    expect(txMock.featuredStaff.deleteMany).toHaveBeenCalledWith({ where: { teacherId: 'T1' } });
    expect(txMock.teacher.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'LEFT', isActive: false }) }));
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
  });

  it('hands timetable slots to a named teacher instead of ending them', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 'T1', userId: null, status: 'ACTIVE' });
    await svc.release(SCHOOL, ACTOR, 'T1', { leftOn: '2026-03-31', handover: { timetableTeacherId: 'T9' } });
    expect(txMock.timetableSlot.updateMany).toHaveBeenCalledWith({ where: { teacherId: 'T1', effectiveTo: null }, data: { teacherId: 'T9' } });
  });
});

describe('reactivate', () => {
  it('sets ACTIVE, clears left fields, reopens the login', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 'T1', userId: 'u1', status: 'LEFT', email: 't@x.in' });
    await svc.reactivate(SCHOOL, ACTOR, 'T1');
    expect(txMock.teacher.update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', isActive: true, leftOn: null, leftReason: null });
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: true } });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @skoolos/api test -- modules/management/teachers.service.spec.ts`
Expected: FAIL (`release` has the old two-argument signature; `reactivate` missing).

- [ ] **Step 3: DTOs**

```ts
export class TeacherHandoverDto {
  @IsOptional() @IsObject()
  classSections?: Record<string, string | null>;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  timetableTeacherId?: string | null;

  @IsOptional() @IsBoolean()
  keepFeatured?: boolean;
}

export class ReleaseTeacherDto {
  @IsDateString() leftOn!: string;
  @IsOptional() @IsString() @Length(0, 120) reason?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @ValidateNested() @Type(() => TeacherHandoverDto) handover?: TeacherHandoverDto;
}

export class ReleaseStaffDto {
  @IsDateString() leftOn!: string;
  @IsOptional() @IsString() @Length(0, 120) reason?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}
```

(`Type` from `class-transformer`; `IsObject`, `ValidateIf`, `ValidateNested` from class-validator.)

- [ ] **Step 4: teachers.service.ts — releaseImpact, release, reactivate**

Replace the existing `release()` with:

```ts
export interface ReleaseImpact {
  classTeacherOf: { id: string; label: string }[];
  timetableSlots: number;
  pendingLeave: number;
  featuredOnWebsite: boolean;
  libraryIssuesOut: number;
  openThreads: number;
}

async releaseImpact(schoolId: string, id: string): Promise<ReleaseImpact> {
  return withTenant(schoolId, async (tx) => {
    const t = await tx.teacher.findFirst({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('Teacher not found');
    const [sections, slots, leave, featured, issues, threads] = await Promise.all([
      tx.classSection.findMany({ where: { classTeacherId: id }, select: { id: true, name: true, grade: { select: { name: true } } } }),
      tx.timetableSlot.count({ where: { teacherId: id, effectiveTo: null } }),
      tx.leaveApplication.count({ where: { teacherId: id, status: 'PENDING' } }),
      tx.featuredStaff.count({ where: { teacherId: id } }),
      tx.libraryIssue.count({ where: { teacherId: id, returnedOn: null } }),
      tx.messageThread.count({ where: { teacherId: id } }),
    ]);
    return {
      classTeacherOf: sections.map((s) => ({ id: s.id, label: `${s.grade.name} ${s.name}` })),
      timetableSlots: slots,
      pendingLeave: leave,
      featuredOnWebsite: featured > 0,
      libraryIssuesOut: issues,
      openThreads: threads,
    };
  });
}

/**
 * "Remove from this school" — the clean off-board that FREES a teacher to be
 * onboarded elsewhere. Deactivates rather than deletes (history stays), hands
 * over what they held, then closes the login. The one-school guard in
 * `createLogin` only blocks on ACTIVE rows, so the next school onboards them.
 */
async release(schoolId: string, actorUserId: string, id: string, dto: ReleaseTeacherDto): Promise<{ released: true }> {
  const leftOn = new Date(dto.leftOn);
  const h = dto.handover ?? {};
  const userId = await withTenant(schoolId, async (tx) => {
    const teacher = await tx.teacher.findFirst({ where: { id }, select: { userId: true, status: true } });
    if (!teacher) throw new NotFoundException('Teacher not found');
    if (teacher.status !== 'ACTIVE') throw new ApiError('NOT_ACTIVE', 'This teacher is not active', 409, 'status');

    for (const [sectionId, to] of Object.entries(h.classSections ?? {})) {
      await tx.classSection.update({ where: { id: sectionId }, data: { classTeacherId: to } });
    }
    // Any seat not named in the handover is simply emptied.
    await tx.classSection.updateMany({ where: { classTeacherId: id }, data: { classTeacherId: null } });

    if (h.timetableTeacherId) {
      await tx.timetableSlot.updateMany({ where: { teacherId: id, effectiveTo: null }, data: { teacherId: h.timetableTeacherId } });
    } else {
      await tx.timetableSlot.updateMany({ where: { teacherId: id, effectiveTo: null }, data: { effectiveTo: leftOn } });
    }

    await tx.leaveApplication.updateMany({
      where: { teacherId: id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: actorUserId },
    });

    if (!h.keepFeatured) await tx.featuredStaff.deleteMany({ where: { teacherId: id } });

    await tx.teacher.update({
      where: { id },
      data: {
        status: 'LEFT', isActive: false, leftOn,
        leftReason: dto.reason?.trim() || null, leftNote: dto.note?.trim() || null,
        statusChangedAt: new Date(), statusChangedById: actorUserId,
      },
    });
    return teacher.userId;
  });

  if (userId) await closeLogin(userId);
  await this.audit.record({ schoolId, actorUserId, action: 'teacher.release', entity: 'Teacher', entityId: id, meta: { leftOn: dto.leftOn, reason: dto.reason ?? null } });
  return { released: true };
}

async reactivate(schoolId: string, actorUserId: string, id: string): Promise<{ id: string; status: 'ACTIVE' }> {
  const userId = await withTenant(schoolId, async (tx) => {
    const t = await tx.teacher.findFirst({ where: { id }, select: { userId: true, status: true } });
    if (!t) throw new NotFoundException('Teacher not found');
    if (t.status === 'ACTIVE') throw new ApiError('ALREADY_ACTIVE', 'This teacher is already active', 409, 'status');
    await tx.teacher.update({
      where: { id },
      data: { status: 'ACTIVE', isActive: true, leftOn: null, leftReason: null, leftNote: null, statusChangedAt: new Date(), statusChangedById: actorUserId },
    });
    return t.userId;
  });
  if (userId) await reopenLogin(userId);
  await this.audit.record({ schoolId, actorUserId, action: 'teacher.reactivate', entity: 'Teacher', entityId: id, meta: null });
  return { id, status: 'ACTIVE' };
}
```

Inject `AuditService` into `TeachersService`'s constructor; import `closeLogin`, `reopenLogin`, `ApiError`. Replace the old platform `$transaction` block in `release` (it is now `closeLogin`).

- [ ] **Step 5: createLogin same-school branch**

Right before the cross-tenant `elsewhere` lookup in `createLogin`, add:

```ts
const hereInactive = await tx.teacher.findFirst({
  where: { schoolId, email: { equals: email, mode: 'insensitive' }, status: 'LEFT', id: { not: teacherId } },
  select: { id: true, firstName: true, lastName: true },
});
if (hereInactive) {
  throw new ApiError(
    'ALREADY_HERE_INACTIVE',
    `${hereInactive.firstName} ${hereInactive.lastName} already has a record at this school that was marked as left — reactivate it instead of adding a duplicate`,
    409,
    'email',
    { teacherId: hereInactive.id },
  );
}
```

(If `ApiError`'s constructor has no fifth `meta` argument, add an optional `meta?: Record<string, unknown>` that is serialised in the error body; check `apps/api/src/common/errors/api-error.ts` first.)

- [ ] **Step 6: Controllers**

`teachers.controller.ts`:

```ts
@Get(':id/release-impact')
releaseImpact(@Param('id', ParseUUIDPipe) id: string) {
  return this.teachers.releaseImpact(this.sid(), id);
}

@Post(':id/release')
release(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseTeacherDto) {
  return this.teachers.release(this.sid(), u.sub, id, dto);
}

@Post(':id/reactivate')
reactivate(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
  return this.teachers.reactivate(this.sid(), u.sub, id);
}
```

`staff.service.ts` gets `release(schoolId, actorUserId, id, dto: ReleaseStaffDto)` (status LEFT, left fields, `isActive=false`, `closeLogin(userId)` when linked, audit `staff.release`) and `reactivate` (mirror of the teacher one). `staff.controller.ts` adds `POST :id/release` and `POST :id/reactivate` with the same shape as above.

- [ ] **Step 7: Run suites**

Run: `pnpm --filter @skoolos/api test -- modules/management/teachers modules/management/staff`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/management/teachers.service.ts apps/api/src/modules/management/teachers.controller.ts apps/api/src/modules/management/teachers.service.spec.ts apps/api/src/modules/management/staff.service.ts apps/api/src/modules/management/staff.controller.ts apps/api/src/modules/management/management.dto.ts
git commit -m "feat(api): teacher release with handover, staff release, reactivate"
```

---

### Task 7: Public site drops left teachers

**Files:**
- Modify: `apps/api/src/modules/public/public-site.service.ts` (the `featuredStaff.findMany` in `getSite`)
- Test: `apps/api/src/modules/public/public-site.service.spec.ts` (add the case; create the file with the txMock scaffold if it does not exist)

**Interfaces:**
- Produces: the public `staff` projection never includes a FeaturedStaff row whose linked teacher has `status = LEFT`.

- [ ] **Step 1: Failing spec case**

```ts
it('featured staff linked to a LEFT teacher are not queried', async () => {
  txMock.featuredStaff.findMany.mockResolvedValue([]);
  await svc.getSite();
  expect(txMock.featuredStaff.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, OR: [{ teacherId: null }, { teacher: { status: 'ACTIVE' } }] });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @skoolos/api test -- modules/public/public-site`
Expected: FAIL (the where is `{ schoolId }`).

- [ ] **Step 3: Implement**

```ts
tx.featuredStaff.findMany({
  take: LIST_CEILING.STRUCTURE,
  where: { schoolId, OR: [{ teacherId: null }, { teacher: { status: 'ACTIVE' } }] },
  orderBy: { order: 'asc' },
}),
```

(Keep whatever `take` the query already has if one is present.)

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @skoolos/api test -- modules/public` → PASS.

```bash
git add apps/api/src/modules/public/public-site.service.ts apps/api/src/modules/public/public-site.service.spec.ts
git commit -m "fix(api): the Educators band never shows a teacher who has left"
```

---

### Task 8: Mobile — the closed child on the shelf

**Files:**
- Modify: `apps/mobile/src/lib/family-store.ts` (`ChildProfile.closed?: boolean`, `family.markClosed(key)`)
- Modify: `apps/mobile/src/lib/api.ts` (on 401 refresh failure whose body says `User no longer active`, call `family.markClosed(activeKey)`)
- Modify: `apps/mobile/src/app/(family)/(tabs)/home/shelf.tsx` (closed card)
- Modify: `apps/mobile/src/app/(auth)/login.tsx` (empty resolve copy)
- Test: `apps/mobile/src/lib/__tests__/family-store.test.ts` (extend), `apps/mobile/src/app/(family)/(tabs)/home/shelf.test.tsx` (extend or create)

**Interfaces:**
- Produces: `ChildProfile.closed?: boolean`; `family.markClosed(key: string): Promise<void>`.

- [ ] **Step 1: Failing store test**

```ts
it('markClosed flags the child and keeps the others', async () => {
  await family.add(childA); await family.add(childB);
  await family.markClosed(childA.key);
  const s = await family.get();
  expect(s.children.find((c) => c.key === childA.key)?.closed).toBe(true);
  expect(s.children.find((c) => c.key === childB.key)?.closed).toBeUndefined();
});
```

Run: `pnpm --filter @skoolos/mobile test -- family-store` → FAIL (`markClosed` is not a function).

- [ ] **Step 2: Implement in family-store.ts**

```ts
export interface ChildProfile {
  key: string; displayName: string; schoolHost: string; accent: string; session: Session;
  /** The school marked this child as left; the login is closed. Shown, never refreshed. */
  closed?: boolean;
}

async markClosed(key: string): Promise<void> {
  const s = await this.get();
  const children = s.children.map((c) => (c.key === key ? { ...c, closed: true } : c));
  await this.write({ ...s, children });
}
```

(`write` is the existing private persist helper; if it is named differently, use that name.)

- [ ] **Step 3: api.ts — detect the closed login**

In the 401 branch that throws `ApiError(401, 'Session expired — please log in again.')`, read the refresh response body first:

```ts
const text = await refreshRes.text().catch(() => '');
if (/no longer active/i.test(text)) {
  const active = await family.activeKey();
  if (active) await family.markClosed(active);
  throw new ApiError(401, 'This login has been closed by the school.');
}
```

(If `family.activeKey()` does not exist, read `(await family.get()).activeKey`.)

- [ ] **Step 4: shelf.tsx — the closed card**

In `Spine`, when `child.closed` render, instead of the spine content:

```tsx
<View accessibilityRole="summary">
  <Text style={{ fontWeight: '700', color: t.text }}>{child.displayName}</Text>
  <Text style={{ color: t.muted, marginTop: 2 }}>No longer enrolled at {schoolLabel(child.schoolHost)}</Text>
  <Pressable onPress={() => family.remove(child.key)} accessibilityRole="button" style={{ marginTop: 8 }}>
    <Text style={{ color: t.accent, fontWeight: '600' }}>Remove from shelf</Text>
  </Pressable>
</View>
```

and make `onPress` of a closed spine a no-op (it must not switch sessions). `schoolLabel(host)` = the host's first label, capitalised (there is an existing helper for the school name on the shelf; reuse it).

Shelf test: render with one closed child and assert `getByText('No longer enrolled at Raffles')` and `getByText('Remove from shelf')`.

- [ ] **Step 5: login.tsx — no copy change (dropped)**

The gate deliberately answers the same neutral "check your details" whether an identifier is unknown or the password is wrong, and `login.test.tsx` guards it ("shows a neutral error when the identifier resolves nowhere"). Leave it. A code the school marked as left resolves nowhere and gets that same message; the family learns why from the shelf card (Step 4), not from the gate.

- [ ] **Step 6: Run mobile tests**

Run: `pnpm --filter @skoolos/mobile test -- family-store shelf login`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/family-store.ts apps/mobile/src/lib/api.ts "apps/mobile/src/app/(family)/(tabs)/home/shelf.tsx" "apps/mobile/src/app/(auth)/login.tsx" apps/mobile/src/lib/__tests__/family-store.test.ts "apps/mobile/src/app/(family)/(tabs)/home/shelf.test.tsx"
git commit -m "feat(mobile): shelf shows a closed child instead of breaking"
```

---

### Task 9: Console — Students page tabs, Mark as left, Re-admit, delete guard, multi-select

**Files:**
- Create: `apps/web/components/ui/dialog-shell.tsx` (the `DialogShell` currently duplicated in `students/page.tsx` and `staff-attendance/page.tsx`, moved once; both pages import it)
- Create: `apps/web/app/app/students/leave-dialog.tsx`
- Modify: `apps/web/app/app/students/page.tsx`, `apps/web/app/app/staff-attendance/page.tsx` (import the shared shell)
- Test: `apps/web/app/app/students/leave-dialog.test.tsx`, `apps/web/app/app/students/page.test.tsx` (create)

**Kit rules for this task (from `sckools-ui-taste`):** tabs are `.sk-tabs > .sk-tab[aria-selected]`; status chips are `.sk-pill` with `data-tone="good" | "amber" | "muted"` exactly as `app/app/alumni/page.tsx` tones them; the clearance warning is `.sk-notice`; buttons are `.sk-btn` with the brand fill recipe the alumni page uses for its primary (`background: var(--sk-brand)`, `color: '#fff'`); disabled gets its own flat fill, never `opacity`. Dialog markup goes through `DialogShell`. Look at the page rendered at desktop and ~360px before committing.

**Interfaces:**
- Consumes: `GET /manage/students?status=`, `GET /manage/students/:id/clearance`, `POST /manage/students/:id/leave`, `POST /manage/students/:id/readmit`, `DELETE` 409.
- Produces: `<LeaveDialog students={Student[]} onDone={() => void} onCancel={() => void} />`.

- [ ] **Step 1: Failing dialog test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeaveDialog from './leave-dialog';

const api = { get: vi.fn(), post: vi.fn() };
vi.mock('@/lib/use-api', () => ({ useApi: () => api }));

const student = { id: 's1', firstName: 'Aarav', lastName: 'Mehta', admissionNo: '0421' };

function mount(props = {}) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><LeaveDialog students={[student]} onDone={vi.fn()} onCancel={vi.fn()} {...props} /></QueryClientProvider>);
}

describe('LeaveDialog', () => {
  it('shows the clearance warning and posts the leave with the chosen reason', async () => {
    api.get.mockResolvedValue({ libraryIssuesOut: 2, finesDueRupees: 0, unsignedRemarks: 0, hasHistory: true });
    api.post.mockResolvedValue({ id: 's1', status: 'TRANSFERRED' });
    const onDone = vi.fn();
    mount({ onDone });
    expect(await screen.findByText(/2 library books still out/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Moved to another school'));
    await userEvent.type(screen.getByLabelText('Reason'), 'Moved city');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as left' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/students/s1/leave', expect.objectContaining({ status: 'TRANSFERRED', reason: 'Moved city' })));
    expect(onDone).toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @skoolos/web test -- students/leave-dialog` → FAIL (module missing).

- [ ] **Step 2: leave-dialog.tsx**

```tsx
'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';

interface LeaveStudent { id: string; firstName: string; lastName: string; admissionNo: string }
interface Clearance { libraryIssuesOut: number; finesDueRupees: number; unsignedRemarks: number; hasHistory: boolean }
type LeaveStatus = 'ALUMNI' | 'TRANSFERRED' | 'LEFT';

const OPTIONS: { value: LeaveStatus; label: string; hint: string }[] = [
  { value: 'ALUMNI', label: 'Passed out', hint: 'Finished the final class. Keeps an alumni login.' },
  { value: 'TRANSFERRED', label: 'Moved to another school', hint: 'A transfer certificate was or will be issued.' },
  { value: 'LEFT', label: 'Left for another reason', hint: 'Withdrawn, long absence, or anything else.' },
];

export default function LeaveDialog({ students, onDone, onCancel }: { students: LeaveStudent[]; onDone: () => void; onCancel: () => void }) {
  const api = useApi();
  const single = students.length === 1 ? students[0] : null;
  const [status, setStatus] = useState<LeaveStatus>('TRANSFERRED');
  const [leftOn, setLeftOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);

  const clearance = useQuery({
    queryKey: ['student-clearance', single?.id],
    queryFn: () => api.get<Clearance>(`/manage/students/${single!.id}/clearance`),
    enabled: !!single,
  });

  const leave = useMutation({
    mutationFn: async () => {
      // One request per student, in order, so a failure names the child it stopped at.
      for (let i = 0; i < students.length; i++) {
        await api.post(`/manage/students/${students[i].id}/leave`, { status, leftOn, reason: reason || undefined, note: note || undefined });
        setProgress(i + 1);
      }
    },
    onSuccess: () => { toast.success(students.length === 1 ? 'Marked as left' : `${students.length} students marked as left`); onDone(); },
    onError: (e: Error) => toast.error(`Stopped at student ${progress + 1} of ${students.length}: ${e.message}`),
  });

  const c = clearance.data;
  const warnings = c
    ? [
        c.libraryIssuesOut > 0 && `${c.libraryIssuesOut} library book${c.libraryIssuesOut === 1 ? '' : 's'} still out`,
        c.finesDueRupees > 0 && `₹${c.finesDueRupees} in library fines due`,
        c.unsignedRemarks > 0 && `${c.unsignedRemarks} diary remark${c.unsignedRemarks === 1 ? '' : 's'} not signed`,
      ].filter(Boolean) as string[]
    : [];

  return (
    <div role="dialog" aria-labelledby="leave-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <form className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onSubmit={(e) => { e.preventDefault(); leave.mutate(); }}>
        <h2 id="leave-title" className="text-lg font-semibold text-slate-900">
          {single ? `Mark ${single.firstName} ${single.lastName} as left` : `Mark ${students.length} students as left`}
        </h2>
        <p className="mt-1 text-sm text-slate-600">Their record and history stay. They leave every register, diary and notice from today.</p>
        {warnings.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Before they go:</b>
            <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        <fieldset className="mt-4 space-y-2">
          <legend className="sk-lab">Why</legend>
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
              <input type="radio" name="status" value={o.value} checked={status === o.value} onChange={() => setStatus(o.value)} aria-label={o.label} className="mt-1" />
              <span><span className="block text-slate-900">{o.label}</span><span className="block text-xs text-slate-500">{o.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="mt-3 block text-sm"><span className="sk-lab">Left on</span><input type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} className="sk-input mt-1 w-full" required /></label>
        <label className="mt-3 block text-sm"><span className="sk-lab">Reason</span><input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="sk-input mt-1 w-full" maxLength={120} /></label>
        <label className="mt-3 block text-sm"><span className="sk-lab">Note (office only)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} className="sk-input mt-1 w-full" rows={2} maxLength={2000} /></label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cancel</button>
          <button type="submit" disabled={leave.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white">
            {leave.isPending ? `Marking ${progress}/${students.length}…` : 'Mark as left'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

(`sk-lab` / `sk-input` are the console's existing label/input classes; if `sk-input` does not exist, use the inline input styling the page already uses.)

- [ ] **Step 3: Students page changes**

In `apps/web/app/app/students/page.tsx`:

1. Extend `Student` with `status: 'ACTIVE' | 'ALUMNI' | 'TRANSFERRED' | 'LEFT'; leftOn: string | null; alumniBatch: string | null;`.
2. Add `const [statusTab, setStatusTab] = useState<'active' | 'left' | 'all'>('active');` and include it in the students query key and URL: `` `/manage/students?status=${statusTab}${classFilter ? `&classSectionId=${encodeURIComponent(classFilter)}` : ''}` ``.
3. Render three tab buttons above the table: "Active", "Alumni & left", "All".
4. Row: after the name, when `s.status !== 'ACTIVE'` render `<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{statusLabel(s)}</span>` where `statusLabel` returns `Alumni · 2025-26`, `Transferred · 31 Mar 2026`, or `Left · 31 Mar 2026`.
5. Row actions: for ACTIVE rows replace the Delete button with "Mark as left…" (opens `LeaveDialog` with `[student]`); keep Delete only when a lazily loaded clearance says `hasHistory === false` — simplest: always show a "Delete" item that, on 409 `HAS_HISTORY`, toasts the server message and opens the LeaveDialog. For non-ACTIVE rows show "Re-admit" → `api.post('/manage/students/${id}/readmit', { classSectionId })` via a small inline class select.
6. Multi-select: a checkbox column (ACTIVE tab only) and a sticky bar "N selected · Mark as left" opening `LeaveDialog` with the selection.
7. `deleteMutation.onError`: if the error `code` is `HAS_HISTORY` (branch on `code`, never on message text — `api-error.ts` rule), `toast.error('This student has history. Mark them as left instead.')` and `setLeaveTargets([student])`.
8. After a successful leave, when the site features include `PRESS`, the success toast carries an action "Order a Transfer Certificate" linking to `/app/press` (the Print Store already gates a TC on dues).

- [ ] **Step 4: Page test (create `page.test.tsx`)**

Mock `useApi` and assert: default fetch URL contains `status=active`; clicking "Alumni & left" refetches with `status=left`; a row with `status: 'ALUMNI'` shows `Alumni · 2025-26` and a "Re-admit" button.

- [ ] **Step 5: Run web tests**

Run: `pnpm --filter @skoolos/web test -- students`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/app/students/leave-dialog.tsx apps/web/app/app/students/leave-dialog.test.tsx apps/web/app/app/students/page.tsx apps/web/app/app/students/page.test.tsx
git commit -m "feat(web): students page — status tabs, Mark as left, Re-admit, delete guard"
```

---

### Task 10: Console — Teachers and Staff: Remove from this school, Reactivate

**Files:**
- Create: `apps/web/app/app/teachers/release-sheet.tsx`
- Modify: `apps/web/app/app/teachers/page.tsx`, `apps/web/app/app/staff/page.tsx`
- Test: `apps/web/app/app/teachers/release-sheet.test.tsx`

**Interfaces:**
- Consumes: `GET /manage/teachers/:id/release-impact`, `POST /manage/teachers/:id/release`, `POST /manage/teachers/:id/reactivate`, `GET /manage/teachers` (for the replacement pickers), `POST /manage/staff/:id/release`, `/reactivate`.
- Produces: `<ReleaseSheet teacher onDone onCancel />`.

- [ ] **Step 1: Failing sheet test**

```tsx
it('lists the impact and posts the handover map', async () => {
  api.get.mockImplementation((url: string) =>
    url.endsWith('/release-impact')
      ? Promise.resolve({ classTeacherOf: [{ id: 'sec-5a', label: 'Grade 5 A' }], timetableSlots: 12, pendingLeave: 1, featuredOnWebsite: true, libraryIssuesOut: 0, openThreads: 3 })
      : Promise.resolve([{ id: 'T2', firstName: 'Priya', lastName: 'Nair', isActive: true, status: 'ACTIVE' }]),
  );
  api.post.mockResolvedValue({ released: true });
  mount();
  expect(await screen.findByText('Class teacher of Grade 5 A')).toBeInTheDocument();
  expect(screen.getByText('12 timetable periods')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('New class teacher for Grade 5 A'), 'T2');
  await userEvent.click(screen.getByRole('button', { name: 'Remove from this school' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/teachers/T1/release', expect.objectContaining({ handover: expect.objectContaining({ classSections: { 'sec-5a': 'T2' } }) })));
});
```

Run: `pnpm --filter @skoolos/web test -- teachers/release-sheet` → FAIL.

- [ ] **Step 2: release-sheet.tsx**

Structure: fetch impact and the active teachers list; state `leftOn`, `reason`, `map: Record<sectionId, string | null>`, `timetableTeacherId: string | null`, `keepFeatured: boolean`. Render one line per impact item:

- "Class teacher of {label}" + select "New class teacher for {label}" (options: "Leave empty" + active teachers).
- "{n} timetable periods" + select "Hand periods to" (options: "Mark as unassigned" + active teachers).
- "{n} pending leave applications will be declined."
- "Shown on the website's Educators section" + checkbox "Keep them on the website" (default unchecked).
- "{n} library books out" and "{n} message threads become read-only".

Submit → `api.post('/manage/teachers/${id}/release', { leftOn, reason, handover: { classSections: map, timetableTeacherId, keepFeatured } })`, toast "Removed from this school", `onDone()`.

- [ ] **Step 3: Wire the pages**

Teachers page: row menu item "Remove from this school…" (ACTIVE rows) opening the sheet; "Reactivate" (inactive rows) → `POST /manage/teachers/:id/reactivate`; the existing "Inactive" badge shows `Left · {leftOn}` when `leftOn` is present. Staff page: "Remove from this school…" opens a small form (leftOn, reason) → `POST /manage/staff/:id/release`; "Reactivate" → `/reactivate`.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @skoolos/web test -- teachers staff` → PASS.

```bash
git add apps/web/app/app/teachers/release-sheet.tsx apps/web/app/app/teachers/release-sheet.test.tsx apps/web/app/app/teachers/page.tsx apps/web/app/app/staff/page.tsx
git commit -m "feat(web): remove-from-school handover sheet, reactivate, for teachers and staff"
```

---

### Task 11: Behaviour spec, expert KB, preflight

**Files:**
- Modify: `.claude/skills/sckools-behavior-spec/` (the students, teachers and public-site sections)
- Test: `pnpm preflight`

- [ ] **Step 1: Add invariants to the behaviour spec**

Under Students: "A student's `status` decides every roster. ACTIVE only on registers, diary, exams, notifications, birthdays. Delete is refused with HAS_HISTORY once any attendance/result/diary/library/message row exists; the console offers Mark as left. Alumni keep their login; Transferred and Left logins are closed and sessions revoked (`student-lifecycle.service.ts`). Re-admit reactivates the same record and sends a fresh invite." Under Teachers: "Remove from this school runs the handover (class teacher seats, timetable slots, pending leave, featured staff) then closes the login (`teachers.service.ts release()`). Reactivate reopens the same row." Under Public site: "Featured staff linked to a LEFT teacher never render."

- [ ] **Step 2: Render-and-look audit**

Start the web app against staging or a local API (`pnpm --filter @skoolos/web dev`), open `/app/students`, `/app/teachers`, `/app/staff` as the Raffles admin, and check each new state at desktop and ~360px: the three tabs, a row with a status chip, the Mark as left dialog with a clearance warning, the multi-select bar, Re-admit, the Remove-from-school sheet with every impact line, Reactivate, hover and disabled states. Fix what is off (spacing, wrapping, contrast) before the gate.

- [ ] **Step 3: Run the full gate**

Run: `pnpm preflight`
Expected: every step green. Fix anything red before continuing; do not skip steps.

- [ ] **Step 4: Commit and push to staging**

```bash
git add .claude/skills/sckools-behavior-spec
git commit -m "docs(spec): lifecycle invariants for students, teachers, public site"
git push origin HEAD:staging
```

Then report: what shipped, what preflight said, the staging URL to test on, and that migration `20260910090000_person_lifecycle` applies on the staging push and must be run on production by the user before the PR to main.
