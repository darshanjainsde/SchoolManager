# Notification spine — Tier 1b Implementation Plan (the leave desk, done right)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave can only be applied for sensibly (no past start, no overlap, ≤ 60 days, active person, a named half for a half day); approval creates cover gaps only for working days, live slots and the right half, each linked to its leave; one `freeTeachersFor()` decides who is free for the console dropdown, the WhatsApp list and a new candidates endpoint; a substitute can say "Got it" or "Can't"; cancelling or clearing tells exactly the people affected; the accounts officer covers what she approves; and an 18:00 IST nudge names tomorrow's unfilled classes.

**Architecture:** All rules live in `LeaveService` and three small pure-ish helpers in `modules/management/internal/` (`school-calendar.ts`, `free-teachers.ts`, half-day math in `leave-dates.ts`). Notices ride the Tier 1a spine: one bell row + one outbox row per person, written in the same transaction, drained after commit. Three new kinds (`LEAVE_CANCELLED`, `COVER_CANCELLED`, `COVER_UNFILLED`) use the Tier 1 templates (`cover_cancelled`, gated until Meta approves) and the approved `cover_pending`. `COVER_ASSIGNED` moves to `cover_assigned_v2` (Got it · Can't) with the approved v1 as its fallback.

**Tech Stack:** NestJS 10, Prisma 5.22 (PostgreSQL, RLS), Jest (api), Vitest + Testing Library (web), jest-expo + @testing-library/react-native (mobile), Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-10-06-notification-spine-and-whatsapp-desk-design.md` (§4 entire, §3.3 SUBSTITUTE rows, §2.5 rows LEAVE_CANCELLED / COVER_UNFILLED / COVER_ASSIGNED, §6 Leave cases, §7 `busySet` guard, §8 Tier 1). **Requires Tier 1a** (`2026-10-06-spine-tier1a.md`) merged: `NotificationDelivery`, `InboundIdentityService`, `isLeaveDesk`, `resolveLeaveDeskRecipients`, `GATED_TEMPLATES`, `COVER_ASSIGNED_V2`, `COVER_CANCELLED`, race-safe `decide()`.

**Deviations from the spec, and why:**
- The spec's `/accounts/leave` does not exist on the web: an ACCOUNTS officer's web shell is confined to `/app/pay` (`app/app/layout.tsx` redirects every other `/app/*` path), and their leave desk is the app's `(worker)/(tabs)/leavedesk`. The **Coverage tab goes on that app desk** (the officer's real desk); the web console's `/app/leave` (admin) gets the same server-driven picker and the "seen" line. A web leave desk for the officer is a separate change to the console shell.
- `halfDay` stays a Boolean (old app builds send it) and gains `halfDayPart: 'AM' | 'PM' | null`. A half day with no part (an old client) keeps today's behaviour — every period of that day becomes a gap. The halves split at 12:00 by the period's start time ("8:00" and "08:00" both read as morning).
- There is no half-day attendance status (`PersonAttendanceStatus` has none); a half day keeps the day's `ON_LEAVE` mark, as it does today. Pay already reads `halfDay` off the application.
- `COVER_UNFILLED` always goes on WhatsApp as the approved `cover_pending` template. Sending the interactive list instead needs the 24-hour-window tracking of Tier 4; until then the list is only ever a reply inside a window the desk opened by tapping.
- `LEAVE_CANCELLED` (to the desk) and `COVER_CANCELLED` (to substitutes) share the one `sckools_cover_cancelled` template (spec §2.5 names one template for both); the words in its parameters differ.
- Bell rows for the new notices reuse existing bell kinds — `LEAVE_APPLIED` for desk-facing, `COVER_ASSIGNED` for substitute-facing — so no client `Record<NotificationKind, …>` (web icons, app links) changes in this tier. The title carries the meaning.
- "Got it" / "Can't" are WhatsApp-only in this tier (`LeaveService.acknowledge` / `decline` are ready for an app button later).
- `assign()` now refuses anyone `freeTeachersFor()` would not offer, so the console, WhatsApp and the API agree on "free" by construction (spec §7 guard). A reassignment tells the replaced substitute.
- The nudge enumerates schools with `groupBy` on the platform client (a cron has no tenant), then does every read and write per school inside `withTenant`.
- Old gaps are linked to their leave by the migration only where exactly one approved leave of that teacher spans the date; any other old gap keeps `leaveApplicationId = NULL` and a cancel falls back to the old teacher-and-date rule for those rows only.

## Global Constraints

- Migrations are written, never applied, by a task. `db-migrate.yml` is workflow_dispatch only and checks out the ref it is run FROM: staging is migrated with `--ref <this branch> -f environment=staging` BEFORE the PR merges; production is the owner's run before the staging → main merge. Until it runs, every `Substitution` read fails on the new columns — so the migration goes first, always.
- A task that adds a Prisma model, a column the backup engine copies, or a platform-client (BYPASSRLS) file runs the FULL `apps/api` jest suite before it is complete: `backups/engine/buckets.ts` `BUCKET_OF`, `rehome.ts` `PACK_EXCLUDED_MODELS` and `common/tenancy-bypass.spec.ts` `ALLOWED` must name it (Tier 1a missed the first two for `NotificationDelivery`).
- Every `notificationOutbox.create` carries `select` (guard-pinned in Tier 1a), so a deploy that lands before its migration cannot 500 a writer.
- Every tenant query inside `withTenant` with an explicit `schoolId`; every list capped with `LIST_CEILING` or a literal `take`.
- **Apply-time checks** (spec §4): no past `startDate` (IST); no overlap with an existing PENDING/APPROVED application of the same person; span ≤ 60 days; applicant must be active (Teacher and Staff alike). Quota stays a warning, not a block.
- **Approve** creates gaps only for working days (`School.workingDays` and the `Holiday` table — the calendar `LeavePolicyService` already uses), for slots live on that date (`effectiveFrom <= date AND (effectiveTo IS NULL OR effectiveTo > date)`), and writes `Substitution.leaveApplicationId`.
- `freeTeachersFor(gap)` excludes the on-leave teacher, anyone with a live slot that period, anyone already covering that period, anyone ON_LEAVE that date, inactive teachers; ranks by teaches-this-subject, then fewest covers that day.
- Substitution routes take `LeaveDeskGuard`; the console's `/app/leave` stays admin-only.
- Every outbox writer calls `requestOutboxDrain()` after its transaction (`outbox-writers.guard.spec.ts`).
- Only Meta-APPROVED templates are sent; `sckools_cover_assigned_v2` and `sckools_cover_cancelled` are in `GATED_TEMPLATES` (Tier 1a) and go only once approved.
- Designed conflicts return 409 (`LEAVE_OVERLAP`, `TEACHER_CONFLICT`, `NOT_THE_SUBSTITUTE`, `LEAVE_NOT_PENDING`).
- UI: console uses the existing `.sk-*` kit and `var(--sk-*)` tokens (read `.claude/skills/sckools-ui-taste/SKILL.md` first); the app uses `components/ui` + `components/desk`. Every state (loading, empty, error) has words. Copy is plain English an Indian school office reads at a glance.
- Branch from `origin/staging` after Tier 1a is merged. `pnpm preflight` green before push; stage explicit paths, never `git add -A`; PR to `staging`.

## Review Focus

1. **A leave that spans Diwali or a Sunday** — no gap and no ON_LEAVE mark on those days; the working days around them are covered. Pinned in Task 3.
2. **Leave A is cancelled while leave B of the same teacher overlaps some of the same dates** — B's gaps and B's substitutes are untouched; only A's substitutes are told. Pinned in Task 7.
3. **A substitute taps "Can't" after the desk has already given the period to someone else** — nothing is cleared, the new cover stands, the tapper is told it already changed. Pinned in Task 8.
4. **Vercel fires the 18:00 nudge twice** — the desk gets one nudge for tomorrow. Pinned in Task 11.
5. **A half day PM in a school whose periods are written "8:00" (no leading zero)** — the 8:00 period is read as morning and gets no gap; an unreadable time is covered rather than left empty. Pinned in Task 3.

---

### Task 1: Schema — `halfDayPart`, `Substitution.leaveApplicationId`, `Substitution.acknowledgedAt`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `LeaveApplication`, `Substitution`)
- Create: `packages/db/prisma/migrations/20261007_010000_leave_cover_links/migration.sql`
- Modify: `packages/types/src/index.ts` (`LeaveApplication.halfDayPart`)
- Test: `packages/db/src/rls-coverage.spec.ts` (existing), `pnpm typecheck`

**Interfaces:**
- Produces: `LeaveApplication.halfDayPart: string | null` (`'AM' | 'PM'`, CHECKed), `Substitution.leaveApplicationId: string | null`, `Substitution.acknowledgedAt: Date | null`; shared `LeaveApplication.halfDayPart?: 'AM' | 'PM' | null`.

- [ ] **Step 1: Edit the models**

In `model LeaveApplication` after `halfDay Boolean @default(false)` add:

```prisma
  /// Which half of a half day: AM | PM. Null on a full day, and on a half day
  /// sent by an older client (every period of that day is then covered).
  halfDayPart  String?
```

and after `staff Staff? @relation(...)` add `substitutions Substitution[]`.

Replace `model Substitution` with:

```prisma
model Substitution {
  id                  String            @id @default(uuid()) @db.Uuid
  schoolId            String            @db.Uuid
  classSectionId      String            @db.Uuid
  periodId            String            @db.Uuid
  date                DateTime          @db.Date
  originalTeacherId   String            @db.Uuid
  substituteTeacherId String?           @db.Uuid // null = uncovered gap
  reason              String? // e.g. "leave"
  /// The leave this gap was opened for. A cancel removes exactly these rows,
  /// so a second leave overlapping the same dates is never touched.
  leaveApplicationId  String?           @db.Uuid
  /// When the substitute tapped "Got it". Cleared whenever the substitute changes.
  acknowledgedAt      DateTime?
  createdAt           DateTime          @default(now())
  school              School            @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  leaveApplication    LeaveApplication? @relation(fields: [leaveApplicationId], references: [id], onDelete: SetNull)

  @@unique([classSectionId, periodId, date], name: "one_sub_per_slot_date")
  @@index([schoolId, date])
  @@index([leaveApplicationId])
  /// A teacher's own covers on a date — "their covers reopen when they go on leave".
  @@index([schoolId, substituteTeacherId, date])
}
```

- [ ] **Step 2: Write the migration**

Create `packages/db/prisma/migrations/20261007_010000_leave_cover_links/migration.sql`:

```sql
-- Notification spine, Tier 1b: the leave desk, done right.

-- Which half of a half day. Only meaningful with halfDay; the CHECK says so.
ALTER TABLE "LeaveApplication" ADD COLUMN "halfDayPart" TEXT;
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_halfDayPart_check"
  CHECK ("halfDayPart" IS NULL OR ("halfDay" AND "halfDayPart" IN ('AM', 'PM')));

-- A gap knows the leave it was opened for, and whether its substitute has seen it.
ALTER TABLE "Substitution" ADD COLUMN "leaveApplicationId" UUID;
ALTER TABLE "Substitution" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_leaveApplicationId_fkey"
  FOREIGN KEY ("leaveApplicationId") REFERENCES "LeaveApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Substitution_leaveApplicationId_idx" ON "Substitution"("leaveApplicationId");
CREATE INDEX "Substitution_schoolId_substituteTeacherId_date_idx" ON "Substitution"("schoolId", "substituteTeacherId", "date");

-- Backfill: a gap opened by an approval belongs to the ONE approved leave of
-- its teacher that spans its date. Where two approved leaves overlap that date
-- nothing is guessed: the row stays NULL and a cancel uses the old
-- teacher-and-date rule for it.
UPDATE "Substitution" s SET "leaveApplicationId" = m.leave_id
FROM (
  SELECT s2.id AS sub_id, MIN(la.id::text)::uuid AS leave_id
  FROM "Substitution" s2
  JOIN "LeaveApplication" la
    ON la."schoolId" = s2."schoolId"
   AND la."teacherId" = s2."originalTeacherId"
   AND la.status = 'APPROVED'
   AND s2.date BETWEEN la."startDate" AND la."endDate"
  WHERE s2.reason = 'leave' AND s2."leaveApplicationId" IS NULL
  GROUP BY s2.id
  HAVING COUNT(*) = 1
) m
WHERE s.id = m.sub_id;
```

- [ ] **Step 3: The shared contract**

In `packages/types/src/index.ts`, inside `export interface LeaveApplication`, after `halfDay: boolean;` add:

```ts
  /** Which half of a half day; null/absent on a full day or from an older API. */
  halfDayPart?: 'AM' | 'PM' | null;
```

- [ ] **Step 4: Validate, generate, typecheck, run the RLS guard**

Run: `pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db generate && pnpm --filter @skoolos/db exec jest src/rls-coverage.spec.ts && pnpm typecheck`
Expected: valid schema, client generated, PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261007_010000_leave_cover_links/migration.sql packages/types/src/index.ts
git commit -m "feat(db): a gap knows its leave and whether its substitute has seen it; a half day knows which half"
```

---

### Task 2: Apply-time checks, and the form asks which half

**Files:**
- Modify: `apps/api/src/common/errors/api-error.ts` (+ four codes)
- Modify: `apps/api/src/modules/management/management.dto.ts` (`CreateLeaveDto.halfDayPart`)
- Modify: `apps/api/src/modules/management/leave.service.ts` (`apply`, `personFor`, `toRow`, new `overlapping`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`
- Modify: `apps/api/src/modules/management/leave-staff.spec.ts`
- Modify: `apps/web/components/teacher/LeaveForm.tsx`
- Modify: `apps/web/components/teacher/LeaveForm.test.tsx`

**Interfaces:**
- Produces: `MAX_LEAVE_DAYS = 60` (exported from `leave.service.ts`); error codes `LEAVE_IN_PAST` (400), `LEAVE_TOO_LONG` (400), `LEAVE_OVERLAP` (409), `LEAVE_INACTIVE` (403); `CreateLeaveDto.halfDayPart?: 'AM' | 'PM'`; `LeaveForm.onSubmit` value gains `halfDayPart?: 'AM' | 'PM'`.

- [ ] **Step 1: Write the failing API tests**

In `leave.service.spec.ts`:

1. Inside `describe('apply', …)` add a `beforeEach` / `afterEach` pair at its top (the existing tests use 20–22 July 2026, so "today" must be before that):

```ts
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-19T03:00:00.000Z')); // IST 19 Jul, 08:30
      txMock.leaveApplication.findMany.mockResolvedValue([]); // no other leave
    });
    afterEach(() => jest.useRealTimers());
```

2. In the two expectations that pin `txMock.teacher.findFirst` (`'creates a PENDING application …'` and `'lets the owning teacher cancel their own PENDING application'`) change `select: { id: true, firstName: true, lastName: true }` to `select: { id: true, firstName: true, lastName: true, isActive: true }`; in `'creates a PENDING application …'` add `halfDayPart: null,` to the expected `data` after `halfDay: false,`.

3. Append inside `describe('apply', …)`:

```ts
    describe('refuses what a school cannot act on', () => {
      beforeEach(() => {
        txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: true });
        txMock.leaveApplication.create.mockResolvedValue({ id: LEAVE_ID, teacherId: TEACHER, status: 'PENDING', type: 'SICK', startDate: new Date('2026-07-19'), endDate: new Date('2026-07-19'), reason: null, createdAt: new Date() });
      });

      it('a start date that has already gone (IST) is refused before any query', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-18', endDate: '2026-07-19' })).rejects.toMatchObject({ response: { code: 'LEAVE_IN_PAST', field: 'startDate' } });
        expect(withTenantMock).not.toHaveBeenCalled();
      });

      it('today itself is fine', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-19', endDate: '2026-07-19' })).resolves.toMatchObject({ status: 'PENDING' });
      });

      it('60 days is the most one request can cover; 61 is refused', async () => {
        // 20 Jul → 17 Sep inclusive: 12 + 31 + 17 = 60 days.
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'UNPAID', startDate: '2026-07-20', endDate: '2026-09-17' })).resolves.toBeDefined();
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'UNPAID', startDate: '2026-07-20', endDate: '2026-09-18' })).rejects.toMatchObject({ response: { code: 'LEAVE_TOO_LONG' } });
      });

      it('an overlap with pending or approved leave is refused, naming those dates', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-22'), endDate: new Date('2026-07-23'), status: 'APPROVED', halfDay: false, halfDayPart: null }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-21', endDate: '2026-07-22' })).rejects.toMatchObject({
          response: { code: 'LEAVE_OVERLAP', message: expect.stringContaining('approved leave for Wed 22 – Thu 23 Jul 2026') },
        });
        expect(txMock.leaveApplication.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL, teacherId: TEACHER, status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: new Date('2026-07-22') }, endDate: { gte: new Date('2026-07-21') },
        });
        expect(txMock.leaveApplication.create).not.toHaveBeenCalled();
      });

      it('the morning and the afternoon of one day are two halves, not a clash', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'PENDING', halfDay: true, halfDayPart: 'AM' }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21', halfDay: true, halfDayPart: 'PM' })).resolves.toBeDefined();
        expect(txMock.leaveApplication.create.mock.calls[0][0].data).toMatchObject({ halfDay: true, halfDayPart: 'PM' });
      });

      it('a teacher who has left cannot apply', async () => {
        txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: false });
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20' })).rejects.toMatchObject({ response: { code: 'LEAVE_INACTIVE' } });
      });

      it('morning/afternoon without a half day is refused', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20', halfDayPart: 'AM' })).rejects.toMatchObject({ response: { code: 'VALIDATION', field: 'halfDayPart' } });
      });
    });
```

4. Inside `describe('LeaveService notices', …)` change its `beforeEach` to also run `jest.useFakeTimers().setSystemTime(new Date('2026-09-01T03:00:00.000Z')); txMock.leaveApplication.findMany.mockResolvedValue([]);` and add `afterEach(() => jest.useRealTimers());`.

In `leave-staff.spec.ts`: in the top-level `beforeEach` add `jest.useFakeTimers().setSystemTime(new Date('2026-10-01T03:00:00.000Z'));` and `txMock.leaveApplication.findFirst.mockResolvedValue(null);`; add a top-level `afterEach(() => jest.useRealTimers());`. Append:

```ts
describe('a staff member who has left', () => {
  it('cannot apply — the same rule as a teacher', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: DRIVER, firstName: 'Ram', lastName: 'Singh', isActive: false });
    await expect(svc.apply(SCHOOL, DRIVER_USER, { type: 'CASUAL', startDate: '2026-10-05', endDate: '2026-10-05' })).rejects.toMatchObject({ response: { code: 'LEAVE_INACTIVE' } });
    expect(txMock.staff.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, userId: DRIVER_USER });
  });
});
```

- [ ] **Step 2: Write the failing form test**

Append inside `describe('LeaveForm', …)` of `LeaveForm.test.tsx`:

```tsx
  it('a half day asks which half, and sends it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    expect(screen.queryByLabelText('Which half')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/half day/i));
    await user.selectOptions(screen.getByLabelText('Which half'), 'PM');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ halfDay: true, halfDayPart: 'PM' }));
  });

  it('a full day sends no half', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<LeaveForm isSubmitting={false} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } });
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(onSubmit.mock.calls[0][0].halfDayPart).toBeUndefined();
  });
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/leave && pnpm --filter @skoolos/web exec vitest run components/teacher/LeaveForm.test.tsx`
Expected: FAIL — no `LEAVE_IN_PAST`/`LEAVE_TOO_LONG`/`LEAVE_OVERLAP`/`LEAVE_INACTIVE`; no "Which half" control.

- [ ] **Step 4: Implement the API side**

`api-error.ts`, after `'LEAVE_OWN_DECISION'`:

```ts
  /** A leave whose first day has already gone (IST) — pair with 400. */
  | 'LEAVE_IN_PAST'
  /** One request longer than MAX_LEAVE_DAYS — pair with 400. */
  | 'LEAVE_TOO_LONG'
  /** The same person already has PENDING/APPROVED leave on one of these dates — pair with 409. */
  | 'LEAVE_OVERLAP'
  /** The applicant has left the school — pair with 403. */
  | 'LEAVE_INACTIVE'
```

`management.dto.ts`, in `CreateLeaveDto` after `halfDay?`:

```ts
  /** Which half of a half day. Optional so an older app's half day still applies (all periods are then covered). */
  @IsOptional()
  @IsIn(['AM', 'PM'])
  halfDayPart?: 'AM' | 'PM';
```

`leave.service.ts`:

- Add `export const MAX_LEAVE_DAYS = 60;` above the class.
- `LeaveApplicationRow` gains `halfDayPart?: string | null;` and `toRow` adds `halfDayPart: (a.halfDayPart as 'AM' | 'PM' | null | undefined) ?? null,`.
- `personFor` returns `isActive` and no longer filters staff by it (an inactive person must hear WHY):

```ts
  ): Promise<{ kind: 'TEACHER' | 'STAFF'; id: string; firstName: string; lastName: string | null; isActive: boolean } | null> {
    const teacher = await tx.teacher.findFirst({
      where: { schoolId, userId },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    if (teacher) return { kind: 'TEACHER', ...teacher };
    const staff = await tx.staff.findFirst({
      where: { schoolId, userId },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    return staff ? { kind: 'STAFF', ...staff } : null;
  }
```

- Add below `whereIs`:

```ts
  /**
   * Leave of the same person that shares a date with [start, end]. The morning
   * and the afternoon of one date are two halves, not a clash.
   */
  private static async overlapping(
    tx: TenantTx,
    schoolId: string,
    person: { kind: 'TEACHER' | 'STAFF'; id: string },
    start: string,
    end: string,
    dto: { halfDay?: boolean; halfDayPart?: 'AM' | 'PM' },
  ) {
    const rows = await tx.leaveApplication.findMany({
      take: 5,
      where: {
        schoolId,
        ...LeaveService.whereIs(person),
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: new Date(end) },
        endDate: { gte: new Date(start) },
      },
      select: { startDate: true, endDate: true, status: true, halfDay: true, halfDayPart: true },
    });
    return rows.find((r) => !(dto.halfDay && r.halfDay && dto.halfDayPart && r.halfDayPart && dto.halfDayPart !== r.halfDayPart)) ?? null;
  }
```

- Replace the body of `apply` up to and including the `tx.leaveApplication.create` call with:

```ts
    const start = dto.startDate.slice(0, 10);
    const end = dto.endDate.slice(0, 10);
    if (end < start) {
      throw new ApiError('VALIDATION', 'endDate must be on or after startDate', 400, 'endDate');
    }
    // The DB carries this as a CHECK. Refusing it here means the person is
    // told what is wrong instead of being shown a constraint violation.
    if (dto.halfDay && end !== start) {
      throw new ApiError('VALIDATION', 'A half day is one day. Pick the same date for both, or turn the half day off.', 400, 'halfDay');
    }
    if (dto.halfDayPart && !dto.halfDay) {
      throw new ApiError('VALIDATION', 'Morning or afternoon is only for a half day.', 400, 'halfDayPart');
    }
    // School days are IST days: at 23:00 IST "today" is still today.
    if (start < todayIstDateStr(new Date())) {
      throw new ApiError('LEAVE_IN_PAST', 'Leave cannot start on a day that has already gone. Ask the office to record it.', 400, 'startDate');
    }
    if (dateRangeInclusive(start, end).length > MAX_LEAVE_DAYS) {
      throw new ApiError('LEAVE_TOO_LONG', `One request can cover at most ${MAX_LEAVE_DAYS} days. Apply for a longer leave in parts.`, 400, 'endDate');
    }

    const out = await withTenant(schoolId, async (tx) => {
      const person = await LeaveService.personFor(tx, schoolId, callerUserId);
      if (!person) {
        throw new ApiError('NOT_A_TEACHER', 'Only a teacher or a staff member can apply for leave', 403);
      }
      if (person.isActive === false) {
        throw new ApiError('LEAVE_INACTIVE', 'This login belongs to someone who no longer works here, so it cannot apply for leave.', 403);
      }
      const clash = await LeaveService.overlapping(tx, schoolId, person, start, end, dto);
      if (clash) {
        const word = clash.status === 'APPROVED' ? 'approved' : 'pending';
        throw new ApiError('LEAVE_OVERLAP', `You already have ${word} leave for ${LeaveService.datesLabel(toDateStr(clash.startDate), toDateStr(clash.endDate))}. Cancel it or pick other dates.`, 409, 'startDate');
      }

      const typeDef = await tx.leaveTypeDef.findFirst({
        where: { schoolId, builtin: dto.type },
        select: { id: true },
      });

      const created = await tx.leaveApplication.create({
        data: {
          schoolId,
          teacherId: person.kind === 'TEACHER' ? person.id : null,
          staffId: person.kind === 'STAFF' ? person.id : null,
          type: dto.type,
          typeDefId: typeDef?.id ?? null,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          halfDay: dto.halfDay ?? false,
          halfDayPart: dto.halfDay ? (dto.halfDayPart ?? null) : null,
          reason: dto.reason,
        },
      });
```

(the rest of `apply` — `tellDeskApplied`, `return LeaveService.toRow(created)`, `requestOutboxDrain()` — is unchanged).

- [ ] **Step 5: Implement the form**

In `LeaveForm.tsx`:

- `EMPTY_FORM` gains `halfDayPart: 'AM' as 'AM' | 'PM'`.
- `onSubmit`'s value type gains `halfDayPart?: 'AM' | 'PM'`.
- In `submit()` add `halfDayPart: halfDay ? form.halfDayPart : undefined,` after `halfDay,`.
- Add `min` to both date inputs so a browser never offers a gone day: compute once above `return`:

```tsx
  // IST "today", the day the server judges a start date against.
  const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
```

  and add `min={todayIst}` to the `leave-from` and `leave-to` `<Input>`s.
- Replace the half-day block (`{oneDay ? ( … ) : null}`) with:

```tsx
      {oneDay ? (
        <div className="sm:col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              style={{ width: 16, height: 16, flex: 'none' }}
              checked={form.halfDay}
              onChange={(e) => setForm((f) => ({ ...f, halfDay: e.target.checked }))}
            />
            <span>Half day — I will be in for the other half</span>
          </label>
          {form.halfDay ? (
            <div className="space-y-1.5" style={{ minWidth: 180 }}>
              <label htmlFor="leave-half" className="sk-lab">
                Which half
              </label>
              {/* Only that half's classes get a substitute, so the office needs to know. */}
              <Select
                id="leave-half"
                className={`${fieldCls} w-full`}
                value={form.halfDayPart}
                onChange={(e) => setForm((f) => ({ ...f, halfDayPart: e.target.value as 'AM' | 'PM' }))}
              >
                <option value="AM">Morning — away before 12:00</option>
                <option value="PM">Afternoon — away from 12:00</option>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management && pnpm --filter @skoolos/web exec vitest run components/teacher`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/errors/api-error.ts apps/api/src/modules/management/management.dto.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/management/leave-staff.spec.ts apps/web/components/teacher/LeaveForm.tsx apps/web/components/teacher/LeaveForm.test.tsx
git commit -m "feat(leave): refuse a past start, an overlap, more than 60 days or a person who has left; a half day names its half"
```

---

### Task 3: Approve covers working days, live slots, the right half — and links every gap to its leave

**Files:**
- Create: `apps/api/src/modules/management/internal/school-calendar.ts`
- Create: `apps/api/src/modules/management/internal/school-calendar.spec.ts`
- Modify: `apps/api/src/modules/management/internal/leave-dates.ts` (+ `minutesOfDay`, `inHalf`)
- Create: `apps/api/src/modules/management/internal/leave-dates.spec.ts`
- Modify: `apps/api/src/modules/management/leave-policy.service.ts` (`holidaySet` delegates)
- Modify: `apps/api/src/modules/management/leave.service.ts` (`approve`, new `slotsOfTheDay`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`

**Interfaces:**
- Produces: `holidayDates(tx: Pick<TenantTx,'holiday'>, schoolId: string, from: Date, to: Date): Promise<Set<string>>`; `workingDates(tx: Pick<TenantTx,'school'|'holiday'>, schoolId: string, start: string, end: string): Promise<string[]>`; `minutesOfDay(t: string | null | undefined): number | null`; `inHalf(app: { halfDay?: boolean | null; halfDayPart?: string | null }, startTime: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/management/internal/leave-dates.spec.ts`:

```ts
import { inHalf, minutesOfDay } from './leave-dates';

describe('minutesOfDay', () => {
  it.each([
    ['08:00', 480], ['8:00', 480], ['12:40', 760], ['1:30 pm', 810], ['12:15 AM', 15], ['10:15', 615],
  ])('%s → %i', (s, m) => expect(minutesOfDay(s)).toBe(m));
  it.each(['', null, undefined, 'P3', '25:00'])('%s → null', (s) => expect(minutesOfDay(s as string)).toBeNull());
});

describe('inHalf — which periods a half day leaves empty', () => {
  it('a full day, or a half day with no part (an older app), covers every period', () => {
    expect(inHalf({ halfDay: false }, '8:00')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: null }, '13:00')).toBe(true);
  });
  it('morning is before 12:00, afternoon from 12:00 — "8:00" without a leading zero is morning', () => {
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '8:00')).toBe(false);
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '12:00')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, '11:59')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, '12:40')).toBe(false);
  });
  it('a time nobody can read is covered rather than left without a teacher', () => {
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, 'after lunch')).toBe(true);
  });
});
```

Create `apps/api/src/modules/management/internal/school-calendar.spec.ts`:

```ts
import { workingDates } from './school-calendar';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tx = (workingDays: number[] | null, holidays: { startDate: Date; endDate: Date | null }[] = []) => ({
  school: { findUnique: jest.fn().mockResolvedValue(workingDays ? { workingDays } : null) },
  holiday: { findMany: jest.fn().mockResolvedValue(holidays) },
});

describe('workingDates — the calendar a leave is counted and covered on', () => {
  it('drops the days the school does not work and every holiday day, ranges expanded', async () => {
    // Sat 7 – Fri 13 Nov 2026; a Mon–Fri school; Diwali break Mon 9 – Tue 10.
    const t = tx([1, 2, 3, 4, 5], [{ startDate: new Date('2026-11-09'), endDate: new Date('2026-11-10') }]);
    expect(await workingDates(t as never, SCHOOL, '2026-11-07', '2026-11-13')).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    expect(t.holiday.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL });
    expect(t.school.findUnique).toHaveBeenCalledWith({ where: { id: SCHOOL }, select: { workingDays: true } });
  });

  it('a school with no row yet works Monday to Saturday', async () => {
    expect(await workingDates(tx(null) as never, SCHOOL, '2026-11-14', '2026-11-15')).toEqual(['2026-11-14']); // Sat yes, Sun no
  });
});
```

In `leave.service.spec.ts`: add to `txMock` → `school: { findFirst: …, findUnique: jest.fn() }` and `holiday: { findMany: jest.fn() }`; in the top `beforeEach` add `txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] }); txMock.holiday.findMany.mockResolvedValue([]);`. In `'generates a Substitution gap …'` add `leaveApplicationId: LEAVE_ID,` to the expected `substitution.create` `data`. Then append inside `describe('approve', …)`:

```ts
    describe('only the classes that would really be empty', () => {
      const leaveOf = (o: Record<string, unknown>) => txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, staffId: null, status: 'PENDING', ...o });
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-01T03:00:00.000Z'));
        txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
        txMock.substitution.findFirst.mockResolvedValue(null);
        txMock.substitution.create.mockImplementation(async ({ data }: { data: { periodId: string; date: Date } }) => ({ id: `${data.periodId}@${data.date.toISOString().slice(0, 10)}` }));
        txMock.staffAttendance.findFirst.mockResolvedValue(null);
        txMock.staffAttendance.create.mockResolvedValue({});
      });
      afterEach(() => jest.useRealTimers());

      it('Diwali inside the span: no gap and no ON_LEAVE mark that day', async () => {
        leaveOf({ startDate: new Date('2026-11-09'), endDate: new Date('2026-11-11') }); // Mon–Wed
        txMock.holiday.findMany.mockResolvedValue([{ startDate: new Date('2026-11-09'), endDate: null }]);
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual([`${PERIOD}@2026-11-10`, `${PERIOD}@2026-11-11`]);
        expect(txMock.staffAttendance.create.mock.calls.map((c) => c[0].data.date)).toEqual([new Date('2026-11-10'), new Date('2026-11-11')]);
      });

      it('asks only for slots LIVE on that date, not every slot that was ever active', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.timetableSlot.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL, teacherId: TEACHER, dayOfWeek: 3,
          effectiveFrom: { lte: new Date('2026-11-11T00:00:00+05:30') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date('2026-11-11T00:00:00+05:30') } }],
        });
      });

      it('a half day PM leaves only the afternoon periods to cover — "8:00" is morning', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: 'PM' });
        txMock.timetableSlot.findMany.mockResolvedValue([
          { classSectionId: CLASS_SECTION, periodId: 'p1', period: { startTime: '8:00' } },
          { classSectionId: CLASS_SECTION, periodId: 'p6', period: { startTime: '12:40' } },
        ]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['p6@2026-11-11']);
      });

      it('every gap names the leave it was opened for', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.substitution.create.mock.calls[0][0].data.leaveApplicationId).toBe(LEAVE_ID);
      });
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/internal src/modules/management/leave.service.spec.ts`
Expected: FAIL — modules missing; Diwali gets a gap; the slot query has `effectiveTo: null` only.

- [ ] **Step 3: Implement**

Append to `internal/leave-dates.ts`:

```ts
/** Minutes after midnight for "8:00", "08:00", "1:30 pm"; null when it is not a time. */
export function minutesOfDay(t: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(am|pm)?\s*$/i.exec(t ?? '');
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const NOON = 12 * 60;

/**
 * Does a half day leave THIS period empty? Morning = starts before 12:00,
 * afternoon = from 12:00. A full day — or a half day from an older app that
 * did not say which half — leaves every period empty, as before. A start time
 * nobody can read is treated as empty too: a class with an extra teacher is a
 * smaller problem than a class with none.
 */
export function inHalf(app: { halfDay?: boolean | null; halfDayPart?: string | null }, startTime: string | null | undefined): boolean {
  if (!app.halfDay || (app.halfDayPart !== 'AM' && app.halfDayPart !== 'PM')) return true;
  const m = minutesOfDay(startTime);
  if (m === null) return true;
  return app.halfDayPart === 'AM' ? m < NOON : m >= NOON;
}
```

Create `internal/school-calendar.ts`:

```ts
import type { TenantTx } from '@skoolos/db';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { dateRangeInclusive, isoWeekdayOf, toDateStr } from './leave-dates';

/**
 * THE SCHOOL'S CALENDAR — one definition of a working day, shared by the
 * leave balance (LeavePolicyService) and the cover an approval opens
 * (LeaveService). A working day is inside `School.workingDays` and not on a
 * `Holiday`. Every query carries the school.
 */
export async function holidayDates(tx: Pick<TenantTx, 'holiday'>, schoolId: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await tx.holiday.findMany({
    take: LIST_CEILING.STRUCTURE,
    where: { schoolId, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
    select: { startDate: true, endDate: true },
  });
  const out = new Set<string>();
  for (const h of rows) {
    for (const d of dateRangeInclusive(toDateStr(h.startDate), toDateStr(h.endDate ?? h.startDate))) out.add(d);
  }
  return out;
}

/** The working `YYYY-MM-DD` dates in [start, end], in order. */
export async function workingDates(tx: Pick<TenantTx, 'school' | 'holiday'>, schoolId: string, start: string, end: string): Promise<string[]> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { workingDays: true } });
  const working = new Set(school?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const holidays = await holidayDates(tx, schoolId, new Date(start), new Date(end));
  return dateRangeInclusive(start, end).filter((d) => working.has(isoWeekdayOf(d)) && !holidays.has(d));
}
```

In `leave-policy.service.ts` replace the body of `holidaySet` with `return holidayDates(tx, schoolId, from, to);` (import from `'./internal/school-calendar'`), keeping its signature. Run `pnpm --filter @skoolos/api exec jest src/modules/management/leave-policy.service.spec.ts` — unchanged and green.

In `leave.service.ts` import `workingDates` from `'./internal/school-calendar'`, `inHalf` from `'./internal/leave-dates'`, `resolveAsOfDate` from `'./internal/timetable-date'`. Add below `markOnLeaveIfDue`:

```ts
  /** The teacher's slots LIVE on that date, cut to the half they are away for. */
  private static async slotsOfTheDay(
    tx: TenantTx,
    schoolId: string,
    teacherId: string,
    dateStr: string,
    app: { halfDay?: boolean | null; halfDayPart?: string | null },
  ) {
    const asOf = resolveAsOfDate(dateStr, new Date());
    const slots = await tx.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: {
        schoolId,
        teacherId,
        dayOfWeek: isoWeekdayOf(dateStr),
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
      },
      select: { classSectionId: true, periodId: true, period: { select: { startTime: true } } },
    });
    return slots.filter((s) => inHalf(app, s.period?.startTime));
  }
```

and in `approve` replace from `const dates = dateRangeInclusive(…)` through the end of the `for (const dateStr …)` loop with:

```ts
      // Only WORKING days: a Sunday or Diwali inside the span has no class to
      // cover and no attendance to mark (the same calendar the balance uses).
      const dates = await workingDates(tx, schoolId, toDateStr(app.startDate), toDateStr(app.endDate));
      const todayStr = todayIstDateStr(new Date());

      // Substitutions and the staff-attendance mark are TEACHER work: a driver
      // has no timetable to cover and no class waiting for one.
      const teacherId = app.teacherId;
      let gaps = 0;
      const gapIds: string[] = [];
      for (const dateStr of teacherId ? dates : []) {
        const date = new Date(dateStr);
        for (const slot of await LeaveService.slotsOfTheDay(tx, schoolId, teacherId!, dateStr, app)) {
          const existing = await tx.substitution.findFirst({
            where: { schoolId, classSectionId: slot.classSectionId, periodId: slot.periodId, date },
          });
          if (existing) continue;
          const gap = await tx.substitution.create({
            data: {
              schoolId,
              classSectionId: slot.classSectionId,
              periodId: slot.periodId,
              date,
              originalTeacherId: teacherId!,
              reason: 'leave',
              leaveApplicationId: app.id,
            },
          });
          gaps += 1;
          gapIds.push(gap.id);
        }
        if (dateStr >= todayStr) {
          await this.markOnLeaveIfDue(tx, schoolId, teacherId!, date, adminUserId);
        }
      }
```

Update `approve`'s docstring: "for every WORKING day of the leave (School.workingDays minus holidays), one gap per slot LIVE on that date — only the away half's periods on a half day — linked to this leave by `leaveApplicationId`."

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/management/internal/school-calendar.ts apps/api/src/modules/management/internal/school-calendar.spec.ts apps/api/src/modules/management/internal/leave-dates.ts apps/api/src/modules/management/internal/leave-dates.spec.ts apps/api/src/modules/management/leave-policy.service.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts
git commit -m "fix(leave): approval covers working days only, slots live that day and the half the teacher is away — every gap names its leave"
```

---

### Task 4: One `freeTeachersFor()`, a candidates endpoint, and the accounts officer can cover

**Files:**
- Create: `apps/api/src/modules/management/internal/free-teachers.ts`
- Create: `apps/api/src/modules/management/internal/free-teachers.spec.ts`
- Modify: `apps/api/src/modules/management/leave.service.ts` (`candidates`, `assign`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts` (`describe('assign')`)
- Modify: `apps/api/src/modules/management/leave.controller.ts` (`SubstitutionController`)
- Create: `apps/api/src/modules/management/leave.controller.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CoverCandidate { id: string; name: string; teachesSubject: boolean; coversThatDay: number }
  export interface CoverGap { id: string; date: Date; periodId: string; classSectionId: string; originalTeacherId: string }
  export function freeTeachersFor(db: Pick<TenantTx, 'timetableSlot' | 'substitution' | 'staffAttendance' | 'teacher'>, schoolId: string, gap: CoverGap): Promise<CoverCandidate[]>
  LeaveService.candidates(schoolId: string, substitutionId: string): Promise<CoverCandidate[]>
  ```
  `GET /manage/substitution/:id/candidates`; `/manage/substitution/*` guarded by `LeaveDeskGuard` for `SCHOOL_ADMIN | STAFF`.

- [ ] **Step 1: Write the failing tests**

Create `internal/free-teachers.spec.ts`:

```ts
import { freeTeachersFor } from './free-teachers';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GAP = { id: 'g1', date: new Date('2026-10-12'), periodId: 'p3', classSectionId: 'cs-9a', originalTeacherId: 't-priya' }; // a Monday
const T = (id: string, firstName: string) => ({ id, firstName, lastName: 'K' });
const AS_OF = new Date('2026-10-12T00:00:00+05:30');

function db() {
  return {
    timetableSlot: {
      findFirst: jest.fn().mockResolvedValue({ subjectId: 'maths' }),
      // Busy that period: Arun. Teaches maths: Kavya.
      findMany: jest.fn(async ({ where }: { where: { subjectId?: string } }) => (where.subjectId ? [{ teacherId: 't-kavya' }] : [{ teacherId: 't-arun' }])),
    },
    substitution: {
      findMany: jest.fn().mockResolvedValue([{ substituteTeacherId: 't-ramesh' }]), // already covering p3 elsewhere
      groupBy: jest.fn().mockResolvedValue([{ substituteTeacherId: 't-mohan', _count: { _all: 2 } }]),
    },
    staffAttendance: { findMany: jest.fn().mockResolvedValue([{ teacherId: 't-sunita' }]) }, // ON_LEAVE that day
    teacher: { findMany: jest.fn().mockResolvedValue([T('t-priya', 'Priya'), T('t-arun', 'Arun'), T('t-ramesh', 'Ramesh'), T('t-sunita', 'Sunita'), T('t-mohan', 'Mohan'), T('t-kavya', 'Kavya'), T('t-anil', 'Anil')]) },
  };
}

describe('freeTeachersFor — the one definition of "free for this period"', () => {
  it('leaves out the teacher on leave, anyone teaching then, anyone already covering then, anyone ON_LEAVE that day', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r.map((c) => c.id).sort()).toEqual(['t-anil', 't-kavya', 't-mohan']);
  });

  it('puts whoever teaches the subject first, then whoever covers least that day, then by name', async () => {
    const r = await freeTeachersFor(db() as never, SCHOOL, GAP);
    expect(r).toEqual([
      { id: 't-kavya', name: 'Kavya K', teachesSubject: true, coversThatDay: 0 },
      { id: 't-anil', name: 'Anil K', teachesSubject: false, coversThatDay: 0 },
      { id: 't-mohan', name: 'Mohan K', teachesSubject: false, coversThatDay: 2 },
    ]);
  });

  it('reads only slots live that day, only active teachers, and only this school', async () => {
    const d = db();
    await freeTeachersFor(d as never, SCHOOL, GAP);
    const live = { effectiveFrom: { lte: AS_OF }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: AS_OF } }] };
    expect(d.timetableSlot.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, dayOfWeek: 1, periodId: 'p3', ...live });
    expect(d.teacher.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, isActive: true });
    expect(d.substitution.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: GAP.date, periodId: 'p3', substituteTeacherId: { not: null }, NOT: { id: 'g1' } });
    expect(d.staffAttendance.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: GAP.date, status: 'ON_LEAVE', teacherId: { not: null } });
  });

  it('a gap whose class has no live slot that day still gets a list, just without subject ranking', async () => {
    const d = db();
    d.timetableSlot.findFirst.mockResolvedValue(null);
    const r = await freeTeachersFor(d as never, SCHOOL, GAP);
    expect(r.every((c) => !c.teachesSubject)).toBe(true);
    expect(d.timetableSlot.findMany).toHaveBeenCalledTimes(1);
  });
});
```

Create `leave.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { LeaveDeskGuard } from './internal/leave-desk.guard';
import { SubstitutionController } from './leave.controller';

describe('SubstitutionController — the officer covers what she approves', () => {
  it('admits SCHOOL_ADMIN and STAFF, then narrows STAFF to the leave desk', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SubstitutionController)).toEqual(['SCHOOL_ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(GUARDS_METADATA, SubstitutionController)).toContain(LeaveDeskGuard);
  });

  it('GET :id/candidates asks the service who is free', async () => {
    const handler = SubstitutionController.prototype.candidates;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/candidates');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    const leave = { candidates: jest.fn().mockResolvedValue([]) };
    const c = new SubstitutionController(leave as never, { requireTenant: () => ({ schoolId: 'S' }) } as never);
    await c.candidates('g1');
    expect(leave.candidates).toHaveBeenCalledWith('S', 'g1');
  });
});
```

In `leave.service.spec.ts`, add at the top (before the `import { LeaveService }` line):

```ts
jest.mock('./internal/free-teachers', () => ({ freeTeachersFor: jest.fn() }));
```

import it (`import { freeTeachersFor } from './internal/free-teachers';`), and replace the whole `describe('assign', …)` with:

```ts
  describe('assign', () => {
    const dto: AssignSubstitutionDto = { substituteTeacherId: OTHER_TEACHER };
    const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER, substituteTeacherId: null };
    beforeEach(() => {
      txMock.substitution.findFirst.mockResolvedValue(gap);
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: OTHER_TEACHER });
    });

    it('sets a substitute freeTeachersFor offers, and clears any earlier "seen"', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
      await svc.assign(SCHOOL, SUB_ID, dto);
      expect(freeTeachersFor).toHaveBeenCalledWith(txMock, SCHOOL, gap);
      expect(txMock.substitution.update).toHaveBeenCalledWith({ where: { id: SUB_ID }, data: { substituteTeacherId: OTHER_TEACHER, acknowledgedAt: null } });
    });

    it('refuses anyone freeTeachersFor would not offer — the console, WhatsApp and the API agree', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: 'someone-else', name: 'X', teachesSubject: false, coversThatDay: 0 }]);
      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({ response: { code: 'TEACHER_CONFLICT', field: 'substituteTeacherId' } });
      expect(txMock.substitution.update).not.toHaveBeenCalled();
    });

    it('a gap of another school is not found', async () => {
      txMock.substitution.findFirst.mockResolvedValue(null);
      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toThrow('Substitution not found');
    });
  });

  describe('candidates', () => {
    it('asks freeTeachersFor about the school\'s own gap', async () => {
      const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER };
      txMock.substitution.findFirst.mockResolvedValue(gap);
      (freeTeachersFor as jest.Mock).mockResolvedValue([]);
      await svc.candidates(SCHOOL, SUB_ID);
      expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL } });
      expect(freeTeachersFor).toHaveBeenCalledWith(txMock, SCHOOL, gap);
    });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/internal/free-teachers.spec.ts src/modules/management/leave.controller.spec.ts src/modules/management/leave.service.spec.ts`
Expected: FAIL — module missing; controller has no `candidates`, roles are `['SCHOOL_ADMIN']`.

- [ ] **Step 3: Implement**

Create `internal/free-teachers.ts`:

```ts
import type { TenantTx } from '@skoolos/db';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { isoWeekdayOf, toDateStr } from './leave-dates';
import { resolveAsOfDate } from './timetable-date';

export interface CoverCandidate {
  id: string;
  name: string;
  /** Teaches the gap's subject somewhere in the live timetable. */
  teachesSubject: boolean;
  /** Covers already given to them that date. */
  coversThatDay: number;
}

export interface CoverGap {
  id: string;
  date: Date;
  periodId: string;
  classSectionId: string;
  originalTeacherId: string;
}

type Db = Pick<TenantTx, 'timetableSlot' | 'substitution' | 'staffAttendance' | 'teacher'>;

/**
 * WHO IS FREE TO COVER THIS PERIOD — the only place that question is
 * answered. The console's dropdown, the WhatsApp list, the candidates
 * endpoint and `assign()`'s own check all call this, so they can never
 * disagree (the web page used to compute its own `busySet` from the whole
 * week's timetable and offer teachers who were on leave).
 *
 * Out: the teacher on leave; anyone with a slot LIVE that date in that
 * period; anyone already covering that period that date; anyone ON_LEAVE that
 * date; inactive teachers. Order: teaches this subject, then fewest covers
 * that day, then name. Works with a tenant tx or the platform client — every
 * where names the school.
 */
export async function freeTeachersFor(db: Db, schoolId: string, gap: CoverGap): Promise<CoverCandidate[]> {
  const dateStr = toDateStr(gap.date);
  const asOf = resolveAsOfDate(dateStr, new Date());
  const live = { effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] };
  const weekday = isoWeekdayOf(dateStr);

  const [slot, busy, covering, onLeave, teachers, load] = await Promise.all([
    db.timetableSlot.findFirst({
      where: { schoolId, classSectionId: gap.classSectionId, periodId: gap.periodId, dayOfWeek: weekday, ...live },
      select: { subjectId: true },
    }),
    db.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, dayOfWeek: weekday, periodId: gap.periodId, ...live },
      select: { teacherId: true },
    }),
    db.substitution.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, date: gap.date, periodId: gap.periodId, substituteTeacherId: { not: null }, NOT: { id: gap.id } },
      select: { substituteTeacherId: true },
    }),
    db.staffAttendance.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, date: gap.date, status: 'ON_LEAVE', teacherId: { not: null } },
      select: { teacherId: true },
    }),
    db.teacher.findMany({
      take: LIST_CEILING.STRUCTURE,
      where: { schoolId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    db.substitution.groupBy({
      by: ['substituteTeacherId'],
      where: { schoolId, date: gap.date, substituteTeacherId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const out = new Set<string>(
    [gap.originalTeacherId, ...busy.map((b) => b.teacherId), ...covering.map((c) => c.substituteTeacherId), ...onLeave.map((o) => o.teacherId)].filter(
      (x): x is string => !!x,
    ),
  );
  const free = teachers.filter((t) => !out.has(t.id));

  const teaches = new Set<string>();
  if (slot?.subjectId && free.length > 0) {
    const rows = await db.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, subjectId: slot.subjectId, teacherId: { in: free.map((t) => t.id) }, ...live },
      select: { teacherId: true },
      distinct: ['teacherId'],
    });
    for (const r of rows) teaches.add(r.teacherId);
  }
  const coversOf = new Map(load.map((g) => [g.substituteTeacherId, g._count._all]));

  return free
    .map((t) => ({
      id: t.id,
      name: `${t.firstName} ${t.lastName ?? ''}`.trim(),
      teachesSubject: teaches.has(t.id),
      coversThatDay: coversOf.get(t.id) ?? 0,
    }))
    .sort((a, b) => Number(b.teachesSubject) - Number(a.teachesSubject) || a.coversThatDay - b.coversThatDay || a.name.localeCompare(b.name));
}
```

In `leave.service.ts` import `freeTeachersFor, type CoverCandidate` from `'./internal/free-teachers'`; add:

```ts
  /** Who is free for this gap — the same answer the dropdown, WhatsApp and assign() use. */
  async candidates(schoolId: string, substitutionId: string): Promise<CoverCandidate[]> {
    return withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');
      return freeTeachersFor(tx, schoolId, sub);
    });
  }
```

and replace `assign`'s body inside `withTenant` (from `const sub = …` through `return updated;`) with:

```ts
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');

      // ONE definition of "free": whoever freeTeachersFor would not offer is refused.
      const free = await freeTeachersFor(tx, schoolId, sub);
      if (!free.some((c) => c.id === dto.substituteTeacherId)) {
        throw new ApiError('TEACHER_CONFLICT', 'That teacher is not free then — they teach, cover or are on leave in that period.', 409, 'substituteTeacherId');
      }

      const updated = await tx.substitution.update({
        where: { id },
        // A new substitute has not seen it yet.
        data: { substituteTeacherId: dto.substituteTeacherId, acknowledgedAt: null },
      });
      await this.tellSubstituteAssigned(tx, schoolId, sub, dto.substituteTeacherId);
      return updated;
```

Update `assign`'s docstring to "The substitute must be one `freeTeachersFor()` offers for this gap."

In `leave.controller.ts`, replace the `SubstitutionController` decorators and add the handler:

```ts
@Controller('manage/substitution')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard, LeaveDeskGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN', 'STAFF')
export class SubstitutionController {
  // … constructor and sid() unchanged …

  /** Who is free for this gap — what the console dropdown and the app's Coverage tab offer. */
  @Get(':id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.leave.candidates(this.sid(), id);
  }
```

and update its docstring: "The leave desk's own resource: an admin, or the accounts officer through `LeaveDeskGuard` — whoever approves leave can cover it."

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management src/common/module-wiring.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/management/internal/free-teachers.ts apps/api/src/modules/management/internal/free-teachers.spec.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/management/leave.controller.ts apps/api/src/modules/management/leave.controller.spec.ts
git commit -m "feat(leave): one freeTeachersFor() answers who is free; GET /manage/substitution/:id/candidates; the accounts officer can cover"
```

---

### Task 5: The WhatsApp cover list asks the same question

**Files:**
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.ts` (`coverList`)
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts`
- Create: `apps/api/src/modules/management/free-teachers.guard.spec.ts`

**Interfaces:**
- Consumes: `LeaveService.candidates(schoolId, substitutionId): Promise<CoverCandidate[]>` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/management/free-teachers.guard.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * "Who is free" has ONE answer (spec §7). The web page used to build its own
 * busySet from the week's timetable and the WhatsApp list ran its own five
 * queries; they disagreed about teachers on leave. Both now ask
 * freeTeachersFor through the service.
 */
const SRC = resolve(__dirname, '..', '..');
const WEB = resolve(SRC, '..', '..', 'web');

describe('freeTeachersFor is the only free-teacher computation', () => {
  it('the WhatsApp actions ask LeaveService.candidates and compute nothing themselves', () => {
    const src = readFileSync(join(SRC, 'modules/whatsapp/whatsapp-actions.service.ts'), 'utf8');
    expect(src).toMatch(/this\.leave\.candidates\(/);
    expect(src).not.toMatch(/staffAttendance\.findMany|timetableSlot\.findMany/);
  });

  it('LeaveService.assign checks freeTeachersFor, not its own clash queries', () => {
    const src = readFileSync(join(SRC, 'modules/management/leave.service.ts'), 'utf8');
    expect(src).toMatch(/freeTeachersFor\(tx, schoolId, sub\)/);
    expect(src).not.toMatch(/regularClash|substitutionClash/);
  });

  it('the console leave page has no busySet of its own', () => {
    const page = readFileSync(join(WEB, 'app/app/leave/page.tsx'), 'utf8');
    expect(page).not.toMatch(/busySet/);
  });
});
```

(The third case stays red until Task 9; run it then.)

In `whatsapp-actions.service.spec.ts`: add `candidates: jest.fn()` to the `leave` mock. Replace the test `'Approve runs the SAME LeaveService.approve the console runs, then offers the cover list for the first gap'` with:

```ts
  it('Approve runs the SAME LeaveService.approve the console runs, then offers the free teachers LeaveService names', async () => {
    leave.approve.mockResolvedValue({ gaps: 2, gapIds: [SUB, 'gap-2'] });
    leave.candidates.mockResolvedValue([
      { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
      { id: 'tb', name: 'Kavya Rao', teachesSubject: false, coversThatDay: 1 },
    ]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.timetableSlot.findFirst.mockResolvedValue({ subject: { name: 'Mathematics' } });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('approved:2');
    expect(leave.candidates).toHaveBeenCalledWith(SCHOOL, SUB);
    const list = channel.deliverWith.mock.calls.find((c) => c[3] === 'interactive:list');
    expect(list).toBeDefined();
    expect(list![0]).toBe(SCHOOL);
  });

  it('the list shows who teaches the subject and how loaded the others are', async () => {
    leave.candidates.mockResolvedValue([
      { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
      { id: 'tb', name: 'Kavya Rao', teachesSubject: false, coversThatDay: 1 },
    ]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.timetableSlot.findFirst.mockResolvedValue({ subject: { name: 'Mathematics' } });
    const rowsSpy = jest.spyOn(require('../../common/notifications/whatsapp/graph.client'), 'sendList');
    channel.deliverWith.mockImplementation(async (_s: string, _p: string, _k: string, _l: string, fn: (c: unknown, p: null, f: unknown) => Promise<unknown>) => {
      await fn({ token: 't', phoneNumberId: '1', wabaId: null, graphVersion: 'v21.0' }, null, jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'w' }] }) }));
      return { ok: true, code: null };
    });
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    const rows = (rowsSpy.mock.calls[0][2] as { rows: { title: string; description?: string }[] }).rows;
    expect(rows.map((r) => [r.title, r.description])).toEqual([
      ['Arun Mehta', 'teaches Mathematics'],
      ['Kavya Rao', '1 cover already that day'],
      ['Decide in the console', 'leave this one for later'],
    ]);
    rowsSpy.mockRestore();
  });
```

and in `'when the 24-hour window has closed, the cover list falls back to the console template'` replace `db.teacher.findMany.mockResolvedValue([{ id: 'ta', firstName: 'Arun', lastName: 'Mehta' }]);` with `leave.candidates.mockResolvedValue([{ id: 'ta', name: 'Arun Mehta', teachesSubject: false, coversThatDay: 0 }]);`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp && pnpm --filter @skoolos/api exec jest src/modules/management/free-teachers.guard.spec.ts -t "WhatsApp|assign"`
Expected: FAIL — `leave.candidates` never called; the guard finds `timetableSlot.findMany` in the actions file.

- [ ] **Step 3: Implement**

Replace `coverList` in `whatsapp-actions.service.ts` with:

```ts
  /**
   * "Who covers this period?" — exactly the teachers LeaveService.candidates
   * names (freeTeachersFor), same order: whoever teaches the subject, then the
   * least loaded. Nine rows and a way out.
   */
  async coverList(db: Db, schoolId: string, phone: string, substitutionId: string): Promise<void> {
    const sub = await db.substitution.findUnique({ where: { id: substitutionId }, select: { id: true, date: true, periodId: true, classSectionId: true, originalTeacherId: true } });
    if (!sub) return;
    const [free, when] = await Promise.all([this.leave.candidates(schoolId, sub.id), this.whenOf(db, schoolId, sub.date, sub.periodId, sub.classSectionId)]);
    if (free.length === 0) {
      await this.text(schoolId, phone, `Nobody is free for ${when.className} on ${when.when}. Decide in the console.`);
      return;
    }
    const keys = this.keys();
    const rows = free.slice(0, NO_ROWS_CAP).map((t) => ({
      id: coverPayload(sub.id, t.id, keys),
      title: t.name,
      description: t.teachesSubject
        ? `teaches ${when.subjectName ?? 'this subject'}`
        : t.coversThatDay > 0
          ? `${t.coversThatDay} cover${t.coversThatDay === 1 ? '' : 's'} already that day`
          : 'free this period',
    }));
    rows.push({ id: coverPayload(sub.id, 'skip', keys), title: 'Decide in the console', description: 'leave this one for later' });
    const sent = await this.channel.deliverWith(schoolId, phone, 'COVER_LIST', 'interactive:list', (cfg, pnid, f) =>
      sendList(cfg, phone, { header: 'Who covers?', body: `${when.className}${when.subjectName ? ` · ${when.subjectName}` : ''}\n${when.when}`, button: 'Pick a teacher', rows, footer: `${free.length} free` }, { phoneNumberId: pnid, fetchImpl: f }),
    );
    if (!sent.ok && sent.code === OUT_OF_WINDOW) {
      const school = await db.school.findFirst({ where: { id: schoolId }, select: { name: true } });
      const open = await db.substitution.count({ where: { schoolId, originalTeacherId: sub.originalTeacherId, substituteTeacherId: null, date: { gte: sub.date } } });
      await this.channel.deliverWith(schoolId, phone, 'COVER_PENDING', COVER_PENDING, (cfg, pnid, f) => sendTemplate(cfg, phone, coverPendingTemplate(school?.name ?? 'The school', open), { phoneNumberId: pnid, fetchImpl: f }));
    }
  }
```

Remove the now-unused `isoWeekdayOf` import if nothing else in the file uses it (`whenOf` does — keep it if so).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/whatsapp && pnpm --filter @skoolos/api exec jest src/modules/management/free-teachers.guard.spec.ts -t "WhatsApp|assign"`
Expected: PASS (the busySet case is Task 9's).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/whatsapp/whatsapp-actions.service.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts apps/api/src/modules/management/free-teachers.guard.spec.ts
git commit -m "fix(whatsapp): the cover list is LeaveService.candidates — the same free teachers, in the same order, as the console"
```

---

### Task 6: Three new notices — leave withdrawn, cover called off, classes still uncovered

**Files:**
- Modify: `packages/types/src/index.ts` (`NOTIFICATION_OUTBOX_KINDS`)
- Modify: `packages/types/src/contracts.spec.ts`
- Modify: `apps/api/src/common/notifications/notification.types.ts` (three payloads + map entries)
- Modify: `apps/api/src/common/notifications/format.ts` (push text + `coverCancelledReason`)
- Modify: `apps/api/src/common/notifications/whatsapp/templates.ts` (names, `templateFor`, `SUBMISSIONS`)
- Modify: `apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts` (`MESSAGES`)
- Modify: `apps/api/src/common/mail/mail.service.ts` (three composers)
- Modify: `apps/api/src/common/notifications/email.channel.ts` (three cases)
- Modify: `apps/api/src/modules/management/notification-outbox.service.ts` (`OUTBOX_EMAIL`, `toNotificationMessage`)
- Modify: `apps/api/src/modules/management/notification-outbox.fixtures.ts`
- Modify: `apps/api/src/modules/management/notification-outbox.messages.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LeaveCancelledPayload { schoolName: string; leaveId: string; teacherName: string; dates: string; releasedCovers: number }
  export interface CoverCancelledPayload { schoolName: string; substitutionId: string; when: string; className: string; why: 'LEAVE_CANCELLED' | 'CHANGED' | 'TEACHER_ON_LEAVE' }
  export interface CoverUnfilledPayload { schoolName: string; gaps: number; forDate: string; forWhen: string; note: string | null }
  export function coverCancelledReason(why: CoverCancelledPayload['why']): string
  ```
  Outbox kinds `LEAVE_CANCELLED | COVER_CANCELLED | COVER_UNFILLED` (all emailed by the drain). WhatsApp: `LEAVE_CANCELLED`, `COVER_CANCELLED` → `sckools_cover_cancelled` (gated); `COVER_UNFILLED` → `sckools_cover_pending` (approved).

- [ ] **Step 1: Write the failing tests**

In `packages/types/src/contracts.spec.ts`, in the sorted list of `'declares exactly the NotificationOutbox kinds the API writes'`, add `'COVER_CANCELLED',` and `'COVER_UNFILLED',` after `'COVER_ASSIGNED',` (with the comment `// A cover called off, and classes still uncovered (to the leave desk).`) and `'LEAVE_CANCELLED',` after `'LEAVE_APPLIED',`.

In `whatsapp.spec.ts` add to `MESSAGES`:

```ts
  LEAVE_CANCELLED: { kind: 'LEAVE_CANCELLED', payload: { schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 22 – Tue 23 Sep 2026', releasedCovers: 3 } },
  COVER_CANCELLED: { kind: 'COVER_CANCELLED', payload: { schoolName: 'Raffles', substitutionId: 's1', when: 'Mon 22 Sep, period 3 (10:15–11:00)', className: '9-A', why: 'LEAVE_CANCELLED' } },
  COVER_UNFILLED: { kind: 'COVER_UNFILLED', payload: { schoolName: 'Raffles', gaps: 4, forDate: '2026-09-22', forWhen: 'tomorrow, Tue 22 Sep 2026', note: null } },
```

and append inside `describe('templateFor ↔ SUBMISSIONS', …)`:

```ts
  it('a withdrawn leave and a called-off cover share the one cover_cancelled card, with words for each reader', () => {
    expect(templateFor(MESSAGES.LEAVE_CANCELLED)).toMatchObject({ name: 'sckools_cover_cancelled', params: ['Raffles', "Priya Nair's leave", 'Mon 22 – Tue 23 Sep 2026', 'it was withdrawn, so 3 covers were released'] });
    expect(templateFor(MESSAGES.COVER_CANCELLED).params).toEqual(['Raffles', 'your cover of 9-A', 'Mon 22 Sep, period 3 (10:15–11:00)', 'the leave it was for was cancelled']);
    expect(templateFor(MESSAGES.COVER_UNFILLED)).toEqual({ name: 'sckools_cover_pending', language: 'en', params: ['Raffles', '4'] });
  });
```

In `notification-outbox.fixtures.ts` add:

```ts
  LEAVE_CANCELLED: { schoolName: S, leaveId: ID, teacherName: 'Priya Nair', dates: 'Mon 13 – Tue 14 Oct', releasedCovers: 2 },
  COVER_CANCELLED: { schoolName: S, substitutionId: ID, when: 'Mon 13 Oct, P3', className: '9-A', why: 'CHANGED' },
  COVER_UNFILLED: { schoolName: S, gaps: 3, forDate: '2026-10-13', forWhen: 'tomorrow, Mon 13 Oct 2026', note: null },
```

Append to `notification-outbox.messages.spec.ts`:

```ts
  it('the three leave-desk notices keep their own kind and words — no ANNOUNCEMENT overloading', () => {
    for (const kind of ['LEAVE_CANCELLED', 'COVER_CANCELLED', 'COVER_UNFILLED'] as const) {
      expect(toNotificationMessage(kind, FIXTURES[kind], 'x')).toEqual({ kind, payload: FIXTURES[kind] });
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/types test && pnpm --filter @skoolos/api exec jest src/common/notifications/whatsapp src/modules/management/notification-outbox`
Expected: FAIL — kinds missing (and typecheck errors on the Record maps).

- [ ] **Step 3: Implement the contracts**

`packages/types/src/index.ts`: append `'LEAVE_CANCELLED', 'COVER_CANCELLED', 'COVER_UNFILLED'` to `NOTIFICATION_OUTBOX_KINDS`.

`notification.types.ts`, after `CoverAssignedPayload`:

```ts
/** Payload for LEAVE_CANCELLED — to the leave desk: a request (or an approved leave) was withdrawn. */
export interface LeaveCancelledPayload {
  schoolName: string;
  leaveId: string;
  teacherName: string;
  dates: string;
  /** Covers that were given to substitutes and are now released (0 for a pending request). */
  releasedCovers: number;
}

/** Payload for COVER_CANCELLED — to ONE substitute: a cover they were given is off. */
export interface CoverCancelledPayload {
  schoolName: string;
  substitutionId: string;
  when: string;
  className: string;
  /** LEAVE_CANCELLED: the leave was withdrawn · CHANGED: the desk cleared or reassigned it · TEACHER_ON_LEAVE: the substitute is on leave that day. */
  why: 'LEAVE_CANCELLED' | 'CHANGED' | 'TEACHER_ON_LEAVE';
}

/** Payload for COVER_UNFILLED — to the leave desk: classes with nobody in front of them. */
export interface CoverUnfilledPayload {
  schoolName: string;
  gaps: number;
  /** YYYY-MM-DD the gaps fall on — also what makes the evening nudge once-only. */
  forDate: string;
  /** "tomorrow, Tue 14 Oct 2026" / "Mon 13 Oct 2026". */
  forWhen: string;
  /** Why now, when it is not the evening nudge: "Ramesh Kumar can't take 9-A, …". */
  note: string | null;
}
```

and add to `NotificationPayloadMap`:

```ts
  LEAVE_CANCELLED: LeaveCancelledPayload;
  COVER_CANCELLED: CoverCancelledPayload;
  COVER_UNFILLED: CoverUnfilledPayload;
```

`format.ts`: add above `formatNotification`:

```ts
/** Why a cover is off, as the end of a sentence ("…, because <this>"). */
export function coverCancelledReason(why: 'LEAVE_CANCELLED' | 'CHANGED' | 'TEACHER_ON_LEAVE'): string {
  if (why === 'LEAVE_CANCELLED') return 'the leave it was for was cancelled';
  if (why === 'TEACHER_ON_LEAVE') return 'you are on leave that day';
  return 'the office has changed the cover';
}
```

and three cases before `default`:

```ts
    case 'LEAVE_CANCELLED': {
      const n = message.payload.releasedCovers;
      return {
        title: `Leave withdrawn: ${message.payload.teacherName}`,
        body: `${message.payload.dates}${n ? ` · ${n} cover${n === 1 ? '' : 's'} released` : ''}`,
      };
    }
    case 'COVER_CANCELLED':
      return {
        title: `Cover called off: ${message.payload.className}`,
        body: `${message.payload.when} — ${coverCancelledReason(message.payload.why)}.`,
      };
    case 'COVER_UNFILLED': {
      const g = message.payload.gaps;
      return {
        title: `${g} period${g === 1 ? '' : 's'} still need cover`,
        body: `${message.payload.forWhen}${message.payload.note ? ` · ${message.payload.note}` : ''}. Open Leave → Coverage.`,
      };
    }
```

- [ ] **Step 4: Templates**

In `templates.ts`:

1. Import `coverCancelledReason` from `'../format'`.
2. In `TEMPLATE_NAMES` add (literal strings — the constants below are declared later in the file):

```ts
  // Both readers get the one "called off" card; the parameters differ.
  LEAVE_CANCELLED: `${TEMPLATE_PREFIX}cover_cancelled`,
  COVER_CANCELLED: `${TEMPLATE_PREFIX}cover_cancelled`,
  // The approved "periods still need cover" pointer.
  COVER_UNFILLED: `${TEMPLATE_PREFIX}cover_pending`,
```

3. Move the two bodies into constants declared ABOVE `SUBMISSIONS` (so both records can use them without a temporal-dead-zone error):

```ts
const COVER_CANCELLED_BODY = {
  body: 'A change at {{1}}: {{2}} on {{3}} is called off, because {{4}}. Open the Sckools app to see the day as it now stands.',
  samples: ['Raffles Public School', 'your cover of 9-A, period 3', 'Mon 22 Sep 2026', 'the leave it was for was cancelled'],
};
const COVER_PENDING_BODY = {
  body: 'A message from {{1}}. {{2}} periods still need cover after the leave you approved. Open the console to assign teachers.',
  samples: ['Raffles Public School', '3'],
};
```

   In `EXTRA_SUBMISSIONS` make `[COVER_PENDING]: { category: 'UTILITY', ...COVER_PENDING_BODY },` and `[COVER_CANCELLED]: { category: 'UTILITY', ...COVER_CANCELLED_BODY },`; in `SUBMISSIONS` add:

```ts
  LEAVE_CANCELLED: COVER_CANCELLED_BODY,
  COVER_CANCELLED: COVER_CANCELLED_BODY,
  COVER_UNFILLED: COVER_PENDING_BODY,
```

4. In `templateFor` add before `default`:

```ts
    case 'LEAVE_CANCELLED': {
      const p = message.payload;
      const n = p.releasedCovers;
      const why = n > 0 ? `it was withdrawn, so ${n} cover${n === 1 ? ' was' : 's were'} released` : 'it was withdrawn';
      return { name, language, params: [param(p.schoolName), param(`${p.teacherName}'s leave`), param(p.dates), param(why)] };
    }
    case 'COVER_CANCELLED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(`your cover of ${p.className}`), param(p.when), param(coverCancelledReason(p.why))] };
    }
    case 'COVER_UNFILLED':
      return coverPendingTemplate(message.payload.schoolName, message.payload.gaps);
```

- [ ] **Step 5: Email and the drain**

`mail.service.ts`: import the three payload types and `coverCancelledReason` (from `'../notifications/format'`); add after `sendCoverAssigned`:

```ts
  async sendLeaveCancelled(to: string, p: LeaveCancelledPayload, schoolId: string | null = null, out?: MailOutcomeSink): Promise<boolean> {
    const n = p.releasedCovers;
    return this.sendLetter(to, schoolId, `${p.teacherName} withdrew their leave for ${p.dates}`, {
      title: 'Leave withdrawn',
      intro: `${p.teacherName} has withdrawn their leave for ${p.dates}.${n ? ` ${n} cover${n === 1 ? ' was' : 's were'} released and the substitute${n === 1 ? ' has' : 's have'} been told.` : ''}`,
      rows: [{ label: 'Dates', value: p.dates }, { label: 'Covers released', value: String(n) }],
    }, 'LEAVE_CANCELLED', out);
  }

  async sendCoverCancelled(to: string, p: CoverCancelledPayload, schoolId: string | null = null, out?: MailOutcomeSink): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Your cover of ${p.className} on ${p.when} is called off`, {
      title: 'Cover called off',
      intro: `You no longer need to cover ${p.className} on ${p.when}, because ${coverCancelledReason(p.why)}.`,
      rows: [{ label: 'When', value: p.when }, { label: 'Class', value: p.className }],
    }, 'COVER_CANCELLED', out);
  }

  async sendCoverUnfilled(to: string, p: CoverUnfilledPayload, schoolId: string | null = null, out?: MailOutcomeSink): Promise<boolean> {
    const s = p.gaps === 1 ? '' : 's';
    return this.sendLetter(to, schoolId, `${p.gaps} period${s} still need cover — ${p.forWhen}`, {
      title: 'Classes still need a teacher',
      tone: 'alert',
      intro: `${p.gaps} period${s} on ${p.forWhen} ${p.gaps === 1 ? 'has' : 'have'} nobody to take ${p.gaps === 1 ? 'it' : 'them'} yet.${p.note ? ` ${p.note}` : ''}`,
      note: 'Open the console → Leave → Coverage (or the Leave tab in the app) to pick a teacher for each.',
    }, 'COVER_UNFILLED', out);
  }
```

`email.channel.ts` `compose` switch, before `default`:

```ts
      case 'LEAVE_CANCELLED':
        return this.mail.sendLeaveCancelled(to, message.payload, schoolId, out);
      case 'COVER_CANCELLED':
        return this.mail.sendCoverCancelled(to, message.payload, schoolId, out);
      case 'COVER_UNFILLED':
        return this.mail.sendCoverUnfilled(to, message.payload, schoolId, out);
```

`notification-outbox.service.ts`: `OUTBOX_EMAIL` gains `LEAVE_CANCELLED: true, COVER_CANCELLED: true, COVER_UNFILLED: true,`; `toNotificationMessage` gains, before `default`:

```ts
    // The leave desk's own notices: their kind and words, never an ANNOUNCEMENT.
    case 'LEAVE_CANCELLED':
      return { kind: 'LEAVE_CANCELLED', payload: payload as LeaveCancelledPayload };
    case 'COVER_CANCELLED':
      return { kind: 'COVER_CANCELLED', payload: payload as CoverCancelledPayload };
    case 'COVER_UNFILLED':
      return { kind: 'COVER_UNFILLED', payload: payload as CoverUnfilledPayload };
```

(import the three payload types in its `notification.types` type import).

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @skoolos/types test && pnpm --filter @skoolos/api exec jest src/common src/modules/management/notification-outbox && pnpm typecheck`
Expected: PASS; typecheck clean (every `Record<NotificationKind, …>` and `switch` is exhaustive).

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/index.ts packages/types/src/contracts.spec.ts apps/api/src/common/notifications/notification.types.ts apps/api/src/common/notifications/format.ts apps/api/src/common/notifications/whatsapp/templates.ts apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts apps/api/src/common/mail/mail.service.ts apps/api/src/common/notifications/email.channel.ts apps/api/src/modules/management/notification-outbox.service.ts apps/api/src/modules/management/notification-outbox.fixtures.ts apps/api/src/modules/management/notification-outbox.messages.spec.ts
git commit -m "feat(notifications): LEAVE_CANCELLED, COVER_CANCELLED and COVER_UNFILLED — email, push and WhatsApp (cover_cancelled once approved, cover_pending now)"
```

---

### Task 7: Cancel, clear and reassign tell exactly the people affected; a substitute's own leave reopens their covers

**Files:**
- Modify: `apps/api/src/modules/management/leave.service.ts` (`cancel`, `clear`, `assign`, `approve`; new statics `tellDesk`, `tellSubstitutes`, `describeGaps`, `reopenCoversOf`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`
- Modify: `apps/api/src/modules/management/leave-staff.spec.ts`

**Interfaces:**
- Consumes: `resolveLeaveDeskRecipients` (Tier 1a), the Task 6 payloads.
- Produces: `LeaveService.tellDesk(db: TenantTx, schoolId: string, n: { kind: 'LEAVE_CANCELLED' | 'COVER_UNFILLED'; payload: Record<string, string | number | null>; title: string; body: string; linkId: string | null; exceptUserId?: string | null }): Promise<number>` (public static — the nudge cron uses it); `LeaveService.tellSubstitutes(tx, schoolId, subs, why)`; `clear(schoolId, id)` now also drains.

- [ ] **Step 1: Write the failing tests**

In `leave.service.spec.ts`: add to `txMock` → `substitution.updateMany: jest.fn()`, `teacher.findMany` (exists), `notification.create` (exists); in the top `beforeEach` add `txMock.substitution.findMany.mockResolvedValue([]); txMock.substitution.updateMany.mockResolvedValue({ count: 0 }); txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'A', grade: { name: '9' } }]); txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period 3', startTime: '10:15', endTime: '11:00' }]);`.

Replace the test `'deletes future Substitution gaps and clears future ON_LEAVE marks, but never touches the past date'` with:

```ts
      it('removes only THIS leave\'s future gaps (and unlinked old ones of the teacher on those dates), clears future marks, never the past', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});
        txMock.substitution.findMany.mockResolvedValue([]);

        const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        expect(txMock.substitution.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL,
          date: { in: [new Date('2026-07-21'), new Date('2026-07-22')] },
          OR: [{ leaveApplicationId: LEAVE_ID }, { leaveApplicationId: null, originalTeacherId: TEACHER }],
        });
        expect(txMock.staffAttendance.delete).toHaveBeenCalledTimes(2);
        expect(txMock.leaveApplication.update).toHaveBeenCalledWith({ where: { id: LEAVE_ID }, data: { status: 'CANCELLED' } });
        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 2 });
      });

      it('leave B overlapping these dates keeps its gaps and its substitutes; A\'s substitute is told and the desk hears', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue(null);
        // Only A's rows match the where above; B's rows carry leaveApplicationId = B.
        txMock.substitution.findMany.mockResolvedValue([
          { id: 'gA1', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER },
          { id: 'gA2', date: new Date('2026-07-22'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null },
        ]);
        txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: 'u-kavya' }]);
        txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Asha', lastName: 'Rao' });
        txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }, { id: 'u-head2', email: 'h2@x' }]);

        await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['gA1', 'gA2'] }, schoolId: SCHOOL } });
        const rows = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data);
        expect(rows).toContainEqual(expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-kavya', payload: expect.objectContaining({ substitutionId: 'gA1', className: '9-A', why: 'LEAVE_CANCELLED' }) }));
        // The admin who cancelled is not told what they just did; the other desk member is.
        expect(rows.filter((r) => r.kind === 'LEAVE_CANCELLED').map((r) => r.targetUserId)).toEqual(['u-head2']);
        expect(rows.find((r) => r.kind === 'LEAVE_CANCELLED').payload).toMatchObject({ teacherName: 'Asha Rao', releasedCovers: 1 });
      });
```

In `describe('cancel', …)` add:

```ts
    it('withdrawing a PENDING request tells the desk, which was holding Approve buttons for it', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: true });
      txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
      await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'TEACHER');
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data)).toEqual([
        expect.objectContaining({ kind: 'LEAVE_CANCELLED', targetUserId: ADMIN_USER, payload: expect.objectContaining({ releasedCovers: 0 }) }),
      ]);
    });
```

Replace `describe('clear', …)` with:

```ts
  describe('clear', () => {
    it('nulls the substitute and the "seen", and tells the teacher who was covering', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER });
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: null });
      txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: 'u-kavya' }]);

      const result = await svc.clear(SCHOOL, SUB_ID);

      expect(txMock.substitution.update).toHaveBeenCalledWith({ where: { id: SUB_ID }, data: { substituteTeacherId: null, acknowledgedAt: null } });
      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-kavya', payload: expect.objectContaining({ why: 'CHANGED' }) }) });
      expect(result.substituteTeacherId).toBeNull();
    });

    it('clearing an empty gap tells nobody', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null });
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: null });
      await svc.clear(SCHOOL, SUB_ID);
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });
  });
```

In `describe('assign', …)` add:

```ts
    it('giving the period to someone else tells the one it was taken from', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...gap, substituteTeacherId: 't-ramesh' });
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
      txMock.teacher.findMany.mockResolvedValue([{ id: 't-ramesh', userId: 'u-ramesh' }]);
      await svc.assign(SCHOOL, SUB_ID, dto);
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data)).toContainEqual(expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-ramesh', payload: expect.objectContaining({ why: 'CHANGED' }) }));
    });
```

In `describe('only the classes that would really be empty', …)` (Task 3) add:

```ts
      it('a substitute who goes on leave: their covers those days reopen, they are told, the desk is nudged', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        txMock.substitution.findMany.mockResolvedValue([{ id: 'cover-1', date: new Date('2026-11-11'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER }]);
        txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
        txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, userId: TEACHER_USER }]);
        txMock.teacher.findFirst.mockResolvedValue({ userId: TEACHER_USER, firstName: 'Asha', lastName: 'Rao' });
        txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);

        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

        expect(txMock.substitution.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, substituteTeacherId: TEACHER, date: { in: [new Date('2026-11-11')] } });
        expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['cover-1'] }, schoolId: SCHOOL, substituteTeacherId: TEACHER }, data: { substituteTeacherId: null, acknowledgedAt: null } });
        const kinds = txMock.notificationOutbox.create.mock.calls.map((c) => [c[0].data.kind, c[0].data.targetUserId]);
        expect(kinds).toContainEqual(['COVER_CANCELLED', TEACHER_USER]);
        expect(kinds).toContainEqual(['COVER_UNFILLED', ADMIN_USER]);
      });
```

In `leave-staff.spec.ts` add `substitution.findMany: jest.fn().mockResolvedValue([])` to its txMock and change `'does not unwind substitutions for a staff cancellation'` to assert `expect(txMock.substitution.findMany).not.toHaveBeenCalled();` as well.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/leave`
Expected: FAIL — cancel still deletes by teacher+date; nobody is told.

- [ ] **Step 3: Implement the notice helpers**

In `leave.service.ts` import `resolveLeaveDeskRecipients` (already, from Tier 1a) and `type CoverCancelledPayload` from `'../../common/notifications/notification.types'`. Add in the notices section:

```ts
  /** "Mon 22 Sep 2026, Period 3 (10:15–11:00)" and "9-A" for each gap — two queries, not one per gap. */
  private static async describeGaps(tx: TenantTx, schoolId: string, subs: { id: string; date: Date; periodId: string; classSectionId: string }[]) {
    const [periods, sections] = await Promise.all([
      tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(subs.map((s) => s.periodId))] } }, select: { id: true, label: true, startTime: true, endTime: true } }),
      tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(subs.map((s) => s.classSectionId))] } }, select: { id: true, name: true, grade: { select: { name: true } } } }),
    ]);
    const periodOf = new Map(periods.map((p) => [p.id, p]));
    const sectionOf = new Map(sections.map((s) => [s.id, s]));
    return new Map(
      subs.map((s) => {
        const p = periodOf.get(s.periodId);
        const c = sectionOf.get(s.classSectionId);
        const day = LeaveService.datesLabel(toDateStr(s.date), toDateStr(s.date));
        return [s.id, { when: `${day}, ${p ? `${p.label} (${p.startTime}–${p.endTime})` : 'a period'}`, className: c ? `${c.grade.name}-${c.name}` : 'a class' }];
      }),
    );
  }

  /**
   * "Your cover is off" — one bell row and one outbox row per substitute who
   * HAD the cover. A gap nobody was covering tells nobody.
   */
  static async tellSubstitutes(
    tx: TenantTx,
    schoolId: string,
    subs: { id: string; date: Date; periodId: string; classSectionId: string; substituteTeacherId: string | null }[],
    why: CoverCancelledPayload['why'],
  ): Promise<void> {
    const covered = subs.filter((s) => s.substituteTeacherId);
    if (covered.length === 0) return;
    const [school, teachers, described] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(covered.map((s) => s.substituteTeacherId!))] } }, select: { id: true, userId: true } }),
      LeaveService.describeGaps(tx, schoolId, covered),
    ]);
    const userOf = new Map(teachers.map((t) => [t.id, t.userId]));
    for (const s of covered) {
      const userId = userOf.get(s.substituteTeacherId!);
      const d = described.get(s.id);
      if (!userId || !d) continue;
      const payload = { schoolName: school?.name ?? 'Your school', substitutionId: s.id, when: d.when, className: d.className, why };
      await tx.notification.create({ data: { schoolId, userId, kind: 'COVER_ASSIGNED', title: `Cover called off: ${d.className}`, body: d.when, linkType: 'timetable', linkId: s.id } });
      await tx.notificationOutbox.create({ data: { schoolId, kind: 'COVER_CANCELLED', payload, targetUserId: userId } });
    }
  }

  /**
   * A notice to everyone who runs the leave desk (admins + accounts officers),
   * minus the person whose own action caused it. Bell kind LEAVE_APPLIED so
   * every client already has an icon and a link for it; the title says what
   * happened. Returns how many were told.
   */
  static async tellDesk(
    db: TenantTx,
    schoolId: string,
    n: { kind: 'LEAVE_CANCELLED' | 'COVER_UNFILLED'; payload: Record<string, string | number | null>; title: string; body: string; linkId: string | null; exceptUserId?: string | null },
  ): Promise<number> {
    const desk = (await resolveLeaveDeskRecipients(db, schoolId)).filter((d) => d.userId !== n.exceptUserId);
    for (const d of desk) {
      await db.notification.create({ data: { schoolId, userId: d.userId, kind: 'LEAVE_APPLIED', title: n.title, body: n.body, linkType: 'leave', linkId: n.linkId } });
      await db.notificationOutbox.create({ data: { schoolId, kind: n.kind, payload: n.payload, targetUserId: d.userId } });
    }
    return desk.length;
  }

  /**
   * A teacher going on leave cannot cover anyone else those days: their covers
   * (on the away half) reopen, they are told, and the desk is nudged.
   */
  private static async reopenCoversOf(
    tx: TenantTx,
    schoolId: string,
    teacherId: string,
    dates: string[],
    app: { halfDay?: boolean | null; halfDayPart?: string | null },
  ): Promise<number> {
    if (dates.length === 0) return 0;
    const covers = await tx.substitution.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, substituteTeacherId: teacherId, date: { in: dates.map((d) => new Date(d)) } },
      select: { id: true, date: true, periodId: true, classSectionId: true, substituteTeacherId: true },
    });
    if (covers.length === 0) return 0;
    const periods = await tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(covers.map((c) => c.periodId))] } }, select: { id: true, startTime: true } });
    const startOf = new Map(periods.map((p) => [p.id, p.startTime]));
    const away = covers.filter((c) => inHalf(app, startOf.get(c.periodId)));
    if (away.length === 0) return 0;
    await tx.substitution.updateMany({ where: { id: { in: away.map((c) => c.id) }, schoolId, substituteTeacherId: teacherId }, data: { substituteTeacherId: null, acknowledgedAt: null } });
    await LeaveService.tellSubstitutes(tx, schoolId, away, 'TEACHER_ON_LEAVE');
    return away.length;
  }
```

- [ ] **Step 4: Wire them in**

`approve` — after the gap loop and before `tellTeacherDecided`:

```ts
      // A teacher who was covering someone else on these days cannot now.
      const reopened = teacherId ? await LeaveService.reopenCoversOf(tx, schoolId, teacherId, dates, app) : 0;
      if (reopened > 0) {
        const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });
        const who = await tx.teacher.findFirst({ where: { id: teacherId!, schoolId }, select: { firstName: true, lastName: true } });
        const name = who ? `${who.firstName} ${who.lastName ?? ''}`.trim() : 'A teacher';
        await LeaveService.tellDesk(tx, schoolId, {
          kind: 'COVER_UNFILLED',
          payload: { schoolName: school?.name ?? 'Your school', gaps: reopened, forDate: dates[0], forWhen: LeaveService.datesLabel(dates[0], dates[dates.length - 1]), note: `${name} is on leave, so ${reopened} of their covers reopened.` },
          title: `${reopened} cover${reopened === 1 ? '' : 's'} reopened`,
          body: `${name} is on leave`,
          linkId: app.id,
          // The approver too: approving a leave does not tell them the teacher was covering for others.
        });
      }
```

`cancel` — wrap in `const out = await withTenant(...)` / `requestOutboxDrain(); return out;`. Replace the PENDING branch with:

```ts
      if (app.status === 'PENDING') {
        await tx.leaveApplication.update({ where: { id }, data: { status: 'CANCELLED' } });
        await LeaveService.tellDeskCancelled(tx, schoolId, app, 0, callerUserId);
        return { status: 'CANCELLED' as const, restoredDates: 0 };
      }
```

and replace the APPROVED loop (from `const cancelTeacherId = app.teacherId;` to just before the final `update`) with:

```ts
      // Only THIS leave's gaps — a second leave overlapping these dates keeps
      // its own. Gaps from before leaveApplicationId existed (NULL) fall back to
      // the old teacher-and-date rule.
      const cancelTeacherId = app.teacherId;
      let released = 0;
      if (cancelTeacherId && dates.length > 0) {
        const gaps = await tx.substitution.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: {
            schoolId,
            date: { in: dates.map((d) => new Date(d)) },
            OR: [{ leaveApplicationId: id }, { leaveApplicationId: null, originalTeacherId: cancelTeacherId }],
          },
          select: { id: true, date: true, periodId: true, classSectionId: true, substituteTeacherId: true },
        });
        await LeaveService.tellSubstitutes(tx, schoolId, gaps, 'LEAVE_CANCELLED');
        released = gaps.filter((g) => g.substituteTeacherId).length;
        if (gaps.length > 0) await tx.substitution.deleteMany({ where: { id: { in: gaps.map((g) => g.id) }, schoolId } });
        for (const dateStr of dates) {
          const date = new Date(dateStr);
          const mark = await tx.staffAttendance.findFirst({ where: { schoolId, teacherId: cancelTeacherId, date } });
          if (mark && mark.status === 'ON_LEAVE') await tx.staffAttendance.delete({ where: { id: mark.id } });
        }
      }

      await tx.leaveApplication.update({ where: { id }, data: { status: 'CANCELLED' } });
      await LeaveService.tellDeskCancelled(tx, schoolId, app, released, callerUserId);
      return { status: 'CANCELLED' as const, restoredDates: dates.length };
```

Add the helper:

```ts
  private static async tellDeskCancelled(
    tx: TenantTx,
    schoolId: string,
    app: { id: string; teacherId: string | null; staffId: string | null; startDate: Date; endDate: Date },
    releasedCovers: number,
    exceptUserId: string,
  ): Promise<void> {
    const [school, who] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      app.teacherId
        ? tx.teacher.findFirst({ where: { id: app.teacherId, schoolId }, select: { firstName: true, lastName: true } })
        : tx.staff.findFirst({ where: { id: app.staffId!, schoolId }, select: { firstName: true, lastName: true } }),
    ]);
    const teacherName = who ? `${who.firstName} ${who.lastName ?? ''}`.trim() : 'A colleague';
    const dates = LeaveService.datesLabel(toDateStr(app.startDate), toDateStr(app.endDate));
    await LeaveService.tellDesk(tx, schoolId, {
      kind: 'LEAVE_CANCELLED',
      payload: { schoolName: school?.name ?? 'Your school', leaveId: app.id, teacherName, dates, releasedCovers },
      title: `${teacherName} withdrew their leave`,
      body: dates,
      linkId: app.id,
      exceptUserId,
    });
  }
```

`clear` — replace with:

```ts
  async clear(schoolId: string, id: string) {
    const out = await withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');
      const updated = await tx.substitution.update({ where: { id }, data: { substituteTeacherId: null, acknowledgedAt: null } });
      await LeaveService.tellSubstitutes(tx, schoolId, [sub], 'CHANGED');
      return updated;
    });
    requestOutboxDrain();
    return out;
  }
```

`assign` — right after the `freeTeachersFor` check, before the `update`:

```ts
      // Taking the period from one teacher to give it to another: tell the first.
      if (sub.substituteTeacherId && sub.substituteTeacherId !== dto.substituteTeacherId) {
        await LeaveService.tellSubstitutes(tx, schoolId, [sub], 'CHANGED');
      }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management src/common/notifications/outbox-writers.guard.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/management/leave-staff.spec.ts
git commit -m "feat(leave): cancel removes only that leave's gaps and tells its substitutes and the desk; clear and reassign tell the teacher; a substitute's own leave reopens their covers"
```

---

### Task 8: "Got it" and "Can't"

**Files:**
- Modify: `apps/api/src/common/errors/api-error.ts` (+ `NOT_THE_SUBSTITUTE`)
- Modify: `apps/api/src/common/notifications/whatsapp/actions.ts` (+ `cant`)
- Modify: `apps/api/src/common/notifications/whatsapp/actions.spec.ts`
- Modify: `apps/api/src/common/notifications/notification.types.ts` (`CoverAssignedPayload.cantPayload`)
- Modify: `apps/api/src/common/notifications/whatsapp/templates.ts` (COVER_ASSIGNED → v2 with v1 fallback)
- Modify: `apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts`
- Modify: `apps/api/src/modules/management/notification-outbox.service.ts` (`toNotificationMessage` COVER_ASSIGNED)
- Modify: `apps/api/src/modules/management/leave.service.ts` (`acknowledge`, `decline`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.ts` (`onAck`, new `onCant`, expiry rule)
- Modify: `apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts`

**Interfaces:**
- Produces: `Action` gains `{ kind: 'cant'; substitutionId: string }`; `cantPayload(substitutionId, keys, now?)` (body `cn:<subId>`); `LeaveService.acknowledge(schoolId, substitutionId, teacherUserId): Promise<{ acknowledgedAt: Date }>`; `LeaveService.decline(schoolId, substitutionId, teacherUserId): Promise<{ declined: true }>`; `COVER_ASSIGNED_V1 = 'sckools_cover_assigned'`; `TEMPLATE_NAMES.COVER_ASSIGNED = 'sckools_cover_assigned_v2'`.

- [ ] **Step 1: Write the failing tests**

Append to `actions.spec.ts` (import `cantPayload`):

```ts
describe("the Can't button", () => {
  const keys = { sign: 'k', verify: ['k'], legacy: null };
  it('round-trips as its own action', () => {
    expect(parseAction(cantPayload('sub-1', keys), keys)).toEqual({ ok: true, action: { kind: 'cant', substitutionId: 'sub-1' } });
  });
  it('expires like every other button', () => {
    const old = cantPayload('sub-1', keys, Date.now() - ACTION_TTL_MS - 60_000);
    expect(parseAction(old, keys)).toMatchObject({ ok: false, why: 'expired', action: { kind: 'cant' } });
  });
});
```

(add `ACTION_TTL_MS` and `parseAction` to the spec's import if missing.)

In `whatsapp.spec.ts`: add `cantPayload: 'cn:s1:sig'` to `MESSAGES.COVER_ASSIGNED.payload`, import `COVER_ASSIGNED_V1`, and replace

```ts
    expect(templateFor(MESSAGES.COVER_ASSIGNED).buttons).toEqual([{ type: 'quick_reply', index: 0, payload: 'ca:s1:sig' }]);
```

with

```ts
    const cover = templateFor(MESSAGES.COVER_ASSIGNED);
    expect(cover.name).toBe('sckools_cover_assigned_v2');
    expect(cover.buttons).toEqual([{ type: 'quick_reply', index: 0, payload: 'ca:s1:sig' }, { type: 'quick_reply', index: 1, payload: 'cn:s1:sig' }]);
    // Until Meta approves v2, the approved v1 goes: same words, Got it only.
    expect(cover.fallback).toEqual({ name: 'sckools_cover_assigned', language: 'en', params: cover.params, buttons: [{ type: 'quick_reply', index: 0, payload: 'ca:s1:sig' }] });
```

and in the Tier 1a test `'v2 of the cover card takes the same parameters as v1, so v1 is a true fallback'` replace `SUBMISSIONS.COVER_ASSIGNED.body` with `byName.get(COVER_ASSIGNED_V1)!.body`.

In `leave.service.spec.ts` append:

```ts
describe('the substitute answers', () => {
  const svc = new LeaveService();
  const SUBST_USER = 'u-kavya';
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: OTHER_TEACHER, firstName: 'Kavya', lastName: 'Rao' });
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
    txMock.staff.findMany.mockResolvedValue([]);
  });

  it('Got it stamps acknowledgedAt once; a second tap keeps the first time', async () => {
    txMock.substitution.findFirst.mockResolvedValueOnce({ acknowledgedAt: null });
    txMock.substitution.update.mockResolvedValue({});
    const r = await svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER);
    expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER }, select: { acknowledgedAt: true } });
    expect(txMock.substitution.update).toHaveBeenCalledWith({ where: { id: SUB_ID }, data: { acknowledgedAt: r.acknowledgedAt } });
    const first = new Date('2026-10-12T02:40:00Z');
    txMock.substitution.findFirst.mockResolvedValueOnce({ acknowledgedAt: first });
    txMock.substitution.update.mockClear();
    expect(await svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER)).toEqual({ acknowledgedAt: first });
    expect(txMock.substitution.update).not.toHaveBeenCalled();
  });

  it("Can't reopens the gap and tells the desk which class, when, and who", async () => {
    txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
    txMock.substitution.findFirst.mockResolvedValue({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-10-12'), periodId: PERIOD, classSectionId: CLASS_SECTION });
    txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'A', grade: { name: '9' } }]);
    txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period 3', startTime: '10:15', endTime: '11:00' }]);
    await svc.decline(SCHOOL, SUB_ID, SUBST_USER);
    expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER }, data: { substituteTeacherId: null, acknowledgedAt: null } });
    expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'COVER_UNFILLED', targetUserId: ADMIN_USER, payload: expect.objectContaining({ gaps: 1, forDate: '2026-10-12', note: "Kavya Rao can't take 9-A, Mon 12 Oct 2026, Period 3 (10:15–11:00)." }) }) });
  });

  it("Can't after the desk already gave the period to someone else changes nothing", async () => {
    txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.decline(SCHOOL, SUB_ID, SUBST_USER)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });
    expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('a login that is not a teacher here cannot answer for a cover', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    await expect(svc.acknowledge(SCHOOL, SUB_ID, 'u-stranger')).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });
  });
});
```

In `whatsapp-actions.service.spec.ts`: add `acknowledge: jest.fn().mockResolvedValue({ acknowledgedAt: new Date() }), decline: jest.fn().mockResolvedValue({ declined: true })` to the `leave` mock, import `cantPayload`, and add:

```ts
  it('Got it records the acknowledgement through LeaveService, as the substitute', async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys()), 'wamid.ack'))).toBe('acked');
    expect(leave.acknowledge).toHaveBeenCalledWith(SCHOOL, SUB, 'u-ta');
    expect(sentTexts()).toEqual(['Noted.']);
  });

  it("Can't clears the cover and says the office will find someone", async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    expect(await svc().handleInbound(tap(cantPayload(SUB, actionKeys()), 'wamid.cant'))).toBe('declined');
    expect(leave.decline).toHaveBeenCalledWith(SCHOOL, SUB, 'u-ta');
    expect(sentTexts()).toEqual(['Okay — the office will find someone else.']);
  });

  it("Can't from anyone but the substitute is recorded and not answered", async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: false, why: 'NOT_ALLOWED' });
    expect(await svc().handleInbound(tap(cantPayload(SUB, actionKeys()), 'wamid.cant2'))).toBe('cant-not-substitute');
    expect(leave.decline).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual([]);
  });

  it("Can't on a cover that has already moved says so and changes nothing", async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    leave.decline.mockRejectedValueOnce(new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours, so nothing changed.', 409));
    expect(await svc().handleInbound(tap(cantPayload(SUB, actionKeys()), 'wamid.cant3'))).toBe('cover-moved');
    expect(sentTexts()).toEqual(['This cover has already changed, so nothing was done.']);
  });

  it("an expired Can't is recorded and not answered, like an expired Got it", async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL });
    const old = cantPayload(SUB, actionKeys(), Date.now() - ACTION_TTL_MS - 3_600_000);
    expect(await svc().handleInbound(tap(old, 'wamid.oldcant'))).toBe('expired');
    expect(sentTexts()).toEqual([]);
  });
```

and change the Tier 1a ack test's `'acked'` reply expectation (it asserts nothing about text) — leave it.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/common/notifications/whatsapp src/modules/management/leave.service.spec.ts src/modules/whatsapp`
Expected: FAIL — no `cantPayload`, no `acknowledge`/`decline`, v1 template.

- [ ] **Step 3: Implement the grammar and the template**

`actions.ts`: update the header comment's body list to `lv:a:<leaveId> | lv:r:<leaveId> | cv:<subId>:<teacherId|skip> | ca:<subId> | cn:<subId>`; extend `Action` with `| { kind: 'cant'; substitutionId: string }`; add

```ts
/** The substitute's "Can't" — the cover goes back to the desk. */
export const cantPayload = (substitutionId: string, keys: Pick<ActionKeys, 'sign'>, now = Date.now()) => seal(`cn:${substitutionId}`, keys, now);
```

and in `shape()` before `return null;`:

```ts
  if (parts[0] === 'cn' && parts.length === 2 && parts[1]) return { kind: 'cant', substitutionId: parts[1] };
```

`notification.types.ts`: `CoverAssignedPayload` gains `cantPayload: string;` (after `ackPayload`).

`notification-outbox.service.ts` COVER_ASSIGNED case: import `cantPayload` and return `{ kind: 'COVER_ASSIGNED', payload: { ...p, ackPayload: ackPayload(p.substitutionId, keys), cantPayload: cantPayload(p.substitutionId, keys) } }`.

`templates.ts`:
- `TEMPLATE_NAMES.COVER_ASSIGNED` → `` `${TEMPLATE_PREFIX}cover_assigned_v2` `` (comment: "Got it · Can't. Until Meta approves it, `fallback` sends the approved v1.").
- Next to `COVER_ASSIGNED_V2` add `export const COVER_ASSIGNED_V1 = \`${TEMPLATE_PREFIX}cover_assigned\`;`.
- `SUBMISSIONS.COVER_ASSIGNED` becomes the v2 body: move the `[COVER_ASSIGNED_V2]` entry's text into a constant `COVER_ASSIGNED_V2_BODY` declared above `SUBMISSIONS` (`{ body, samples, buttons: ['Got it', "Can't"] }`), use it for both `SUBMISSIONS.COVER_ASSIGNED` and `EXTRA_SUBMISSIONS[COVER_ASSIGNED_V2]` (`{ category: 'UTILITY', ...COVER_ASSIGNED_V2_BODY }`), and add the old v1 text to `EXTRA_SUBMISSIONS`:

```ts
  [COVER_ASSIGNED_V1]: {
    category: 'UTILITY',
    body: 'A cover duty at {{1}}. On {{2}} you are covering class {{3}} for {{4}}, in place of {{5}}. Tap below to confirm you have seen this.',
    samples: ['Raffles Public School', 'Mon 22 Sep, period 3 (10:15–11:00)', '9-A', 'Mathematics', 'Priya Nair'],
    buttons: ['Got it'],
  },
```

- `templateFor` COVER_ASSIGNED case becomes:

```ts
    case 'COVER_ASSIGNED': {
      const p = message.payload;
      const params = [param(p.schoolName), param(p.when), param(p.className), param(p.subjectName, 'the class'), param(p.originalTeacherName)];
      const gotIt: TemplateButton = { type: 'quick_reply', index: 0, payload: p.ackPayload };
      return {
        name, language, params,
        buttons: [gotIt, { type: 'quick_reply', index: 1, payload: p.cantPayload }],
        // Meta reviews a new template for hours or days; until then the approved v1 card goes.
        fallback: { name: COVER_ASSIGNED_V1, language, params, buttons: [gotIt] },
      };
    }
```

- [ ] **Step 4: Implement the service methods**

`api-error.ts`: add `/** The caller is not (or no longer) the substitute on this cover — pair with 403/409. */ | 'NOT_THE_SUBSTITUTE'`.

`leave.service.ts`:

```ts
  /** The covering teacher, by login — or a refusal that names no one else. */
  private static async substituteOf(tx: TenantTx, schoolId: string, userId: string) {
    const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true, firstName: true, lastName: true } });
    if (!teacher) throw new ApiError('NOT_THE_SUBSTITUTE', 'Only the teacher covering this period can answer for it.', 403);
    return teacher;
  }

  /** "Got it" — the first tap's time is kept. */
  async acknowledge(schoolId: string, substitutionId: string, teacherUserId: string): Promise<{ acknowledgedAt: Date }> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await LeaveService.substituteOf(tx, schoolId, teacherUserId);
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id }, select: { acknowledgedAt: true } });
      if (!sub) throw new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours.', 409);
      if (sub.acknowledgedAt) return { acknowledgedAt: sub.acknowledgedAt };
      const acknowledgedAt = new Date();
      await tx.substitution.update({ where: { id: substitutionId }, data: { acknowledgedAt } });
      return { acknowledgedAt };
    });
  }

  /**
   * "Can't" — the cover goes back to the desk, which is told at once. Matches
   * only while the period is still this teacher's: a Can't tapped after the
   * desk gave it to someone else changes nothing.
   */
  async decline(schoolId: string, substitutionId: string, teacherUserId: string): Promise<{ declined: true }> {
    const out = await withTenant(schoolId, async (tx) => {
      const teacher = await LeaveService.substituteOf(tx, schoolId, teacherUserId);
      const { count } = await tx.substitution.updateMany({
        where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id },
        data: { substituteTeacherId: null, acknowledgedAt: null },
      });
      if (count === 0) throw new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours, so nothing changed.', 409);
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId }, select: { id: true, date: true, periodId: true, classSectionId: true } });
      if (!sub) return { declined: true as const };
      const [school, described] = await Promise.all([
        tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        LeaveService.describeGaps(tx, schoolId, [sub]),
      ]);
      const d = described.get(sub.id)!;
      const name = `${teacher.firstName} ${teacher.lastName ?? ''}`.trim();
      const day = toDateStr(sub.date);
      await LeaveService.tellDesk(tx, schoolId, {
        kind: 'COVER_UNFILLED',
        payload: { schoolName: school?.name ?? 'Your school', gaps: 1, forDate: day, forWhen: LeaveService.datesLabel(day, day), note: `${name} can't take ${d.className}, ${d.when}.` },
        title: `${name} can't cover ${d.className}`,
        body: d.when,
        linkId: null,
      });
      return { declined: true as const };
    });
    requestOutboxDrain();
    return out;
  }
```

- [ ] **Step 5: Implement the WhatsApp side**

In `whatsapp-actions.service.ts`:
- `act()`: add `if (action.kind === 'cant') return this.onCant(db, action, phone);` before the `onAck` return.
- In `handleInbound`, change the expired-reply condition to `if (schoolId && parsed.action.kind !== 'ack' && parsed.action.kind !== 'cant')` and its comment to "An expired Got it / Can't is recorded and NOT answered: a substitute has nothing to decide in the console."
- Replace `onAck` and add `onCant`:

```ts
  private async onAck(db: Db, a: Extract<Action, { kind: 'ack' }>, phone: string) {
    const sub = await db.substitution.findUnique({ where: { id: a.substitutionId }, select: { schoolId: true, substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return { result: 'gap-not-found', schoolId: sub?.schoolId ?? null };
    const who = await this.identity.actorFor(phone, sub.schoolId, { kind: 'SUBSTITUTE', substitutionId: a.substitutionId });
    if (!who.ok) return { result: 'ack-not-substitute', schoolId: sub.schoolId };
    await this.leave.acknowledge(sub.schoolId, a.substitutionId, who.profile.userId);
    await this.text(sub.schoolId, phone, 'Noted.');
    return { result: 'acked', schoolId: sub.schoolId };
  }

  private async onCant(db: Db, a: Extract<Action, { kind: 'cant' }>, phone: string) {
    const sub = await db.substitution.findUnique({ where: { id: a.substitutionId }, select: { schoolId: true, substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return { result: 'gap-not-found', schoolId: sub?.schoolId ?? null };
    // Silent to anyone but the substitute.
    const who = await this.identity.actorFor(phone, sub.schoolId, { kind: 'SUBSTITUTE', substitutionId: a.substitutionId });
    if (!who.ok) return { result: 'cant-not-substitute', schoolId: sub.schoolId };
    try {
      await this.leave.decline(sub.schoolId, a.substitutionId, who.profile.userId);
    } catch (e) {
      if (apiCode(e) === 'NOT_THE_SUBSTITUTE') {
        await this.text(sub.schoolId, phone, 'This cover has already changed, so nothing was done.');
        return { result: 'cover-moved', schoolId: sub.schoolId };
      }
      throw e;
    }
    await this.text(sub.schoolId, phone, 'Okay — the office will find someone else.');
    return { result: 'declined', schoolId: sub.schoolId };
  }
```

Note `onAck` now acts AFTER identity even when the gap's substitute later changed: `acknowledge` throws `NOT_THE_SUBSTITUTE` (a 4xx), which `handleInbound` records as `error:` — no reply, as before.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/common src/modules/management src/modules/whatsapp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/errors/api-error.ts apps/api/src/common/notifications/whatsapp/actions.ts apps/api/src/common/notifications/whatsapp/actions.spec.ts apps/api/src/common/notifications/notification.types.ts apps/api/src/common/notifications/whatsapp/templates.ts apps/api/src/common/notifications/whatsapp/whatsapp.spec.ts apps/api/src/modules/management/notification-outbox.service.ts apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.ts apps/api/src/modules/whatsapp/whatsapp-actions.service.spec.ts
git commit -m "feat(leave): a substitute answers Got it or Can't — Can't hands the period back to the desk at once (cover_assigned_v2, v1 until approved)"
```

---

### Task 9: The console's Coverage tab asks the server who is free, and shows who has seen it

**Files:**
- Modify: `apps/api/src/modules/management/leave.service.ts` (`coverage` returns `acknowledgedAt`)
- Modify: `apps/api/src/modules/management/leave.service.spec.ts`
- Modify: `apps/web/app/app/leave/page.tsx`
- Create: `apps/web/app/app/leave/cover-picker.test.tsx`

**Interfaces:**
- Consumes: `GET /manage/substitution/:id/candidates` → `CoverCandidate[]` (Task 4).
- Produces: coverage rows gain `acknowledgedAt: string | null` (ISO over the wire).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('LeaveService', …)` of `leave.service.spec.ts`:

```ts
  describe('coverage', () => {
    it('says whether each substitute has seen their cover', async () => {
      const seen = new Date('2026-10-05T02:40:00Z');
      txMock.substitution.findMany.mockResolvedValue([{ id: SUB_ID, date: new Date('2026-10-05'), classSectionId: CLASS_SECTION, periodId: PERIOD, originalTeacherId: TEACHER, substituteTeacherId: OTHER_TEACHER, acknowledgedAt: seen }]);
      txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'B', grade: { name: 'VII' } }]);
      txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period I', order: 1 }]);
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }, { id: OTHER_TEACHER, firstName: 'Kavya', lastName: 'Rao' }]);
      const [row] = await svc.coverage(SCHOOL, '2026-10-05', '2026-10-05');
      expect(row).toMatchObject({ substituteTeacherName: 'Kavya Rao', acknowledgedAt: seen });
    });
  });
```

Create `apps/web/app/app/leave/cover-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AdminLeavePage from './page';

/**
 * WHO IS FREE IS THE SERVER'S ANSWER, NOT THE PAGE'S.
 *
 * The page used to build its own busySet from the whole week's timetable and
 * offered teachers who were on leave that day. It now asks
 * /manage/substitution/:id/candidates — freeTeachersFor, the same answer the
 * WhatsApp list and assign() use — and only for the gap being picked.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GAPS = [
  { id: 'g1', date: '2026-10-05', classSectionId: 'c1', classSectionName: 'VII-B', periodId: 'per1', periodLabel: 'Period I', originalTeacherName: 'Asha Rao', substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null },
  { id: 'g2', date: '2026-10-05', classSectionId: 'c2', classSectionName: 'VIII-A', periodId: 'per2', periodLabel: 'Period II', originalTeacherName: 'Asha Rao', substituteTeacherId: 't9', substituteTeacherName: 'Kavya Rao', acknowledgedAt: '2026-10-05T02:40:00.000Z' },
  { id: 'g3', date: '2026-10-05', classSectionId: 'c3', classSectionName: 'IX-C', periodId: 'per3', periodLabel: 'Period III', originalTeacherName: 'Asha Rao', substituteTeacherId: 't8', substituteTeacherName: 'Mohan Das', acknowledgedAt: null },
];

let api: ApiStub;
beforeEach(() => {
  vi.clearAllMocks();
  api = {
    get: vi.fn((path: string) => {
      if (path.startsWith('/manage/leave/coverage')) return Promise.resolve(GAPS);
      if (path === '/manage/substitution/g1/candidates') return Promise.resolve([
        { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
        { id: 'tb', name: 'Lata Iyer', teachesSubject: false, coversThatDay: 2 },
      ]);
      return Promise.resolve([]);
    }),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
});

const openCoverage = async () => {
  renderWithProviders(<AdminLeavePage />);
  fireEvent.click(await screen.findByRole('tab', { name: /coverage/i }));
  return screen.findByLabelText(/Substitute for VII-B/);
};

describe('the coverage picker', () => {
  it('asks the server who is free for THIS gap, only once someone opens it', async () => {
    const select = await openCoverage();
    expect(api.get).not.toHaveBeenCalledWith('/manage/substitution/g1/candidates');
    fireEvent.focus(select);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/manage/substitution/g1/candidates'));
    expect(await screen.findByRole('option', { name: 'Arun Mehta · teaches this subject' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Lata Iyer · 2 covers that day' })).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/manage/availability');
  });

  it('picking a teacher assigns them', async () => {
    const select = await openCoverage();
    fireEvent.focus(select);
    await screen.findByRole('option', { name: /Arun Mehta/ });
    fireEvent.change(select, { target: { value: 'ta' } });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/substitution/g1/assign', { substituteTeacherId: 'ta' }));
  });

  it('a covered class says whether the substitute has seen it', async () => {
    await openCoverage();
    expect(await screen.findByText(/Kavya Rao · seen 8:10\sam/i)).toBeTruthy();
    expect(screen.getByText('Mohan Das · not yet seen')).toBeTruthy();
  });

  it('the page has no free-teacher logic of its own', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/app/leave/page.tsx'), 'utf8');
    expect(page).not.toMatch(/busySet/);
    expect(page).not.toMatch(/\/manage\/availability/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/leave.service.spec.ts -t coverage && pnpm --filter @skoolos/web exec vitest run app/app/leave`
Expected: FAIL — `acknowledgedAt` missing; the page calls `/manage/availability` and has a `busySet`.

- [ ] **Step 3: Implement the API field**

In `LeaveService.coverage`, add `acknowledgedAt: r.acknowledgedAt,` to the mapped row (after `substituteTeacherName`).

- [ ] **Step 4: Implement the page**

In `apps/web/app/app/leave/page.tsx`:

1. Delete `AvailabilityTeacher`, `BusyEntry`, `AvailabilityResponse`, `isoWeekdayOf`, the `availability` query, `busySet` and `freeTeachersFor`; drop `useMemo` from the React import.
2. `CoverageGap` gains `acknowledgedAt: string | null;`. Add:

```tsx
/** What `GET /manage/substitution/:id/candidates` returns — freeTeachersFor, ranked. */
interface CoverCandidate {
  id: string;
  name: string;
  teachesSubject: boolean;
  coversThatDay: number;
}

/** "8:10 am", in the school's time. */
function seenAt(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * One gap's picker. It asks the server who is free — freeTeachersFor, the
 * same answer WhatsApp and assign() use — and only when somebody opens it, so
 * a week with forty gaps costs nothing until a gap is being filled.
 */
function CoverPicker({ gap, disabled, onPick }: { gap: CoverageGap; disabled: boolean; onPick: (teacherId: string) => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [open, setOpen] = useState(false);
  const candidates = useQuery({
    queryKey: ['a-cover-candidates', gap.id],
    enabled: !!host && open,
    queryFn: () => api.get<CoverCandidate[]>(`/manage/substitution/${gap.id}/candidates`),
  });
  const options = candidates.data ?? [];
  const keepCurrent = gap.substituteTeacherId && !options.some((c) => c.id === gap.substituteTeacherId);
  return (
    <select
      aria-label={`Substitute for ${gap.classSectionName}, ${gap.periodLabel}, ${formatDate(gap.date)}`}
      style={fieldStyle}
      onFocus={(e) => {
        ringFocus(e);
        setOpen(true);
      }}
      onMouseDown={() => setOpen(true)}
      onBlur={ringBlur}
      value={gap.substituteTeacherId ?? ''}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">
        {open && candidates.isLoading ? 'Finding who is free…' : candidates.isError ? 'Could not load — try again' : 'Pick a free teacher…'}
      </option>
      {/* The current substitute stays selectable even if a later change made them busy. */}
      {keepCurrent ? <option value={gap.substituteTeacherId!}>{gap.substituteTeacherName ?? 'Assigned teacher'}</option> : null}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.teachesSubject ? ' · teaches this subject' : c.coversThatDay > 0 ? ` · ${c.coversThatDay} cover${c.coversThatDay === 1 ? '' : 's'} that day` : ''}
        </option>
      ))}
    </select>
  );
}
```

3. In the coverage `gaps.map`, delete the `free` / `options` computation and replace the whole `<select …>…</select>` with:

```tsx
                  <CoverPicker
                    gap={gap}
                    disabled={assign.isPending}
                    onPick={(substituteTeacherId) => assign.mutate({ gapId: gap.id, substituteTeacherId })}
                  />
```

4. In `.cov-info`, after `<div className="meta">{gap.originalTeacherName} (on leave)</div>` add:

```tsx
                    {covered ? (
                      <div className="meta">
                        {gap.substituteTeacherName} · {gap.acknowledgedAt ? `seen ${seenAt(gap.acknowledgedAt)}` : 'not yet seen'}
                      </div>
                    ) : null}
```

5. In `assign`'s and `clear`'s `onSuccess`, also `void qc.invalidateQueries({ queryKey: ['a-cover-candidates'] });` (a pick changes who is free for every other gap that period).

- [ ] **Step 5: Run the tests and look at it**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management src/modules/management/free-teachers.guard.spec.ts && pnpm --filter @skoolos/web exec vitest run app/app/leave app/sk-theme.test.ts app/shell-alignment.test.ts`
Expected: PASS — including the busySet case of `free-teachers.guard.spec.ts` left red in Task 5.

Then run the web app against staging data (`pnpm --filter @skoolos/web dev`, log in as the Ladwa admin, open Leave → Coverage) at 1280 px and 360 px: the picker opens with "Finding who is free…", then names; the seen line sits under the on-leave line in the same `.meta` style; nothing scrolls sideways at 360 px.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/management/leave.service.ts apps/api/src/modules/management/leave.service.spec.ts apps/web/app/app/leave/page.tsx apps/web/app/app/leave/cover-picker.test.tsx
git commit -m "feat(web): the coverage picker asks the server who is free for that gap, and each cover shows whether its teacher has seen it"
```

---

### Task 10: The accounts officer's desk in the app gains Coverage

**Files:**
- Modify: `apps/mobile/src/app/(worker)/(tabs)/leavedesk/index.tsx`
- Create: `apps/mobile/src/app/(worker)/__tests__/leavedesk.test.tsx`

**Interfaces:**
- Consumes: `GET /manage/leave/coverage?from&to` (rows with `acknowledgedAt`), `GET /manage/substitution/:id/candidates`, `POST /manage/substitution/:id/assign`, `POST /manage/substitution/:id/clear` — all open to the officer since Task 4.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/app/(worker)/__tests__/leavedesk.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LeaveDesk from '../(tabs)/leavedesk/index';
import { api } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const routes: Record<string, unknown> = {};
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  for (const k of Object.keys(routes)) delete routes[k];
  routes['/manage/leave'] = [];
  routes['/manage/leave/coverage'] = [
    { id: 'g1', date: '2026-10-07T00:00:00.000Z', classSectionId: 'c1', classSectionName: 'Grade 7 — B', periodId: 'p1', periodLabel: 'Period I', originalTeacherName: 'Asha Rao', substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null },
    { id: 'g2', date: '2026-10-07T00:00:00.000Z', classSectionId: 'c2', classSectionName: 'Grade 8 — A', periodId: 'p2', periodLabel: 'Period II', originalTeacherName: 'Asha Rao', substituteTeacherId: 't9', substituteTeacherName: 'Kavya Rao', acknowledgedAt: '2026-10-07T02:40:00.000Z' },
  ];
  routes['/manage/substitution/g1/candidates'] = [{ id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 }];
  (api.request as jest.Mock).mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return {};
    const key = path.split('?')[0];
    if (key in routes) return routes[key];
    throw new Error(`unmocked ${path}`);
  });
});

describe("the accounts officer's leave desk", () => {
  it('Coverage lists the week\'s gaps, and a pick assigns a teacher the server says is free', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText('Grade 7 — B · Period I')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pick-g1'));
    fireEvent.press(await screen.findByTestId('candidate-g1-ta'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/substitution/g1/assign', { method: 'POST', body: { substituteTeacherId: 'ta' } }));
  });

  it('a covered class says who, and whether they have seen it', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText(/Kavya Rao · seen 8:10\sam/i)).toBeTruthy();
  });

  it('the coverage window starts today and spans a week', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    await screen.findByText('Grade 7 — B · Period I');
    const asked = (api.request as jest.Mock).mock.calls.map((c) => c[0] as string).find((p) => p.startsWith('/manage/leave/coverage'))!;
    expect(asked).toMatch(/^\/manage\/leave\/coverage\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @skoolos/mobile exec jest "src/app/\(worker\)/__tests__/leavedesk.test.tsx"`
Expected: FAIL — no `leavedesk-view-coverage`.

- [ ] **Step 3: Implement**

Replace the whole of `apps/mobile/src/app/(worker)/(tabs)/leavedesk/index.tsx` with:

```tsx
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { invalidate, useQuery } from '@/lib/query';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { SegmentedField } from '@/components/Field';
import { Button, Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

interface LeaveRow {
  id: string;
  teacherName: string;
  personKind?: 'TEACHER' | 'STAFF';
  type: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
}

interface GapRow {
  id: string;
  date: string;
  classSectionName: string;
  periodLabel: string;
  originalTeacherName: string;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  acknowledgedAt: string | null;
}

/** What `GET /manage/substitution/:id/candidates` returns — freeTeachersFor, ranked. */
interface Candidate {
  id: string;
  name: string;
  teachesSubject: boolean;
  coversThatDay: number;
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (r: LeaveRow) =>
  r.halfDay ? `${day(r.startDate)} · half day`
    : r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? day(r.startDate)
      : `${day(r.startDate)} – ${day(r.endDate)}`;
/** "8:10 am", in the school's time. */
const seenAt = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toLowerCase().replace(/\s+/g, ' ');

/**
 * LEAVE, WAITING ON SOMEBODY.
 *
 * The one part of the accounts desk that genuinely belongs on a phone: a
 * decision, made in a corridor, that somebody is standing around waiting for.
 * Approving here is what stops the pay run being blocked on a person who is
 * not at their desk — pending leave is deliberately left out of the month, so
 * an undecided application quietly delays payroll.
 */
function Waiting() {
  const tokens = useTokens();
  const q = useQuery<LeaveRow[]>('/manage/leave?status=PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return <Empty icon="take">You do not have the right to decide leave.</Empty>;
  }
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingRows label="leave waiting" />;

  async function decide(id: string, what: 'approve' | 'reject') {
    setBusy(id); setError(null);
    try {
      await api.request(`/manage/leave/${id}/${what}`, { method: 'POST', body: {} });
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  const rows = q.data;
  return (
    <>
      <PageHeader title={rows.length === 0 ? 'Nothing waiting' : `${rows.length} waiting on you`} icon="take" />
      {rows.length === 0 ? (
        <Empty icon="take">
          No leave is waiting. Anything still undecided is left out of the month&apos;s pay, so this being
          empty is what keeps a pay run unblocked.
        </Empty>
      ) : (
        rows.map((r, i) => (
          <View key={r.id}>
            <Row
              first={i === 0}
              title={r.teacherName}
              sub={`${r.type} · ${span(r)}${r.reason ? ` · ${r.reason}` : ''}`}
              right={<Pill tone="amber">Pending</Pill>}
            />
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
              <Button label="Approve" small onPress={() => decide(r.id, 'approve')} disabled={busy === r.id} testID={`approve-${r.id}`} />
              <Button label="Reject" variant="ghost" small onPress={() => decide(r.id, 'reject')} disabled={busy === r.id} testID={`reject-${r.id}`} />
            </View>
          </View>
        ))
      )}
      {error ? (
        <Text style={{ paddingHorizontal: 12, paddingBottom: 10, fontFamily: font.sans, fontSize: 12, color: tokens.color.red }}>{error}</Text>
      ) : null}
    </>
  );
}

/**
 * COVERAGE — the classes the leave she approved left empty, this week.
 *
 * Who is free comes from the server (freeTeachersFor), one gap at a time, so
 * this screen, the console and WhatsApp can never offer different teachers.
 * A covered class says whether its teacher has tapped "Got it".
 */
function Coverage() {
  const tokens = useTokens();
  const from = todayISO();
  const q = useQuery<GapRow[]>(`/manage/leave/coverage?from=${from}&to=${shiftISO(from, 6)}`);
  const [picking, setPicking] = useState<string | null>(null);
  const cands = useQuery<Candidate[]>(picking ? `/manage/substitution/${picking}/candidates` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(gapId: string, what: 'assign' | 'clear', substituteTeacherId?: string) {
    setBusy(gapId); setError(null);
    try {
      await api.request(`/manage/substitution/${gapId}/${what}`, { method: 'POST', body: substituteTeacherId ? { substituteTeacherId } : {} });
      setPicking(null);
      // One pick changes who is free for every other gap that period.
      invalidate('/manage/substitution');
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingRows label="classes to cover" />;
  const gaps = q.data;
  const open = gaps.filter((g) => !g.substituteTeacherId).length;
  const note = (text: string, color: string) => <Text style={{ fontFamily: font.sans, fontSize: 12, color }}>{text}</Text>;

  return (
    <>
      <PageHeader title={open === 0 ? 'Every class has a teacher' : `${open} ${open === 1 ? 'class needs' : 'classes need'} a teacher`} icon="timetable" />
      {gaps.length === 0 ? (
        <Empty icon="timetable">No approved leave leaves a class empty this week.</Empty>
      ) : (
        gaps.map((g, i) => (
          <View key={g.id}>
            <Row
              first={i === 0}
              title={`${g.classSectionName} · ${g.periodLabel}`}
              sub={
                g.substituteTeacherId
                  ? `${g.substituteTeacherName} · ${g.acknowledgedAt ? `seen ${seenAt(g.acknowledgedAt)}` : 'not yet seen'}`
                  : `${day(g.date)} · for ${g.originalTeacherName}`
              }
              right={<Pill tone={g.substituteTeacherId ? 'green' : 'amber'}>{g.substituteTeacherId ? 'Covered' : 'Needs cover'}</Pill>}
            />
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
              <Button
                label={picking === g.id ? 'Close' : g.substituteTeacherId ? 'Change' : 'Pick'}
                small
                variant={g.substituteTeacherId || picking === g.id ? 'ghost' : 'primary'}
                onPress={() => setPicking(picking === g.id ? null : g.id)}
                disabled={busy === g.id}
                testID={`pick-${g.id}`}
              />
              {g.substituteTeacherId ? (
                <Button label="Clear" small variant="ghost" onPress={() => act(g.id, 'clear')} disabled={busy === g.id} testID={`clear-${g.id}`} />
              ) : null}
            </View>
            {picking === g.id ? (
              <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6 }}>
                {cands.error ? note('Could not load who is free. Close and try again.', tokens.color.red) : null}
                {!cands.data && !cands.error ? note('Finding who is free…', tokens.color.sub) : null}
                {cands.data && cands.data.length === 0 ? note('Nobody is free then. Decide on the console.', tokens.color.sub) : null}
                {(cands.data ?? []).map((c) => (
                  <Button
                    key={c.id}
                    small
                    variant="ghost"
                    label={`${c.name}${c.teachesSubject ? ' · teaches this' : c.coversThatDay > 0 ? ` · ${c.coversThatDay} today` : ''}`}
                    onPress={() => act(g.id, 'assign', c.id)}
                    disabled={busy === g.id}
                    testID={`candidate-${g.id}-${c.id}`}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))
      )}
      {error ? <Text style={{ paddingHorizontal: 12, paddingBottom: 10, fontFamily: font.sans, fontSize: 12, color: tokens.color.red }}>{error}</Text> : null}
    </>
  );
}

/**
 * THE ACCOUNTS OFFICER'S LEAVE DESK — what is waiting on her, and the
 * classes the leave she approved left empty. Pull to refresh forgets both
 * answers and asks again.
 */
export default function LeaveDesk() {
  const [view, setView] = useState<'waiting' | 'coverage'>('waiting');
  const [nonce, setNonce] = useState(0);
  return (
    <Screen
      onRefresh={() => {
        invalidate('/manage/leave');
        invalidate('/manage/substitution');
        setNonce((n) => n + 1);
      }}
      refreshing={false}
    >
      <SectionTitle title="Leave" />
      <Page>
        <SegmentedField
          label="Show"
          testID="leavedesk-view"
          value={view}
          onChange={setView}
          options={[{ value: 'waiting', label: 'Waiting' }, { value: 'coverage', label: 'Coverage' }]}
        />
        <View key={nonce}>{view === 'waiting' ? <Waiting /> : <Coverage />}</View>
      </Page>
    </Screen>
  );
}
```

Before committing, render it in Expo Go against staging as the Ladwa accounts officer at a 360 pt-wide device: the segmented control sits under the "Leave" title, a covered row reads "Kavya Rao · seen 8:10 am", the candidate buttons wrap without clipping.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/mobile exec jest "src/app/\(worker\)"`
Expected: PASS (the existing worker tests stay green).

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/src/app/(worker)/(tabs)/leavedesk/index.tsx" "apps/mobile/src/app/(worker)/__tests__/leavedesk.test.tsx"
git commit -m "feat(app): the accounts officer's leave desk gains Coverage — pick a free teacher, see who has seen their cover"
```

---

### Task 11: The 18:00 IST nudge for tomorrow's empty classes

**Files:**
- Create: `apps/api/src/modules/management/cover-nudge.service.ts`
- Create: `apps/api/src/modules/management/cover-nudge.service.spec.ts`
- Create: `apps/api/src/modules/management/cover-nudge.controller.ts`
- Modify: `apps/api/src/modules/management/management.module.ts` (provider + controller)
- Modify: `apps/api/vercel.json` (cron)

**Interfaces:**
- Consumes: `LeaveService.tellDesk` (Task 7).
- Produces: `CoverNudgeService.run(now?: Date): Promise<{ schools: number; nudged: number }>`; `GET|POST /internal/cron/cover-nudge` (CronSecretGuard).

- [ ] **Step 1: Write the failing test**

Create `cover-nudge.service.spec.ts`:

```ts
const platform = { substitution: { groupBy: jest.fn() } };
const tx = {
  notificationOutbox: { findFirst: jest.fn(), create: jest.fn() },
  notification: { create: jest.fn() },
  school: { findFirst: jest.fn().mockResolvedValue({ name: 'Raffles' }) },
  user: { findMany: jest.fn() },
  staff: { findMany: jest.fn().mockResolvedValue([]) },
};
const withTenantMock = jest.fn((_s: string, fn: (t: unknown) => unknown) => fn(tx));
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => platform, withTenant: (s: string, fn: (t: unknown) => unknown) => withTenantMock(s, fn) }));

import { CoverNudgeService } from './cover-nudge.service';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-10-12T12:30:00Z'); // 18:00 IST, Monday

describe('CoverNudgeService — tomorrow\'s empty classes, at 18:00 IST', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tx.notificationOutbox.findFirst.mockResolvedValue(null);
    tx.user.findMany.mockResolvedValue([{ id: 'u-head', email: 'head@x' }]);
  });

  it('one COVER_UNFILLED per school to the desk, counting tomorrow\'s uncovered gaps', async () => {
    platform.substitution.groupBy.mockResolvedValue([{ schoolId: A, _count: { _all: 4 } }]);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 1 });
    expect(platform.substitution.groupBy).toHaveBeenCalledWith({ by: ['schoolId'], where: { date: new Date('2026-10-13'), substituteTeacherId: null }, _count: { _all: true } });
    expect(withTenantMock).toHaveBeenCalledWith(A, expect.any(Function));
    expect(tx.notificationOutbox.create).toHaveBeenCalledWith({
      data: { schoolId: A, kind: 'COVER_UNFILLED', targetUserId: 'u-head', payload: { schoolName: 'Raffles', gaps: 4, forDate: '2026-10-13', forWhen: 'tomorrow, Tue 13 Oct 2026', note: null } },
    });
  });

  it('fired twice (Vercel can), the desk still gets one nudge', async () => {
    platform.substitution.groupBy.mockResolvedValue([{ schoolId: A, _count: { _all: 4 } }]);
    tx.notificationOutbox.findFirst.mockResolvedValue({ id: 'already' });
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 0 });
    expect(tx.notificationOutbox.findFirst).toHaveBeenCalledWith({
      where: { schoolId: A, kind: 'COVER_UNFILLED', createdAt: { gte: new Date(NOW.getTime() - 12 * 3_600_000) }, payload: { path: ['forDate'], equals: '2026-10-13' } },
      select: { id: true },
    });
    expect(tx.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('nothing uncovered anywhere: nobody is bothered', async () => {
    platform.substitution.groupBy.mockResolvedValue([]);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 0, nudged: 0 });
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it('one school failing does not stop the next', async () => {
    const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    platform.substitution.groupBy.mockResolvedValue([{ schoolId: A, _count: { _all: 1 } }, { schoolId: B, _count: { _all: 2 } }]);
    withTenantMock.mockImplementationOnce(async () => { throw new Error('pooler timeout'); });
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 2, nudged: 1 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management/cover-nudge.service.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `cover-nudge.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { todayIstDateStr, toDateStr } from './internal/leave-dates';
import { LeaveService } from './leave.service';

/**
 * THE 18:00 IST NUDGE (spec §4). For every school with a class tomorrow that
 * nobody is covering, ONE notice to the leave desk with the count. Runs from
 * Vercel Cron at 12:30 UTC — Hobby allows daily crons, and this is one.
 *
 * Schools are found with one groupBy on the platform client (a cron has no
 * tenant); everything per school then runs inside withTenant. Vercel may
 * invoke a cron twice: a nudge already written for that date in the last 12
 * hours is not written again.
 */
@Injectable()
export class CoverNudgeService {
  private readonly logger = new Logger(CoverNudgeService.name);

  async run(now: Date = new Date()): Promise<{ schools: number; nudged: number }> {
    const today = todayIstDateStr(now);
    const tomorrow = toDateStr(new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 3_600_000));
    const date = new Date(tomorrow);
    const open = await getPlatformPrisma().substitution.groupBy({
      by: ['schoolId'],
      where: { date, substituteTeacherId: null },
      _count: { _all: true },
    });

    let nudged = 0;
    for (const g of open) {
      try {
        const told = await withTenant(g.schoolId, async (tx) => {
          const already = await tx.notificationOutbox.findFirst({
            where: { schoolId: g.schoolId, kind: 'COVER_UNFILLED', createdAt: { gte: new Date(now.getTime() - 12 * 3_600_000) }, payload: { path: ['forDate'], equals: tomorrow } },
            select: { id: true },
          });
          if (already) return 0;
          const school = await tx.school.findFirst({ where: { id: g.schoolId }, select: { name: true } });
          const gaps = g._count._all;
          return LeaveService.tellDesk(tx, g.schoolId, {
            kind: 'COVER_UNFILLED',
            payload: { schoolName: school?.name ?? 'Your school', gaps, forDate: tomorrow, forWhen: `tomorrow, ${LeaveService.datesLabel(tomorrow, tomorrow)}`, note: null },
            title: `${gaps} ${gaps === 1 ? 'class has' : 'classes have'} no teacher tomorrow`,
            body: LeaveService.datesLabel(tomorrow, tomorrow),
            linkId: null,
          });
        });
        if (told > 0) nudged += 1;
      } catch (e) {
        this.logger.error(`Cover nudge for school ${g.schoolId} failed: ${(e as Error).message}`);
      }
    }
    if (nudged > 0) requestOutboxDrain();
    return { schools: open.length, nudged };
  }
}
```

Note `tellDesk` writes the payload object as given — the test pins its exact shape.

Create `cover-nudge.controller.ts`:

```ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { CoverNudgeService } from './cover-nudge.service';

/** Vercel Cron issues a GET at 12:30 UTC (18:00 IST); POST is the operator's manual trigger. */
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class CoverNudgeController {
  constructor(private readonly nudge: CoverNudgeService) {}

  @Get('cover-nudge')
  runFromCron() {
    return this.nudge.run();
  }

  @Post('cover-nudge')
  run() {
    return this.nudge.run();
  }
}
```

`management.module.ts`: import both; add `CoverNudgeService` to `providers` and `CoverNudgeController` to `controllers`.

`apps/api/vercel.json` `crons` — add:

```json
    {
      "path": "/internal/cron/cover-nudge",
      "schedule": "30 12 * * *"
    },
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @skoolos/api exec jest src/modules/management src/common/module-wiring.spec.ts src/common/notifications/outbox-writers.guard.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/management/cover-nudge.service.ts apps/api/src/modules/management/cover-nudge.service.spec.ts apps/api/src/modules/management/cover-nudge.controller.ts apps/api/src/modules/management/management.module.ts apps/api/vercel.json
git commit -m "feat(leave): an 18:00 IST nudge to the leave desk names tomorrow's classes with no teacher — once, however often the cron fires"
```

---

### Task 12: Gate, push, staging

- [ ] **Step 1:** `pnpm preflight` — expect green. A red test is fixed, not skipped.
- [ ] **Step 2:** One fresh reviewer (most capable model) on `git diff origin/staging..HEAD`, with this plan and the spec. Fix what it finds; re-run preflight.
- [ ] **Step 3:** `git fetch origin && git log --oneline origin/staging..HEAD`; `git push -u origin HEAD`; `gh pr create --base staging` (title "Notification spine Tier 1b: the leave desk, done right"; body: task list; "Migration `20261007_010000_leave_cover_links` — staging applies on push; production BEFORE the staging→main merge, or every Substitution read fails"; the new cron `cover-nudge` 12:30 UTC). Wait for CI; merge.
- [ ] **Step 4:** On staging (Ladwa), once `db-migrate` has run: apply for a half day PM as a teacher for tomorrow → approve as the accounts officer from the app → only afternoon periods appear under Coverage; pick a teacher from the app's Coverage tab; from that teacher's WhatsApp tap "Got it" (or, while v2 is pending, see the v1 card) and watch "seen" appear on both the console and the app; cancel the leave and read the `COVER_CANCELLED` and `LEAVE_CANCELLED` delivery rows; `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://api.test.sckools.com/internal/cron/cover-nudge` twice and see one `COVER_UNFILLED` per desk person.
- [ ] **Step 5:** Tell the owner: run the prod migration first; `node scripts/whatsapp-verify.mjs` for the two templates' review status; once both are APPROVED on production, remove them from `GATED_TEMPLATES` in a follow-up.

