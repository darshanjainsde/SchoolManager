# Admin Pro Console (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the five school-admin management tabs (Students, Teachers, Classes, Timetable, Availability) as one coherent Pro console with structured errors, pagination/search, email-invite logins, safe deletes, bulk actions, CSV import, and timetable conflict detection — shipped to `test.sckools.com` first, gated by a Pro feature flag.

**Architecture:** Additive changes to the existing NestJS `management` module (structured error envelope, paginated endpoints, invite + bulk + import endpoints, conflict-checked timetable) and a rebuilt Next.js `/app` UI composed from new shared components (Drawer, ConfirmDialog, DataTable, BulkBar). Old pages remain reachable until the `MANAGEMENT_PRO` flag flips per school. Design reference: the approved artifact "SkoolOS Admin Pro — Management, Rebuilt" (chalk-green console, drawers not inline forms, consequence-listing confirms).

**Tech Stack:** NestJS + Prisma (`withTenant` transactions), Next.js 14 app router, TanStack Query v5, sonner toasts, lucide-react icons, existing `MailService`, existing `RequireFeature` guard.

## Global Constraints

- Branching: every task = feature branch off `staging`; merge back to `staging` (auto-deploys test.sckools.com). NEVER merge to `main`; NEVER `git add -A` (iCloud " 2" junk in local tree) — add explicit paths only.
- Untouched routes (hard boundary): Dashboard, Website, Enquiries, Events, Announcements — no edits to their files or APIs.
- All tenant data access through the existing `withTenant(schoolId, tx => …)` pattern — never raw `prisma.*` for tenant rows.
- Error envelope everywhere: `{ code: ErrorCode, message: string, field?: string }`. Client logic switches ONLY on `code` — string-matching `err.message` is a review-rejection.
- Feature flags: existing endpoints stay under `@RequireFeature('MANAGEMENT')`; new Pro-only surfaces additionally check `MANAGEMENT_PRO` (Task 12).
- No temp passwords in any UI. Login = email invite (72 h single-use token) from `@sckools.com`.
- Verification gates for every task: `pnpm typecheck && pnpm lint && pnpm boundary && pnpm --filter @skoolos/api test`.
- Prisma migrations are additive only; each runs on staging DB before the code that needs it merges.
- Pagination defaults: `pageSize` 25, server-clamped to max 100. Query keys: `['manage', <entity>, params]`.

## File Structure (locked decomposition)

```
apps/api/src/common/errors/api-error.ts            (NEW: ErrorCode union + ApiError)
apps/api/src/common/errors/api-error.filter.ts     (NEW: Nest exception filter → envelope)
apps/api/src/modules/management/students.service.ts    (MODIFY: paged list, soft delete, invite, bulk, import)
apps/api/src/modules/management/students.controller.ts (MODIFY: new endpoints)
apps/api/src/modules/management/timetable.service.ts   (MODIFY: conflict check, publish)
apps/api/src/modules/management/management.dto.ts      (MODIFY: new DTOs)
apps/api/src/common/mail/mail.service.ts               (MODIFY: sendStudentInvite)
packages/db/prisma/schema.prisma                       (MODIFY: LoginInvite model, TimetableSlot unique index, isPublished)
apps/web/components/ui/drawer.tsx                  (NEW)
apps/web/components/ui/confirm-dialog.tsx          (NEW)
apps/web/components/manage/data-table.tsx          (NEW)
apps/web/components/manage/bulk-bar.tsx            (NEW)
apps/web/components/manage/kpi-card.tsx            (NEW)
apps/web/components/manage/empty-state.tsx         (NEW)
apps/web/lib/manage/api-error.ts                   (NEW: envelope type + isApiError guard)
apps/web/lib/manage/keys.ts                        (NEW: query-key + invalidation helpers)
apps/web/app/app/students/page.tsx                 (REWRITE ≤200 lines, composed)
apps/web/app/app/students/student-drawer.tsx       (NEW: profile + add/edit drawers)
apps/web/app/app/students/import-drawer.tsx        (NEW: CSV wizard)
apps/web/app/app/teachers/page.tsx                 (REWRITE)
apps/web/app/app/classes/page.tsx                  (REWRITE: sections only)
apps/web/app/app/classes/structure/page.tsx        (NEW: grades + subjects moved here)
apps/web/app/app/timetable/page.tsx                (REWRITE: grid + conflicts + publish)
apps/web/app/app/availability/page.tsx             (REWRITE: derived + substitute)
```

Suggested subagent routing: Tasks 1–7 → `general-purpose` (API/backend). Tasks 8–11 → `general-purpose` with frontend-design skill loaded. Tasks 12–13 → `general-purpose`. Independent pairs that may run in parallel: (T2,T4), (T8,T9), (T10a,T10b), (T11-teachers, T11-classes).

---

### Task 1: Structured error envelope (API-wide)

**Files:**
- Create: `apps/api/src/common/errors/api-error.ts`
- Create: `apps/api/src/common/errors/api-error.filter.ts`
- Create: `apps/api/src/common/errors/api-error.spec.ts`
- Modify: `apps/api/src/configure-app.ts` (register global filter)

**Interfaces:**
- Produces: `type ErrorCode = 'DUPLICATE_ADMISSION_NO' | 'CLASS_NOT_FOUND' | 'LOGIN_EXISTS' | 'EMAIL_REQUIRED' | 'INVITE_ALREADY_ACCEPTED' | 'CLASS_NOT_EMPTY' | 'TEACHER_CONFLICT' | 'VALIDATION' | 'FORBIDDEN_FEATURE' | 'NOT_FOUND'`;
  `class ApiError extends HttpException { constructor(code: ErrorCode, message: string, status: number, field?: string) }`;
  response body always `{ code, message, field? }`.

- [ ] **Step 1: Failing test** — `api-error.spec.ts`:
```ts
import { ApiError } from './api-error';

it('serializes to the envelope', () => {
  const e = new ApiError('DUPLICATE_ADMISSION_NO', 'Admission no. already exists', 409, 'admissionNo');
  expect(e.getStatus()).toBe(409);
  expect(e.getResponse()).toEqual({
    code: 'DUPLICATE_ADMISSION_NO',
    message: 'Admission no. already exists',
    field: 'admissionNo',
  });
});
```
- [ ] **Step 2:** `pnpm --filter @skoolos/api test -- api-error` → FAIL (module not found).
- [ ] **Step 3: Implement** `api-error.ts`:
```ts
import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'DUPLICATE_ADMISSION_NO' | 'CLASS_NOT_FOUND' | 'LOGIN_EXISTS'
  | 'EMAIL_REQUIRED' | 'INVITE_ALREADY_ACCEPTED' | 'CLASS_NOT_EMPTY'
  | 'TEACHER_CONFLICT' | 'VALIDATION' | 'FORBIDDEN_FEATURE' | 'NOT_FOUND';

export class ApiError extends HttpException {
  constructor(code: ErrorCode, message: string, status: number, field?: string) {
    super(field ? { code, message, field } : { code, message }, status);
  }
}
```
`api-error.filter.ts` (catch `ValidationPipe` errors and unknown `HttpException`s, normalize to envelope with `code: 'VALIDATION'` / `'NOT_FOUND'` etc.; unknown 500s → `{ code: 'INTERNAL', message: 'Something went wrong' }` without leaking internals). Register in `configure-app.ts` via `app.useGlobalFilters(new ApiErrorFilter())`.
- [ ] **Step 4:** Test passes; full gate suite passes.
- [ ] **Step 5: Commit** `feat(api): structured ApiError envelope + global filter`.

### Task 2: Paginated, searchable students list

**Files:**
- Modify: `apps/api/src/modules/management/students.service.ts:21` (`list`)
- Modify: `apps/api/src/modules/management/students.controller.ts:37-43` (`list`)
- Modify: `apps/api/src/modules/management/management.dto.ts` (add `ListStudentsQueryDto`)
- Create: `apps/api/src/modules/management/students.service.spec.ts`

**Interfaces:**
- Consumes: `withTenant` (existing), `ApiError` (Task 1).
- Produces: `GET /manage/students?q=&classSectionId=&status=active|inactive|all&page=&pageSize=` → `{ items: StudentRow[]; total: number; page: number; pageSize: number }` where `StudentRow` = current row shape + `inviteStatus: 'NONE'|'INVITED'|'ACTIVE'|'EXPIRED'`.

- [ ] **Step 1: Failing tests** (mock tx): `q` matches firstName/lastName/admissionNo/guardianName case-insensitively; `pageSize: 500` clamps to 100; default excludes `isActive: false`; result shape has `total`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** service core:
```ts
const where = {
  schoolId,
  ...(status === 'all' ? {} : { isActive: status !== 'inactive' }),
  ...(classSectionId ? { classSectionId } : {}),
  ...(q ? { OR: [
    { firstName:    { contains: q, mode: 'insensitive' } },
    { lastName:     { contains: q, mode: 'insensitive' } },
    { admissionNo:  { contains: q, mode: 'insensitive' } },
    { guardianName: { contains: q, mode: 'insensitive' } },
  ] } : {}),
} satisfies Prisma.StudentWhereInput;
const size = Math.min(Math.max(pageSize ?? 25, 1), 100);
const [items, total] = await Promise.all([
  tx.student.findMany({ where, ...include, orderBy: [{ classSectionId: 'asc' }, { rollNo: 'asc' }], skip: (page - 1) * size, take: size }),
  tx.student.count({ where }),
]);
return { items, total, page, pageSize: size };
```
DTO uses `@IsInt() @Type(() => Number)` for page/pageSize, `@IsIn(['active','inactive','all'])` for status.
- [ ] **Step 4:** Tests pass; gates pass.
- [ ] **Step 5: Commit** `feat(api): paginated searchable students list`.

### Task 3: Soft delete + restore

**Files:**
- Modify: `apps/api/src/modules/management/students.service.ts:86` (`remove`), add `restore`
- Modify: `apps/api/src/modules/management/students.controller.ts` (add `PATCH :id/restore`)
- Test: extend `students.service.spec.ts`

**Interfaces:**
- Produces: `DELETE /manage/students/:id` → sets `isActive=false`, 204. `PATCH /manage/students/:id/restore` → sets `isActive=true`, returns row. Both idempotent; unknown id → `ApiError('NOT_FOUND', …, 404)`.

- [ ] **Step 1:** Failing tests: delete marks inactive (no `tx.student.delete` call), restore reactivates, restore of active row is a no-op success.
- [ ] **Step 2:** FAIL. **Step 3:** implement via `tx.student.update({ where: { id, schoolId }, data: { isActive: false } })` (updateMany + count check for tenant safety). **Step 4:** pass + gates. **Step 5: Commit** `feat(api): soft delete + restore for students`.

### Task 4: LoginInvite model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration `20260721_000000_login_invites_timetable_publish`

**Interfaces:**
- Produces (Prisma models/fields other tasks rely on):
```prisma
model LoginInvite {
  id        String    @id @default(uuid()) @db.Uuid
  schoolId  String    @db.Uuid
  userId    String    @db.Uuid
  email     String
  tokenHash String    @unique
  expiresAt DateTime
  acceptedAt DateTime?
  createdAt DateTime  @default(now())
  school    School    @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([schoolId, userId])
}
```
Plus on `TimetableSlot`: `isPublished Boolean @default(true)` and `@@unique([schoolId, teacherId, dayOfWeek, periodId, academicYearId], name: "one_slot_per_teacher_period")` — **verify the actual column names in the existing model first** (`dayOfWeek`/`periodId`/`academicYearId` must match schema; adjust the index to the real names).

- [ ] **Step 1:** Edit schema; `pnpm --filter @skoolos/db exec prisma migrate dev --name login_invites_timetable_publish --create-only`; review SQL (expect: CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE UNIQUE INDEX).
- [ ] **Step 2:** If prod data could violate the new unique index, the migration must fail loudly in staging — check with `SELECT teacherId, dayOfWeek, periodId, COUNT(*) FROM "TimetableSlot" GROUP BY 1,2,3 HAVING COUNT(*) > 1` on staging DB and dedupe first.
- [ ] **Step 3:** Apply to staging DB (`migrate deploy` with staging `DIRECT_URL`), `pnpm db:generate`, gates pass.
- [ ] **Step 4: Commit** `feat(db): LoginInvite + timetable publish flag + teacher-slot unique index`.

### Task 5: Email invite flow (replaces temp passwords)

**Files:**
- Modify: `apps/api/src/modules/management/students.service.ts:97` (replace `createLogin` with `invite`)
- Modify: `apps/api/src/modules/management/students.controller.ts:50-53` (`POST :id/invite`, `POST :id/invite/resend`, `DELETE :id/invite`)
- Modify: `apps/api/src/common/mail/mail.service.ts` (add `sendStudentInvite`)
- Modify: `apps/api/src/modules/auth/internal/accept-invite.controller.ts` (accept student tokens — read it first; it already validates `token`+`u` and sets password)
- Test: extend `students.service.spec.ts`

**Interfaces:**
- Consumes: `LoginInvite` (Task 4), `MailService.send(to, subject, html, text): Promise<boolean>`.
- Produces: `POST /manage/students/:id/invite { email: string }` → `{ inviteStatus: 'INVITED', expiresAt }`. Errors: `EMAIL_REQUIRED` (400), `LOGIN_EXISTS` (409 if user has password set), `INVITE_ALREADY_ACCEPTED` (409). `MailService.sendStudentInvite(to: string, schoolName: string, studentName: string, acceptUrl: string): Promise<boolean>`.
- Invite URL: `https://<school-host>/accept-invite?token=<raw>&u=<userId>` — host from the school's primary Domain row, matching the existing accept-invite link format.

- [ ] **Step 1: Failing tests:** invite creates passwordless STUDENT user linked to `Student.userId`, stores **sha256 hash** of token (never raw), 72 h expiry; resend voids prior invite rows (delete then insert); invite when `user.passwordHash` set → `LOGIN_EXISTS`; missing email → `EMAIL_REQUIRED`; SMTP returning false does NOT throw — invite row still created (UI shows retry).
- [ ] **Step 2:** FAIL. **Step 3: Implement** (token: `randomBytes(32).toString('base64url')`; hash: `createHash('sha256')`). Keep the old `createLogin` endpoint deleted — the new UI never calls it; grep for web usages (`students/page.tsx` create-login mutation) and remove in Task 10.
- [ ] **Step 4:** Pass + gates. Manual: on staging, invite to a team inbox → email arrives with `[TEST]` prefix, link opens accept page, password set, login works.
- [ ] **Step 5: Commit** `feat(api): student login invites via email, no temp passwords`.

### Task 6: Bulk actions + CSV import endpoint

**Files:**
- Modify: `apps/api/src/modules/management/students.controller.ts` (`POST bulk/assign-class`, `POST bulk/invite`, `POST import`)
- Modify: `apps/api/src/modules/management/students.service.ts`
- Modify: `apps/api/src/modules/management/management.dto.ts` (`BulkAssignDto { studentIds: string[]; classSectionId: string }`, `BulkInviteDto { items: { studentId: string; email: string }[] }`, `ImportStudentsDto { rows: CreateStudentDto[] }`, all with `@ArrayMaxSize(500)`)
- Test: extend `students.service.spec.ts`

**Interfaces:**
- Produces: `bulk/assign-class` → `{ updated: number }` in one transaction (any invalid id → whole tx rolls back, `CLASS_NOT_FOUND`/`NOT_FOUND`). `import` → validate ALL rows first (dup admissionNo in-file case-insensitive, dup vs DB, missing fields, unknown class name) → if any error: `{ ok: false, errors: [{ row: number; code: ErrorCode; message: string }] }` and **zero writes**; else `{ ok: true, created: number }` in one `withTenant` transaction.

- [ ] **Step 1:** Failing tests for: atomic rollback on one bad row; in-file duplicate detection (`ADM-1` vs `adm-1`); happy path creates N.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Pass + gates. **Step 5: Commit** `feat(api): bulk assign/invite + atomic CSV import`.

### Task 7: Timetable conflicts + publish + derived availability

**Files:**
- Modify: `apps/api/src/modules/management/timetable.service.ts`
- Modify: `apps/api/src/modules/management/timetable.controller.ts` (`POST publish`, keep existing assign; availability endpoint likely in `catalog.controller.ts` — locate `AvailabilityQueryDto` usage and extend there)
- Test: `apps/api/src/modules/management/timetable.service.spec.ts`

**Interfaces:**
- Consumes: unique index `one_slot_per_teacher_period` (Task 4).
- Produces: assign checks conflicts and throws `ApiError('TEACHER_CONFLICT', 'R. Verma already teaches 7-A at Tue P4', 409)` with the clashing class name in the message; Prisma `P2002` on the unique index is caught and mapped to the same error (race-safe). `POST /manage/timetable/publish { academicYearId, week?: never }` flips draft slots `isPublished=true` in one tx, returns `{ published: number, heldBack: { slotId, reason }[] }`. Availability = teachers with no published slot at (day, period) minus on-leave; response `{ free: TeacherLite[], needsSubstitute: { slot, teacher }[] }`.

- [ ] **Step 1:** Failing tests: double-book same teacher/day/period → `TEACHER_CONFLICT`; publish skips (holds back) conflicted drafts without failing others; availability excludes teachers with published slots.
- [ ] **Steps 2–4:** FAIL → implement → pass + gates.
- [ ] **Step 5: Commit** `feat(api): timetable conflict detection, atomic publish, derived availability`.

### Task 8: Web primitives — Drawer + ConfirmDialog

**Files:**
- Create: `apps/web/components/ui/drawer.tsx`
- Create: `apps/web/components/ui/confirm-dialog.tsx`

**Interfaces:**
- Produces:
```tsx
<Drawer open={boolean} onClose={() => void} title={string} width?: 'md'|'lg'>{children}</Drawer>
<ConfirmDialog open onCancel onConfirm title consequences={string[]} confirmLabel danger?: boolean confirmText?: string /> // confirmText: user must type it (bulk delete count)
```
- Drawer: fixed right panel, scrim, `role="dialog" aria-modal`, focus trap (focus first focusable on open, return focus on close), Esc closes, body scroll locked while open, 250 ms translate transition respecting `prefers-reduced-motion`. Match existing UI file style (see `components/ui/card.tsx` for conventions — plain function components + tailwind classes, no external deps).

- [ ] **Step 1:** Implement both (no test runner in web — verification is typecheck + Storybook-less manual check on a scratch page, then delete the scratch page).
- [ ] **Step 2:** `pnpm typecheck && pnpm lint` pass.
- [ ] **Step 3: Commit** `feat(web): Drawer + ConfirmDialog primitives (focus-trapped, a11y)`.

### Task 9: Web manage lib — error guard, keys, hooks

**Files:**
- Create: `apps/web/lib/manage/api-error.ts`
- Create: `apps/web/lib/manage/keys.ts`

**Interfaces:**
- Produces:
```ts
// api-error.ts
export interface ApiErrorBody { code: string; message: string; field?: string }
export function isApiError(e: unknown): e is { body: ApiErrorBody } // works with useApi's thrown Error — read apps/web/lib/use-api.ts first; if it throws plain Error(message), extend it to attach parsed body as `cause`, DON'T regex the message.
// keys.ts
export const manageKeys = {
  students: (p?: object) => ['manage', 'students', p ?? {}] as const,
  teachers: () => ['manage', 'teachers'] as const,
  classes:  () => ['manage', 'classes'] as const,
  timetable:(p?: object) => ['manage', 'timetable', p ?? {}] as const,
  availability: (p?: object) => ['manage', 'availability', p ?? {}] as const,
  kpis: () => ['manage', 'kpis'] as const,
};
export function invalidateAfter(qc: QueryClient, m: 'student'|'bulkAssign'|'invite'|'import'|'classCrud'|'publish'): Promise<void> // implements the plan's invalidation matrix
```
- The invalidation matrix (verbatim from spec): student CRUD → students+kpis; bulkAssign → students+classes; invite → students; import → students+kpis; classCrud → classes+students; publish → timetable+availability+teachers.

- [ ] **Step 1:** Read `apps/web/lib/use-api.ts`; extend its error throw to `Object.assign(new Error(msg), { body: parsedJson })` if not already.
- [ ] **Step 2:** Implement both files exactly as the interface block. Typecheck + lint.
- [ ] **Step 3: Commit** `feat(web): manage query keys, invalidation matrix, typed API errors`.

### Task 10: DataTable, BulkBar, KpiCard, EmptyState

**Files:**
- Create: `apps/web/components/manage/data-table.tsx`
- Create: `apps/web/components/manage/bulk-bar.tsx`
- Create: `apps/web/components/manage/kpi-card.tsx`
- Create: `apps/web/components/manage/empty-state.tsx`

**Interfaces:**
```tsx
<DataTable<T> columns={Array<{ key: string; header: string; render: (row: T) => ReactNode }>}
  rows={T[]} rowKey={(r: T) => string} onRowClick={(r: T) => void}
  selectable selected={Set<string>} onSelectedChange={(s: Set<string>) => void}
  page={number} pageSize={number} total={number} onPageChange={(p: number) => void}
  isLoading error={ApiErrorBody | null} empty={<EmptyState …/>} />
<BulkBar count={number} actions={Array<{ label: string; danger?: boolean; onClick: () => void }>} onClear={() => void} />
<KpiCard n={number|string} label={string} tone?: 'default'|'warn' onAction?: { label: string; onClick(): void } />
<EmptyState title body cta?: { label; onClick } />
```
- DataTable renders header checkbox (select page), loading skeleton rows, error state showing `error.message`, pager "x–y of total". BulkBar is fixed-bottom, slides in when `count > 0`.

- [ ] **Step 1:** Implement all four; typecheck + lint pass.
- [ ] **Step 2: Commit** `feat(web): manage DataTable/BulkBar/KpiCard/EmptyState`.

### Task 11: Students page rebuild (the reference implementation)

**Files:**
- Rewrite: `apps/web/app/app/students/page.tsx` (≤200 lines)
- Create: `apps/web/app/app/students/student-drawer.tsx`
- Create: `apps/web/app/app/students/import-drawer.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2,3,5,6,8,9,10.
- Produces the UX contract: KPI strip (enrolled / unassigned / no-login / flagged from a new lightweight `GET /manage/students/kpis` — add it here, same service file, one grouped count query); debounced (300 ms) search + class chips; row click → profile drawer (identity, guardian, invite panel with email input + "Email set-password invite" + Invited/Active/Expired states + resend/revoke, danger zone); Add → drawer form with live duplicate check (`GET /manage/students?q=<admissionNo>&pageSize=1` debounced 400 ms, exact match → inline `DUPLICATE_ADMISSION_NO` error with link); delete → ConfirmDialog (consequences: roster, login, history-kept) → soft delete → sonner toast with 10 s Undo calling restore; selection → BulkBar (Assign to class, Send invites, Export CSV client-side, Delete… with typed count); Import → 3-step wizard (client parses CSV with `papaparse` — add dep to apps/web only; map columns; call `POST import`; render per-row errors).
- Deleting last row of a page: after invalidation, if `page > ceil((total-1)/pageSize)` set page to that max (guard in page component).

- [ ] **Step 1:** Build `student-drawer.tsx` (profile + add/edit modes, controlled by `mode: 'view'|'add'|'edit'`).
- [ ] **Step 2:** Build `import-drawer.tsx`.
- [ ] **Step 3:** Rewrite `page.tsx` composing DataTable + drawers + BulkBar; delete the old inline `StudentForm`/`CreateLoginModal` components and the create-login mutation.
- [ ] **Step 4:** Gates pass. Manual QA on localhost against seeded DB: all acceptance criteria for students (spec section) pass.
- [ ] **Step 5: Commit** `feat(web): Students tab — Pro console rebuild`.

### Task 12: MANAGEMENT_PRO flag + gated rollout

**Files:**
- Modify: `apps/api/src/modules/features/internal/feature-resolver.service.ts` (read first — add `MANAGEMENT_PRO` to the feature map, default off, PRO-tier default on)
- Modify: `apps/web/app/app/layout.tsx` (fetch resolved features once; if `MANAGEMENT_PRO` off → render existing old pages; if on → new console shell with the redesigned sidebar grouping)

**Interfaces:**
- Produces: per-school flip via existing `FeatureOverride` rows (owner portal already edits these). Non-Pro API callers to Pro-only endpoints (bulk, import, invite, publish) get `ApiError('FORBIDDEN_FEATURE', …, 403)` via `@RequireFeature('MANAGEMENT_PRO')` on those routes only.

- [ ] **Step 1:** Failing test in `feature-resolver.service.spec.ts` (file exists): PRO school resolves `MANAGEMENT_PRO: true`, STANDARD false, override wins.
- [ ] **Steps 2–4:** FAIL → implement → pass + gates.
- [ ] **Step 5: Commit** `feat: MANAGEMENT_PRO flag gates new console per school`.

### Task 13: Teachers, Classes(+structure), Timetable, Availability rebuilds

Same composition pattern as Task 11 — each is a sibling deliverable using identical primitives. Keep as four sub-branches; each independently mergeable:

- [ ] **13a Teachers:** card grid (subjects chips, load bar from `GET /manage/timetable/load` — add grouped count endpoint in timetable.service), add/edit drawer, soft-state "On leave" toggle if the Teacher model has such a field — **check schema first; if absent, defer leave to invite-only scope and derive availability solely from slots.** Commit `feat(web): Teachers tab rebuild`.
- [ ] **13b Classes:** section cards (`_count.students`, class teacher, timetable status), click-through → `/app/students?classSectionId=…` (URL param pre-applies filter — support in Task 11's page via `useSearchParams`), add-section drawer; `classes/structure/page.tsx` for grades+subjects lists with ConfirmDialog deletes (`CLASS_NOT_EMPTY` handled). Commit `feat(web): Classes tab + structure page`.
- [ ] **13c Timetable:** grid per class (periods × Mon–Sat from existing Period rows), assign popover listing only conflict-free teachers (server round-trip per open is fine at this scale), conflict cells render `TEACHER_CONFLICT` message, Publish button → shows `heldBack` list. Commit `feat(web): Timetable rebuild with conflict-safe publish`.
- [ ] **13d Availability:** period picker chips, free list + needsSubstitute list from Task 7 endpoint, "Assign as substitute" → dated override slot (`POST /manage/timetable/substitute { slotId, teacherId, date }` — add endpoint, same conflict check). Commit `feat(web): Availability tab derived from timetable`.

### Task 14: Staging QA gate + prod PR

- [ ] Merge all to `staging`; verify test.sckools.com deploys green.
- [ ] Run the full acceptance list from the spec artifact (all Given/When/Then) on `acme.test.sckools.com` — record pass/fail in the PR description.
- [ ] Tenant isolation re-check; invite email `[TEST]`-prefixed to team inbox; conflict + publish exercised.
- [ ] Open PR `staging → main` titled `Phase 2: Admin Pro console (flag-gated)`. Do NOT merge without the user's explicit approval. Prod flip: apply migration to prod DB first (established Supabase Management API flow, user-run), then merge, then flip `MANAGEMENT_PRO` per school from the owner portal.

---

## Self-review notes

- Spec coverage: audit findings 1–10 → Tasks 1 (string-matching), 2 (search/pagination), 3+11 (safe delete), 5 (invites), 6 (bulk/CSV), 8+11 (drawers/focus), 11 (profile view), 13b (classes split, cross-links), 13c/13d (timetable/availability), 12 (Pro gating). Pipeline → Phase 0 plan.
- Column names in Task 4's unique index and the leave field in 13a are flagged for schema verification by the implementer — intentionally, to avoid asserting fields this plan hasn't read.
- Untouched-tabs boundary restated in Global Constraints; no task touches those routes.
