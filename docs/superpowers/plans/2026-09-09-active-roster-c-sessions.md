# Active Roster · Track C: Sessions (year end) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sessions tab where the office opens the next academic year, copies the classes, decides every child (Promote · Stay in grade · Pass out · Leaving) with attendance and results beside each name, and starts the session in one transaction that moves seats, makes alumni, copies the timetable, carries leave forward, writes the promotion register and tells families, teachers and alumni.

**Architecture:** A `SessionPlan` draft (from-year → to-year) with one `SessionDecision` per student, edited over days and applied by `SessionsService.start()` inside one `withTenant` transaction that reuses Track A's `applyStudentLeave`. Attendance % and results % are computed on read, never stored. Scheduled starts run through the existing cron pattern. The console gets a six-step page; the Add student form gets a Session picker; the portal and app get an Alumni home.

**Tech Stack:** NestJS + Prisma, class-validator, jest; Next 15 + React 19 + TanStack Query, vitest; Expo; `MailService.sendLetter` for the two new emails.

**Spec:** `docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md` (§4, §5, §6, §7, §8)

## Global Constraints

- Requires Track A merged (`StudentStatus`, `applyStudentLeave`, `closeLogin`, `activeStudentsWhere`).
- New tables get RLS (`tenant_iso`) in their migration; `packages/db/src/rls-coverage.spec.ts` must stay green.
- Only one plan per school in DRAFT or SCHEDULED at a time.
- Start is one transaction; login closures and notifications happen after commit.
- The pass mark flags; it never decides (D10). Nothing about a student changes until Start.
- Same branch, staging and commit rules as Track A.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma`, `migrations/20260912090000_session_plans/migration.sql` | `SessionPlan`, `SessionDecision`, enums, RLS |
| `packages/types/src/index.ts` | `NOTIFICATION_KINDS` + `'SESSION'` |
| `apps/api/src/modules/management/sessions.dto.ts` | every DTO for the tab |
| `apps/api/src/modules/management/internal/session-maths.ts` (+spec) | pure helpers: grade ladder, default section map, attendance %, results %, roll numbers, session name/date defaults |
| `apps/api/src/modules/management/sessions.service.ts` (+spec) | plan lifecycle, structure copy, rows, decisions, review, start, cancel, register, startDue |
| `apps/api/src/modules/management/sessions.controller.ts`, `sessions-cron.controller.ts` | routes, cron |
| `apps/api/src/modules/management/classes.service.ts`, `classes.controller.ts`, `students.controller.ts`, `students.service.ts` | year filter, year on rows |
| `apps/api/src/common/mail/mail.service.ts` | `sendAlumniWelcome`, `sendSessionStarted` |
| `apps/api/vercel.json` | cron entry |
| `apps/web/app/app/sessions/page.tsx`, `steps/*.tsx`, `decide-table.tsx` (+test), `register.tsx` | the tab |
| `apps/web/app/app/layout.tsx` | nav item |
| `apps/web/app/app/students/page.tsx` | Session picker, past-sessions toggle |
| `apps/web/app/portal/page.tsx`, `apps/mobile/src/app/(family)/(tabs)/home/index.tsx` | Alumni home |

---

### Task 1: Schema, migration with RLS, notification kind

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enums, two models, back-relations on School, AcademicYear, Student)
- Create: `packages/db/prisma/migrations/20260912090000_session_plans/migration.sql`
- Modify: `packages/types/src/index.ts` (`NOTIFICATION_KINDS`), `packages/types/src/contracts.spec.ts` (if it enumerates kinds)
- Test: `packages/db/src/rls-coverage.spec.ts`, `packages/types` tests

- [ ] **Step 1: Schema**

Add the two enums and models exactly as spec §5. Back-relations: `School.sessionPlans SessionPlan[]`, `School.sessionDecisions SessionDecision[]`, `AcademicYear.plansFrom SessionPlan[] @relation("PlanFrom")`, `AcademicYear.plansTo SessionPlan[] @relation("PlanTo")`, `Student.sessionDecisions SessionDecision[]`.

- [ ] **Step 2: Migration**

```sql
CREATE TYPE "SessionPlanStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'STARTED', 'CANCELLED');
CREATE TYPE "SessionDecisionKind" AS ENUM ('PROMOTE', 'STAY', 'PASS_OUT', 'LEAVE');

CREATE TABLE "SessionPlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "fromYearId" UUID NOT NULL,
  "toYearId" UUID NOT NULL,
  "status" "SessionPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "passMarkPct" INTEGER NOT NULL DEFAULT 33,
  "countExamIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "sectionMap" JSONB NOT NULL DEFAULT '{}',
  "rollPolicy" TEXT NOT NULL DEFAULT 'KEEP',
  "copyTimetable" BOOLEAN NOT NULL DEFAULT true,
  "carryLeave" BOOLEAN NOT NULL DEFAULT true,
  "scheduledFor" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "startedById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionPlan_fromYearId_fkey" FOREIGN KEY ("fromYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionPlan_toYearId_fkey" FOREIGN KEY ("toYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SessionPlan_schoolId_status_idx" ON "SessionPlan"("schoolId", "status");

CREATE TABLE "SessionDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "decision" "SessionDecisionKind" NOT NULL,
  "toSectionId" UUID,
  "fromSectionId" UUID,
  "leaveStatus" "StudentStatus",
  "leaveReason" TEXT,
  "note" TEXT,
  "decidedById" UUID NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionDecision_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionDecision_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionDecision_planId_studentId_key" ON "SessionDecision"("planId", "studentId");
CREATE INDEX "SessionDecision_schoolId_planId_idx" ON "SessionDecision"("schoolId", "planId");

-- Tenant isolation, same policy shape as 20260824090000_rls_coverage_gap.
ALTER TABLE "SessionPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "SessionPlan" USING ("schoolId"::text = current_setting('app.current_tenant', true)) WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
ALTER TABLE "SessionDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "SessionDecision" USING ("schoolId"::text = current_setting('app.current_tenant', true)) WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
```

(Open `20260824090000_rls_coverage_gap/migration.sql` and confirm the role grants that migration applies per table; add the same `GRANT` lines for the two new tables if it has them.)

- [ ] **Step 3: Notification kind**

In `packages/types/src/index.ts` add `'SESSION',` to `NOTIFICATION_KINDS` with the comment `// Year-end: "Aarav is in Class 6A for 2026-27" and a teacher's new classes.` Update any test that enumerates the kinds.

- [ ] **Step 4: Validate**

Run: `pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db exec prisma generate && pnpm --filter @skoolos/db test && pnpm --filter @skoolos/types test`
Expected: PASS, including RLS coverage for the two new tables.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260912090000_session_plans/migration.sql packages/types/src/index.ts packages/types/src/contracts.spec.ts
git commit -m "feat(db): SessionPlan and SessionDecision with RLS; SESSION notification kind"
```

---

### Task 2: Pure session maths

**Files:**
- Create: `apps/api/src/modules/management/internal/session-maths.ts`, `session-maths.spec.ts`

**Interfaces:**
- Produces:
  - `nextSessionDefaults(from: { name: string; startDate: Date; endDate: Date }): { name: string; startDate: Date; endDate: Date }` — "2025-26" → "2026-27"; start = end + 1 day; end = start + 1 year − 1 day.
  - `gradeLadder(grades: { id: string; order: number }[]): { ok: true; ordered: string[] } | { ok: false; reason: 'DUPLICATE_ORDER' | 'EMPTY' }`.
  - `defaultSectionMap(fromSections: { id; gradeId; name }[], toSections: { id; gradeId; name }[], ladder: string[]): Record<string, string | 'PASS_OUT'>`.
  - `attendancePct(marks: { status: 'PRESENT'|'ABSENT'|'LATE' }[]): number | null`.
  - `resultsPct(results: { marks: number; maxMarks: number }[]): number | null`.
  - `assignRollNumbers(policy: 'KEEP'|'ALPHABETICAL'|'ADMISSION_NO', students: { id; firstName; lastName; admissionNo; rollNo: string | null }[]): Map<string, string | null>`.

- [ ] **Step 1: Failing spec**

```ts
import { nextSessionDefaults, gradeLadder, defaultSectionMap, attendancePct, resultsPct, assignRollNumbers } from './session-maths';

describe('session maths', () => {
  it('next session name and dates', () => {
    const n = nextSessionDefaults({ name: '2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') });
    expect(n.name).toBe('2026-27');
    expect(n.startDate.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(n.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(nextSessionDefaults({ name: 'Session 2025', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') }).name).toBe('Session 2026');
  });
  it('grade ladder rejects duplicate orders', () => {
    expect(gradeLadder([{ id: 'g1', order: 1 }, { id: 'g2', order: 2 }])).toEqual({ ok: true, ordered: ['g1', 'g2'] });
    expect(gradeLadder([{ id: 'g1', order: 0 }, { id: 'g2', order: 0 }])).toEqual({ ok: false, reason: 'DUPLICATE_ORDER' });
  });
  it('default map: same name in next grade, else first section, top grade passes out', () => {
    const from = [{ id: 'f5a', gradeId: 'g5', name: 'A' }, { id: 'f5c', gradeId: 'g5', name: 'C' }, { id: 'f10a', gradeId: 'g10', name: 'A' }];
    const to = [{ id: 't6a', gradeId: 'g6', name: 'A' }, { id: 't6b', gradeId: 'g6', name: 'B' }, { id: 't10a', gradeId: 'g10', name: 'A' }];
    expect(defaultSectionMap(from, to, ['g5', 'g6', 'g10'])).toEqual({ f5a: 't6a', f5c: 't6a', f10a: 'PASS_OUT' });
  });
  it('percentages', () => {
    expect(attendancePct([{ status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }, { status: 'PRESENT' }])).toBe(75);
    expect(attendancePct([])).toBeNull();
    expect(resultsPct([{ marks: 40, maxMarks: 50 }, { marks: 25, maxMarks: 50 }])).toBe(65);
    expect(resultsPct([])).toBeNull();
  });
  it('roll numbers', () => {
    const s = [{ id: 'b', firstName: 'Meera', lastName: 'Iyer', admissionNo: '0102', rollNo: '7' }, { id: 'a', firstName: 'Aarav', lastName: 'Mehta', admissionNo: '0099', rollNo: '3' }];
    expect([...assignRollNumbers('KEEP', s).entries()]).toEqual([['b', '7'], ['a', '3']]);
    expect([...assignRollNumbers('ALPHABETICAL', s).entries()]).toEqual([['a', '1'], ['b', '2']]);
    expect([...assignRollNumbers('ADMISSION_NO', s).entries()]).toEqual([['a', '1'], ['b', '2']]);
  });
});
```

Run: `pnpm --filter @skoolos/api test -- internal/session-maths` → FAIL.

- [ ] **Step 2: Implement**

```ts
export function nextSessionDefaults(from: { name: string; startDate: Date; endDate: Date }) {
  const startDate = new Date(Date.UTC(from.endDate.getUTCFullYear(), from.endDate.getUTCMonth(), from.endDate.getUTCDate() + 1));
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate() - 1));
  const m = from.name.match(/^(\d{4})-(\d{2})$/);
  const name = m
    ? `${Number(m[1]) + 1}-${String((Number(m[2]) + 1) % 100).padStart(2, '0')}`
    : from.name.replace(/\d{4}/, (y) => String(Number(y) + 1));
  return { name, startDate, endDate };
}

export function gradeLadder(grades: { id: string; order: number }[]) {
  if (grades.length === 0) return { ok: false as const, reason: 'EMPTY' as const };
  const orders = new Set(grades.map((g) => g.order));
  if (orders.size !== grades.length) return { ok: false as const, reason: 'DUPLICATE_ORDER' as const };
  return { ok: true as const, ordered: [...grades].sort((a, b) => a.order - b.order).map((g) => g.id) };
}

type Sec = { id: string; gradeId: string; name: string };

export function defaultSectionMap(from: Sec[], to: Sec[], ladder: string[]): Record<string, string | 'PASS_OUT'> {
  const out: Record<string, string | 'PASS_OUT'> = {};
  for (const f of from) {
    const i = ladder.indexOf(f.gradeId);
    const nextGrade = i >= 0 ? ladder[i + 1] : undefined;
    if (!nextGrade) { out[f.id] = 'PASS_OUT'; continue; }
    const candidates = to.filter((t) => t.gradeId === nextGrade).sort((a, b) => a.name.localeCompare(b.name));
    const same = candidates.find((t) => t.name.toLowerCase() === f.name.toLowerCase());
    out[f.id] = (same ?? candidates[0])?.id ?? 'PASS_OUT';
  }
  return out;
}

export function attendancePct(marks: { status: 'PRESENT' | 'ABSENT' | 'LATE' }[]): number | null {
  if (marks.length === 0) return null;
  const present = marks.filter((m) => m.status !== 'ABSENT').length;
  return Math.round((present / marks.length) * 100);
}

export function resultsPct(results: { marks: number; maxMarks: number }[]): number | null {
  const max = results.reduce((s, r) => s + r.maxMarks, 0);
  if (max === 0) return null;
  return Math.round((results.reduce((s, r) => s + r.marks, 0) / max) * 100);
}

export function assignRollNumbers(
  policy: 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO',
  students: { id: string; firstName: string; lastName: string; admissionNo: string; rollNo: string | null }[],
): Map<string, string | null> {
  if (policy === 'KEEP') return new Map(students.map((s) => [s.id, s.rollNo]));
  const sorted = [...students].sort((a, b) =>
    policy === 'ALPHABETICAL'
      ? `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      : a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true }),
  );
  return new Map(sorted.map((s, i) => [s.id, String(i + 1)]));
}
```

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/api test -- internal/session-maths` → PASS.

```bash
git add apps/api/src/modules/management/internal/session-maths.ts apps/api/src/modules/management/internal/session-maths.spec.ts
git commit -m "feat(api): pure session maths (ladder, section map, percentages, roll numbers)"
```

---

### Task 3: DTOs and the plan lifecycle (overview, create, get, update, cancel)

**Files:**
- Create: `apps/api/src/modules/management/sessions.dto.ts`
- Create: `apps/api/src/modules/management/sessions.service.ts`, `sessions.service.spec.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`

**Interfaces:**
- Produces (DTOs):
  - `CreateSessionPlanDto { name: string; startDate: string; endDate: string }`
  - `UpdateSessionPlanDto { passMarkPct?: number(0..100); countExamIds?: string[]; sectionMap?: Record<string, string>; rollPolicy?: 'KEEP'|'ALPHABETICAL'|'ADMISSION_NO'; copyTimetable?: boolean; carryLeave?: boolean }`
  - `DecisionRowDto { studentId: string; decision: 'PROMOTE'|'STAY'|'PASS_OUT'|'LEAVE'; toSectionId?: string|null; leaveStatus?: 'TRANSFERRED'|'LEFT'; leaveReason?: string; note?: string }`, `PutDecisionsDto { rows: DecisionRowDto[] }`
  - `StartSessionDto { when: 'NOW'|'ON_START_DATE'; version: number }`
- Produces (service, this task):
  - `overview(schoolId): Promise<{ years: YearRow[]; plan: PlanView | null }>` where `YearRow = { id, name, startDate, endDate, isCurrent, sections: number, students: number }` and `PlanView = SessionPlan & { fromYear: YearRow; toYear: YearRow }`.
  - `createPlan(schoolId, actorUserId, dto): Promise<PlanView>` — 409 `PLAN_OPEN` when one exists; 400 `NO_CURRENT_YEAR`; creates the to-year (unique name) with `isCurrent=false`.
  - `getPlan(schoolId): Promise<PlanView | null>` (the open one).
  - `updatePlan(schoolId, dto): Promise<PlanView>` (bumps `version`).
  - `cancel(schoolId, actorUserId): Promise<{ cancelled: true }>` (DRAFT/SCHEDULED only).

- [ ] **Step 1: Failing spec (plan lifecycle cases)**

Scaffold as Track A specs; `txMock` has `academicYear`, `sessionPlan`, `classSection`, `student`, `grade`.

```ts
describe('createPlan', () => {
  it('refuses when a plan is open', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT' });
    await expect(svc.createPlan(SCHOOL, ACTOR, { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' })).rejects.toMatchObject({ code: 'PLAN_OPEN' });
  });
  it('creates the next year (not current) and a DRAFT plan', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue(null);
    txMock.academicYear.findFirst.mockResolvedValue({ id: 'y1', name: '2025-26', isCurrent: true });
    txMock.academicYear.findUnique.mockResolvedValue(null);
    txMock.academicYear.create.mockResolvedValue({ id: 'y2', name: '2026-27', isCurrent: false });
    txMock.sessionPlan.create.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', version: 1 });
    const p = await svc.createPlan(SCHOOL, ACTOR, { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(txMock.academicYear.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isCurrent: false, name: '2026-27' }) }));
    expect(p.status).toBe('DRAFT');
  });
});
describe('updatePlan', () => {
  it('bumps version and stores the section map', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', version: 3 });
    txMock.sessionPlan.update.mockResolvedValue({ id: 'p1', version: 4 });
    await svc.updatePlan(SCHOOL, { sectionMap: { f5a: 't6a' }, passMarkPct: 40 });
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sectionMap: { f5a: 't6a' }, passMarkPct: 40, version: { increment: 1 } }) }));
  });
});
```

Run: `pnpm --filter @skoolos/api test -- sessions.service.spec` → FAIL.

- [ ] **Step 2: DTOs**

```ts
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionPlanDto {
  @IsString() @Length(1, 40) name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}
export class UpdateSessionPlanDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) passMarkPct?: number;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) countExamIds?: string[];
  @IsOptional() @IsObject() sectionMap?: Record<string, string>;
  @IsOptional() @IsIn(['KEEP', 'ALPHABETICAL', 'ADMISSION_NO']) rollPolicy?: 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO';
  @IsOptional() @IsBoolean() copyTimetable?: boolean;
  @IsOptional() @IsBoolean() carryLeave?: boolean;
}
export class DecisionRowDto {
  @IsUUID() studentId!: string;
  @IsIn(['PROMOTE', 'STAY', 'PASS_OUT', 'LEAVE']) decision!: 'PROMOTE' | 'STAY' | 'PASS_OUT' | 'LEAVE';
  @IsOptional() @IsUUID() toSectionId?: string | null;
  @IsOptional() @IsIn(['TRANSFERRED', 'LEFT']) leaveStatus?: 'TRANSFERRED' | 'LEFT';
  @IsOptional() @IsString() @Length(0, 120) leaveReason?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
export class PutDecisionsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => DecisionRowDto) rows!: DecisionRowDto[];
}
export class StartSessionDto {
  @IsIn(['NOW', 'ON_START_DATE']) when!: 'NOW' | 'ON_START_DATE';
  @IsInt() @Min(1) version!: number;
}
```

- [ ] **Step 3: Service skeleton with the lifecycle methods**

```ts
import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { AuditService } from '../../common/audit/audit.service';
import { isP2002 } from '../../common/errors/prisma-errors';
import type { CreateSessionPlanDto, UpdateSessionPlanDto } from './sessions.dto';

const OPEN = ['DRAFT', 'SCHEDULED'] as const;

@Injectable()
export class SessionsService {
  constructor(private readonly audit: AuditService /* more deps arrive in Tasks 5–7 */) {}

  private async openPlan(tx: TenantTx, schoolId: string) {
    return tx.sessionPlan.findFirst({ where: { schoolId, status: { in: [...OPEN] } }, include: { fromYear: true, toYear: true } });
  }

  async overview(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const years = await tx.academicYear.findMany({
        where: { schoolId }, orderBy: { startDate: 'asc' },
        include: { _count: { select: { classSections: true } } },
      });
      const counts = await tx.student.groupBy({ by: ['classSectionId'], where: { schoolId, status: 'ACTIVE' }, _count: { _all: true } });
      const sections = await tx.classSection.findMany({ where: { schoolId }, select: { id: true, academicYearId: true } });
      const perYear = new Map<string, number>();
      for (const s of sections) {
        const n = counts.find((c) => c.classSectionId === s.id)?._count._all ?? 0;
        perYear.set(s.academicYearId, (perYear.get(s.academicYearId) ?? 0) + n);
      }
      const plan = await this.openPlan(tx, schoolId);
      return {
        years: years.map((y) => ({ id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate, isCurrent: y.isCurrent, sections: y._count.classSections, students: perYear.get(y.id) ?? 0 })),
        plan,
      };
    });
  }

  async createPlan(schoolId: string, actorUserId: string, dto: CreateSessionPlanDto) {
    const plan = await withTenant(schoolId, async (tx) => {
      if (await this.openPlan(tx, schoolId)) throw new ApiError('PLAN_OPEN', 'A new-session plan is already open. Finish or cancel it first.', 409);
      const from = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
      if (!from) throw new ApiError('NO_CURRENT_YEAR', 'Mark the current academic year first (Settings → Academic years).', 400);
      let to = await tx.academicYear.findUnique({ where: { schoolId_name: { schoolId, name: dto.name.trim() } } });
      if (!to) {
        try {
          to = await tx.academicYear.create({ data: { schoolId, name: dto.name.trim(), startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), isCurrent: false } });
        } catch (e) { if (isP2002(e)) throw new ApiError('YEAR_EXISTS', 'An academic year with that name already exists', 409, 'name'); throw e; }
      }
      if (to.id === from.id) throw new ApiError('SAME_YEAR', 'The next session must be a different year', 400, 'name');
      return tx.sessionPlan.create({ data: { schoolId, fromYearId: from.id, toYearId: to.id, createdById: actorUserId }, include: { fromYear: true, toYear: true } });
    });
    await this.audit.record({ schoolId, actorUserId, action: 'session.plan.create', entity: 'SessionPlan', entityId: plan.id, meta: { from: plan.fromYear.name, to: plan.toYear.name } });
    return plan;
  }

  async getPlan(schoolId: string) {
    return withTenant(schoolId, (tx) => this.openPlan(tx, schoolId));
  }

  async updatePlan(schoolId: string, dto: UpdateSessionPlanDto) {
    return withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      if (plan.status !== 'DRAFT') throw new ApiError('PLAN_LOCKED', 'A scheduled plan cannot be edited. Cancel the schedule first.', 409);
      return tx.sessionPlan.update({
        where: { id: plan.id },
        data: { ...dto, sectionMap: dto.sectionMap as never, version: { increment: 1 } },
        include: { fromYear: true, toYear: true },
      });
    });
  }

  async cancel(schoolId: string, actorUserId: string) {
    const id = await withTenant(schoolId, async (tx) => {
      const plan = await this.openPlan(tx, schoolId);
      if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
      await tx.sessionPlan.update({ where: { id: plan.id }, data: { status: 'CANCELLED', scheduledFor: null } });
      return plan.id;
    });
    await this.audit.record({ schoolId, actorUserId, action: 'session.plan.cancel', entity: 'SessionPlan', entityId: id, meta: null });
    return { cancelled: true as const };
  }
}
```

(`schoolId_name` is Prisma's name for `@@unique([schoolId, name])` on AcademicYear; if the generated client names it differently, use that name.) Register `SessionsService` in `management.module.ts`.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @skoolos/api test -- sessions.service.spec` → PASS.

```bash
git add apps/api/src/modules/management/sessions.dto.ts apps/api/src/modules/management/sessions.service.ts apps/api/src/modules/management/sessions.service.spec.ts apps/api/src/modules/management/management.module.ts
git commit -m "feat(api): session plan lifecycle (overview, create, get, update, cancel)"
```

---

### Task 4: Copy structure and the default section map

**Files:**
- Modify: `apps/api/src/modules/management/sessions.service.ts` (+spec cases)

**Interfaces:**
- Produces: `copyStructure(schoolId): Promise<{ created: number; existing: number; sectionsWithoutClassTeacher: string[]; sectionMap: Record<string, string> }>` — 400 `GRADE_ORDER` when `gradeLadder` fails.

- [ ] **Step 1: Failing spec case**

```ts
describe('copyStructure', () => {
  it('creates next-year sections, drops LEFT class teachers, builds the default map', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', sectionMap: {} });
    txMock.grade.findMany.mockResolvedValue([{ id: 'g5', order: 5 }, { id: 'g6', order: 6 }]);
    txMock.classSection.findMany
      .mockResolvedValueOnce([{ id: 'f5a', gradeId: 'g5', name: 'A', classTeacherId: 'T1', classTeacher: { status: 'LEFT' } }, { id: 'f6a', gradeId: 'g6', name: 'A', classTeacherId: 'T2', classTeacher: { status: 'ACTIVE' } }])
      .mockResolvedValueOnce([]) // existing to-year sections
      .mockResolvedValueOnce([{ id: 't5a', gradeId: 'g5', name: 'A' }, { id: 't6a', gradeId: 'g6', name: 'A' }]); // after create
    txMock.classSection.create.mockResolvedValue({});
    const r = await svc.copyStructure(SCHOOL);
    expect(txMock.classSection.create).toHaveBeenCalledWith({ data: { schoolId: SCHOOL, gradeId: 'g5', name: 'A', academicYearId: 'y2', classTeacherId: null } });
    expect(txMock.classSection.create).toHaveBeenCalledWith({ data: { schoolId: SCHOOL, gradeId: 'g6', name: 'A', academicYearId: 'y2', classTeacherId: 'T2' } });
    expect(r.sectionMap).toEqual({ f5a: 't6a', f6a: 'PASS_OUT' });
    expect(r.sectionsWithoutClassTeacher).toEqual(['t5a']);
  });
  it('refuses when grade order is ambiguous', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2' });
    txMock.grade.findMany.mockResolvedValue([{ id: 'g5', order: 0 }, { id: 'g6', order: 0 }]);
    await expect(svc.copyStructure(SCHOOL)).rejects.toMatchObject({ code: 'GRADE_ORDER' });
  });
});
```

- [ ] **Step 2: Implement**

```ts
async copyStructure(schoolId: string) {
  return withTenant(schoolId, async (tx) => {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan || plan.status !== 'DRAFT') throw new ApiError('NO_PLAN', 'No editable plan', 404);
    const ladder = gradeLadder(await tx.grade.findMany({ where: { schoolId }, select: { id: true, order: true } }));
    if (!ladder.ok) throw new ApiError('GRADE_ORDER', 'Set a unique order for every grade first (Classes → Structure).', 400);

    const from = await tx.classSection.findMany({
      where: { academicYearId: plan.fromYearId },
      select: { id: true, gradeId: true, name: true, classTeacherId: true, classTeacher: { select: { status: true } } },
    });
    const existing = await tx.classSection.findMany({ where: { academicYearId: plan.toYearId }, select: { gradeId: true, name: true } });
    const have = new Set(existing.map((e) => `${e.gradeId}|${e.name.toLowerCase()}`));
    let created = 0;
    for (const f of from) {
      if (have.has(`${f.gradeId}|${f.name.toLowerCase()}`)) continue;
      await tx.classSection.create({
        data: { schoolId, gradeId: f.gradeId, name: f.name, academicYearId: plan.toYearId, classTeacherId: f.classTeacher?.status === 'ACTIVE' ? f.classTeacherId : null },
      });
      created++;
    }
    const to = await tx.classSection.findMany({ where: { academicYearId: plan.toYearId }, select: { id: true, gradeId: true, name: true, classTeacherId: true } });
    const sectionMap = defaultSectionMap(from, to, ladder.ordered);
    await tx.sessionPlan.update({ where: { id: plan.id }, data: { sectionMap: sectionMap as never, version: { increment: 1 } } });
    return { created, existing: existing.length, sectionsWithoutClassTeacher: to.filter((t) => !t.classTeacherId).map((t) => t.id), sectionMap };
  });
}
```

Import `gradeLadder`, `defaultSectionMap` from `./internal/session-maths`. In the spec's third `findMany` mock include `classTeacherId` values (`t5a` null, `t6a` 'T2') so the "without class teacher" list matches.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/api test -- sessions.service.spec` → PASS.

```bash
git add apps/api/src/modules/management/sessions.service.ts apps/api/src/modules/management/sessions.service.spec.ts
git commit -m "feat(api): copy class structure into the next session with a default section map"
```

---

### Task 5: Decision rows and saving decisions

**Files:**
- Modify: `apps/api/src/modules/management/sessions.service.ts` (+spec cases)

**Interfaces:**
- Produces:
  - `sectionRows(schoolId, sectionId: string | 'UNPLACED'): Promise<{ section: { id; label; gradeId } | null; targets: { id; label; gradeId }[]; exams: { id; title; subject }[]; rows: SessionStudentRow[] }>` — `SessionStudentRow` per spec §4.3.
  - `upsertDecisions(schoolId, actorUserId, dto: PutDecisionsDto): Promise<{ saved: number; version: number }>` — validates `toSectionId` belongs to the to-year for PROMOTE/STAY; LEAVE needs `leaveStatus`.

- [ ] **Step 1: Failing spec cases**

```ts
describe('sectionRows', () => {
  it('computes attendance and results %, flags review, marks late joiners, defaults decisions', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', fromYearId: 'y1', toYearId: 'y2', passMarkPct: 33, countExamIds: [], sectionMap: { f5b: 't6b' }, createdAt: new Date('2026-03-01'), fromYear: { startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') } });
    txMock.classSection.findFirst.mockResolvedValue({ id: 'f5b', gradeId: 'g5', name: 'B', grade: { name: '5' } });
    txMock.classSection.findMany.mockResolvedValue([{ id: 't6b', gradeId: 'g6', name: 'B', grade: { name: '6' } }, { id: 't5b', gradeId: 'g5', name: 'B', grade: { name: '5' } }]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', title: 'Annual', maxMarks: 100, subject: { name: 'Maths' } }]);
    txMock.student.findMany.mockResolvedValue([
      { id: 's1', firstName: 'Aarav', lastName: 'Mehta', admissionNo: '1', rollNo: '1', createdAt: new Date('2025-04-02') },
      { id: 's2', firstName: 'Dev', lastName: 'Sharma', admissionNo: '2', rollNo: '3', createdAt: new Date('2026-03-15') },
    ]);
    txMock.attendance.findMany.mockResolvedValue([{ studentId: 's1', status: 'PRESENT' }, { studentId: 's1', status: 'ABSENT' }, { studentId: 's2', status: 'PRESENT' }]);
    txMock.result.findMany.mockResolvedValue([{ studentId: 's1', marks: 81, exam: { maxMarks: 100 } }, { studentId: 's2', marks: 29, exam: { maxMarks: 100 } }]);
    txMock.sessionDecision.findMany.mockResolvedValue([]);
    const r = await svc.sectionRows(SCHOOL, 'f5b');
    expect(r.rows[0]).toMatchObject({ studentId: 's1', attendancePct: 50, resultsPct: 81, review: false, joinedSincePlan: false, decision: null, toSectionId: 't6b' });
    expect(r.rows[1]).toMatchObject({ studentId: 's2', resultsPct: 29, review: true, joinedSincePlan: true });
    expect(txMock.student.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', classSectionId: 'f5b' });
  });
});
describe('upsertDecisions', () => {
  it('rejects a PROMOTE into a section outside the next year', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', toYearId: 'y2', version: 1 });
    txMock.classSection.findMany.mockResolvedValue([{ id: 't6b' }]);
    await expect(svc.upsertDecisions(SCHOOL, ACTOR, { rows: [{ studentId: 's1', decision: 'PROMOTE', toSectionId: 'f5b' }] })).rejects.toMatchObject({ code: 'BAD_TARGET' });
  });
  it('upserts rows and bumps the plan version', async () => {
    txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'DRAFT', toYearId: 'y2', version: 1 });
    txMock.classSection.findMany.mockResolvedValue([{ id: 't6b' }]);
    txMock.sessionDecision.upsert.mockResolvedValue({});
    txMock.sessionPlan.update.mockResolvedValue({ version: 2 });
    const r = await svc.upsertDecisions(SCHOOL, ACTOR, { rows: [{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }, { studentId: 's2', decision: 'LEAVE', leaveStatus: 'TRANSFERRED', leaveReason: 'Moved' }] });
    expect(txMock.sessionDecision.upsert).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ saved: 2, version: 2 });
  });
});
```

- [ ] **Step 2: Implement**

```ts
async sectionRows(schoolId: string, sectionId: string) {
  return withTenant(schoolId, async (tx) => {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
    const unplaced = sectionId === 'UNPLACED';
    const section = unplaced ? null : await tx.classSection.findFirst({ where: { id: sectionId, academicYearId: plan.fromYearId }, select: { id: true, gradeId: true, name: true, grade: { select: { name: true } } } });
    if (!unplaced && !section) throw new ApiError('NOT_FOUND', 'Class not found in the closing session', 404);

    const targetsRaw = await tx.classSection.findMany({ where: { academicYearId: plan.toYearId }, select: { id: true, gradeId: true, name: true, grade: { select: { name: true } } }, orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }] });
    const targets = targetsRaw.map((t) => ({ id: t.id, label: `${t.grade.name} ${t.name}`, gradeId: t.gradeId }));
    const map = (plan.sectionMap ?? {}) as Record<string, string>;
    const defaultTo = section ? map[section.id] ?? null : null;
    const stayTo = section ? targets.find((t) => t.gradeId === section.gradeId)?.id ?? null : null;

    const students = await tx.student.findMany({
      where: activeStudentsWhere(schoolId, { classSectionId: unplaced ? null : sectionId }),
      select: { id: true, firstName: true, lastName: true, admissionNo: true, rollNo: true, createdAt: true },
      orderBy: [{ rollNo: 'asc' }, { firstName: 'asc' }],
    });
    const ids = students.map((s) => s.id);
    const examsRaw = section ? await tx.exam.findMany({ where: { classSectionId: section.id }, select: { id: true, title: true, maxMarks: true, subject: { select: { name: true } } } }) : [];
    const countIds = plan.countExamIds.length ? new Set(plan.countExamIds) : null;
    const [marks, results, decisions] = await Promise.all([
      tx.attendance.findMany({ where: { studentId: { in: ids }, date: { gte: plan.fromYear.startDate, lte: plan.fromYear.endDate } }, select: { studentId: true, status: true } }),
      tx.result.findMany({ where: { studentId: { in: ids }, publishedAt: { not: null }, examId: { in: examsRaw.map((e) => e.id) } }, select: { studentId: true, marks: true, examId: true, exam: { select: { maxMarks: true } } } }),
      tx.sessionDecision.findMany({ where: { planId: plan.id, studentId: { in: ids } } }),
    ]);
    const byStudent = <T extends { studentId: string }>(xs: T[]) => xs.reduce((m, x) => (m.get(x.studentId) ?? m.set(x.studentId, []).get(x.studentId)!).push(x) && m, new Map<string, T[]>());
    const marksBy = byStudent(marks), resultsBy = byStudent(results.filter((r) => !countIds || countIds.has(r.examId))), decBy = new Map(decisions.map((d) => [d.studentId, d]));

    const rows: SessionStudentRow[] = students.map((s) => {
      const d = decBy.get(s.id);
      const rp = resultsPct((resultsBy.get(s.id) ?? []).map((r) => ({ marks: r.marks, maxMarks: r.exam.maxMarks })));
      return {
        studentId: s.id, rollNo: s.rollNo, name: `${s.firstName} ${s.lastName}`, admissionNo: s.admissionNo,
        attendancePct: attendancePct(marksBy.get(s.id) ?? []),
        resultsPct: rp,
        review: rp !== null && rp < plan.passMarkPct,
        joinedSincePlan: s.createdAt > plan.createdAt,
        decision: d?.decision ?? null,
        toSectionId: d ? d.toSectionId : defaultTo === 'PASS_OUT' ? null : defaultTo,
        leaveStatus: d?.leaveStatus ?? null, leaveReason: d?.leaveReason ?? null, note: d?.note ?? null,
        defaultDecision: defaultTo === 'PASS_OUT' ? 'PASS_OUT' : 'PROMOTE',
        stayToSectionId: stayTo,
      };
    });
    return { section: section ? { id: section.id, label: `${section.grade.name} ${section.name}`, gradeId: section.gradeId } : null, targets, exams: examsRaw.map((e) => ({ id: e.id, title: e.title, subject: e.subject.name })), rows };
  });
}

async upsertDecisions(schoolId: string, actorUserId: string, dto: PutDecisionsDto) {
  return withTenant(schoolId, async (tx) => {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan || plan.status !== 'DRAFT') throw new ApiError('NO_PLAN', 'No editable plan', 404);
    const valid = new Set((await tx.classSection.findMany({ where: { academicYearId: plan.toYearId }, select: { id: true } })).map((s) => s.id));
    for (const r of dto.rows) {
      if ((r.decision === 'PROMOTE' || r.decision === 'STAY') && (!r.toSectionId || !valid.has(r.toSectionId))) throw new ApiError('BAD_TARGET', `Pick a class in the next session for ${r.studentId}`, 400, 'toSectionId');
      if (r.decision === 'LEAVE' && !r.leaveStatus) throw new ApiError('VALIDATION', 'Leaving needs a reason type', 400, 'leaveStatus');
      const data = { decision: r.decision, toSectionId: r.decision === 'PROMOTE' || r.decision === 'STAY' ? r.toSectionId! : null, leaveStatus: r.decision === 'LEAVE' ? r.leaveStatus! : null, leaveReason: r.leaveReason ?? null, note: r.note ?? null, decidedById: actorUserId };
      await tx.sessionDecision.upsert({ where: { planId_studentId: { planId: plan.id, studentId: r.studentId } }, update: data, create: { schoolId, planId: plan.id, studentId: r.studentId, ...data } });
    }
    const updated = await tx.sessionPlan.update({ where: { id: plan.id }, data: { version: { increment: 1 } }, select: { version: true } });
    return { saved: dto.rows.length, version: updated.version };
  });
}
```

Add the `SessionStudentRow` interface (spec §4.3 plus `leaveStatus`, `leaveReason`, `note`, `defaultDecision`, `stayToSectionId`) to `sessions.dto.ts` as an exported interface. Import `activeStudentsWhere`, `attendancePct`, `resultsPct`.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/api test -- sessions.service.spec` → PASS.

```bash
git add apps/api/src/modules/management/sessions.service.ts apps/api/src/modules/management/sessions.service.spec.ts apps/api/src/modules/management/sessions.dto.ts
git commit -m "feat(api): decision rows with attendance and results %, decision upsert"
```

---

### Task 6: Review and Start

**Files:**
- Modify: `apps/api/src/modules/management/sessions.service.ts` (+spec cases)
- Modify: `apps/api/src/modules/management/management.module.ts` (inject `LeavePolicyService`, `MailService`, `LoginInviteService`, `PushChannel` if used)

**Interfaces:**
- Consumes: `applyStudentLeave` (Track A), `closeLogin`, `LeavePolicyService.closeYear(schoolId, fromYearId, toYearId)`, `assignRollNumbers`, `emitNotifications`.
- Produces:
  - `review(schoolId): Promise<ReviewPayload>` (spec §4.5).
  - `start(schoolId, actorUserId, dto: StartSessionDto): Promise<{ started: true; startedAt: string } | { scheduled: true; scheduledFor: string }>`.
  - `private applyPlan(schoolId, actorUserId, planId): Promise<StartOutcome>` with `StartOutcome = { moved: number; alumni: number; left: number; closeUserIds: string[]; alumniStudentIds: string[]; slotsCopied: number; slotsSkipped: number; teacherUserIds: string[]; familyUserIds: { userId: string; firstName: string; className: string }[] }` — the pure-DB half, reused by `startDue` (Task 8).

- [ ] **Step 1: Failing spec cases**

```ts
describe('start', () => {
  const plan = { id: 'p1', status: 'DRAFT', version: 4, fromYearId: 'y1', toYearId: 'y2', rollPolicy: 'KEEP', copyTimetable: true, carryLeave: true, fromYear: { name: '2025-26', endDate: new Date('2026-03-31'), startDate: new Date('2025-04-01') }, toYear: { name: '2026-27', startDate: new Date('2026-04-01') } };
  beforeEach(() => {
    txMock.sessionPlan.findFirst.mockResolvedValue(plan);
    txMock.classSection.findMany.mockResolvedValue([{ id: 'f5b', gradeId: 'g5', name: 'B', academicYearId: 'y1' }, { id: 't6b', gradeId: 'g6', name: 'B', academicYearId: 'y2' }, { id: 't5b', gradeId: 'g5', name: 'B', academicYearId: 'y2' }]);
    txMock.student.findMany.mockResolvedValue([{ id: 's1', userId: 'u1', firstName: 'Aarav', lastName: 'M', admissionNo: '1', rollNo: '1', classSectionId: 'f5b', status: 'ACTIVE' }, { id: 's2', userId: 'u2', firstName: 'Dev', lastName: 'S', admissionNo: '2', rollNo: '2', classSectionId: 'f5b', status: 'ACTIVE' }]);
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }, { studentId: 's2', decision: 'PASS_OUT', toSectionId: null }]);
    txMock.student.findFirst.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, userId: where.id === 's1' ? 'u1' : 'u2', status: 'ACTIVE' }));
    txMock.academicYear.findFirst.mockResolvedValue({ name: '2025-26' });
    txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: 'f5b', dayOfWeek: 1, periodId: 'pd', subjectId: 'sb', teacherId: 'T1', teacher: { status: 'ACTIVE' } }, { classSectionId: 'f5b', dayOfWeek: 2, periodId: 'pd', subjectId: 'sb', teacherId: 'T9', teacher: { status: 'LEFT' } }]);
    txMock.registerChangeRequest.updateMany.mockResolvedValue({ count: 0 });
    txMock.sessionPlan.update.mockResolvedValue({});
  });
  it('refuses on version mismatch and on undecided students', async () => {
    await expect(svc.start(SCHOOL, ACTOR, { when: 'NOW', version: 3 })).rejects.toMatchObject({ code: 'PLAN_CHANGED' });
    txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' }]);
    await expect(svc.start(SCHOOL, ACTOR, { when: 'NOW', version: 4 })).rejects.toMatchObject({ code: 'UNDECIDED_STUDENTS' });
  });
  it('moves seats, makes alumni, flips the current year, copies the timetable for active teachers, carries leave', async () => {
    await svc.start(SCHOOL, ACTOR, { when: 'NOW', version: 4 });
    expect(txMock.student.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ classSectionId: 't6b' }) }));
    expect(txMock.student.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's2' }, data: expect.objectContaining({ status: 'ALUMNI', alumniBatch: '2025-26', isActive: false }) }));
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y1' }, data: { isCurrent: false } });
    expect(txMock.academicYear.update).toHaveBeenCalledWith({ where: { id: 'y2' }, data: { isCurrent: true } });
    expect(txMock.timetableSlot.create).toHaveBeenCalledTimes(1);
    expect(leavePolicy.closeYear).toHaveBeenCalledWith(SCHOOL, 'y1', 'y2');
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'STARTED' }) }));
    expect(platformMock.user.update).not.toHaveBeenCalled(); // alumni keep their login
  });
  it('ON_START_DATE schedules instead of applying', async () => {
    const r = await svc.start(SCHOOL, ACTOR, { when: 'ON_START_DATE', version: 4 });
    expect(r).toMatchObject({ scheduled: true });
    expect(txMock.sessionPlan.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }));
    expect(txMock.student.update).not.toHaveBeenCalled();
  });
});
```

(`leavePolicy` is a mock `{ closeYear: jest.fn() }` passed to the constructor; `LeavePolicyService.closeYear` runs its own `withTenant`, which in the spec resolves to the same `txMock`.)

- [ ] **Step 2: Implement review, start, applyPlan**

```ts
async review(schoolId: string) {
  return withTenant(schoolId, async (tx) => {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
    const closing = await tx.classSection.findMany({ where: { academicYearId: plan.fromYearId }, select: { id: true } });
    const closingIds = closing.map((c) => c.id);
    const [students, decisions, toSections, newAdmissions, issues] = await Promise.all([
      tx.student.findMany({ where: activeStudentsWhere(schoolId, { OR: [{ classSectionId: { in: closingIds } }, { classSectionId: null }] }), select: { id: true, classSectionId: true } }),
      tx.sessionDecision.findMany({ where: { planId: plan.id } }),
      tx.classSection.findMany({ where: { academicYearId: plan.toYearId }, select: { id: true, classTeacherId: true, name: true, grade: { select: { name: true } } } }),
      tx.student.count({ where: activeStudentsWhere(schoolId, { classSection: { academicYearId: plan.toYearId } }) }),
      tx.libraryIssue.count({ where: { returnedOn: null, student: { status: 'ACTIVE' } } }),
    ]);
    const decBy = new Map(decisions.map((d) => [d.studentId, d]));
    const counts = { promote: 0, stay: 0, passOut: 0, leave: 0, newAdmissions, unplaced: 0, undecided: 0 };
    const passOutIds: string[] = [];
    for (const s of students) {
      const d = decBy.get(s.id);
      if (!d) { if (s.classSectionId === null) counts.unplaced++; else counts.undecided++; continue; }
      if (d.decision === 'PROMOTE') counts.promote++;
      else if (d.decision === 'STAY') counts.stay++;
      else if (d.decision === 'PASS_OUT') { counts.passOut++; passOutIds.push(s.id); }
      else counts.leave++;
    }
    const alumniWithoutEmail = passOutIds.length ? await tx.student.count({ where: { id: { in: passOutIds }, OR: [{ email: null }, { email: '' }] } }) : 0;
    return {
      counts, alumniWithoutEmail, libraryIssuesOut: issues,
      sectionsWithoutClassTeacher: toSections.filter((t) => !t.classTeacherId).map((t) => `${t.grade.name} ${t.name}`),
      version: plan.version, status: plan.status, scheduledFor: plan.scheduledFor,
      fromYear: { id: plan.fromYearId, name: plan.fromYear.name }, toYear: { id: plan.toYearId, name: plan.toYear.name, startDate: plan.toYear.startDate },
    };
  });
}

async start(schoolId: string, actorUserId: string, dto: StartSessionDto) {
  const gate = await withTenant(schoolId, async (tx) => {
    const plan = await this.openPlan(tx, schoolId);
    if (!plan) throw new ApiError('NO_PLAN', 'No open plan', 404);
    if (plan.version !== dto.version) throw new ApiError('PLAN_CHANGED', 'The plan changed since you opened this page. Reload and review again.', 409);
    return plan;
  });
  if (dto.when === 'ON_START_DATE') {
    const scheduledFor = startOfDayInZone(gate.toYear.startDate, await this.timezone(schoolId));
    await withTenant(schoolId, (tx) => tx.sessionPlan.update({ where: { id: gate.id }, data: { status: 'SCHEDULED', scheduledFor } }));
    await this.audit.record({ schoolId, actorUserId, action: 'session.schedule', entity: 'SessionPlan', entityId: gate.id, meta: { scheduledFor } });
    return { scheduled: true as const, scheduledFor: scheduledFor.toISOString() };
  }
  const outcome = await this.applyPlan(schoolId, actorUserId, gate.id);
  await this.afterStart(schoolId, gate.id, outcome); // Task 7
  return { started: true as const, startedAt: new Date().toISOString() };
}

private async applyPlan(schoolId: string, actorUserId: string, planId: string): Promise<StartOutcome> {
  const outcome = await withTenant(schoolId, async (tx) => {
    const plan = await tx.sessionPlan.findFirst({ where: { id: planId, status: { in: ['DRAFT', 'SCHEDULED'] } }, include: { fromYear: true, toYear: true } });
    if (!plan) throw new ApiError('NO_PLAN', 'This plan has already been started or cancelled', 409);
    const sections = await tx.classSection.findMany({ where: { academicYearId: { in: [plan.fromYearId, plan.toYearId] } }, select: { id: true, gradeId: true, name: true, academicYearId: true, classTeacherId: true, grade: { select: { name: true } } } });
    const closing = sections.filter((s) => s.academicYearId === plan.fromYearId);
    const next = sections.filter((s) => s.academicYearId === plan.toYearId);
    const nextLabel = new Map(next.map((n) => [n.id, `${n.grade.name} ${n.name}`]));
    const students = await tx.student.findMany({ where: activeStudentsWhere(schoolId, { classSectionId: { in: closing.map((c) => c.id) } }), select: { id: true, userId: true, firstName: true, lastName: true, admissionNo: true, rollNo: true, classSectionId: true } });
    const decisions = await tx.sessionDecision.findMany({ where: { planId: plan.id } });
    const decBy = new Map(decisions.map((d) => [d.studentId, d]));
    const undecided = students.filter((s) => !decBy.has(s.id));
    if (undecided.length) throw new ApiError('UNDECIDED_STUDENTS', `${undecided.length} students have no decision yet`, 400);

    const o: StartOutcome = { moved: 0, alumni: 0, left: 0, closeUserIds: [], alumniStudentIds: [], slotsCopied: 0, slotsSkipped: 0, teacherUserIds: [], familyUserIds: [] };
    const byTarget = new Map<string, typeof students>();
    for (const s of students) {
      const d = decBy.get(s.id)!;
      if (d.decision === 'PROMOTE' || d.decision === 'STAY') (byTarget.get(d.toSectionId!) ?? byTarget.set(d.toSectionId!, []).get(d.toSectionId!)!).push(s);
    }
    for (const [target, group] of byTarget) {
      const rolls = assignRollNumbers(plan.rollPolicy as 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO', group);
      for (const s of group) {
        await tx.student.update({ where: { id: s.id }, data: { classSectionId: target, rollNo: rolls.get(s.id) ?? null } });
        o.moved++;
        if (s.userId) o.familyUserIds.push({ userId: s.userId, firstName: s.firstName, className: nextLabel.get(target) ?? '' });
      }
    }
    for (const s of students) {
      const d = decBy.get(s.id)!;
      if (d.decision === 'PASS_OUT') {
        await applyStudentLeave(tx, { schoolId, actorUserId, studentId: s.id, status: 'ALUMNI', leftOn: plan.fromYear.endDate, alumniBatch: plan.fromYear.name });
        o.alumni++; o.alumniStudentIds.push(s.id);
      } else if (d.decision === 'LEAVE') {
        const r = await applyStudentLeave(tx, { schoolId, actorUserId, studentId: s.id, status: (d.leaveStatus ?? 'LEFT') as 'TRANSFERRED' | 'LEFT', leftOn: plan.fromYear.endDate, reason: d.leaveReason, note: d.note });
        o.left++; if (r.userId) o.closeUserIds.push(r.userId);
      }
      await tx.sessionDecision.update({ where: { planId_studentId: { planId: plan.id, studentId: s.id } }, data: { fromSectionId: s.classSectionId, appliedAt: new Date() } });
    }

    await tx.academicYear.update({ where: { id: plan.fromYearId }, data: { isCurrent: false } });
    await tx.academicYear.update({ where: { id: plan.toYearId }, data: { isCurrent: true } });

    if (plan.copyTimetable) {
      const key = (s: { gradeId: string; name: string }) => `${s.gradeId}|${s.name.toLowerCase()}`;
      const nextByKey = new Map(next.map((n) => [key(n), n.id]));
      const closingById = new Map(closing.map((c) => [c.id, c]));
      const slots = await tx.timetableSlot.findMany({ where: { academicYearId: plan.fromYearId, effectiveTo: null }, select: { classSectionId: true, dayOfWeek: true, periodId: true, subjectId: true, teacherId: true, teacher: { select: { status: true, userId: true } } } });
      for (const sl of slots) {
        const target = nextByKey.get(key(closingById.get(sl.classSectionId)!));
        if (!target || sl.teacher.status !== 'ACTIVE') { o.slotsSkipped++; continue; }
        await tx.timetableSlot.create({ data: { schoolId, classSectionId: target, dayOfWeek: sl.dayOfWeek, periodId: sl.periodId, subjectId: sl.subjectId, teacherId: sl.teacherId, academicYearId: plan.toYearId, effectiveFrom: plan.toYear.startDate } });
        o.slotsCopied++;
        if (sl.teacher.userId) o.teacherUserIds.push(sl.teacher.userId);
      }
    }
    await tx.registerChangeRequest.updateMany({ where: { classSectionId: { in: closing.map((c) => c.id) }, status: 'PENDING' }, data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: actorUserId } });
    await tx.sessionPlan.update({ where: { id: plan.id }, data: { status: 'STARTED', startedAt: new Date(), startedById: actorUserId } });
    return o;
  });

  const planRow = await withTenant(schoolId, (tx) => tx.sessionPlan.findUnique({ where: { id: planId }, select: { fromYearId: true, toYearId: true, carryLeave: true } }));
  if (planRow?.carryLeave) await this.leavePolicy.closeYear(schoolId, planRow.fromYearId, planRow.toYearId);
  for (const userId of outcome.closeUserIds) await closeLogin(userId);
  await this.audit.record({ schoolId, actorUserId, action: 'session.start', entity: 'SessionPlan', entityId: planId, meta: { moved: outcome.moved, alumni: outcome.alumni, left: outcome.left, slotsCopied: outcome.slotsCopied, slotsSkipped: outcome.slotsSkipped } });
  return outcome;
}

private async timezone(schoolId: string): Promise<string> {
  const s = await withTenant(schoolId, (tx) => tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }));
  return s?.timezone ?? 'Asia/Kolkata';
}
```

`startOfDayInZone(date: Date, tz: string): Date` goes in `internal/session-maths.ts`: build `YYYY-MM-DD` from the date's UTC parts, then find the instant at which that calendar day starts in `tz` (iterate: take `Date.UTC(y, m-1, d)`, compute the zone offset with `Intl.DateTimeFormat(…, { timeZoneName: 'shortOffset' })` or `formatToParts` hour/minute delta, subtract it). Add a spec case: `startOfDayInZone(new Date('2026-04-01T00:00:00Z'), 'Asia/Kolkata')` → `2026-03-31T18:30:00.000Z`.

Inject `LeavePolicyService` (already in the module) into `SessionsService`.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/api test -- sessions.service.spec internal/session-maths` → PASS.

```bash
git add apps/api/src/modules/management/sessions.service.ts apps/api/src/modules/management/sessions.service.spec.ts apps/api/src/modules/management/internal/session-maths.ts apps/api/src/modules/management/internal/session-maths.spec.ts apps/api/src/modules/management/management.module.ts
git commit -m "feat(api): session review and Start (seats, alumni, year flip, timetable, leave, register)"
```

---

### Task 7: After Start — notifications and the two emails

**Files:**
- Modify: `apps/api/src/common/mail/mail.service.ts` (+ `mail.service.spec.ts` if present)
- Modify: `apps/api/src/modules/management/sessions.service.ts` (`afterStart`)

**Interfaces:**
- Produces:
  - `MailService.sendAlumniWelcome(to, schoolName, loginName, signInUrl, schoolId): Promise<boolean>`
  - `MailService.sendSessionStarted(to, schoolName, childName, className, sessionName, schoolId): Promise<boolean>`
  - `private afterStart(schoolId, planId, outcome: StartOutcome): Promise<void>` — inbox rows (`emitNotifications`, kind `SESSION`) for families and teachers; emails to alumni with an address; pushes through the existing outbox as ANNOUNCEMENT payloads.

- [ ] **Step 1: Failing mail test**

```ts
it('sendAlumniWelcome renders the subject, sign-in name and CTA', async () => {
  const sent = await mail.sendAlumniWelcome('a@x.in', 'Raffles Public School', 'RAF-00042', 'https://raffles.sckools.com/login', SCHOOL);
  expect(sent).toBe(true);
  const call = transporter.sendMail.mock.calls[0][0];
  expect(call.subject).toBe('Your journey at Raffles Public School is complete');
  expect(call.text).toMatch(/RAF-00042/);
  expect(call.text).toMatch(/Sign in/);
});
```

(Use the transporter mock the existing mail specs build; if none exists, follow `mail-di.spec.ts` for how `MailIdentityService` is stubbed.)

- [ ] **Step 2: Implement the templates**

```ts
async sendAlumniWelcome(to: string, schoolName: string, loginName: string, signInUrl: string, schoolId: string | null = null): Promise<boolean> {
  return this.sendLetter(to, schoolId, `Your journey at ${schoolName} is complete`, {
    title: 'Congratulations on passing out',
    intro: `Your time at ${schoolName} is complete. Your Sckools login stays with you as an alumni account, so your results and records are always a sign-in away.`,
    rows: [{ label: 'Sign-in name', value: loginName }],
    cta: { label: 'Sign in', url: signInUrl },
    note: 'Your password is unchanged. If you never set one, use "Forgot password" on the sign-in page with your sign-in name.',
  });
}

async sendSessionStarted(to: string, schoolName: string, childName: string, className: string, sessionName: string, schoolId: string | null = null): Promise<boolean> {
  return this.sendLetter(to, schoolId, `${childName} is in ${className} for ${sessionName}`, {
    title: `New session ${sessionName}`,
    intro: `${schoolName} has started the ${sessionName} session. ${childName} is now in ${className}.`,
    note: 'Open the Sckools app to see the new class, timetable and diary.',
  });
}
```

- [ ] **Step 3: afterStart**

```ts
private async afterStart(schoolId: string, planId: string, o: StartOutcome): Promise<void> {
  const school = await withTenant(schoolId, (tx) => tx.school.findUnique({ where: { id: schoolId }, select: { name: true, slug: true } }));
  const plan = await withTenant(schoolId, (tx) => tx.sessionPlan.findUnique({ where: { id: planId }, include: { toYear: { select: { name: true } } } }));
  if (!school || !plan) return;
  const session = plan.toYear.name;

  await withTenant(schoolId, async (tx) => {
    for (const f of o.familyUserIds) {
      await emitNotifications(tx, { schoolId, userIds: [f.userId], kind: 'SESSION', title: `${f.firstName} is in ${f.className} for ${session}`, body: 'The new class, timetable and diary are ready.', linkType: 'home', linkId: null });
    }
    const teachers = Array.from(new Set(o.teacherUserIds));
    if (teachers.length) {
      await emitNotifications(tx, { schoolId, userIds: teachers, kind: 'SESSION', title: `Session ${session} has started`, body: 'Your classes and timetable for the new session are ready.', linkType: 'today', linkId: null });
    }
  });

  // Alumni emails: only students with an address (D12). Failures are logged, never thrown — Start already committed.
  const alumni = await withTenant(schoolId, (tx) => tx.student.findMany({ where: { id: { in: o.alumniStudentIds }, email: { not: null } }, select: { email: true, code: true, firstName: true } }));
  const signInUrl = `https://${school.slug}.${this.env.PLATFORM_HOST}/login`;
  for (const a of alumni) {
    if (!a.email) continue;
    try { await this.mail.sendAlumniWelcome(a.email, school.name, a.code ?? a.firstName, signInUrl, schoolId); }
    catch (e) { this.logger.warn(`alumni mail to ${a.email} failed: ${(e as Error).message}`); }
  }
}
```

Inject `MailService` and a `Logger`; read `PLATFORM_HOST` via `loadEnv()` as `school-resolve.service.ts` does. Push notifications to families ride the existing outbox: write one `NotificationOutbox` row of kind `ANNOUNCEMENT` per moved family with the same title (mirror how `AnnouncementsService` writes its outbox row; copy that call shape exactly).

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @skoolos/api test -- common/mail sessions.service.spec` → PASS.

```bash
git add apps/api/src/common/mail/mail.service.ts apps/api/src/common/mail/mail.service.spec.ts apps/api/src/modules/management/sessions.service.ts
git commit -m "feat(api): session-start notifications, alumni welcome and session-started emails"
```

---

### Task 8: Controllers, cron, year filters

**Files:**
- Create: `apps/api/src/modules/management/sessions.controller.ts`, `sessions-cron.controller.ts`
- Modify: `apps/api/src/modules/management/sessions.service.ts` (`register`, `startDue`)
- Modify: `apps/api/src/modules/management/classes.service.ts`, `classes.controller.ts`, `students.controller.ts`, `students.service.ts`
- Modify: `apps/api/src/modules/management/management.module.ts`, `apps/api/vercel.json`
- Test: `apps/api/src/modules/management/sessions.service.spec.ts` (register, startDue), `classes.service.spec.ts` (year filter)

**Interfaces:**
- Produces:
  - Routes per spec §6 under `manage/sessions`; `GET|POST /internal/cron/session-start`.
  - `register(schoolId, yearId): Promise<RegisterRow[]>` with `RegisterRow = { studentId, name, admissionNo, fromSection: string | null, toSection: string | null, decision, leaveStatus, decidedBy: string | null, appliedAt: string | null }`.
  - `startDue(now?: Date): Promise<{ started: string[] }>` — platform client scans SCHEDULED plans with `scheduledFor <= now`, then `applyPlan` + `afterStart` per school.
  - `ClassesService.list(schoolId, academicYearId?: string)` rows carry `academicYear: { id, name, isCurrent }`.
  - `StudentsService.list` accepts `academicYearId` (filters `classSection.academicYearId`).

- [ ] **Step 1: Failing spec cases**

```ts
it('register joins decisions with names and section labels', async () => {
  txMock.sessionPlan.findFirst.mockResolvedValue({ id: 'p1', status: 'STARTED', fromYearId: 'y1' });
  txMock.sessionDecision.findMany.mockResolvedValue([{ studentId: 's1', decision: 'PROMOTE', fromSectionId: 'f5b', toSectionId: 't6b', leaveStatus: null, decidedById: 'u9', appliedAt: new Date('2026-04-01'), student: { firstName: 'Aarav', lastName: 'Mehta', admissionNo: '1' } }]);
  txMock.classSection.findMany.mockResolvedValue([{ id: 'f5b', name: 'B', grade: { name: '5' } }, { id: 't6b', name: 'B', grade: { name: '6' } }]);
  txMock.user.findMany.mockResolvedValue([{ id: 'u9', email: 'office@x.in' }]);
  const r = await svc.register(SCHOOL, 'y1');
  expect(r[0]).toMatchObject({ name: 'Aarav Mehta', fromSection: '5 B', toSection: '6 B', decision: 'PROMOTE', decidedBy: 'office@x.in' });
});
it('startDue starts every scheduled plan whose time has come', async () => {
  platformMock.sessionPlan = { findMany: jest.fn().mockResolvedValue([{ id: 'p1', schoolId: SCHOOL, startedById: null, createdById: 'u1' }]) };
  const apply = jest.spyOn(svc as never, 'applyPlan').mockResolvedValue({ moved: 0, alumni: 0, left: 0, closeUserIds: [], alumniStudentIds: [], slotsCopied: 0, slotsSkipped: 0, teacherUserIds: [], familyUserIds: [] });
  const after = jest.spyOn(svc as never, 'afterStart').mockResolvedValue(undefined);
  const r = await svc.startDue(new Date('2026-03-31T18:31:00Z'));
  expect(platformMock.sessionPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'SCHEDULED', scheduledFor: { lte: new Date('2026-03-31T18:31:00Z') } } }));
  expect(apply).toHaveBeenCalledWith(SCHOOL, 'u1', 'p1');
  expect(after).toHaveBeenCalled();
  expect(r).toEqual({ started: ['p1'] });
});
```

- [ ] **Step 2: register and startDue**

```ts
async register(schoolId: string, yearId: string) {
  return withTenant(schoolId, async (tx) => {
    const plan = await tx.sessionPlan.findFirst({ where: { schoolId, fromYearId: yearId, status: 'STARTED' } });
    if (!plan) return [];
    const [rows, sections] = await Promise.all([
      tx.sessionDecision.findMany({ where: { planId: plan.id }, include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } }, orderBy: { updatedAt: 'asc' } }),
      tx.classSection.findMany({ where: { academicYearId: { in: [plan.fromYearId, plan.toYearId] } }, select: { id: true, name: true, grade: { select: { name: true } } } }),
    ]);
    const label = new Map(sections.map((s) => [s.id, `${s.grade.name} ${s.name}`]));
    const users = await tx.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.decidedById))) } }, select: { id: true, email: true } });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => ({
      studentId: r.studentId, name: `${r.student.firstName} ${r.student.lastName}`, admissionNo: r.student.admissionNo,
      fromSection: r.fromSectionId ? label.get(r.fromSectionId) ?? null : null, toSection: r.toSectionId ? label.get(r.toSectionId) ?? null : null,
      decision: r.decision, leaveStatus: r.leaveStatus, decidedBy: email.get(r.decidedById) ?? null, appliedAt: r.appliedAt?.toISOString() ?? null,
    }));
  });
}

async startDue(now: Date = new Date()): Promise<{ started: string[] }> {
  const due = await getPlatformPrisma().sessionPlan.findMany({ where: { status: 'SCHEDULED', scheduledFor: { lte: now } }, select: { id: true, schoolId: true, createdById: true }, take: 50 });
  const started: string[] = [];
  for (const p of due) {
    try {
      const outcome = await this.applyPlan(p.schoolId, p.createdById, p.id);
      await this.afterStart(p.schoolId, p.id, outcome);
      started.push(p.id);
    } catch (e) {
      this.logger.error(`session start for plan ${p.id} failed: ${(e as Error).message}`);
    }
  }
  return { started };
}
```

- [ ] **Step 3: Controllers**

`sessions.controller.ts` (`@Controller('manage/sessions')`, same guard trio and `@RequireFeature('MANAGEMENT')`, `@Roles('SCHOOL_ADMIN')`):

```ts
@Get() overview() { return this.sessions.overview(this.sid()); }
@Post('plan') createPlan(@CurrentUser() u: SchoolJwtPayload, @Body() dto: CreateSessionPlanDto) { return this.sessions.createPlan(this.sid(), u.sub, dto); }
@Get('plan') getPlan() { return this.sessions.getPlan(this.sid()); }
@Patch('plan') updatePlan(@Body() dto: UpdateSessionPlanDto) { return this.sessions.updatePlan(this.sid(), dto); }
@Post('plan/structure/copy') copyStructure() { return this.sessions.copyStructure(this.sid()); }
@Get('plan/students') rows(@Query('sectionId') sectionId: string) { return this.sessions.sectionRows(this.sid(), sectionId); }
@Put('plan/decisions') decisions(@CurrentUser() u: SchoolJwtPayload, @Body() dto: PutDecisionsDto) { return this.sessions.upsertDecisions(this.sid(), u.sub, dto); }
@Get('plan/review') review() { return this.sessions.review(this.sid()); }
@Post('plan/start') start(@CurrentUser() u: SchoolJwtPayload, @Body() dto: StartSessionDto) { return this.sessions.start(this.sid(), u.sub, dto); }
@Post('plan/cancel') cancel(@CurrentUser() u: SchoolJwtPayload) { return this.sessions.cancel(this.sid(), u.sub); }
@Get(':yearId/register') register(@Param('yearId', ParseUUIDPipe) yearId: string) { return this.sessions.register(this.sid(), yearId); }
```

`sessions-cron.controller.ts` mirrors `notification-outbox.controller.ts`: `@Controller('internal/cron') @Public() @UseGuards(CronSecretGuard)`, `@Get('session-start')` and `@Post('session-start')` both returning `this.sessions.startDue()`.

`apps/api/vercel.json` crons: add `{ "path": "/internal/cron/session-start", "schedule": "30 18 * * *" }` (00:00 IST).

- [ ] **Step 4: Year filters**

`classes.service.list(schoolId, academicYearId?)`: `where: { schoolId, ...(academicYearId ? { academicYearId } : {}) }` and `include.academicYear: { select: { id: true, name: true, isCurrent: true } }`; extend `ClassSectionAdminRow` accordingly. `classes.controller.ts` reads `@Query('academicYearId', new ParseUUIDPipe({ optional: true }))`.

`students.service.list`: `ListFilters.academicYearId?: string` → `extra.classSection = { academicYearId }`; `students.controller.ts` reads the query param and passes it (admin only).

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @skoolos/api test -- sessions classes students && pnpm --filter @skoolos/api typecheck` → PASS.

```bash
git add apps/api/src/modules/management/sessions.controller.ts apps/api/src/modules/management/sessions-cron.controller.ts apps/api/src/modules/management/sessions.service.ts apps/api/src/modules/management/sessions.service.spec.ts apps/api/src/modules/management/classes.service.ts apps/api/src/modules/management/classes.controller.ts apps/api/src/modules/management/students.controller.ts apps/api/src/modules/management/students.service.ts apps/api/src/modules/management/management.module.ts apps/api/vercel.json packages/types/src/index.ts
git commit -m "feat(api): /manage/sessions routes, register, scheduled-start cron, year filters"
```

---

### Task 9: Console — the Sessions page (steps 1, 2, 4, 5, 6 and the register)

**Files:**
- Create: `apps/web/app/app/sessions/page.tsx`, `apps/web/app/app/sessions/steps/next-session.tsx`, `steps/classes.tsx`, `steps/roll-numbers.tsx`, `steps/copy-rest.tsx`, `steps/review.tsx`, `apps/web/app/app/sessions/register.tsx`
- Modify: `apps/web/app/app/layout.tsx` (nav item)
- Test: `apps/web/app/app/sessions/page.test.tsx`

**Interfaces:**
- Consumes: every `/manage/sessions` route.
- Produces: `/app/sessions` with a stepper; each step is its own component taking `{ plan, refresh }`.

- [ ] **Step 1: Failing page test**

```tsx
it('shows the current session and the Start a new session button when no plan is open', async () => {
  api.get.mockResolvedValue({ years: [{ id: 'y1', name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true, sections: 12, students: 380 }], plan: null });
  mount();
  expect(await screen.findByText('2025-26')).toBeInTheDocument();
  expect(screen.getByText('380 students in 12 classes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start a new session' })).toBeInTheDocument();
});
it('with an open plan, renders the stepper on the saved step', async () => {
  api.get.mockResolvedValue({ years: [], plan: { id: 'p1', status: 'DRAFT', version: 2, fromYear: { name: '2025-26' }, toYear: { name: '2026-27' }, sectionMap: { f: 't' } } });
  mount();
  expect(await screen.findByText('3 · Decide students')).toBeInTheDocument();
});
```

Run: `pnpm --filter @skoolos/web test -- sessions/page` → FAIL.

- [ ] **Step 2: page.tsx**

Structure:

```tsx
const STEPS = ['Next session', 'Classes', 'Decide students', 'Roll numbers', 'Copy the rest', 'Review & start'];
```

- Query `['sessions']` → `GET /manage/sessions`.
- No plan: a card per year (name, dates, "{students} students in {sections} classes", "current" chip) and the button "Start a new session" → renders `NextSessionStep` in create mode.
- Plan open: a stepper header (`{i+1} · {label}`, current step highlighted). Current step defaults: no `sectionMap` keys → step 2; else step 3; the admin can click any step. Step bodies: `NextSessionStep` (edit name/dates disabled once sections exist), `ClassesStep`, `DecideStep` (Task 10), `RollNumbersStep`, `CopyRestStep`, `ReviewStep`.
- Started sessions: a "Register" link per year with a STARTED plan → `Register` component (`GET /manage/sessions/:yearId/register`, a table with a Print button calling `window.print()`, filter "Alumni without email").

`NextSessionStep`: inputs prefilled from `nextSessionDefaults` (reimplement the name/date defaults in the component; the API does not expose them) → `POST /manage/sessions/plan`.
`ClassesStep`: "Copy this year's classes" → `POST /manage/sessions/plan/structure/copy`; then lists the next-year classes (`GET /manage/classes?academicYearId=`) with class-teacher selects (`PUT /manage/classes/:id { classTeacherId }`, the existing update route) and an amber "No class teacher" chip; the section map table "{from} → {to}" with a select per row → `PATCH /manage/sessions/plan { sectionMap }`.
`RollNumbersStep`: three radios → `PATCH { rollPolicy }`.
`CopyRestStep`: two checkboxes → `PATCH { copyTimetable, carryLeave }`; a link to `/app/settings` (holidays).
`ReviewStep`: `GET /manage/sessions/plan/review` → counts grid, warnings list (undecided, unplaced, sections without class teacher, alumni without email, library books out), radio "Start now" / "Start on {toYear.startDate}", the Start button disabled while `counts.undecided > 0`; on click `POST /manage/sessions/plan/start { when, version }`; on 409 `PLAN_CHANGED` toast "The plan changed. Reloading." and refetch; "Cancel this plan" → `POST /manage/sessions/plan/cancel` after `window.confirm`.

Nav: in `layout.tsx` add `{ href: '/app/sessions', label: 'Sessions', icon: CalendarRange, requiredFeature: 'MANAGEMENT' }` after Classes; import `CalendarRange` from lucide-react.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/web test -- sessions route-file-exports && pnpm --filter @skoolos/web typecheck` → PASS.

```bash
git add apps/web/app/app/sessions apps/web/app/app/layout.tsx
git commit -m "feat(web): Sessions tab — next session, classes, roll numbers, copy, review, register"
```

---

### Task 10: Console — the Decide students step

**Files:**
- Create: `apps/web/app/app/sessions/decide-table.tsx`, `decide-table.test.tsx`, `steps/decide.tsx`

**Interfaces:**
- Consumes: `GET /manage/sessions/plan/students?sectionId=`, `PUT /manage/sessions/plan/decisions`, `PATCH /manage/sessions/plan { passMarkPct, countExamIds }`.
- Produces: `<DecideTable sectionId rows targets exams passMarkPct onSaved />`.

- [ ] **Step 1: Failing table test**

```tsx
const rows = [
  { studentId: 's1', rollNo: '1', name: 'Aarav Mehta', admissionNo: '1', attendancePct: 94, resultsPct: 81, review: false, joinedSincePlan: false, decision: null, toSectionId: 't6b', leaveStatus: null, leaveReason: null, note: null, defaultDecision: 'PROMOTE', stayToSectionId: 't5b' },
  { studentId: 's2', rollNo: '3', name: 'Dev Sharma', admissionNo: '2', attendancePct: 61, resultsPct: 29, review: true, joinedSincePlan: false, decision: null, toSectionId: 't6b', leaveStatus: null, leaveReason: null, note: null, defaultDecision: 'PROMOTE', stayToSectionId: 't5b' },
];
const targets = [{ id: 't6b', label: '6 B', gradeId: 'g6' }, { id: 't5b', label: '5 B', gradeId: 'g5' }];

it('shows review flags, lets Stay in grade pick the same-grade section, and saves all rows', async () => {
  api.put.mockResolvedValue({ saved: 2, version: 5 });
  render(<DecideTable sectionId="f5b" rows={rows} targets={targets} exams={[]} passMarkPct={33} onSaved={vi.fn()} />);
  expect(screen.getByText('Review')).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('row', { name: /Dev Sharma/ })).getByRole('button', { name: 'Stay in grade' }));
  expect(within(screen.getByRole('row', { name: /Dev Sharma/ })).getByDisplayValue('5 B')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save and next class' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/sessions/plan/decisions', { rows: [
    { studentId: 's1', decision: 'PROMOTE', toSectionId: 't6b' },
    { studentId: 's2', decision: 'STAY', toSectionId: 't5b' },
  ] }));
});
it('Select all → Promote fills every undecided row', async () => {
  render(<DecideTable sectionId="f5b" rows={rows} targets={targets} exams={[]} passMarkPct={33} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Select all → Promote' }));
  expect(screen.getAllByText('Promote').length).toBe(2);
});
```

Run: `pnpm --filter @skoolos/web test -- decide-table` → FAIL.

- [ ] **Step 2: decide-table.tsx**

State: `Map<studentId, { decision, toSectionId, leaveStatus, leaveReason, note }>` seeded from rows (`decision ?? defaultDecision`, `toSectionId`). Columns: Roll · Student (chips: `Review` amber when `review`, `Joined N weeks ago` indigo when `joinedSincePlan`) · Attendance · Results (`—` when null) · Decision (four small buttons: Promote / Stay in grade / Pass out / Leaving; the active one filled) · Goes to (select of `targets`, hidden for PASS_OUT/LEAVE; STAY preselects `stayToSectionId`; LEAVE shows a select Transferred/Left + reason input). Row `aria-label` = the student's name. Toolbar: "Select all → Promote", "Show: below pass mark", "Show: attendance under 75%". Footer: "Save and next class" → `PUT /manage/sessions/plan/decisions` with every row (only the keys the API needs: `studentId, decision, toSectionId?, leaveStatus?, leaveReason?, note?` — omit `toSectionId` for PASS_OUT/LEAVE), then `onSaved(version)`. Final-grade sections (every `defaultDecision === 'PASS_OUT'`) render the "Goes to" column as "Alumni · Class of {fromYear}".

`steps/decide.tsx`: a class picker (closing-year sections from `GET /manage/classes?academicYearId=` + "Unplaced"), the pass-mark input and the "Exams that count" multi-select (from `exams` in the rows response) → `PATCH /manage/sessions/plan`, then `<DecideTable>`; a "Joined since the plan" group header when any row has `joinedSincePlan`.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/web test -- decide-table sessions` → PASS.

```bash
git add apps/web/app/app/sessions/decide-table.tsx apps/web/app/app/sessions/decide-table.test.tsx apps/web/app/app/sessions/steps/decide.tsx
git commit -m "feat(web): Decide students table with attendance, results, review flags"
```

---

### Task 11: Console — Session picker on the Students page

**Files:**
- Modify: `apps/web/app/app/students/page.tsx`
- Test: `apps/web/app/app/students/page.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET /manage/sessions` (years), `GET /manage/classes?academicYearId=`, `GET /manage/students?academicYearId=`.

- [ ] **Step 1: Failing test case**

```tsx
it('offers a Session select in the Add form when a next session exists and lists that session\'s classes', async () => {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/manage/sessions')) return Promise.resolve({ years: [{ id: 'y1', name: '2025-26', isCurrent: true }, { id: 'y2', name: '2026-27', isCurrent: false }], plan: { id: 'p1', status: 'DRAFT' } });
    if (url.startsWith('/manage/classes')) return Promise.resolve(url.includes('y2') ? [{ id: 't6b', name: 'B', grade: { name: '6' }, academicYear: { id: 'y2', name: '2026-27', isCurrent: false } }] : [{ id: 'f5b', name: 'B', grade: { name: '5' }, academicYear: { id: 'y1', name: '2025-26', isCurrent: true } }]);
    return Promise.resolve([]);
  });
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /Add student/ }));
  expect(screen.getByText(/Admitting for 2026-27\?/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Session'), 'y2');
  expect(await screen.findByRole('option', { name: '6 B' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement**

- Query `['sessions']`; `openYears = years.filter(y => y.isCurrent || plan?.toYearId === y.id)` (the next year is "open" only while a plan targets it; after Start it is current).
- `StudentForm` gains a `Session` select (rendered only when `openYears.length > 1`), default the current year; the class select lists `GET /manage/classes?academicYearId=<selected>`. Banner above the form when a next year is open and the current is selected: "Admitting for {next.name}? Switch the session."
- List filter: the class dropdown groups options by session name; a checkbox "Show past sessions" (default off) that hides classes whose year is neither current nor open; when off, the students query adds `academicYearId=<current>` unless a class filter is set.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/web test -- students` → PASS.

```bash
git add apps/web/app/app/students/page.tsx apps/web/app/app/students/page.test.tsx
git commit -m "feat(web): session picker for new admissions, past-sessions toggle"
```

---

### Task 12: Alumni home (portal + app), behaviour spec, preflight

**Files:**
- Modify: `apps/web/app/portal/page.tsx` (and the portal shell nav component that lists Diary/Timetable/…)
- Modify: `apps/mobile/src/app/(family)/(tabs)/home/index.tsx`, `apps/mobile/src/app/(family)/(tabs)/_layout.tsx`
- Modify: `.claude/skills/sckools-behavior-spec/…`
- Test: `apps/web/app/portal/page.test.tsx` (extend or create), `apps/mobile/src/app/(family)/(tabs)/home/index.test.tsx` (extend)

**Interfaces:**
- Consumes: `GET /portal/profile` → `status`, `alumniBatch` (Track A).

- [ ] **Step 1: Failing tests**

Web: render the portal home with a profile `{ status: 'ALUMNI', alumniBatch: '2025-26', firstName: 'Aarav' }` and assert `Alumni · Class of 2025-26` is shown, the "Results" and "Attendance" links exist, and "Diary" / "Timetable" links do not. Mobile: same assertions on the family home (`getByText('Alumni · Class of 2025-26')`, `queryByText('Diary')` null).

- [ ] **Step 2: Implement**

Web portal home: when `profile.status === 'ALUMNI'` render an `AlumniHome` block (heading `Alumni · Class of {alumniBatch}`, a line "Your results and records stay here.", cards for Results, Attendance record, Notifications) and pass `alumni` to the shell so its nav hides Diary, Timetable, Assignments, Messages, Library. When `status` is TRANSFERRED or LEFT the API login is already closed; no branch needed.

Mobile family home: when the profile is ALUMNI, show the same header and only the Results, Attendance and Notifications entries; the tabs layout hides the Attendance-marking and Diary tabs for that session. Guard against the existing `useFocusEffect` refetch tests: mock `/portal/profile` in the home test's `api.request` mock (see the ledger entry `rn-header-widget-breaks-screen-tests`).

- [ ] **Step 3: Behaviour spec**

Sessions section (new): "One open SessionPlan per school. Rows show attendance % and results % from the closing year; the pass mark only flags. Start is one transaction (`sessions.service.ts applyPlan`): seats move, PASS_OUT → ALUMNI with `alumniBatch` = closing year, LEAVE → the chosen status with the login closed after commit, the current year flips, the timetable copies for ACTIVE teachers only, leave carries forward via `closeYear`, pending register-change requests on closing sections are rejected. Scheduled plans start from `/internal/cron/session-start`. Alumni keep a read-only login (portal and app show the Alumni home). New admissions in next-year sections are untouched by Start."

- [ ] **Step 4: Preflight and commit**

Run: `pnpm preflight` → all green.

```bash
git add apps/web/app/portal apps/mobile/src/app/\(family\) .claude/skills/sckools-behavior-spec
git commit -m "feat: alumni home in portal and app; sessions invariants in the behaviour spec"
```

Report: what shipped; that migrations `20260910090000_person_lifecycle`, `20260911090000_celebrations`, `20260912090000_session_plans` are pending on staging; that the cron entry needs the CRON secret configured on the staging API project; and that the first real run should be rehearsed on the Raffles sample tenant on staging (open a plan, decide two classes, Start now, check the register, the family app and the alumni email).
