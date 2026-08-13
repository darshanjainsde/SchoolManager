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
- **Never touch the production Supabase project** (`pnczxkyteaocpdoufwyz` — 3 real
  schools, 301 students).
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

## 3. Shipped (all green: 343 unit + 424 e2e)

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

**Deployed to staging:** console + API live, CORS correct, day-report timezone-correct.
`GET /search/suggest`, the period routes and the replacement-price field are **not yet
deployed** — staging still needs the five newest migrations (`search_trigram`,
`reservation_vocabulary`, `library_period`, `visit_branch_scope`,
`title_replacement_price`).

## 4. What is left

### P3 — Lost books, dues, collections
**No longer blocked.** `Title.replacementPrice` now exists (Decimal(10,2), nullable, with a
`>= 0` CHECK in the database), along with a pure resolver —
`apps/library-api/src/common/replacement-price.ts` — which is the one place the resolution
order lives:

> typed override → `Title.replacementPrice` → `Copy.acquisitionCost` → `UNPRICED`

It returns `{ amount, source }`, and **`UNPRICED` is a legitimate outcome, not an error.**
A missing price must never block *recording* a loss: the report is what freezes the daily
late charge, so refusing it to collect a catalogue field would keep billing the child who
owned up. Only the money is deferred. `PURCHASE_COST` must always be shown *with* its age
("the library paid ₹45 when this copy was bought") — it is historic, and presenting it bare
is how a wrong number acquires authority. Zero is a real price (a book written off as out of
print), never "absent".

Four ways a price gets in, none of them a new screen: the catalogue detail field, a one-way
seed from the add-copies path (never overwrites a value a librarian set), the CSV import's
`replacementPrice` column, and the per-loss override. It is **not visible to a MEMBER** —
the only party that tells a child what they owe is the library, after a librarian confirms
the loss.

**P3 still owes the provenance columns.** The resolved amount must be SNAPSHOTTED onto the
`Fine` row with its source (`TITLE_PRICE` / `PURCHASE_COST` / `TYPED` / …), plus who set it
and when — never a live join back to `Title`, or editing the catalogue next term silently
rewrites a bill already issued. Deliberately not added early: an unused enum plus three
unused columns is a real cost, and `schema-shape.spec.ts` scans every enum in the file.

**THE RULE THIS PHASE TURNS ON.** A `LOST` fine is only ever created by a deliberate human
action, with the amount **and its source** on screen at that moment. Never at self-report
time, never from `UNPRICED` coerced to ₹0, and `PURCHASE_COST` never shown bare — always
with its age ("the library paid ₹45 when this copy was bought — check this").

P3 is the first time this software produces a number a parent is asked to pay, and it is a
big jump: ₹6 of late charge becomes a ₹305 bill the instant a loss is recorded, in a product
whose own governing decision is that fines are off by default because most schools charge
children nothing. If that number can appear without a human having looked at it, the failure
mode is not an angry parent — it is the **librarian quietly stopping reporting losses**. She
leaves the book issued to a child who left school three years ago, and the register, the
availability count and the not-returned list are then all wrong forever. Everything the
phase exists for dies at once.

- **The five steps, in order**, one transaction, explicit timeout:
  1. **Close the issue** (`returnedAt = now`, `status = LOST`). First, because it is the
     step that STOPS THE MONEY: the late charge is derived at read time from rows where
     `returnedAt IS NULL`, so this makes every existing read stop billing at once. Do *not*
     instead leave it null and add `AND status='ACTIVE'` to each query — one missed query
     keeps billing the child who owned up (trap 9, applied to money).
  2. **Freeze the accrued late charge** as an `OVERDUE` fine, honouring `chargeStudentFines`
     exactly as `returnBook` does. This converts a derived number into a stored one.
  3. **`Copy.status = LOST`** — nothing else; availability is counted, never stored.
  4. **Raise the priced `LOST` fine**, with its source snapshotted. `UNPRICED` raises **no
     fine at all** — a ₹0 fine reads as "nothing owed" to every total and to P5's No Dues
     certificate.
  5. **Retire the number**: the `LostReport` row plus the audit entry.
- **Self-report creates no `Fine` row.** The frozen figure lives on `LostReport` until a
  librarian confirms; both fines are then created from the frozen figures, and confirm is
  where the price may be typed. `FineStatus` gains **no** `PENDING` value — adding one to a
  shipped money enum silently makes a 9-year-old's unconfirmed tap count as money owed in
  `listFines`, `dayReport`, the owed tile and P4's `/me/dues`. Reject restores the world
  exactly and the late clock resumes across the gap. The child sees no rupee figure at all
  before confirm.
- Settlement: **pay** (in full only — a counter taking ₹100 today and ₹199 next week needs a
  payments table, so P3 does not offer it), **bring a replacement**, **found**, **write-off**.
- **A found book keeps its OLD accession number.** "A retired number never returns" is about
  *replacements* — a different physical object must never inherit a number. A found book is
  the same object, with that number already in ink inside its cover. The
  `(orgId, accessionNumber)` unique index is what structurally prevents reuse, so reversal is
  safe by construction. The frozen late charge stays frozen: un-freezing it makes "Found it"
  a button nobody presses.
- **A replacement copy gets `acquisitionCost: null`** — not the price charged. The school
  paid nothing; writing the charge there fakes the auditor's "Price paid" column *and* plants
  a false `PURCHASE_COST` for the resolver to find the next time that copy is lost.
- **Write-off records its approver rather than gating on one.** There is no principal role,
  and in a 400-student school the librarian is often the only account — gating behind a role
  nobody holds yields either a permanently open due that poisons every total, or a fake
  "paid". Required reason plus a required free-text "approved by" captures the human who
  actually said yes; every write-off shows in the waiver log.
- **Waiver reasons are codes, not free text** — 400 unique strings cannot answer "where did
  each rupee go". `BOOK_FOUND` and `REPLACED_IN_KIND` are *mechanical* and excluded from the
  "let off" money figure: the school lost nothing either time.
- A **no-member "missing at stock take"** route ships in P3 even though the stock-take screen
  is P5 — otherwise a librarian invents a fake issue to a child in order to record a missing
  book.
- Dues list is **member-shaped, not fine-shaped** ("does Meera owe anything?"), split by
  member type so a teacher's ₹300 is never inside a figure a principal reads as what the
  children owe.
- **P3 sends no money notification of any kind.** That single restraint makes P4's "no push
  saying *you owe ₹300*" true by construction until P4 designs the message deliberately.
- **Do NOT build** the payment-provider ledger yet (PM: fines are off by default; ship a
  dues list and a paper receipt). Nor damage-at-return, partial payments, refunds/credits as
  money states, or a principal role.

### P4 — Student and teacher portals
Auth bridge accepting a Sckools token via `Member.externalRef`; `/me/issues`, `/me/dues`,
`/me/history`; availability search; self-report lost. Notifications to **both** the
Sckools inbox and push. **Teachers need different politics** — no push saying "you owe
₹300", a separate list from students, principal approval to waive.
**Do NOT build** a student-facing reservation queue (a child cannot collect outside their
period, and shelf expiry then punishes them; "tell me when it's back" is the real want).

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
