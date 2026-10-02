# Backup buckets — splitting a school's backup from one file into four

**Status:** approved 2 Oct 2026 · builds on the shipped backup engine (`4e6e3f4`)
**Pitch:** https://claude.ai/artifact/DAdbRnXA9uSyA5LVnECBcb

## The problem

A school's website is built from its real details — name, logo, address, board,
courses, photos — long before any real management data exists. The shipped
backup is one `.sckools` file holding both, so there is no way to replace one
without replacing the other. Three things are therefore impossible:

1. **Demo setup.** Show a prospect their own website with believable data behind
   the login, without hand-entering a year of fees and attendance.
2. **Go-live cutover.** Throw away the demo's data and keep the website that was
   approved.
3. **Daily rollback.** Put yesterday's fees back without reverting a page the
   office edited this morning — and without a daily backup that re-packs every
   photo and PDF the school has ever uploaded.

## The shape

Four buckets. Each is saved and restored on its own.

| Bucket | Holds | Tables | Rhythm | Files |
|---|---|---|---|---|
| `school` | identity, plan, status, domain, integrations (email, WhatsApp, gateway, bank), **admin logins** | 7 | on change, keep 10 | none |
| `website` | theme, hero, nav, footer, festive look, homepage sections, pages + blocks, drafts, menu, media, Hall of Fame, blog | 18 | on change, keep 10 | website media |
| `setup` | session, grades, sections, subjects, periods, timetable, rooms, roster (teachers, staff, students, alumni) + their logins, fee heads and plans, library catalogue, houses, pay grades, holidays | 29 | on change, keep 10 | avatars |
| `day` | attendance, exams and marks, invoices, payments, receipts, counters, diary, homework, messages and deliveries, payslips, leave, complaints, enquiries, events, hiring, gifts, library issues, meet results, print orders, audit log | 88 | daily, keep 30 | **none** |

`school` + `website` are **kept**. `setup` + `day` are the **management data**:
what a sample pack replaces, what a reset empties, what a rollback puts back.
`3 + 7 + 18 + 29 + 88 = 145` — every table with a `schoolId`, three of them
already excluded as short-lived credentials.

The `setup` / `day` line: **setup holds what persists across occasions, day
holds what belongs to one occasion.** A fee head persists, an invoice is one
month's. A subject persists, an exam is one term's. The consequence is
deliberate — an exam rolls back together with its marks.

### Why two tables are split by row

`User` and `MediaAsset` are the only tables whose **rows** go to different
buckets. `User`: `OWNER`/`SCHOOL_ADMIN` → `school`, everyone else → `setup`.
`MediaAsset`: `kind = AVATAR` (a person's own profile photo) → `setup`, every
other kind (logo, hero, gallery, festive) → `website`. The MediaAsset split also
drives the FILE list, since a bucket's files are exactly its own MediaAsset rows.

- All in `setup` → a sample load or a reset deletes the school's own admin
  account, locking them out of the product they are being shown.
- All in `school` → a sample pack's teachers and students arrive with
  `Teacher.userId` cleared (it is optional), so nobody can sign in to the demo.

The split is a partition, not two filters: one side is the exact SQL negation of
the other, over a NOT NULL column, so no row lands in both or in neither.

## What the schema says (measured, not assumed)

`apps/api/src/modules/backups/engine/scoped-plan.spec.ts` pins all of this.

- **Cross-bucket foreign keys exist in exactly two directions**: `setup → day`
  (42 required cascades, 12 optional cascades, 3 restricts, 5 set-nulls) and
  `setup → website` (2 optional set-nulls). Nothing anywhere requires a
  `website` or `school` row.
- **No required foreign key points from a lower bucket to a higher one**, and no
  RESTRICT link points from a lower bucket into a higher one. This is what makes
  a single-bucket restore possible at all, and it is a guard test
  (`buckets.spec.ts`), not an observation.

### What is saved, and how it goes back

Saving and replacing are different questions, so `scopePlan` takes a scope
EXACTLY as given and reports whether it is `closed` — whether emptying it would
delete rows outside it. Only a closed scope can be replaced. The four units
actually saved are therefore `school`, `website`, `setup,day` and `day`:
a `setup`-only archive could only ever put a roster back over an empty
register, so the management half moves as one.

| Scope | Mode | Why |
|---|---|---|
| `day` | empty the bucket, insert the snapshot | nothing outside `day` depends on it |
| `setup` + `day` | emptied and inserted together | 42 required links cascade off the roster, so a request for `setup` is widened to both |
| `website` | empty the bucket, insert the snapshot | nothing depends on a page or a picture |
| `school` | **merge by primary key, never empty** | emptying it would delete admin logins, and their complaints and notifications cascade with them (`expandScope(['school']) === ['school','day']`) |
| full | unchanged from `4e6e3f4` | moves a school to another machine; gates delete |

`expandScope` derives the widening from the live schema, so a new foreign key
that widens it fails a test instead of silently losing rows.

### Pointers on kept rows

Emptying `setup` sets `FeaturedStaff.teacherId` and `HallOfFameEntry.studentId`
to NULL — two website rows losing a pointer. (`SchoolProfile.logoAssetId`,
`Domain.logoAssetId` and `Course.imageAssetId` look like a third case but are
plain columns with no foreign key, so Postgres never touches them.) The restore saves those values
first and writes back the ones whose target exists again, so restoring a
school's own `setup` keeps its cards linked while a sample pack (different
teacher rows) correctly leaves them empty. Derived from the schema, not listed
by hand.

## Files

The daily bucket is **rows only** and a `day` restore **never deletes a file**.
A file whose row went away costs storage and nothing else; roll forward and the
row finds it again. Only `website` (media, selected by `MediaAsset` plus the
`MediaKind` key prefixes), `setup` (avatars) and the full archive pack files.

## Rhythm without touching the write path

A cron snapshots `school`, `website` and `setup` and **throws the file away when
nothing changed**: the archive already computes a sha256 per entry, so the
ordered hash of a bucket's entries is its version. Same hash as the newest
archive → discard, stamp the old one as still current. New hash → it becomes the
current version and the eleventh falls off. No Prisma middleware, no write-path
risk. `day` is taken daily regardless.

## Sample packs

A pack is a `setup` + `day` archive in the same password-locked `.sckools`
container, stored at **platform level** (`samples/packs/<id>.sckools`), so
deleting a school can never take a pack with it. Two ways to make one: freeze a
school's management data, or upload a pack file. Loading re-homes it:

| Carried | Rewritten on load |
|---|---|
| every row's `schoolId` | to the target school |
| every id | mapped to a new one, derived from `(old id, target school)`. **Not optional**: a uuid key stops a collision with a *different* row, not with the same row re-inserted — and the school a pack was cut from usually lives in the same database. Deriving rather than allocating keeps it one pass, since a child's pointer maps to whatever its parent's key maps to. Every uuid column is mapped, not just the declared foreign keys, because a soft reference left alone would go on pointing at the source school's row |
| logins | nothing to rewrite: `User` is `@@unique([schoolId, email])`, so the same pack loads into many schools at once. Password hashes travel, so the pack's documented demo password keeps working |
| dates | optionally shifted by the gap between the pack's reference date and today, respecting the school calendar |
| student and staff codes | re-issued under the target school's `codePrefix` |
| files the pack needs | re-uploaded under the target prefix, links rewritten (the existing machine-fitting step) |
| counters | loaded with the rows, so the next invoice number follows the sample data |
| device tokens, sessions, OTPs | dropped |

## Safety

- A scoped purge is built from the scope's own table list; no parameter lets
  "reset management data" name a `website` or `school` table.
- Every destructive action takes a safety snapshot of exactly what it replaces
  and waits for it to pass its check first.
- A failed restore rolls back (unchanged).
- Admin logins survive every data operation.
- A `day` restore cannot delete a file.
- Every save, restore, reset and pack load is audited.
- The round trip is a test: save four buckets → empty the management half →
  load a pack → restore the real management half → counts and fingerprints match.

## Build order

1. **The map** — `buckets.ts`, `scoped-plan.ts`, guard tests, measured sizes.
2. **Scoped backup** — bucket snapshots with hash dedupe, cron, retention,
   Buckets list in the console.
3. **Scoped restore** — scoped purge, filtered import, preflight numbers,
   safety snapshots, restore dialog.
4. **Reset & packs** — reset management data, the pack library, re-homing, date shift.
5. **Bucket-wise from a full archive** — a filter on import, not a new format.

## Open numbers

Retention (10 versions / 30 days) is a proposal to be set from step 1's
measurement of a real `day` snapshot on SNSPS and Raffles.
