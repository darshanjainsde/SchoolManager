# Support Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** School admins raise support tickets (words + photos + captured diagnostics) from the console; the owner console answers them school-wise; the school tracks every move.

**Architecture:** A new `modules/support` Nest module modelled on `modules/concerns` (one service, two controllers: school door under `manage/support`, owner door under `owner/support` behind OwnerHostGuard + PlatformJwtGuard). Two tenant tables under RLS; owner reads via the platform client. Web: an admin Help page + a Report drawer reachable from every page (kit components), and an owner Support board + desk page (`.sk-own-*` conventions). Notifications reuse the Notification/NotificationOutbox pair with one new kind each.

**Tech Stack:** NestJS 11, Prisma/Postgres 17 RLS, Next 15/React 19, @tanstack/react-query, vitest, jest + supertest e2e against local Postgres (`setup-env.ts` supplies the URLs; no `.env` needed).

**Spec:** `docs/superpowers/specs/2026-10-24-support-desk-design.md`

## Global Constraints

- Statuses: `OPEN ACKNOWLEDGED IN_PROGRESS WAITING_ON_SCHOOL RESOLVED CLOSED`. Types: `BUG QUESTION DATA_FIX BILLING IDEA`. Severities: `BLOCKING ANNOYING SUGGESTION`.
- Limits: title ≤ 120, body ≤ 4,000, externalRef ≤ 120, 5 images × 5 MB, image kinds by bytes (`IMAGE_KINDS`), per-school 20 tickets/day → 429, per-IP `@Throttle({ default: { limit: 10, ttl: 3_600_000 } })`.
- Windows: reopen 14 days after `resolvedAt`; auto-close 7 days after `resolvedAt`; look-in 48 hours; presigned link 300 s.
- Ticket number display: `SK-` + 6-digit zero-padded `number`.
- No feature flag, no `requiredFeature`, no `RequireFeatureGuard`.
- Every new route literal (route-contract scanner), every new table in `BUCKET_OF`, RLS in the migration via the `FOREACH` loop, every new FK indexed.
- Never `git add -A`; commit each green increment; no `.env` sourcing before builds or unit tests.
- Web: admin screens from `components/ui/kit.tsx` (RowList/Row/Cell/RowTitle/Field/Figures/Overlay); owner screens in `.sk-own-*` + new `.sk-sup-*` classes with tokens only; both themes; 360 px clean.

## Review Focus

1. A second school's admin requesting `GET /manage/support/:id` for another school's ticket must get 404, never the row. → Task 5 e2e.
2. A file key that is not on the ticket (or belongs to another ticket) passed to `GET :id/file?key=` must 404 and never presign. → Task 5 e2e.
3. `POST owner/support/:id/open-school` with `lookInUntil` null or in the past must 409 and mint nothing. → Task 5 e2e.
4. Illegal moves (CLOSED → anything by owner; school confirm on OPEN; reopen after 14 days) must 409/400 and leave status untouched. → Task 3 unit + Task 5 e2e.
5. Multipart booleans arrive as strings: `allowLookIn: "true"` must be read as true and `"false"` as false; a missing field as false. → Task 4 DTO spec.

---

### Task 1: Shared types and constants

**Files:**
- Modify: `packages/types/src/index.ts` (append after the Complaint Box block; add `'SUPPORT'` to `NOTIFICATION_KINDS`, `'SUPPORT_UPDATE'` to `NOTIFICATION_OUTBOX_KINDS`)
- Modify: `packages/types/src/contracts.spec.ts` (the outbox-kinds expectation)
- Modify: `apps/web/app/app/settings/notifications/labels.ts` (`SUPPORT: 'Support ticket'`, `SUPPORT_UPDATE: 'Support ticket update'`)
- Test: `packages/types/src/support.spec.ts`

**Interfaces (Produces):**
```ts
export const SUPPORT_TICKET_TYPES = ['BUG','QUESTION','DATA_FIX','BILLING','IDEA'] as const;
export type SupportTicketType = (typeof SUPPORT_TICKET_TYPES)[number];
export const SUPPORT_TICKET_TYPE_LABEL: Record<SupportTicketType, string>; // Something broke · A question · Fix our data · Billing · An idea
export const SUPPORT_SEVERITIES = ['BLOCKING','ANNOYING','SUGGESTION'] as const;
export type SupportSeverity; export const SUPPORT_SEVERITY_LABEL: Record<SupportSeverity,string>; // Blocking us today · Annoying · Suggestion
export const SUPPORT_MODULES = ['WEBSITE','BLOG','EVENTS','ENQUIRIES','CONCERNS','STUDENTS','TEACHERS','STAFF','CLASSES','ATTENDANCE','LEAVE','TIMETABLE','SYLLABUS','EXAMS','PRESS','FEES','PAY','LIBRARY','SPORTS','ANNOUNCEMENTS','ALUMNI','MESSAGES','SETTINGS','LOGIN','APP','OTHER'] as const;
export type SupportModule; export const SUPPORT_MODULE_LABEL: Record<SupportModule,string>;
export const SUPPORT_STATUSES = ['OPEN','ACKNOWLEDGED','IN_PROGRESS','WAITING_ON_SCHOOL','RESOLVED','CLOSED'] as const;
export type SupportStatus;
export const SUPPORT_STATUS_LABEL: Record<SupportStatus,string>;        // owner wording: Open · Acknowledged · In progress · Waiting on school · Resolved · Closed
export const SUPPORT_STATUS_LABEL_SCHOOL: Record<SupportStatus,string>; // Open · Picked up · In progress · Waiting on you · Resolved · Closed
export const SUPPORT_STATUS_TONE: Record<SupportStatus,'info'|'warn'|'good'|'neutral'>; // OPEN info, ACKNOWLEDGED info, IN_PROGRESS info, WAITING_ON_SCHOOL warn, RESOLVED good, CLOSED neutral
export const SUPPORT_REOPEN_DAYS = 14; export const SUPPORT_AUTO_CLOSE_DAYS = 7; export const SUPPORT_LOOK_IN_HOURS = 48;
export const SUPPORT_MAX_FILES = 5; export const SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export function supportTicketNo(n: number): string; // 142 → 'SK-000142'
export type SupportAuthorKind = 'SCHOOL'|'OWNER'|'SYSTEM';
export interface SupportAttachment { key: string; name: string }
export interface SupportTicketContext { pagePath: string|null; tier: string; browser: string|null; appVersion: string|null }
export interface SupportTicketRow { id; number; ticketNo; type; module; severity; title; status; createdAt; lastActivityAt; lastSchoolActivityAt; lastOwnerActivityAt: string|null; resolvedAt: string|null; closedAt: string|null; reopenedAt: string|null; unanswered: boolean; lookInUntil: string|null; entryCount: number; raisedBy: { name: string }; school: { id; name; slug; tier } | null }
export interface SupportEntryRow { id; authorKind; authorName: string|null; body; attachments: SupportAttachment[]; visibleToSchool: boolean; statusFrom: SupportStatus|null; statusTo: SupportStatus|null; createdAt }
export interface SupportTicketDetail extends SupportTicketRow { body; attachments: SupportAttachment[]; context: SupportTicketContext|null; entries: SupportEntryRow[]; canReopen: boolean; canConfirm: boolean; assignedTo: { id: string; name: string }|null; externalRef: string|null; sameModuleOpen: number }
export interface SupportSchoolCounts { open: number; waitingOnYou: number; closed: number }
export interface SupportOwnerCounts { unanswered: number; pastDay: number; inProgress: number; waitingOnSchool: number; open: number }
export interface SupportBoardRow { schoolId; name; slug; tier; open: number; waitingOnSchool: number; oldestUnansweredAt: string|null; oldestUnansweredTitle: string|null }
export interface SupportBoard { counts: SupportOwnerCounts; schools: SupportBoardRow[] }
export interface SupportFileLink { url: string; expiresInSeconds: number; name: string }
```

- [ ] **Step 1: Write the failing test** `packages/types/src/support.spec.ts`
```ts
import { SUPPORT_STATUSES, SUPPORT_STATUS_LABEL, SUPPORT_STATUS_LABEL_SCHOOL, SUPPORT_STATUS_TONE, SUPPORT_MODULES, SUPPORT_MODULE_LABEL, supportTicketNo, NOTIFICATION_KINDS, NOTIFICATION_OUTBOX_KINDS } from './index';
it('formats the ticket number with six digits', () => { expect(supportTicketNo(142)).toBe('SK-000142'); expect(supportTicketNo(1234567)).toBe('SK-1234567'); });
it('every status has a label on both sides and a tone', () => { for (const s of SUPPORT_STATUSES) { expect(SUPPORT_STATUS_LABEL[s]).toBeTruthy(); expect(SUPPORT_STATUS_LABEL_SCHOOL[s]).toBeTruthy(); expect(SUPPORT_STATUS_TONE[s]).toBeTruthy(); } });
it('every module has a label', () => { for (const m of SUPPORT_MODULES) expect(SUPPORT_MODULE_LABEL[m]).toBeTruthy(); });
it('the desk has its notification kinds', () => { expect(NOTIFICATION_KINDS).toContain('SUPPORT'); expect(NOTIFICATION_OUTBOX_KINDS).toContain('SUPPORT_UPDATE'); });
```
- [ ] **Step 2:** `pnpm --filter @skoolos/types test` → FAIL (exports missing).
- [ ] **Step 3:** Add the block + kinds; update `contracts.spec.ts` expected list (insert `'SUPPORT_UPDATE'` in sorted position with a comment).
- [ ] **Step 4:** `pnpm --filter @skoolos/types test` → PASS.
- [ ] **Step 5:** Commit `feat(types): support desk contracts and notification kinds`.

### Task 2: Schema, migration, backup buckets

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (two models after `ConcernComment`; `School.supportTickets`, `School.supportTicketEntries`; `User.supportTicketsRaised @relation("SupportTicketRaisedBy")`, `User.supportTicketEntries`)
- Create: `packages/db/prisma/migrations/20261025_000000_support_desk/migration.sql`
- Modify: `apps/api/src/modules/backups/engine/buckets.ts` (`SupportTicket: 'day', SupportTicketEntry: 'day'` beside Concern)

**Produces (Prisma):**
```prisma
model SupportTicket {
  id String @id @default(uuid()) @db.Uuid
  schoolId String @db.Uuid
  number Int @unique @default(autoincrement())
  raisedById String @db.Uuid
  type String  module String  severity String
  title String  body String
  attachmentKeys String[] @default([])
  context Json?
  status String @default("OPEN")
  assignedOwnerId String? @db.Uuid
  lookInUntil DateTime?  externalRef String?
  acknowledgedAt DateTime?  resolvedAt DateTime?  closedAt DateTime?  reopenedAt DateTime?
  lastActivityAt DateTime @default(now())  lastSchoolActivityAt DateTime @default(now())  lastOwnerActivityAt DateTime?
  createdAt DateTime @default(now())
  school School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  raisedBy User @relation("SupportTicketRaisedBy", fields: [raisedById], references: [id], onDelete: Cascade)
  entries SupportTicketEntry[]
  @@index([schoolId, status, lastActivityAt])  @@index([status, lastActivityAt])  @@index([raisedById])
}
model SupportTicketEntry {
  id String @id @default(uuid()) @db.Uuid
  schoolId String @db.Uuid  ticketId String @db.Uuid  authorId String? @db.Uuid
  authorKind String  body String  attachmentKeys String[] @default([])
  visibleToSchool Boolean @default(true)  statusFrom String?  statusTo String?
  createdAt DateTime @default(now())
  school School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  ticket SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  author User? @relation(fields: [authorId], references: [id], onDelete: SetNull)
  @@index([schoolId, ticketId, createdAt])  @@index([ticketId])  @@index([authorId])
}
```
Migration SQL mirrors the Concern migration: `"number" SERIAL NOT NULL` + `CREATE UNIQUE INDEX "SupportTicket_number_key"`, FKs, indexes, and the `DO $$ FOREACH t IN ARRAY ARRAY['SupportTicket','SupportTicketEntry']` RLS loop.

- [ ] **Step 1:** Edit schema; `pnpm db:generate` → generates.
- [ ] **Step 2:** `pnpm --filter @skoolos/db test` → `rls-coverage.spec` FAILS naming the two tables (no migration yet). Watch it fail.
- [ ] **Step 3:** Write the migration; `pnpm --filter @skoolos/db test` → PASS.
- [ ] **Step 4:** Apply to the local test DB the way the e2e globalSetup does (`pnpm --filter @skoolos/api test:e2e -- test/rls-coverage.e2e-spec.ts` runs migrate deploy in globalSetup) → PASS, including `fk-indexes`.
- [ ] **Step 5:** Add bucket entries; `pnpm --filter @skoolos/api test -- buckets` → PASS (remove one entry first to watch "unplaced" go red).
- [ ] **Step 6:** Commit `feat(db): SupportTicket + SupportTicketEntry under RLS, day bucket`.

### Task 3: Pure pieces — status machine and letters (TDD)

**Files:**
- Create: `apps/api/src/modules/support/support-status.ts`, `support-status.spec.ts`
- Create: `apps/api/src/modules/support/support-letters.ts`, `support-letters.spec.ts`

**Produces:**
```ts
// support-status.ts
export const OWNER_MOVES: Record<SupportStatus, SupportStatus[]>; // per spec
export function assertOwnerMove(from: SupportStatus, to: SupportStatus): void; // throws ApiError('SUPPORT_ILLEGAL_MOVE', …, 409, 'status')
export function canReopen(status: SupportStatus, resolvedAt: Date|null, now?: Date): boolean; // RESOLVED|CLOSED and within 14 d
export function canConfirm(status: SupportStatus): boolean; // RESOLVED
export function isUnanswered(t: { status: string; lastSchoolActivityAt: Date; lastOwnerActivityAt: Date|null }): boolean;
export function autoCloseDue(resolvedAt: Date|null, now?: Date): boolean; // > 7 d
export function lookInActive(lookInUntil: Date|null, now?: Date): boolean;
// support-letters.ts (pure Letter builders for MailService.sendLetter)
export function ownerAlertLetter(kind: 'RAISED'|'REPLIED'|'REOPENED', t: { ticketNo: string; title: string; schoolName: string; severity: string; module: string; by: string; preview: string; url: string }): { subject: string; letter: Letter };
export function schoolUpdateText(kind: 'ACKNOWLEDGED'|'STATUS'|'REPLIED'|'RESOLVED'|'OPENED', t: { ticketNo: string; title: string; statusLabel?: string }): { title: string; body: string };
```
- [ ] **Step 1:** Spec `support-status.spec.ts`: OPEN→ACKNOWLEDGED ok; CLOSED→IN_PROGRESS throws 409; RESOLVED→IN_PROGRESS ok; WAITING_ON_SCHOOL→ACKNOWLEDGED throws; `canReopen('RESOLVED', 13 days ago)` true, 15 days false, `('OPEN', null)` false; `isUnanswered` true when owner null, false when owner newer; `autoCloseDue` 6 d false / 8 d true; `lookInActive` null false, future true, past false.
- [ ] **Step 2:** `pnpm --filter @skoolos/api test -- support-status` → FAIL. Implement. → PASS.
- [ ] **Step 3:** Spec `support-letters.spec.ts`: subject carries ticketNo and school; letter rows include Severity and Module; `schoolUpdateText('RESOLVED')` title is "Sckools marked your ticket resolved" and body starts with ticketNo.
- [ ] **Step 4:** Implement; PASS. Add error codes `SUPPORT_ILLEGAL_MOVE`, `SUPPORT_DAILY_LIMIT`, `SUPPORT_LOOK_IN_REQUIRED`, `SUPPORT_REOPEN_WINDOW` to `ErrorCode` in `common/errors/api-error.ts`.
- [ ] **Step 5:** Commit `feat(api): support desk status machine and letters`.

### Task 4: Service, DTOs, controllers, module, notification plumbing

**Files:**
- Create: `apps/api/src/modules/support/support.dto.ts`, `support.dto.spec.ts`, `support.service.ts`, `support.controller.ts`, `support.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts` (import `SupportModule`), `apps/api/src/modules/owner/index.ts` (export `ImpersonationService`; `OwnerModule` exports it), `apps/api/src/common/storage/storage.service.ts` (`PRIVATE_PREFIXES` + `'support/'`), `apps/api/src/modules/management/notification-outbox.service.ts` (`OUTBOX_EMAIL.SUPPORT_UPDATE: true`; `case 'SUPPORT_UPDATE'` → ANNOUNCEMENT shape, `className: 'Support desk'`), `apps/api/src/modules/management/notification-outbox.fixtures.ts` (`SUPPORT_UPDATE: { schoolName: S, ...fx }`)

**Interfaces (Produces):**
```ts
// DTOs (class-validator; multipart strings → @Transform for booleans)
CreateTicketDto { type; module; severity; title (3..120); body (3..4000); pagePath? (≤200); appVersion? (≤40); allowLookIn?: boolean }
SchoolCommentDto { body (1..4000) }   ReopenDto { body (3..4000) }   LookInDto { allow: boolean }
OwnerCommentDto { body (1..4000); visibleToSchool?: boolean }   OwnerStatusDto { status ∈ SUPPORT_STATUSES; note? (≤4000) }
AssignDto { assign: boolean }   PatchTicketDto { externalRef: string|null (≤120) }
// Service
type SchoolViewer = { schoolId: string; userId: string };  type Owner = { userId: string };
class SupportService {
  schoolCounts(v): Promise<SupportSchoolCounts>; schoolList(v, status: 'OPEN'|'CLOSED'|'ALL'): Promise<SupportTicketRow[]>;
  create(v, dto, files: UploadedImage[], meta: { userAgent: string|null }): Promise<SupportTicketDetail>;
  schoolDetail(v, id): Promise<SupportTicketDetail>; schoolComment(v, id, dto, files): Promise<SupportTicketDetail>;
  confirm(v, id): Promise<SupportTicketDetail>; reopen(v, id, body): Promise<SupportTicketDetail>; setLookIn(v, id, allow): Promise<SupportTicketDetail>;
  schoolFile(v, id, key): Promise<SupportFileLink>;
  ownerCounts(): Promise<SupportOwnerCounts>; ownerBoard(): Promise<SupportBoard>;
  ownerList(f: { schoolId?; status?; type?; module? }): Promise<SupportTicketRow[]>; ownerDetail(o, id): Promise<SupportTicketDetail>;
  ownerStatus(o, id, status, note?): Promise<SupportTicketDetail>; ownerComment(o, id, body, visibleToSchool): Promise<SupportTicketDetail>;
  ownerAssign(o, id, assign): Promise<SupportTicketDetail>; ownerPatch(o, id, externalRef): Promise<SupportTicketDetail>;
  openSchool(o, id): Promise<{ url: string; expiresInSeconds: number }>; ownerFile(id, key): Promise<SupportFileLink>;
  sweepAutoClose(): Promise<number>; // RESOLVED older than 7 d → CLOSED + SYSTEM entry; called at the top of schoolList and ownerBoard
}
```
Controllers: `SchoolSupportController` (`@UseGuards(SchoolJwtGuard, RolesGuard) @Roles('SCHOOL_ADMIN') @Controller('manage/support')`, `FilesInterceptor('files', 5, { limits: { fileSize: SUPPORT_MAX_FILE_BYTES } })` on create and comment, `@Throttle` on create, user agent from `@Req()`); `OwnerSupportController` (`@Controller('owner/support') @UseGuards(OwnerHostGuard, PlatformJwtGuard)`), static routes (`counts`, `board`, `tickets`) declared before `:id`.
Service rules: tenant writes under `withTenant`; owner reads/writes via `getPlatformPrisma()` with explicit `schoolId` in every where; `assertUploadKind(buffer, IMAGE_KINDS, 'photo')` per file; storage key prefix `support/${schoolId}/${ticketId}`; file route finds key in `ticket.attachmentKeys` or `entries.attachmentKeys` else 404; daily limit counts `createdAt >= startOfTodayIST`; owner email through `MailService.sendLetter(contactEmail, null, subject, letter)` where `contactEmail = (await marketing.getConfigRow()).contactEmail` (skip when empty); school notification = `tx.notification.create({ kind: 'SUPPORT', linkType: 'support', linkId })` + `tx.notificationOutbox.create({ kind: 'SUPPORT_UPDATE', payload: { schoolName, title, body }, targetUserId: raisedById })` + `requestOutboxDrain()`; every notify wrapped in try/catch.

- [ ] **Step 1:** `support.dto.spec.ts`: `plainToInstance(CreateTicketDto, { …, allowLookIn: 'true' })` validates and reads `true`; `'false'` → false; missing → undefined/false; title of 121 chars fails; unknown module fails. Run → FAIL. Implement DTOs → PASS.
- [ ] **Step 2:** Implement service + controllers + module; `pnpm --filter @skoolos/api typecheck` → PASS; `pnpm --filter @skoolos/api test` → PASS (outbox fixtures/kinds compile, `route-contract.spec` reads the new controllers with no `unreadable`).
- [ ] **Step 3:** Commit `feat(api): support desk module — school and owner doors, files, notifications`.

### Task 5: End-to-end: authorization, behaviour, manifest

**Files:**
- Create: `apps/api/test/support-authz.e2e-spec.ts` (routes × roles; owner-host pattern from `backups-authz`)
- Create: `apps/api/test/support-desk.e2e-spec.ts` (behaviour)
- Modify: `apps/api/test/route-manifest.ts` (every new route under a `// Support desk` comment)

Behaviour spec, each its own `it`, all against the booted `AppModule` with `ValidationPipe({ whitelist: true, transform: true })`:
1. Admin creates a ticket with two PNG buffers (`.attach('files', png, 'a.png')` twice, fields as multipart) → 201, `ticketNo` matches `/^SK-\d{6}$/`, `attachments.length === 2`, `context.tier === 'PRO'`, `status 'OPEN'`.
2. A JPEG-named file with text bytes → 400 `UNSUPPORTED_FILE_TYPE`; six files → 400.
3. Second school's admin: `GET /manage/support/:id` → 404; `GET /manage/support` lists nothing of school one.
4. Owner: `GET /owner/support/board` lists school one with `open 1`, `oldestUnansweredTitle`; `GET /owner/support/counts` `unanswered ≥ 1`.
5. Owner `POST :id/status { status: 'ACKNOWLEDGED' }` → 200; school detail shows `status 'ACKNOWLEDGED'` and a notification row `kind 'SUPPORT'` for the raiser; outbox row `SUPPORT_UPDATE` with `targetUserId`.
6. Owner private note (`visibleToSchool: false`) → school detail `entries` excludes it; owner detail includes it.
7. Owner `status WAITING_ON_SCHOOL`; school comment → status flips to `IN_PROGRESS`.
8. Owner `status 'CLOSED'` from `IN_PROGRESS` → 409 `SUPPORT_ILLEGAL_MOVE`; status unchanged.
9. School `confirm` on `IN_PROGRESS` → 409; owner `RESOLVED` then school `confirm` → `CLOSED`, `closedAt` set.
10. Reopen: after CLOSED → `POST :id/reopen` → `OPEN`, `reopenedAt` set; set `resolvedAt` 15 days back via platform client then reopen → 400 `SUPPORT_REOPEN_WINDOW`.
11. Look-in: owner `open-school` with no consent → 409 `SUPPORT_LOOK_IN_REQUIRED`; school `look-in { allow: true }` → `lookInUntil` ≈ now+48 h; owner `open-school` → 200 `{ url }` containing `/login?imp=`; school detail has a SYSTEM entry mentioning "opened"; school `look-in { allow: false }` → null.
12. File: school `GET :id/file?key=<attachments[0].key>` → 200 with `url`; `?key=support/other` → 404; owner same key → 200.
13. Daily limit: create 20 more via platform client inserts (`createdAt now`) then `POST` → 429 `SUPPORT_DAILY_LIMIT`.
14. Auto-close: a RESOLVED ticket with `resolvedAt` 8 days back; `GET /owner/support/board` → that ticket now `CLOSED` with a SYSTEM entry.
15. RLS forge: `withTenant(schoolOne, tx => tx.supportTicket.create({ data: { schoolId: schoolTwo, … } }))` rejects `/row-level security|42501/`.

- [ ] **Step 1:** Write `support-authz.e2e-spec.ts`; run `pnpm --filter @skoolos/api test:e2e -- test/support-authz` → PASS (routes exist from Task 4) and confirm `route-coverage.e2e-spec` FAILS naming the unlisted routes.
- [ ] **Step 2:** Add routes to `AUTHZ_REVIEWED`; `test:e2e -- test/route-coverage` → PASS.
- [ ] **Step 3:** Write `support-desk.e2e-spec.ts` items 1–15; run; fix service until PASS. For item 8 temporarily remove `assertOwnerMove` and watch it fail, restore.
- [ ] **Step 4:** Full `pnpm --filter @skoolos/api test:e2e` → PASS, exits cleanly.
- [ ] **Step 5:** Commit `test(api): support desk e2e — doors, tenancy, status machine, look-in, files, limits`.

### Task 6: Web shared pieces — helpers, thread, report drawer, sidebar door

**Files:**
- Create: `apps/web/lib/support.ts` (`ago` re-export from `lib/concerns`, `TYPE_OPTIONS`, `MODULE_OPTIONS`, `SEVERITY_OPTIONS`, `moduleForPath(pathname): SupportModule`, `browserLabel()` not needed client-side)
- Create: `apps/web/components/support/ticket-thread.tsx` (`TicketThread({ ticket, viewer: 'SCHOOL'|'OWNER', busy, onComment(body, files, visibleToSchool), onConfirm?, onReopen?, onLookIn?, onStatus?, fileLink(key) })`)
- Create: `apps/web/components/support/report-problem.tsx` (`ReportProblem({ pagePath, onClose, onCreated })` — kit Overlay side `end`, Field for every control, three segmented groups rendered as `button[aria-pressed]`, `input type=file multiple accept=image/*` capped at 5 with per-file 5 MB check, captured box showing pagePath + browser string from `navigator.userAgent` trimmed client-side for display only, look-in checkbox, Submit via `api.postForm('/manage/support', fd)`; error mapping: 413/“too large” → field message under Photos, 429 → Note "limit reached today", 503 STORAGE_UNAVAILABLE → server message, offline → "You seem offline")
- Create: `apps/web/components/support/report-door.tsx` (sidebar footer button "Report a problem" that mounts `ReportProblem` with `usePathname()`)
- Modify: `apps/web/app/app/layout.tsx` (ReportDoor in both footers above SwitchProfile)
- Modify: `apps/web/app/sk-theme.css` (`.sk-sup-seg`, `.sk-sup-ctx`, `.sk-sup-thumbs`, `.sk-sup-entry[data-private]`, `.sk-sup-sys` — tokens only, both themes inherit)
- Test: `apps/web/components/support/report-problem.test.tsx`

- [ ] **Step 1:** Test: renders with `pagePath '/app/fees'` → module preselected `FEES`; submit without title → inline error, no request; six files → message, only five kept; `postForm` rejects with `ApiError(429, 'Limit reached')` → Note visible, dialog stays; `ApiError(503, 'The file store is unreachable…')` → message shown verbatim; success → `onCreated` called with ticket. Run → FAIL.
- [ ] **Step 2:** Implement components + CSS; `pnpm --filter @skoolos/web test -- report-problem` → PASS; `pnpm --filter @skoolos/web typecheck` → PASS.
- [ ] **Step 3:** Commit `feat(web): Report a problem drawer, ticket thread, sidebar door`.

### Task 7: Admin Help page and nav

**Files:**
- Create: `apps/web/app/app/support/page.tsx` (HubPage "Help", HubKpis open/waiting on you/closed, chips OPEN/CLOSED/ALL, RowList `minmax(0,1.6fr) 140px auto auto` → ticketNo+title/module·severity | status pill | ago; drawer `TicketThread` viewer SCHOOL; "Report a problem" HubPage action)
- Modify: `apps/web/app/app/nav-model.ts` (item `{ href: '/app/support', label: 'Help', icon: LifeBuoy }` directly before Settings; keep Settings last), `apps/web/app/app/nav-model.test.ts` (`EVERY_ROUTE` + `/app/support`)
- Test: `apps/web/app/app/support/support.test.tsx`

- [ ] **Step 1:** Tests: list shows `SK-000142` with "Waiting on you" pill tone warn; opening a row renders dialog outside container; detail with `canConfirm` shows "Yes, it's fixed"; with `canReopen` shows Reopen; `get` rejecting 500 → error state with retry, never the empty copy; empty list → copy mentions Report a problem. Run → FAIL.
- [ ] **Step 2:** Implement; `pnpm --filter @skoolos/web test -- support nav-model sk-kit hub-pages` → PASS; typecheck PASS.
- [ ] **Step 3:** Commit `feat(web): admin Help page — tickets, thread drawer, nav item`.

### Task 8: Owner Support board and desk

**Files:**
- Create: `apps/web/app/platform/support/desk.ts` (`ticketTone(status, unansweredHours): QueueTone` — unanswered > 24 → 'bad'; WAITING_ON_SCHOOL 'warn'; OPEN/ACKNOWLEDGED/IN_PROGRESS 'info'; RESOLVED 'good'; CLOSED 'neutral'; `hoursSince(iso, now)`), `desk.test.ts` (mirrors `orders/queue.test.ts`, incl. CSS rule presence for `.sk-sup-row[data-tone='…']`)
- Create: `apps/web/app/platform/support/page.tsx` (figures via `.sk-own-attn` ×3; board table in `.sk-own-tablewrap`/`.sk-own-table` with late stripe `data-tone`; filters: four `<select>` (school, status, type, module) in a `.sk-own-field` row; list rows link to `[id]`)
- Create: `apps/web/app/platform/support/[id]/page.tsx` (`TicketThread` viewer OWNER inside `.sk-own-panel`; desk card: status select + note + "Move", assign to me toggle, GitHub ref input + save, look-in state, same-module count, "Open as this school" button enabled only when `lookInUntil` is future → `window.open(url)`)
- Modify: `apps/web/app/platform/layout.tsx` (nav item `{ href: '/platform/support', label: 'Support', icon: LifeBuoy, badge: 'supportUnanswered' }` after Schools; badge union + second query `GET /owner/support/counts` with `staleTime 60_000`, merged into `attention`), `apps/web/app/platform/query-states.test.ts` (`['support', 'app/platform/support/page.tsx', 'board', 'board.data']`), `apps/web/app/sk-theme.css` (`.sk-sup-row[data-tone]`, `.sk-sup-late`)
- Test: `apps/web/app/platform/support/support.test.tsx` (board renders school rows late-first with the late stripe; filters change the query string; desk page: private toggle sends `visibleToSchool:false`; Open-as-school disabled without consent; status select offers only `OWNER_MOVES[status]`)

- [ ] **Step 1:** `desk.test.ts` → FAIL → implement → PASS.
- [ ] **Step 2:** Page tests → FAIL → implement → PASS; `pnpm --filter @skoolos/web test -- platform` (hosts, action-tables, query-states, layout-tokens) → PASS; typecheck PASS.
- [ ] **Step 3:** Commit `feat(web): owner Support tab — school-wise board, desk, nav badge`.

### Task 9: Gates, visual check, staging

- [ ] **Step 1:** `pnpm --filter @skoolos/api lint typecheck test`, `pnpm --filter @skoolos/web lint typecheck test`, `pnpm --filter @skoolos/types test`, `pnpm --filter @skoolos/db test`, `pnpm boundary`, `pnpm build` (nothing sourced). All PASS.
- [ ] **Step 2:** `pnpm --filter @skoolos/api test:e2e` full → PASS.
- [ ] **Step 3:** `pnpm --filter @skoolos/web audit:screens` with the two admin screens and the two owner screens registered; serve `audit/`, read `measure.html` at 360/390/768/1280 → no OVERFLOW/CLIPPED/TAP/RAGGED.
- [ ] **Step 4:** Dispatch one adversarial review subagent (cross-tenant reads on owner routes, file-key handling, look-in gate, throttle bypass, RLS on both tables). Fix findings, re-run the affected suites. Log the dispatch with `pnpm dispatch:log`.
- [ ] **Step 5:** `git fetch origin && git log --oneline HEAD..origin/staging` → empty or rebase. Push `feat/support-desk`, open PR to `staging`, read `gh pr checks` until green. Smoke `GET https://api.test.sckools.com/ready` after the deploy. Raise one real ticket from `raffles.test.sckools.com` as `admin@raffles.test` and answer it from `owner.test.sckools.com`.
- [ ] **Step 6:** Append the QA atlas audit entry (`qa-site/audits.json`) and refresh `sckools-expert` references for the new module.
