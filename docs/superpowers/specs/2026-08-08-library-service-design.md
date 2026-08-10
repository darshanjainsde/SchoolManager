# Library Service — design spec

**Date:** 2026-08-08
**Branch:** `feat/library-service` (worktree at `/Users/darshanjain/skoolos-library`, based on `origin/main` @ `eb4d19a`)
**Status:** approved design, pending implementation plans

---

## 1. Summary

A standalone, multi-tenant **library management microservice** that runs a school
library (book lending) *and* a paid reading room (seats, shifts, subscriptions) for
many organisations at once. It is built beside Sckools — same monorepo, same tooling,
same operational patterns — with **no code, database, or deploy coupling**, so it can
be tested in isolation and merged into Sckools later as a routing change rather than a
rewrite.

New workspaces:

```
packages/library-db/     own schema.prisma, own PrismaClient, own migrations
apps/library-api/        NestJS 11, mirrors apps/api conventions
apps/library-web/        Next 15 / React 19 console + member portal
apps/testboard/          library.trackyour.in/test — run and observe every test, any target
packages/testboard-db/   own schema for run history
```

### Goals

1. Run a complete school library: catalogue, copies, issue/return/renew, holds, fines.
2. Run a complete reading room: branches, floors, seat maps, shifts, subscriptions,
   attendance, fees, expenses, reports.
3. Be genuinely multi-tenant: a new school is a **row insert, never a deploy**, and
   each school configures its own branches, shifts, policies, forms and branding.
4. Add a `LIBRARIAN` role that logs in on web (and later the mobile app) alongside
   teachers and students.
5. Be stateless and horizontally scalable from the first commit — nothing in process
   memory, every scaling constraint from the Sckools baseline designed around, not
   retrofitted.
6. Ship a hosted test dashboard at `library.trackyour.in/test` that shows functional **and**
   non-functional results and can dispatch a run against any target machine or server.

### Non-goals (explicitly deferred)

- Payment gateway / real money collection. Plan is a column; invoices record what was
  collected at the desk.
- Merging with Sckools auth, database, or deploy. Designed for it (§13), not doing it.
- Mobile app screens. The API is designed mobile-ready; screens come after Phase 5.
- Inter-library loan, acquisitions/purchase orders, MARC/Z39.50 import, OPAC
  federation. Real library-science features, none of them needed to be useful.

---

## 2. Research basis

### 2.1 The lending core (awesome-low-level-design)

The reference LLD is a small OOP exercise: `Book`, `Member`, `LibraryManager`
(singleton, concurrent maps), borrow/return, max-books and loan-duration rules,
keyword search. We take its **domain vocabulary and rules** and discard its
mechanics — a singleton with concurrent collections is the wrong answer for a
horizontally-scaled stateless service. Its concurrency requirement is met by database
constraints instead (§6.4).

Rules adopted: per-member borrowing cap, fixed loan duration, availability status per
copy, keyword search, member borrowing history.

Rules added because the LLD omits them and every real library needs them: **copies
distinct from titles**, holds/reservations with a queue, renewals with a limit,
fines with waivers, per-member-type policy, multi-branch.

### 2.2 The reading-room layer (librify.in)

Librify is not a book system — it is a study-hall SaaS for Indian reading rooms, and
its entire product is *seats × shifts × subscriptions*. Verified feature inventory:

| Area | Shipped features |
|---|---|
| Students | QR self-registration, custom registration form (photo/ID proof/address), approve-decline workflow, profiles with subscription + payment history, search/filter, status (active/pending/inactive) |
| Seats & shifts | Floor-wise interactive seat map, shifts (Morning/Afternoon/Evening/Night/Full-day/24h) each with own timing **and own price**, live per-shift availability, fixed vs floating seats |
| Subscriptions | Auto start/end tracking, expiry alerts, dues tracking, payment history, renew/upgrade |
| Attendance | One-click marking, self check-in vs admin-marked **source tracking**, shift filter, fixed/floating tabs, date-wise history, search/sort |
| Money | Revenue dashboard, payment-source split (cash/UPI), revenue charts, transaction list, expense tracker (rent/electricity/salary/maintenance), fee receipts, Excel/PDF export, daily "actionable items" |
| Comms | WhatsApp fee receipt, payment-due reminder, expiry reminder; in-app notifications; custom notifications |
| Org | Multi-branch with per-branch shifts/seats/students, consolidated reporting, multiple admins/co-owners with role-based access |
| Platform | Web + Android + PWA, Firebase phone-OTP auth, 8 Indian language options |

Their pricing gates almost entirely on **counts and money features**, which is why our
entitlement resolver must return quotas, not just booleans (§8):

| Plan | Price | Gate |
|---|---|---|
| Free | ₹0 | QR add, basic analytics, basic registration form + student management, **1 branch, 1 admin** |
| Mini | ₹590/yr | + reports, revenue dashboard, expense tracker, custom registration form, WhatsApp receipt + due reminder. Still **1 branch, 1 admin** |
| Pro | ₹1,490/yr | + **unlimited branches**, **unlimited admins**, WhatsApp expiry reminders, priority support |

We adopt the shape and the gate points; prices are a column, set later.

---

## 3. Architecture

### 3.1 Services and domains

| Vercel project | Domain(s) | Contents |
|---|---|---|
| `library-api` | `api.library.trackyour.in` | NestJS 11, ncc-bundled into one catch-all function, `maxDuration: 60`, region `bom1` |
| `library-web` | `app.library.trackyour.in`, `*.library.trackyour.in` | Next 15 App Router. One deployment, tenant by Host header: console (`/console`), member portal (`/me`), public catalogue (`/`) |
| `library-testboard` | `library.trackyour.in` | Test control plane and results dashboard, served at `/test` |

Wildcard `*.library.trackyour.in` gives the same onboarding property Sckools has:
`raffles.library.trackyour.in` starts working the moment an `Org` + `Domain` row
exists. Explicit domains (`api.…`, `app.…`) resolve before the wildcard, so they never
collide — the same rule `api.sckools.com` already relies on.

`test.trackyour.in` is deliberately **not** used: it already serves the Sckools test
dashboard (verified — `/` 307s to `/sckools/`), and taking that domain over would put a
working dashboard at risk for no gain. The library testboard gets its own front door.

**Region is `bom1` (Mumbai) for every project, matching the ap-south-1 database.**
Non-negotiable: a cross-region hop costs ~150 ms, more than ~100 same-region queries.

### 3.2 Database isolation

Same staging Supabase project (`pnczxkyteaocpdoufwyz`, ap-south-1), **separate
Postgres schemas**:

- `library` — all library tables
- `testboard` — test run history

The library connection strings carry **`?schema=library`**. This is the load-bearing
detail: Prisma writes its `_prisma_migrations` table into the connection's default
schema, so the library gets its own migration history inside `library`, and
`pnpm db:migrate` for Sckools can never see, touch, or drift against it. The two
Prisma projects are mutually invisible.

Three database roles, mirroring the Sckools split:

| Role | URL env | Use |
|---|---|---|
| `library_app` | `LIBRARY_DATABASE_URL_APP` | RLS-enforced. Every request path. |
| `library_platform` | `LIBRARY_DATABASE_URL_PLATFORM` | `BYPASSRLS`. Only login, host lookup, org console, crons — each re-scoping by `orgId` in code. |
| superuser | `LIBRARY_DIRECT_URL` | Migrations only (session pooler `:5432`). |

Runtime uses the **transaction pooler `:6543`** with `connection_limit=1` pinned in
the URL (§9.1).

### 3.3 Statelessness

Nothing lives in process memory. Explicitly:

| Concern | Where it lives |
|---|---|
| Session | Stateless JWT (access) + hashed refresh token rows |
| Cache | Upstash Redis, `lib:` key prefix, fail-open cache-aside |
| Rate limiting | Redis-backed throttler storage (**not** the in-memory default) |
| Locks / queue position | Postgres `SELECT … FOR UPDATE`, never an in-process mutex |
| Async work | `NotificationOutbox` table + cron drain |
| Files (covers, ID proofs) | Supabase Storage bucket `library-files`, public URL written to a row; bytes never re-transit the API |
| Idempotency | `IdempotencyKey` table, not a memory map |

Any instance can serve any request; instance count is a throughput dial with no
correctness consequence.

### 3.4 Module boundaries

`apps/library-api/src/modules/*` follows the Sckools convention exactly: a module
exports only through `index.ts`, everything else lives in `internal/`, and
`dependency-cruiser` enforces it in `pnpm boundary`. Modules:

```
tenancy    org resolution, org context, RLS wrapper
auth       login, refresh rotation, invites, password reset
plans      capability + quota resolver, RequireFeature guard
catalog    titles, authors, categories, copies, search, import
circulation loans, holds, renewals, fines, policy engine
rooms      branches, zones, seats, shifts, subscriptions, attendance
billing    invoices, payments, receipts, expenses, reports
members    member records, registration forms, QR self-registration
notify     outbox, templates, channel adapters
console    org-level admin: staff accounts, plan, settings, branding
health     /ready, /live
```

`circulation` may import `catalog` (it moves copies) but `catalog` must never import
`circulation`. `rooms` and `catalog` never import each other — they meet only at
`members`.

---

## 4. Tenancy and security

### 4.1 Resolution

Identical to the Sckools spine, which is verified-correct and must survive:

1. Tenant comes from **`X-Library-Host`** (app-controlled header) → `req.hostname`
   → `req.headers.host`. The header exists because Vercel's ingress overwrites
   `X-Forwarded-Host`, which would otherwise collapse every request to one host.
2. `orgMiddleware` → `OrgLookupService`: Redis `libhost:<hostname>` (60 s, fail-open)
   → `LibraryDomain` row with `status: LIVE` → `<slug>.library.<PLATFORM_HOST>`
   fallback → `unknown`.
3. Result rides in `AsyncLocalStorage` and on `req.org`.

### 4.2 Row-level security

`withOrg(orgId, fn)` opens a transaction and issues
`SET LOCAL app.current_org = '<uuid>'`, UUID-regex validated before interpolation.
`SET LOCAL` is **transaction-scoped**, so pgbouncer connection reuse cannot leak a
tenant — this is why the transaction wrapper is mandatory, not stylistic.

Policies read `NULLIF(current_setting('app.current_org', true), '')::uuid`. The
`NULLIF` matters: `current_setting(..., true)` returns NULL only for a session
that has *never* touched the GUC. Once `SET LOCAL app.current_org` has run once
on a pooled connection, Postgres gives that custom GUC a reset value of the
empty string `''`, not "unset" — so a later unscoped query on that same reused
connection would otherwise see `''::uuid`, a hard Postgres error, instead of
the intended zero-rows comparison. `NULLIF` collapses both the never-set case
(NULL) and the reset-after-`SET LOCAL` case (`''`) to NULL before the cast, so
an unscoped query reliably returns zero rows rather than every row or an
error. **Fail closed.**

`ENABLE ROW LEVEL SECURITY` on **every** table carrying `orgId`, with **no
exceptions** — this, not `FORCE ROW LEVEL SECURITY`, is the control that
actually protects us. `FORCE` only extends RLS enforcement to the table
*owner*; our tables are owned by `postgres` (migrations run as that role),
while the app connects as `library_app`, which is not the owner, not a
superuser, and not `BYPASSRLS`. Plain `relrowsecurity` (`ENABLE`) already
applies to `library_app` regardless of `FORCE`, because `library_app` is
exactly the kind of non-owner, non-superuser role RLS was designed to
restrict — `FORCE` changes nothing for it. We still set `FORCE` on every
table as defence-in-depth: if a future migration or a manual `ALTER TABLE
... OWNER TO` ever makes `library_app` the owner (or a bug grants it
elevated rights), `FORCE` is what would keep RLS applying even then. But it
is not the mechanism that protects us today — do not reason about isolation
as "protected because FORCE is set." Sckools has a known gap here
(`BlogPost`, `SchoolBlogSelection` are tenant-scoped with no policies); we do
not repeat it, and the testboard runs an **RLS coverage audit** that fails
if any `orgId`-bearing table lacks `ENABLE`+`FORCE`+a policy whose `USING`
expression actually scopes by `app.current_org` (§11.2) — a policy created
with `USING (true)` is forced and policied but scopes nothing, so the audit
checks the policy's expression text, not just its existence.

Token tables (`RefreshToken`, `PasswordResetToken`, `RegistrationToken`) hold hashed
single-use values and are keyed by hash lookup, so they are exempt by design — the
audit carries an explicit allow-list of exactly those three, and adding a fourth
requires editing the allow-list, which is visible in review.

### 4.3 Branch scoping

Org isolation is the **security** boundary (RLS). Branch is an **authorization**
boundary, enforced in the app by `BranchScopeGuard`: a `LibUser` carries
`branchIds[]`, and the guard injects a branch filter into the request context. A
librarian scoped to Branch A cannot read Branch B, but the failure mode is a 403, not
a data leak across organisations.

### 4.4 Auth

- Audience-split JWT (`aud: "library"`), separate secret from both Sckools secrets, so
  a Sckools token can never validate here and vice versa.
- Bearer only, no cookies. argon2id password hashes, lockout counters on `LibUser`.
- Refresh tokens stored as SHA-256 hashes with a `familyId`; **replay of a revoked
  token revokes the whole family** in its own committed transaction before the 401.
- Login accepts email / phone / member code, all misses collapsing to one generic
  error message and one timing profile.
- Guard chain, in order:

```
RedisThrottlerGuard (global)
  → LibJwtGuard          (per controller — there is no global JWT guard)
  → OrgHostGuard
  → RequireFeatureGuard  (capability + quota)
  → RolesGuard
  → BranchScopeGuard
```

Because there is no global JWT guard, **every controller spec asserts its own guard
set**, and the authz-matrix suite (§11.1) fails on any endpoint absent from the
matrix. An unguarded controller is an open endpoint; a test must be what says so.

---

## 5. Data model

All tables carry `id uuid pk`, `createdAt`, `updatedAt`. All tenant tables carry
`orgId uuid` (RLS) and, where operational, `branchId uuid`.

### 5.1 Identity and org

**`LibraryOrg`** — `slug` (unique), `name`, `plan` (`FREE|MINI|PRO`), `status`
(`SETUP|LIVE|SUSPENDED`), `currency` (default `INR`), `timezone` (default
`Asia/Kolkata`), `locale`, `contactEmail`, `contactPhone`.

**`LibraryDomain`** — `orgId`, `hostname` (unique), `type` (`SUBDOMAIN|CUSTOM`),
`status` (`PENDING|LIVE|ERROR`).

**`OrgTheme`** — `orgId` (unique), `logoUrl`, `primaryColor`, `accentColor`,
`receiptHeader`, `receiptFooter`.

**`Branch`** — `orgId`, `name`, `code` (unique per org), `address`, `phone`,
`openTime`, `closeTime`, `active`.

**`LibUser`** — a *login*. `orgId`, `email` (nullable), `phone` (nullable),
`passwordHash`, `role` (`ORG_OWNER|LIBRARIAN|ASSISTANT|MEMBER`), `branchIds uuid[]`,
`memberId` (nullable — set when this login belongs to a patron), `status`,
`failedAttempts`, `lockedUntil`, `lastLoginAt`.
Unique: `(orgId, email)`, `(orgId, phone)`.

**`Member`** — a *patron record*. `orgId`, `code` (unique per org, e.g. `LIB-00042`),
`memberType` (`STUDENT|TEACHER|EXTERNAL`), `firstName`, `lastName`, `phone`, `email`,
`photoUrl`, `address`, `customFields jsonb`, `status`
(`PENDING|ACTIVE|SUSPENDED|EXPIRED`), `joinedAt`, `homeBranchId`,
`externalRef` (nullable — holds the Sckools `Student.id` / `Teacher.id` at merge time).

`MemberType` is a fixed enum rather than a per-org table, because `CirculationPolicy`
is keyed on it and a free-text type would make the policy lookup unbounded. What *is*
per-org is the **label and code prefix** for each type (`OrgTheme.memberTypeLabels
jsonb`), so a school can call `EXTERNAL` "Alumni" without changing the policy model.

> **Why `LibUser` and `Member` are separate tables.** A patron can exist with no
> login (a walk-in, or a child registered by staff); a librarian is a login with no
> patron record; and at merge time a Sckools student gains a library `Member` without
> gaining a second password. Fusing them is the most common mistake in this domain and
> forces a migration the first time self check-in ships.

### 5.2 Catalogue

**`Title`** — the bibliographic record. `orgId`, `isbn13`, `isbn10`, `title`,
`subtitle`, `publisher`, `publishedYear`, `edition`, `language`, `callNumber`,
`coverUrl`, `description`, `pageCount`,
`searchVector tsvector` **generated column** over title+subtitle+authors+publisher,
GIN-indexed.
Unique: `(orgId, isbn13)` where `isbn13` is not null.

**`Author`** — `orgId`, `name`, `sortName`. Unique `(orgId, sortName)`.
**`TitleAuthor`** — `titleId`, `authorId`, `role` (`AUTHOR|EDITOR|TRANSLATOR`).
**`Category`** — `orgId`, `name`, `parentId` (nullable, one level of nesting).
**`TitleCategory`** — `titleId`, `categoryId`.

**`Copy`** — the physical item. `orgId`, `titleId`, `branchId`, `barcode` (unique per
org), `accessionNumber`, `shelf`, `condition` (`NEW|GOOD|FAIR|POOR`), `acquiredAt`,
`acquisitionCost`, `status`
(`AVAILABLE|ON_LOAN|ON_HOLD_SHELF|IN_TRANSIT|LOST|DAMAGED|WITHDRAWN`).

### 5.3 Circulation

**`CirculationPolicy`** — `orgId`, `branchId` (nullable = org default), `memberType`,
`maxBooks`, `loanDays`, `renewLimit`, `renewDays`, `finePerDay`, `graceDays`,
`maxFine` (nullable cap), `maxHolds`, `holdShelfDays`.
Unique: `(orgId, branchId, memberType)`.

**`Loan`** — `orgId`, `branchId`, `copyId`, `memberId`, `issuedAt`, `dueAt`,
`returnedAt` (nullable), `renewCount`, `issuedByUserId`, `returnedByUserId`,
`status` (`ACTIVE|RETURNED|LOST`).

> `OVERDUE` is deliberately **not** a stored status — see §6.3.

**`Hold`** — placed on a **Title**, not a Copy (a member wants the book, not that
copy). `orgId`, `branchId`, `titleId`, `memberId`, `placedAt`, `queuePosition`,
`status` (`PENDING|READY|COLLECTED|EXPIRED|CANCELLED`), `readyCopyId` (nullable),
`readyAt`, `expiresAt`.

**`Fine`** — `orgId`, `memberId`, `loanId` (nullable), `kind`
(`OVERDUE|DAMAGE|LOST|OTHER`), `amount`, `waivedAmount`, `waivedByUserId`,
`waivedReason`, `status` (`OPEN|PAID|WAIVED|PARTIAL`).

### 5.4 Reading room

**`Shift`** — `orgId`, `branchId`, `name`, `startTime`, `endTime`, `price`,
`colorHex`, `active`, `sortOrder`. Crosses-midnight allowed (`endTime < startTime`
means next day), which is how "Night" and "24-Hour" work.

**`Zone`** — `orgId`, `branchId`, `name` (e.g. "Ground floor"), `sortOrder`,
`mapWidth`, `mapHeight`.

**`Seat`** — `orgId`, `branchId`, `zoneId`, `label` (unique per zone), `seatType`
(`FIXED|FLOATING`), `x`, `y`, `active`.

**`Subscription`** — `orgId`, `branchId`, `memberId`, `shiftId`, `seatId` (nullable —
null means floating), `startDate`, `endDate`, `amount`, `status`
(`ACTIVE|CANCELLED`), `createdByUserId`.

> `EXPIRING` / `EXPIRED` are computed from `endDate`, not stored — §6.3.

**`RoomAttendance`** — `orgId`, `branchId`, `memberId`, `shiftId`, `date`,
`checkInAt`, `checkOutAt` (nullable), `source` (`QR|MANUAL|APP`),
`markedByUserId` (nullable — null when self check-in).
Unique: `(orgId, memberId, shiftId, date)`.

### 5.5 Money

**`Invoice`** — `orgId`, `branchId`, `memberId`, `number` (unique per org, generated),
`kind` (`SUBSCRIPTION|FINE|MIXED`), `subtotal`, `discount`, `total`, `issuedAt`,
`status` (`UNPAID|PAID|PARTIAL|VOID`).
**`InvoiceLine`** — `invoiceId`, `description`, `amount`, `subscriptionId` (nullable),
`fineId` (nullable).
**`Payment`** — `orgId`, `invoiceId`, `amount`, `mode` (`CASH|UPI|CARD|BANK|OTHER`),
`reference`, `paidAt`, `collectedByUserId`, `receiptNumber` (unique per org).
**`Expense`** — `orgId`, `branchId`, `category`
(`RENT|ELECTRICITY|SALARY|MAINTENANCE|SUPPLIES|INTERNET|OTHER`), `amount`, `spentAt`,
`note`, `attachmentUrl`, `recordedByUserId`.

### 5.6 Members, registration, ops

**`RegistrationForm`** — `orgId`, `branchId` (nullable), `fields jsonb` (ordered array
of `{key,label,type,required,options}`), `active`, `version`.
**`Registration`** — `orgId`, `branchId`, `formVersion`, `payload jsonb`, `photoUrl`,
`status` (`PENDING|APPROVED|DECLINED`), `reviewedByUserId`, `reviewedAt`,
`declineReason`, `memberId` (set on approval), `sourceIp`, `submittedAt`.
**`RegistrationToken`** — the QR payload: `orgId`, `branchId`, `tokenHash`,
`expiresAt`, `usesRemaining` (nullable = unlimited), `createdByUserId`.

**`NotificationTemplate`** — `orgId`, `key`
(`FEE_RECEIPT|DUE_REMINDER|OVERDUE_NOTICE|HOLD_READY|SUB_EXPIRY|WELCOME`), `channel`
(`WHATSAPP|SMS|EMAIL|INAPP`), `body`, `enabled`.
**`NotificationOutbox`** — `orgId`, `channel`, `templateKey`, `to`, `payload jsonb`,
`scheduledFor`, `sentAt`, `attempts`, `lastError`, `providerRef`.
Indexed `(orgId, sentAt)` and `(scheduledFor)` where `sentAt is null`.

**`IdempotencyKey`** — `orgId`, `key` (client-supplied), `endpoint`, `requestHash`,
`responseStatus`, `responseBody jsonb`, `createdAt`. Unique `(orgId, key)`.
**`AuditLog`** — `orgId`, `actorUserId`, `action`, `entity`, `entityId`,
`before jsonb`, `after jsonb`, `ip`, `at`.

### 5.7 Constraints and indexes that carry correctness

These are not optimisations; they are the concurrency design (§6.4).

```sql
-- a copy can have at most ONE active loan, ever
CREATE UNIQUE INDEX loan_one_active_per_copy
  ON library."Loan" ("copyId") WHERE "returnedAt" IS NULL;

-- a fixed seat can have at most ONE active subscription per shift at a time
CREATE UNIQUE INDEX sub_one_active_per_seat_shift
  ON library."Subscription" ("seatId", "shiftId")
  WHERE "status" = 'ACTIVE' AND "seatId" IS NOT NULL;

-- one attendance row per member per shift per day
CREATE UNIQUE INDEX att_one_per_member_shift_day
  ON library."RoomAttendance" ("orgId", "memberId", "shiftId", "date");

-- one pending hold per member per title
CREATE UNIQUE INDEX hold_one_pending_per_member_title
  ON library."Hold" ("memberId", "titleId") WHERE "status" IN ('PENDING','READY');

-- full-text catalogue search
CREATE INDEX title_search ON library."Title" USING GIN ("searchVector");

-- the hot read paths
CREATE INDEX loan_member_active ON library."Loan" ("orgId","memberId") WHERE "returnedAt" IS NULL;
CREATE INDEX loan_due          ON library."Loan" ("orgId","dueAt")     WHERE "returnedAt" IS NULL;
CREATE INDEX sub_active_end    ON library."Subscription" ("orgId","endDate") WHERE "status"='ACTIVE';
CREATE INDEX att_branch_date   ON library."RoomAttendance" ("orgId","branchId","date");
CREATE INDEX copy_title_status ON library."Copy" ("titleId","status");
```

---

## 6. Domain rules

### 6.1 The circulation policy engine

Every circulation decision goes through **pure functions** in
`circulation/internal/policy.ts` that take plain data and return a verdict. No
database, no Nest, no clock — the clock is injected. This makes the rules exhaustively
table-testable, and guarantees the API, a future mobile app, and any report cannot
disagree about them.

```ts
evaluateIssue(policy, member, copy, openLoans, openFines, now)
  → { allowed: true, dueAt } | { allowed: false, reason: IssueDenial }

IssueDenial =
  | 'MEMBER_NOT_ACTIVE' | 'MEMBER_LIMIT_REACHED' | 'COPY_NOT_AVAILABLE'
  | 'COPY_ON_HOLD_FOR_OTHER' | 'OUTSTANDING_FINES_EXCEED_LIMIT'
  | 'BRANCH_MISMATCH'

evaluateRenew(policy, loan, holdsOnTitle, now)
  → { allowed: true, newDueAt } | { allowed: false, reason: 'RENEW_LIMIT'|'HAS_HOLDS'|'ALREADY_OVERDUE' }

computeFine(policy, dueAt, returnedAt|now)
  → { days, amount }        // graceDays subtracted, capped at maxFine

nextHoldToPromote(holds, now) → Hold | null
subscriptionState(sub, now) → 'ACTIVE' | 'EXPIRING' | 'EXPIRED'   // EXPIRING within 7 days
loanState(loan, now)        → 'ACTIVE' | 'DUE_SOON' | 'OVERDUE' | 'RETURNED'
```

`subscriptionState` and `loanState` are **derived for display and filtering and are
never persisted**. The stored columns are only `Loan.status` (`ACTIVE|RETURNED|LOST`)
and `Subscription.status` (`ACTIVE|CANCELLED`) — facts a human action changed. Anything
that changes because time passed is computed. See §6.3.

### 6.2 Circulation flows

**Issue** — scan barcode → resolve copy → load member, policy, open loans, open fines
→ `evaluateIssue` → in one transaction: create `Loan`, set `Copy.status = ON_LOAN`,
write `AuditLog`. If the copy was `ON_HOLD_SHELF` for this member, mark the hold
`COLLECTED` in the same transaction.

**Return** — scan barcode → resolve active loan → in one transaction: set
`returnedAt`, compute fine (create a `Fine` row only if `amount > 0`), then either
promote the next hold (`Copy.status = ON_HOLD_SHELF`, hold → `READY`, queue an outbox
`HOLD_READY` message) or set `Copy.status = AVAILABLE`.

**Renew** — `evaluateRenew`; refused when the title has pending holds, which is the
rule that keeps a queue moving.

**Hold** — placed on a title. Queue position assigned under `SELECT … FOR UPDATE` on
the title's holds. When a hold goes `READY` it expires after `policy.holdShelfDays`.

### 6.3 The no-scheduler rule

**Verified constraint:** Vercel Hobby permits daily crons only, and a sub-daily cron
**rejects the entire deployment** — this has already left the Sckools API on old code
while web shipped.

Therefore:

> **No state transition is ever performed by a scheduler.** `OVERDUE`, `DUE_SOON`,
> `EXPIRING`, and `EXPIRED` are *computed at read time* from `dueAt` / `endDate` by
> the pure functions in §6.1. They are never columns a cron must flip.

The only scheduled job is a **daily outbox drain** (`0 2 * * *`) which sends messages
and marks `sentAt`. Consequences:

- A missed or failed cron delays a WhatsApp message. It can never corrupt a loan, a
  subscription, or a fine.
- Every list endpoint filters on the underlying date column with an index
  (`loan_due`, `sub_active_end`), so "show me overdue loans" is one indexed range
  scan, not a status scan over a stale column.
- Hold expiry is likewise lazy: an expired hold is skipped by
  `nextHoldToPromote` and swept opportunistically on the next return for that title.

Library crons live in `apps/library-api`'s own `vercel.json`, so a bad cron there can
never block a Sckools deploy.

### 6.4 Concurrency

The LLD reference answers "concurrent access" with a singleton and concurrent maps.
That is wrong for a stateless service on N instances. The real answers:

| Race | Answer |
|---|---|
| Two desks issue the same copy | `loan_one_active_per_copy` partial unique index; the loser gets a 409 |
| Two members book the same fixed seat | `sub_one_active_per_seat_shift` partial unique index |
| Two returns promote the same hold | `SELECT … FOR UPDATE` on the title's hold rows inside the return transaction |
| Barcode scanner double-fires | `IdempotencyKey` on issue / return / payment: same key + same request hash replays the stored response, different hash → 409 |
| Double receipt number | Receipt and invoice numbers from a per-org Postgres sequence, allocated inside the payment transaction |

Constraints do not race. Application-level "check then write" does.

---

## 7. Roles and permissions

| Role | Scope | Can |
|---|---|---|
| `ORG_OWNER` | whole org | Everything: all branches, plan, staff accounts, revenue, expenses, waivers, settings, branding |
| `LIBRARIAN` | assigned branches | Catalogue, copies, circulation, members, registrations, seats/shifts, subscriptions, attendance, fees, branch reports |
| `ASSISTANT` | assigned branches | Desk only: issue, return, renew, check-in, collect payment, print receipt. **No** catalogue edits, **no** revenue/expense visibility, **no** fine waivers, **no** member deletion |
| `MEMBER` | self | Search catalogue, place/cancel hold, view + renew own loans, own seat/shift/attendance, own invoices and receipts, update own profile |

`MemberType` (`STUDENT|TEACHER|EXTERNAL`) drives **circulation policy only, never
permissions**. Keeping the two axes separate is what lets a teacher borrow 10 books
for 30 days without gaining any administrative reach.

The full role × endpoint matrix is a **data table in the test suite** (§11.1); adding
an endpoint without adding its row fails CI.

---

## 8. Plans: capabilities and quotas

The Sckools feature resolver returns a `Set<FeatureKey>`. That cannot express "1
branch" — so this resolver returns **both**:

```ts
resolvePlan(plan, overrides) → {
  capabilities: Set<CapabilityKey>,
  quotas: { branches: number, adminSeats: number }   // Infinity for unlimited
}
```

| | FREE | MINI | PRO |
|---|---|---|---|
| `CATALOG` `CIRCULATION` `MEMBERS` `SEATS` `ATTENDANCE` `QR_REGISTRATION` `BASIC_ANALYTICS` | ✅ | ✅ | ✅ |
| `FEES` `EXPENSES` `REVENUE_DASHBOARD` `REPORTS_EXPORT` `CUSTOM_REG_FORM` `WHATSAPP_RECEIPT` `WHATSAPP_DUE_REMINDER` | — | ✅ | ✅ |
| `MULTI_BRANCH` `MULTI_ADMIN` `WHATSAPP_EXPIRY_REMINDER` `PRIORITY_SUPPORT` | — | — | ✅ |
| `quotas.branches` | 1 | 1 | ∞ |
| `quotas.adminSeats` | 1 | 1 | ∞ |

- `@RequireFeature('REVENUE_DASHBOARD')` guards capability endpoints.
- `@RequireQuota('branches')` guards *creation* endpoints, counting current rows in
  the same transaction as the insert — so two concurrent branch creations on a FREE
  plan cannot both succeed.
- `PlanOverride` rows (`orgId`, `key`, `enabled`) allow per-org exceptions, same shape
  as Sckools' `FeatureOverride`.
- Cached in Redis as `libfeat:<orgId>` for 300 s, fail-open to a DB read, invalidated
  explicitly on plan or override change.
- **Downgrade is non-destructive**: dropping PRO→FREE with 3 branches does not delete
  branches; it blocks creating new ones and marks the excess read-only. Deleting a
  customer's data on a billing event is unrecoverable and unacceptable.

---

## 9. Non-functional design

### 9.1 Connections — the constraint that actually bites

```
Sckools today:   2 PrismaClients × ~3 default pool  = ~6 conns / warm instance
Supabase pooler (small compute): max_clients ≈ 200
                 → wall at ~30–35 concurrently warm instances

Library adds:    2 more clients on the SAME pooler → the ceiling is shared
With connection_limit=1 pinned:  2 conns / warm library instance
```

Decisions, from the first commit:

1. `?connection_limit=1&pgbouncer=true` in both pooled library URLs.
2. Transaction pooler `:6543` at runtime; session pooler `:5432` for migrations only.
3. Cache aggressively so instances never spin up in the first place (§9.2).

Symptom if skipped: intermittent `P2024` pool timeouts under burst, perfectly healthy
at rest — the hardest class of bug to reproduce.

### 9.2 Caching

Sckools' single biggest gap is that public HTML is `no-store`, so every anonymous
visitor costs a web function + an API function + a Postgres query. The library does
not repeat it.

| Surface | Strategy | TTL |
|---|---|---|
| Public catalogue pages (`/`, `/title/[id]`) | Edge cache, `s-maxage=300, stale-while-revalidate=3600`, purged on catalogue write | 5 min / 1 h SWR |
| `libhost:<hostname>` | Redis cache-aside, fail-open | 60 s |
| `libfeat:<orgId>` | Redis cache-aside, explicit invalidation | 300 s |
| `libseat:<branchId>:<shiftId>:<date>` seat map | Redis, invalidated on any subscription/attendance write | 15 s |
| Console + member portal | Never cached — authenticated, per-user | — |

Read:write on the public catalogue is roughly 1000:1, so caching is the whole answer
there; circulation is ~1:1, where **index and constraint correctness** is the answer
and caching is irrelevant.

### 9.3 Capacity model

Assumptions stated so they can be substituted: a mid-size library org = 1 branch,
150 seats, 400 members, 5,000 titles, 8,000 copies.

```
Circulation write load
  400 members × 0.5 transactions/day        = 200 txn/day/org
  100 orgs                                  = 20,000 txn/day
  peak in a 60-min after-school window      = 20,000 × 0.4 / 3,600 s ≈ 2.2 txn/s
  → trivial for Postgres; the risk is CONNECTIONS, not throughput

Attendance burst (the real spike — everyone arrives at shift start)
  150 seats checking in within 10 min       = 150 / 600 s = 0.25/s per branch
  100 branches with aligned shift starts    ≈ 25/s peak
  each = 1 indexed upsert                   → fine, but this is the reason
                                              check-in must be idempotent and cached

Storage (per org, per year)
  RoomAttendance  400 members × 300 days    = 120k rows ≈ 12 MB with indexes
  Loan            200 loans/day × 300       = 60k rows  ≈ 8 MB
  → ~25 MB/org/year. 1,000 orgs ≈ 25 GB/year.
  Partitioning trigger: RoomAttendance past ~50M rows (≈ 400 orgs × 1 year), by year.
  Not before.

Catalogue search
  Postgres GIN full-text is correct to ~1M titles/org.
  External search engine trigger: never, at realistic school scale.
```

Nothing here needs a queue, a shard, a replica, or a second region. The single-region
stateless service with a pooled Postgres is correct well past the point where this
becomes a real business, and the spec says so plainly so nobody adds Kafka.

### 9.4 Rate limiting

Redis-backed throttler storage from the first commit, `lib:` key prefix. In-memory
throttling on N warm lambdas silently permits N× the stated limit — Sckools' known
gap #2. Limits that matter:

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 5 / 15 min per (org, identifier) **and** 20 / 15 min per IP |
| `POST /public/register` (QR self-registration) | 3 / hour per IP, 20 / hour per org |
| `POST /public/checkin` | 10 / min per member |
| Everything authenticated | 120 / min per user |

QR self-registration is a public unauthenticated write endpoint; it also carries a
hashed, expiring `RegistrationToken` and records `sourceIp` on every submission.

### 9.5 Observability

From day one, not deferred (Sckools gap #6): `/ready` returning `{db, redis}` status,
`/live`, structured JSON request logs with `orgId` + `requestId`, Sentry on both
`library-api` and `library-web`, and an `AuditLog` row for every issue, return, waive,
refund, plan change and staff-account change.

### 9.6 Bulk operations

Sckools has no bulk student import, which makes onboarding a 600-student school a
week of manual entry. The library ships imports **in Phase 1, not later**:

- CSV import for titles + copies, and for members, with a dry-run diff, per-row error
  reporting, and idempotency by external key.
- ISBN lookup (Open Library API) to auto-fill a title from a scan.
- Export for every report as CSV (always) and PDF (receipts, reports).

Imports run in a request with a hard row cap (2,000/file) so they fit the 60 s
function budget; larger files are chunked client-side. No worker required.

---

## 10. Web application

### 10.1 Surfaces

One Next 15 deployment, routed by Host and path:

| Path | Audience |
|---|---|
| `/` `/search` `/title/[id]` | Public catalogue (cached, anonymous) |
| `/console/**` | `ORG_OWNER` / `LIBRARIAN` / `ASSISTANT` |
| `/desk` | The circulation desk — the single most-used screen |
| `/me/**` | `MEMBER` self-service |
| `/join/[token]` | QR self-registration |
| `/login` `/accept-invite` `/forgot-password` | Auth |

Console sections: Dashboard · Desk · Catalogue · Members · Registrations · Seats &
Shifts · Attendance · Fees · Expenses · Reports · Staff · Settings.

### 10.2 Visual system

Sckools is *chalk & marigold* (deep scholarly green + marigold amber, `.skosx` scope).
The library is a **sibling, not a clone**: **"reading room" — warm paper ground, deep
ink indigo, brass accent**, with the same traffic-light semantics for
available/due/overdue.

It keeps Sckools' token *shape* exactly — `.lbx` scope prefix mirroring `.skosx`,
`--lb-paper / --lb-ink / --lb-ink-2 / --lb-card / --lb-line / --lb-brand /
--lb-accent / --lb-good / --lb-bad`, the same radius and shadow scale, dark mode in
the same `prefers-color-scheme` block. Same skeleton, different skin: merging the two
design systems later is a variable swap, not a restyle.

Product branding is **Sckools Library**, using the Sckools name and Tassel-S mark
(indigo `#4F46E5` / amber `#F59E0B`), per the standing brand rule. The visual theme
above is the product surface; the logo and name are Sckools.

### 10.3 Motion

Seven pieces of motion that do not exist in Sckools today. All on transform/opacity
channels only (never layout-triggering), all behind `prefers-reduced-motion: reduce`,
all with a static, fully-usable fallback.

1. **Live seat map** — SVG floor plan. Switching shift re-colours seats in a staggered
   wave outward from the entrance; occupied seats carry a slow breathing glow; hover
   springs open an occupant card. The map is the reading-room product's signature
   screen and should feel alive.
2. **Shelf browse** — search results render as book spines on a shelf; hover tilts a
   spine out; clicking pulls it forward into the detail view as a shared-element View
   Transition.
3. **Circulation desk** — the barcode field is permanently focused and refocuses after
   every action. Each scan flips a row in from the top with a stamp impact; the due
   date lands as a slightly rotated ink stamp. Undo toast with a countdown ring.
4. **Due ring** — circular countdown on each loan card: green → brass → red as the due
   date approaches, red and pulsing once overdue.
5. **Attendance heat strip** — 30 day-columns growing in on a stagger, hover for the
   day's detail.
6. **Revenue tiles** — digit roll-up on mount plus a sparkline that draws itself in.
7. **Hold queue** — FLIP reorder when a hold is fulfilled and everyone moves up one
   place, so the queue visibly *moves* rather than silently redrawing.

### 10.4 Web quality gates

`apps/web` has no test setup today; `apps/library-web` gets **Vitest + Testing Library
from the first commit**, plus:

- A route-file-export guard test (the exact class of bug `scripts/preflight.sh`
  documents as having broken two Vercel builds).
- `next/image` for every image including book covers — Sckools' 26 raw `<img>` tags
  serving unresized school uploads is a gap we do not inherit.
- axe accessibility assertions on every top-level route.

---

## 11. Testing strategy

Five layers, weighted deliberately toward the two that catch multi-tenant bugs.

### 11.1 Functional

| Layer | What | Where |
|---|---|---|
| **Pure policy** | `evaluateIssue`, `evaluateRenew`, `computeFine`, `nextHoldToPromote`, `subscriptionState`, `loanState`, `resolvePlan`. Table-driven, exhaustive, no DB, injected clock. | `circulation/internal/policy.spec.ts`, `plans/internal/resolve.spec.ts` |
| **Service** | Business services with mocked Prisma, matching the `*.service.spec.ts` convention. | per module |
| **Org isolation** ⭐ | Seed org A and org B. For **every** endpoint, authenticate as A and attempt to read/write B's row ids. Any 200 is a failure. Generated from the same endpoint table as the authz matrix, so a new endpoint is covered automatically. | `test/isolation.e2e.spec.ts` |
| **Authz matrix** ⭐ | Every role × every endpoint, asserting expected allow/deny including branch scoping. An endpoint missing from the table fails the suite. | `test/authz-matrix.e2e.spec.ts` |
| **Guards** | Plan capability, quota enforcement under concurrency, branch scope, idempotency replay, throttle. | per guard |
| **Integration** | supertest against a real ephemeral `library_test` schema: full flows — issue→return with fine, hold→promote→collect→expire, subscribe→attend→expire, register→approve→login. | `test/*.e2e.spec.ts` |
| **Web** | Vitest + Testing Library, route-export guard, axe. | `apps/library-web` |

### 11.2 Non-functional

Run against a selected target, reported in their own dashboard panel:

| Check | Passes when |
|---|---|
| Health | `/ready` returns `{status:ok, db:ok, redis:ok}` |
| Latency | p50 / p95 / p99 per endpoint under thresholds; cold vs warm reported separately |
| Load smoke | k6/autocannon short run: rps, p95, error rate < 1% |
| **RLS coverage audit** | Every `library` table with an `orgId` column has `rowsecurity` **and** `forcerowsecurity` true, ≥1 policy, and that policy's `USING` expression actually references `app.current_org` (not e.g. `USING (true)`) with `WITH CHECK` present. Allow-list: `RefreshToken`, `PasswordResetToken`, `RegistrationToken` |
| Migration drift | `prisma migrate diff` between schema and target DB is empty |
| Security headers | nosniff, referrer-policy, permissions-policy, frame-ancestors, CSP on console routes |
| Cache behaviour | Public catalogue returns `s-maxage`; authenticated routes return `no-store` |
| Connection budget | Live pooler client count vs `max_clients` |
| Accessibility | axe: zero serious/critical violations on every top-level route |
| Bundle size | `library-web` first-load JS under budget |

### 11.3 Gate

`pnpm preflight:library` runs the same gates the cloud runs — lint, typecheck,
boundary, **build**, unit, guard — because the ledger already records that local-gate ≠
cloud-gate is why deploys fail after green tests.

---

## 12. The testboard (`library.trackyour.in/test`)

`apps/testboard` — its own Vercel project, its own `testboard` Postgres schema, its
own auth. Three responsibilities: **see**, **run**, **guard**.

It is deliberately a separate deployment from `library-web`, not a route inside it: a
dashboard whose job includes reporting "library-web is down" cannot be served by
library-web, and it carries its own login and its own database. Routes are namespaced
by project (`/test/library`, `/test/<project>`) so the second project is a row and a
workflow file, per the project-agnostic decision.

### 12.1 Data model (`testboard` schema)

**`TestTarget`** — `name`, `kind` (`LOCAL|STAGING|PROD|CUSTOM`), `baseWebUrl`,
`baseApiUrl`, `allowsDestructive` (bool), `runnerRef` (GitHub environment name or
agent id), `active`.
**`TestRun`** — `projectKey` (`library`, extensible), `targetId`, `commitSha`,
`branch`, `trigger` (`CI|MANUAL|SCHEDULE`), `runnerKind` (`GITHUB|AGENT`),
`status` (`QUEUED|RUNNING|PASSED|FAILED|ERROR|CANCELLED`), `startedAt`, `finishedAt`,
`totals jsonb`, `coveragePct`.
**`TestSuiteResult`** — `runId`, `name`, `group`
(`policy|service|isolation|authz|guards|integration|web`), `status`, `durationMs`.
**`TestCaseResult`** — `suiteId`, `name`, `status`, `durationMs`, `failureMessage`,
`failureStack`.
**`ProbeResult`** — `runId`, `kind` (`HEALTH|LATENCY|LOAD|RLS_AUDIT|MIGRATION_DRIFT|
SECURITY_HEADERS|CACHE|CONNECTIONS|A11Y|BUNDLE`), `status`, `metrics jsonb`, `detail`.
**`BoardUser`** — single owner account: `email`, `passwordHash` (argon2id), `role`.

### 12.2 See

`/library` renders, per run: commit SHA, target, trigger, duration, and two panels.

- **Functional** — suites → cases with status, duration, failure message and stack;
  coverage; and named badge groups surfaced above the fold because they matter more
  than the total: **org isolation**, **authz matrix**, **circulation policy**,
  **plan + quota**.
- **Non-functional** — every check from §11.2 with its measured value and threshold.
- **History** — last 50 runs, pass-rate and duration trends, and **flake detection**:
  a case that changes status across runs *on the same commit SHA* is flagged as flaky,
  because an unnoticed flaky suite is how "green" stops meaning anything.

### 12.3 Run

A target picker plus a Run button. Adding a machine or server is inserting a
`TestTarget` row.

**Now — GitHub Actions.** `POST /api/runs/dispatch` (authenticated) calls
`workflow_dispatch` on `.github/workflows/library-tests.yml` with `target` and
`suites` inputs, using a fine-grained PAT held in Vercel env. The workflow runs the
suites, then POSTs results to `POST /api/runs/ingest` with an HMAC-SHA256 signature
over the body (`X-Testboard-Signature`) plus a run token. Ingest is idempotent by
`runId`. Target secrets (database URLs, tokens) live in **GitHub environment
secrets**, never in the testboard database.

**Next — the agent.** A ~200-line Node agent (`packages/testboard-agent`) that you run
on *any* machine — a laptop, an on-prem box, a VPS — which long-polls
`GET /api/agent/jobs` with a bearer agent token, runs the requested suites locally,
and streams results back to the same signed ingest endpoint. This is what actually
delivers "run against any machine/server", including ones a GitHub runner cannot
reach. Built in Phase 0.5, once the Actions path is proven.

### 12.4 Guard

Production safety is enforced **server-side at dispatch**, not by a checkbox:

- A `TestTarget` with `kind = PROD` or `allowsDestructive = false` accepts only the
  read-only probe suites (health, latency, security headers, cache, a11y, RLS audit,
  migration drift — read-only, no writes).
- Any request to dispatch a seeding, mutating, or resetting suite at such a target is
  rejected 403 before it reaches the runner.
- The runner **re-checks** the same rule from its own inputs, so a compromised or
  buggy dashboard cannot smuggle a destructive suite through.
- This rule has its own test in the testboard suite, and it is in the authz matrix.

### 12.5 Access

Single owner account: email + argon2id password, JWT, same conventions as the rest of
the stack. Needed regardless because dispatch must be authenticated; a login also
works from a phone with no Vercel account, and additional accounts are a row.

---

## 13. Merging into Sckools later

The design's payoff. When the library is proven, the merge is three additive changes —
no data migration, no rewrite:

1. **Auth** — swap `LibJwtGuard`'s issuer/secret for the Sckools school secret and
   accept `aud: "school"`. The role model already mirrors Sckools': `SCHOOL_ADMIN` →
   `ORG_OWNER`, and a new Sckools `UserRole.LIBRARIAN` maps to `LIBRARIAN`. Because
   permissions were never derived from `MemberType`, nothing else moves.
2. **Identity** — one `LibraryOrg` per `School`, linked by a `schoolId` column;
   `Member.externalRef` already exists to hold the Sckools `Student.id` / `Teacher.id`.
   A one-way sync job creates library members from school students.
3. **Routing** — point `school.sckools.com/library` at the library web app, or fold
   its routes into `apps/web` behind the existing Host-based routing. The library API
   stays its own function either way.

Everything that would have made this painful was decided now: separate schema (no
table-name collisions), UUID keys everywhere, a token audience that cannot cross,
`externalRef` present from the first migration, and a design token set with the same
shape as `.skosx`.

---

## 14. Phasing

Each phase is independently deployable to staging and independently testable. One spec
decides the schema and boundaries once; each phase gets its own implementation plan.

| # | Phase | Deliverables | Done when |
|---|---|---|---|
| **0** | **Foundation** | Worktree + branch, `packages/library-db` (full schema, RLS, roles, first migration), `apps/library-api` skeleton, tenancy, auth, plan/quota resolver, Redis throttler, idempotency, `/ready`, Sentry, CI workflow, `preflight:library`, **`apps/testboard` live on library.trackyour.in/test showing a green run** | Testboard shows a passing run against staging, including the RLS-coverage audit |
| **0.5** | **Agent** | `packages/testboard-agent`, agent tokens, job polling, streamed ingest | A run dispatched from the dashboard executes on a laptop and reports back |
| **1** | **Catalogue + circulation** | Titles/authors/categories/copies, full-text search, ISBN lookup, CSV import, issue/return/renew, holds, fines, policy engine, audit log | Full issue→return→fine and hold→promote→collect→expire flows green in integration tests |
| **2** | **Reading room** | Branches, zones, seats, shifts, subscriptions, seat-map API, room attendance, check-in (QR/manual/app) | Subscribe→attend→expire flow green; seat double-booking provably impossible |
| **3** | **Money** | Invoices, payments, receipts, expenses, revenue dashboard, reports, CSV/PDF export | Revenue and expense figures reconcile against seeded fixtures to the rupee |
| **4** | **Members & self-serve** | QR self-registration + custom forms + approval, member portal, notification outbox + templates + WhatsApp adapter (console driver) | Register→approve→login→borrow works end to end; outbox drains on the daily cron |
| **5** | **Web console + polish** | Full `library-web` console and member portal with the motion system, a11y, mobile-ready API surface, SSO adapter for the merge | axe clean, preflight green, non-functional panel all-green on staging |

---

## 15. Risks and decisions taken

| Risk | Decision |
|---|---|
| Building on a stale checkout | Verified `feat/blog-platform` is 20+ commits behind `main`; work happens in a fresh worktree off `origin/main` at `/Users/darshanjain/skoolos-library`, outside iCloud so no ` 2` conflict copies |
| Sckools and library migrations colliding | `?schema=library` gives the library its own `_prisma_migrations`; verified as the mechanism, tested by the migration-drift probe |
| Sub-daily cron rejecting the deploy | No scheduler performs state transitions (§6.3); library crons live in the library project's own `vercel.json` |
| Shared pooler exhaustion | `connection_limit=1` pinned; connection-budget probe on the dashboard |
| Public QR endpoint abuse | Hashed expiring registration token + Redis rate limits + `sourceIp` recorded |
| Destructive test run against prod | Server-side dispatch guard + runner-side re-check, with its own test |
| Scope creep into a rebuild | Phases are independently shippable; acquisitions, MARC, ILL and payment gateways are explicit non-goals |

### Decisions closed 2026-08-09

| Question | Decision | Reasoning |
|---|---|---|
| Which database | **Existing staging project, new schemas** | Connections are not binding at test scale (2 conns/warm instance of a ~200 ceiling). The decisive factor is reversibility: with zero foreign keys crossing into `public`, splitting out later is `pg_dump -n library` + three env vars. Merging *into* Sckools is the stated goal, so the shared direction is the cheap one. Split triggers: combined pooler clients past ~60% of `max_clients`; paying tenants whose restore/RPO needs differ from a school's (one PITR covers both today); library queries measurably moving Sckools' p95. |
| Redis | **Its own Upstash database**, ap-south-1 | Verified: Sckools' throttler is `ThrottlerModule.forRoot` with **default in-memory storage** (`apps/api/src/app.module.ts:46`), so it spends zero Redis commands today. The library is the first system here where Redis sits on the *security* path — a Redis-backed limiter guarding a public unauthenticated write (QR self-registration). Sharing a quota would couple that control to Sckools' traffic. Pattern: bulkhead. Fallback if the account allows only one free database: share with a `lib:` prefix **plus** a command-budget probe on the dashboard. |
| Seed data | **A Raffles library + a second org** | Familiar tenant so the data reads as real. Two orgs is a hard requirement regardless — a single-tenant seed cannot prove tenant isolation, and that suite is the most valuable one in the build. |
| Testboard scope | **Project-agnostic, only `/test/library` wired** | Runs already carry a `projectKey`; keeping the UI generic costs an afternoon and makes adding a second project a row plus a workflow file. |
| Testboard host | **`library.trackyour.in/test`** | User's call. Leaves the working Sckools dashboard on `test.trackyour.in` entirely untouched — verified live, `/` 307s to `/sckools/`. |

### Still open

1. **Product name in the UI** — "Sckools Library" with the Tassel-S mark, per the
   standing brand rule. Change it here if the library is to be its own brand.
2. **Pooler host for staging** — prod is `aws-1-ap-south-1`; the staging note says
   `aws-0`. Confirm from the Supabase connect dialog before the URLs are written.

### Noted, not acted on

Pinning `connection_limit=1` on **Sckools'** own pooled URLs would cut it from ~6 to
~2 connections per warm instance and roughly triple its warm-instance headroom. It is
an environment-variable change with no code change. Out of scope here by instruction —
the library is not to touch Sckools — but it is the cheapest capacity win available in
the whole system and should be picked up separately.
