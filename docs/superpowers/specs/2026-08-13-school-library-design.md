# Sckools Library — design (school librarian edition)

**Supersedes `2026-08-08-library-service-design.md`**, which was reverse-engineered from
Librify, a study-hall SaaS that rents seats by the month. Its business model became our
requirements by mistake. Read this one; keep the old one only for the §0a/§1 sections
that already shipped.

- Approved prototype: https://claude.ai/code/artifact/b8559997-5b75-463b-ab80-3b9467628196
- Why the pivot: https://claude.ai/code/artifact/e5d9464c-eeb2-4597-b75f-a7a720fd5497
- The library period concept: https://claude.ai/code/artifact/edaabd9f-2985-4bc6-8da2-65aeeaeafc82
- Roadmap/timeline: https://claude.ai/code/artifact/924ce10f-c116-4809-8053-50d1aa9a510f

---

## 0. Hard boundaries

- **Never deploy to `main`.** The library lives on `feat/library-service`. Both Vercel
  projects are deliberately **not git-linked**, so nothing deploys on a push.
- **Never touch the production Supabase project** — `oljrqinbjhpysgfwmtxw` (ap-south-1,
  Mumbai). This ref was WRONG here until 2026-08-14: it read `pnczxkyteaocpdoufwyz`,
  which is **Sckools _staging_**, not production. Both are off-limits to library
  commands, but only one of them is the database that would end a school's day, and
  it was the one named nowhere. Corroborated by `design/sckools-app/seed/*.sh`
  (`PROJECT_REF="oljrqinbjhpysgfwmtxw"   # PROD (Mumbai)`) and by the staging having
  only acme/beacon/raffles while prod also carries `riverdale`.
  The "3 real schools, 301 students" figure describes **staging**.
- The library has its **own** database (`eocxgzcfzwmbaivobzfx`, ap-south-1) and its **own**
  Redis (Upstash `primary-dogfish-124934`). Verified: the production ref appears nowhere
  in library config.
- **Staging first**: `library.trackyour.in` (console) and `api.library.trackyour.in` (API)
  already point at the library's own project.
- Every feature goes **senior PM → senior architect → QA** before it ships. This exists
  because a whole phase was built on the wrong product model and had to be reverted.

## 1. Who it is for

A **school librarian** (console), a **student** and a **teacher** (a tab inside the
Sckools app and web portals they already use). Indian school, 300–1500 students. Teachers
borrow on their own account under the same issue/return/late/lost rules, with longer
limits.

## 2. Governing decisions

1. **Plain words.** No library jargon anywhere — schema, API, console, app. `Issue` not
   loan, *back by* not due date, *late* not overdue, *reserved* not hold, *not-returned
   list* not defaulter list. "Accession number" survives only in the register (the
   auditor's word); at the counter it is the **book number**.
2. **No barcodes, no scanner hardware.** The accession number written inside the front
   cover by hand is the only identifier — unique per physical copy, sequential per
   library, and free. Sequential is load-bearing: it lets stock verification accept a
   shelf as a **range**.
3. **Availability is counted, never stored.** There is no quantity column; availability is
   `COUNT(copies WHERE status = AVAILABLE)`. A stored count drifts and then nobody knows
   which number to trust.
4. **A lost book freezes the late charge.** Reporting a loss — by the librarian *or by the
   student from their own app* — closes the issue, which stops the daily charge growing;
   the accrued amount freezes (not wiped: they were still late) and the replacement price
   is added. Owning up is cheaper for them and more accurate for us.
5. **A retired number never returns.** A replacement is a new copy with the next number.
   The register is a history, not a stock list.
6. **Attendance is a by-product.** Issuing marks the child present automatically; the
   librarian ticks only the browsers. Returning does **not** mark presence — "I brought
   Ravi's book" is daily, and a false positive on attendance is far worse than a false
   negative.
7. **Fines off by default**, per member type. Money is recorded, not moved: the Pay action
   exists and is inert until a provider is configured.
8. **Concurrency guarantees live in the database**, never in application checks —
   `issue_one_active_per_copy`, `reservation_one_per_member_title`,
   `VisitAttendance_one_per_member_visit`.

## 3. Shipped (all green: 356 unit + 566 e2e)

| Area | State |
|---|---|
| Tenancy, RLS, auth + refresh rotation, plans, guards, idempotency | Phase 0a |
| Catalogue, full-text search, ISBN lookup, CSV import | Phase 1 |
| Issue / return / renew, reservations, fines **engine**, member search | Phase 1 |
| Console: login, dashboard, catalogue, desk, reservations, overdue, fines | Phase 1 |
| `Issue` vocabulary + accession number replacing barcode | P2a — `2fce144` |
| `GET /search/suggest` typeahead; `Reservation` vocabulary | P2b — `7e3251f` |
| Library period: timetable, capacity warning, auto-attendance, settings | P2c — `0366660` |
| `Title.replacementPrice`, the price resolver, and the console field that sets it | P2d — unblocks P3 |
| **P3 — lost books, dues, collections.** Report/self-report/confirm/reject, five settlements, member-shaped dues, collections + waiver log, three console screens | P3.1–P3.9 |
| Every foreign key indexed; `fk-indexes.spec.ts` guards it with an empty baseline | with P3.9 |

**Deployed to staging:** console + API live, CORS correct, day-report timezone-correct.
Staging was brought up to `title_replacement_price` on 2026-08-13 (data intact: 305
members, 161 copies; RLS audit and isolation e2e green against it), and the API and console
were redeployed to match. **Staging is now three migrations behind again** — `lost_reports`,
`lost_refund_owed` and `index_foreign_keys` — and its code predates P3 entirely.

The staging runbook named the PRODUCTION project until `52c6cfa`; the library's own project
is `eocxgzcfzwmbaivobzfx` and the pooler host is `aws-0-`, not `aws-1-`. Assert the ref
before running anything against it.

## 4. What is left

### P3 — Lost books, dues, collections — **SHIPPED**

Built as P3.1–P3.9. The rules it turns on, kept here because they are what any change to
this area must not break:

- **A `LOST` fine is only ever created by a deliberate human action**, with the amount and
  its source visible at that moment. Never at self-report time, never from `UNPRICED`
  coerced to ₹0, and `PURCHASE_COST` never shown bare — always with its age. P3 is the
  first time this software produces a number a parent pays, and ₹6 of late charge becomes
  a ₹305 bill the instant a loss is recorded. If that number can appear without a human
  looking at it, the failure is not an angry parent — it is the **librarian quietly
  stopping reporting losses**, and then the register, the availability count and the
  not-returned list are wrong forever.
- **Closing the issue is step one**, because it is what stops the money: the late charge is
  derived at read time from `returnedAt IS NULL`. Adding `AND status='ACTIVE'` to each
  reading query instead is trap 9 applied to money.
- **Self-report creates no `Fine` row.** The frozen figure lives on `LostReport` until a
  librarian confirms; confirm builds both fines from the FROZEN figures, never recomputed.
  `FineStatus` gains no `PENDING`, no `REFUND`, no `CREDIT` — a new value in a shipped
  money enum silently changes every sum built on it.
- **A found book keeps its old accession number; a replacement gets the next one** with
  `acquisitionCost` NULL. Retiring a number is about replacements — a different physical
  object — and the `(orgId, accessionNumber)` unique index is what makes reversal safe.
- **Mechanical waivers** (`BOOK_FOUND`, `REPLACED_IN_KIND`) are excluded from "let off":
  the school lost nothing, and counting them makes book-keeping read as generosity.
- **A stock-take loss has no member and no issue**, enforced by a CHECK, so a missing book
  can never be pinned on a child who never had it.
- P3 sends **no money notification of any kind**, which is what makes P4's "no push saying
  *you owe ₹300*" true by construction until P4 designs the message deliberately.

Deliberately NOT built, and still open: the payment-provider ledger, partial payments,
damage-at-return, a principal role, and refunds as a money state (a found-after-payment
refund is recorded as an obligation on `LostReport`, settled at the desk).

### P4 — Student and teacher portals — **PARTLY SHIPPED**

Shipped: the auth bridge (`POST /auth/sckools/exchange`, RS256 public-key verified, joined
on `Member.externalRef`), roster enrolment, `GET /me/library` + `/shelf` + `/class` served
in-process from `apps/api`, and the student and teacher screens on web behind the two-stage
gate (`LIBRARY` feature AND `libraryLive`). The `LIBRARIAN` role, a librarian login the
admin console can mint, and the counter at `/library` shipped with it.

**The bridge is wired at one end only, and this is the trap for whoever picks it up.**
Nothing calls `/auth/sckools/exchange` — no client, only the authz matrix. Nothing in
`apps/api` signs RS256, and `SCKOOLS_JWT_PUBLIC_KEY` is set in no environment, so the route
answers 503 everywhere it is deployed. Worse, it could not serve the person it is now most
needed for: `exchange()` requires a `Member` **with a `login` row**, and `enrolSchool()`
creates members for students and teachers only, with no `LibraryLogin` — so a LIBRARIAN
resolves to *"This person has no library membership"*. Single sign-on into the standalone
console needs a library identity for staff, which is unbuilt.

Still open: `/me/dues`, `/me/history`, self-report lost from the student screen, and
notifications to **both** the Sckools inbox and push. **Teachers need different politics** —
no push saying "you owe ₹300", a separate list from students, principal approval to waive.
**Do NOT build** a student-facing reservation queue (a child cannot collect outside their
period, and shelf expiry then punishes them; "tell me when it's back" is the real want).

### P4b — The counter — **SHIPPED**

All seven of a librarian's daily actions, at `/library` inside Sckools: take a book back
(the default mode), give one out (the child stays chosen between books), undo a mistyped
issue, note damage, tick who came to the library period, find a copy or a child, chase what
has not come back, and add a book. Undo, damage and the class-teacher nudge existed in NO
console before this.

**`packages/library-core` is the seam and the rule.** `apps/api` cannot import
`apps/library-api` — there is now an explicit dependency-cruiser rule — so `policy`,
`issue`, `returnBook`, `renew`, `voidIssue`, `recordDamage`, `addBook`, `selfReportLost`
and the period visits live in the package and BOTH consoles call them. Never write a
circulation rule twice: a read that disagrees is a wrong screen, a write that disagrees is
a wrong bill. `@nestjs/common` is a PEER dependency there — two copies break
`instanceof HttpException` and turn every 403 into a 500.

**TWO IDS, and this has bitten three times.** `AuditLog.actorUserId` has no foreign key and
takes any caller's id. `Issue.issuedByUserId`, `Issue.returnedByUserId` and
`LostReport.reportedByUserId` are foreign keys to `LibUser`. A Sckools librarian or student
has a `User` row and NO `LibUser` row, so every core function takes an optional `libUserId`
that `apps/api` passes as null. Miss it and the first book issued is a 500.

**Fixed while building it, both live:** any authenticated school token could read and DELETE
`/manage/staff` records (a TEACHER token got 404, not 403 — the guard never ran), and
`issue` counted a member's open loans then created with no mutual exclusion, so one child
could be handed two books against a limit of one (now `pg_advisory_xact_lock` before the
reads, with a barrier-forced test).

**`apps/api` now has route-coverage enforcement** (`test/route-coverage.e2e-spec.ts`), which
`apps/library-api` has had since Phase 1a and this app had never had — which is exactly how
the staff hole survived. 272 mounted routes: 44 asserted, 228 in a baseline that may only
shrink.

### Before staging: two processes, one pooler

`apps/api` now opens `library_app` connections on the counter's write path, and
`apps/library-api` opens its own against the same database. Answer this before the deploy,
not after.

**What is actually shared, and what is not.** `getLibraryTenantPrisma()` is a module-level
singleton, so it is one Prisma client PER PROCESS, and the runtime URL pins
`connection_limit=1`. So each function instance holds at most one server connection per
role — the pooler's client ceiling (Supavisor, in the low hundreds) is nowhere near
binding. **The constraint is not connection exhaustion; it is serialisation inside one
instance.**

**The arithmetic that matters.** Fluid Compute reuses one instance across concurrent
requests, and `connection_limit=1` means those requests QUEUE on a single connection. A
library period starts, forty children hand books back at once, and every one of those
transactions is ~20 statements. At ~80ms per transaction that is ~3.2s of queue — inside
`DESK_TX_OPTIONS`' 5s `maxWait`. At ~200ms it is 8s, and the tail of the queue fails with
**P2024**, which reads like pool exhaustion and is really contention. The counter would
break at exactly the busiest minute of its day.

**Do not "fix" this by guessing.** Both levers are one-line changes — raise
`connection_limit` on `skoolos-api`'s library URL, or raise `maxWait` — and picking one
without a measurement just moves the cliff. Measure a real burst on staging first: time
`POST /manage/library/return` at 40 concurrent, and read the P2024 rate.

**Deploy prerequisite.** `skoolos-api` needs `LIBRARY_DATABASE_URL_APP` and
`LIBRARY_DATABASE_URL_PLATFORM`. Without them every library route 500s;
`library-org.service.ts` already logs that cause by name rather than letting it surface as
an unplaceable error on an unrelated-looking route. Env changes need a redeploy.

### P4c — Reminders
A daily cron (`/internal/cron/library-reminders`) tells a borrower a book goes back
tomorrow, and follows up when one is late. **Books and dates, never money** — not even the
word "overdue", which reads as a penalty notice. A child hears on day 1 then weekly; a
teacher weekly only, because a colleague chased every morning mutes the channel. Idempotent
by CHECKING `Notification.linkId` for the day, since that table has no unique index and a
retry must not tell a child twice about one book.

### P5 — Register and stock verification
14 canonical CBSE/NIOS columns, exportable. Scanner-free stock take using accession
**ranges**. Weeding/write-off with reason and approver.

### P6 — Reports, accessibility, merge
Issues per class, most-read, **who has read nothing this term** (what the principal
actually asks), chronic late returners. axe-clean. SSO adapter + routing.

### Missing use cases the PM found (not yet scheduled, ranked by frequency)
1. **Damage at return** (daily) — `FineKind.DAMAGE` and `CopyCondition` exist; no route.
2. **Undo a wrong transaction** (daily) — mistyping a number issues to the wrong child
   with no reversal. Needs void-with-reason.
3. **Bulk/continuous return** (weekly, 40 books at once).
4. **Not-returned list routed to the class teacher**, and WhatsApp to a *parent* — a child
   may not own a phone.
5. **Year-end**: recall-by-date, **No Dues certificate** for TC/results, rolling
   `classRef` forward in April.
6. **Holiday calendar** — fines currently accrue on calendar days with `maxFine` nullable,
   so 45 days of summer vacation bills a shut library.
7. Book requests from students/teachers; donations with donor name; new-arrivals list.

### Known design debt
- **`classRef` is free text and is the spine of the period feature.** `6-B` vs `6B` vs
  `VI-B` silently yields an empty roster, and in April every label changes meaning. Needs a
  normalised org-scoped class list with an academic year.
- The real room limit is **seats**, not classes: two sections of 60 satisfy `capacity: 2`
  and overflow a 40-seat room.
- `MemberStatus` has no `LEFT`/`TRANSFERRED`, so a departed child inflates "owed" forever.
- `FineStatus` has no `REFUND`/`CREDIT` — needed when a book is found after a parent paid.
- Circulation runs on Prisma's default 5s interactive-transaction timeout; issue is ~12
  statements and return ~20 over a pooler. Pass an explicit timeout.
- `/overdue` caps at 500 rows with no pagination.
- Org cache has a ~60s window where a suspended org still resolves.

## 5. Traps this project has already paid for

Read `docs/superpowers/LIBRARY-TRAPS.md`. The ones that bit during this phase:

- A doc comment asserting a guarantee that does not hold is worse than no comment.
  Three did: "best-effort" attendance (it aborts the transaction — 25P02, and Prisma has
  no savepoints), "two clerks serialise on the insert" (different keys, nothing
  serialises), "queried in parallel" (one transaction, one connection).
- `DROP TABLE IF EXISTS schema."A","B","C"` qualifies **only the first name**; the rest
  resolve against `search_path`, and `IF EXISTS` silences the miss. Four tables survived a
  "successful" cleanup for four commits.
- `word_similarity(a,b) > x` **cannot** use a `gin_trgm_ops` index; only the `<%` operator
  can. Proven with `enable_seqscan=off`.
- `similarity()` compares whole strings — `similarity('hungy','The Hungry Tide')` = 0.235.
  `word_similarity()` finds the best word inside: 0.667.
- On Supabase `pg_trgm` usually already exists in `extensions`, so
  `CREATE EXTENSION IF NOT EXISTS` is a no-op and nothing resolves for the app role.
- `prisma migrate reset` drops the schema **and its default privileges**, which silently
  **blinds** the RLS coverage audit (information_schema hides tables the role cannot see)
  rather than failing it. Re-run `scripts/library-db-init.sql` after any reset.
- Verifying a browser-facing API with curl proves nothing about CORS — curl sends no
  preflight.

## 6. How to verify

`pnpm preflight:library` is the gate: lint, typecheck, module boundary, build, ncc bundle,
unit + e2e against real Postgres. The authz matrix test fails if any mounted route is not
covered, so new routes are caught automatically. Cross-tenant isolation must never regress.

Before any deploy, confirm all migrations replay on an **empty** database — that is what a
fresh staging deploy does.
