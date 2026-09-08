# Hall of Fame — batches, groups and layouts — design spec

**Date:** 2026-09-07 · **Status:** Approved (pitch artifacts: batches `69ee30fd…`, layouts `111a040b…`) · **Supersedes** the Hall of Fame part of `2026-07-06-cms-courses-admissions-hof-design.md`.

## Problem

`HallOfFameEntry` allows exactly one podium per website course, ever (`@@unique([courseId, rank])`), and saving
replaces it — so entering Batch of 2025 deletes 2024. "Year" is a free-text caption, not a dimension. The only
grouping is the website's `Course` list, so a Pro school running real classes in Management cannot say
"Class 3 (A + B together)". The public section has no year selector, so a batch has no lasting place on the site.

## Decisions (user-approved)

1. **Year is a dimension.** Every podium belongs to a `batchYear`. Admin picks a batch (chips + "New batch", which
   asks for the year and pre-fills the current academic year). Nothing is ever replaced across years.
2. **A podium belongs to a class, named by the admin.** (Revised 2026-09-08 after the first cut: the admin screen
   showed "groups" with course / class / custom kinds and the user asked for something simpler.) The screen is
   just *Add class → name*; classes are year-independent and a class made for an earlier batch is reused. The
   API keeps `HallOfFameGroup.kind` (`COURSE` / `GRADES` / `CUSTOM`) so migrated course podiums keep working and a
   later screen can offer Management classes; new rows from the admin screen are `CUSTOM`. A class with no
   entries in a year simply does not show for that year.
3. **The site lands on the latest batch with entries** unless the school pins one (`landingYear`), shows the last
   `pastBatches` (default 4) as "Batch of" chips, and honours a shareable `?batch=YYYY` deep link.
4. **Seven layouts** in the studio's Design → Per-section layout group, keyed `sectionVariants.hof.layout`:
   `PODIUM` (default, today's look) · `MEDALS` · `SPOTLIGHT` · `SHELF` · `TIMELINE` · `YEARBOOK` · `SCOREBOARD`.
   All read the same data; layouts carry their own tone (no separate tone knob in v1).
5. **Pick from students (Pro) — read live.** A place may link a `studentId` (search by name, class or admission
   number over `/manage/students`). The site prints the student's *current* name and the profile photo they set
   in the app, resolved at render time (`displayNameOf` / `photoAssetOf`), never copied at save time; an explicit
   upload on the entry still wins. If the student row is deleted the link nulls and the typed name stands.
6. **Degrade, never break, before the migration runs.** Every Hall of Fame read (public projection included) treats
   "table/column does not exist" (Prisma P2021/P2022) as "no hall of fame yet". Prod is deployed before its
   migration is planned; the section hides instead of 500-ing the whole school site.

## Data model

```prisma
enum HallOfFameGroupKind { COURSE GRADES CUSTOM }

model HallOfFameGroup {
  id, schoolId, kind, label, order
  courseId?    // COURSE
  gradeIds[]   // GRADES — clubbed: all sections of these grades
  sectionIds[] // GRADES — set to split a grade by section
  @@index([schoolId])
}
model HallOfFameEntry {
  id, schoolId, groupId, batchYear Int, rank 1..3, name, achievement?, photoAssetId?, studentId?
  @@unique([groupId, batchYear, rank])
}
model HallOfFameSettings { schoolId @id, landingYear Int?, pastBatches Int @default(4) }
```

Migration `20260907_000000_hall_of_fame_batches`: creates the enum and both tables (RLS `tenant_iso` like every
CMS sibling), adds `groupId`/`batchYear`/`studentId` to entries, makes one `COURSE` group per course that has
entries, sets `batchYear` from a 4-digit year found in the old `year` text, else the current academic year's start
year, else this year (non-numeric year text is folded into `achievement`), then drops `courseId`/`year` and the
old unique.

## API (`/site/hall-of-fame`, SCHOOL_ADMIN, purge interceptor)

- `GET` → `{ groups, entries (all years), years, settings, currentYear }`.
- `PUT groups` → replace the ordered set (existing ids update, missing ids delete — cascades their podiums).
  Validation: course/grades/sections must belong to the school (explicit checks — FK checks bypass RLS);
  `GRADES` needs the `MANAGEMENT` feature; `CUSTOM` needs a label.
- `PUT groups/:groupId/:year` → replace that podium (≤3, ranks unique, year 1990..now+1, `studentId` in school).
- `PUT settings` → landingYear (null = latest) / pastBatches (1..10).

Public projection: `hallOfFame: { landingYear, years, groups: [{ id, label, entries: [{ batchYear, rank, name,
achievement, photoUrl }] }] }` limited to the `pastBatches` window; `courses[].hallOfFame` stays for one release,
filled from `COURSE` groups at the landing year.

## Web

- `components/public/sections/HallOfFame.tsx`: year chips + group tabs + the seven layouts; `?batch=` read in an
  effect (never in render); the podium keeps `.ps-champ` rise; other layouts use the site's reveal.
- `site-variants.ts`: `hof` joins `SectionKey`, `SECTION_KEYS`, `SECTION_VARIANT_DEFS` (so the studio lists it
  automatically) with default `PODIUM`.
- `app/app/website/hof-tab.tsx`: batch chips · groups editor (source, course/grade pickers, club sections) ·
  podium editor per group×year with photo upload and "Pick from students" · settings. Existing UI kit only,
  `var(--sk-*)` colours, no literal brand hex.

## Testing

API service spec (validation, tenant checks, feature gate, landing-year rule, P2021 fallback); web
`site-variants.test` (hof defaults/validation), `HallOfFame.test.tsx` (chips, deep link, every layout renders all
three names); `pnpm preflight` before every push; verified on test.sckools.com.
