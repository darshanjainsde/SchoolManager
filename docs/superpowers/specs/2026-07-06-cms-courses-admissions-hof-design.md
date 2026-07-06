# CMS Courses, Admissions & Hall of Fame — design spec

**Date:** 2026-07-06 · **Status:** Approved (interactive mockup: claude.ai/code/artifact/85786424-4861-4042-a4fc-922e265ce865)

## Problem

The public site's "Academics" menu is built from the `Grade` table, whose CRUD sits behind
`@RequireFeature('MANAGEMENT')` (Pro tier). Non-Pro schools can never edit their public
course list — they're stuck with seeded defaults. Marketing content (what a school *offers*)
is entangled with academic operations (timetables/sections).

Additionally, schools need two more homepage sections, both configurable per school from the
admin Website config: **Admissions** (process steps + fee structure) and a class-wise
**Hall of Fame** (1st/2nd/3rd podium per class).

## Decisions (user-approved)

1. **Fully separate CMS content.** New `Course` content type owned by Website config,
   available to ALL tiers. Management `Grade` stays internal and stops feeding the public site.
2. **Flip-card enquiry = quick phone capture** posting to the existing enquiries inbox with
   the course name as `gradeInterest`.
3. **Academics navbar item becomes a hover dropdown** listing all courses; clicking scrolls
   to the course in the Academics section. Plain tap-through on mobile.
4. **Structured fields** (no rich text): image, name, tagline, age range, description,
   highlights list, featured toggle, order.
5. **Seeded defaults:** onboarding creates 4 editable courses (Nursery, Primary, Middle,
   Secondary). Not live yet, so no data migration needed — reseed.
6. **Admissions:** ordered process steps + per-course fee rows (free-text amounts) + fee
   note + `showFeesPublicly` master toggle.
7. **Hall of Fame:** per course, ranks 1–3 with photo/name/achievement/year; animated podium
   (gold rises first); class switcher fed by courses with entries.

## Data model (packages/db/prisma/schema.prisma, CMS block)

```prisma
model Course {
  id           String  @id @default(uuid()) @db.Uuid
  schoolId     String  @db.Uuid
  name         String
  tagline      String?
  description  String?
  highlights   String[] @default([])
  ageRange     String?
  imageAssetId String? @db.Uuid
  featured     Boolean @default(false)
  order        Int     @default(0)
  fee          CourseFee?
  hallOfFame   HallOfFameEntry[]
  // school relation + @@index([schoolId])
}

model CourseFee {        // 1-to-1 with Course (cascade delete)
  courseId String @unique @db.Uuid
  admissionFee String?   // free text: "₹ 15,000" or "On request"
  annualFee    String?
  includes     String?
  schoolId String @db.Uuid  // for RLS
}

model AdmissionStep { schoolId, title, description?, order }
model AdmissionsSettings { schoolId @unique, showFeesPublicly Boolean @default(true), feeNote String? }
model HallOfFameEntry {
  schoolId, courseId, rank Int (1..3), name, achievement?, year?, photoAssetId?
  @@unique([courseId, rank])
}
```

`MediaKind` += `COURSE`, `HOF`. All new tables get the standard `tenant_iso` RLS policy
(ENABLE + FORCE ROW LEVEL SECURITY, `schoolId = current_setting('app.current_tenant')`).

## API (apps/api/src/modules/cms — school-admin JWT, NO feature gate)

- `GET/POST/PUT/DELETE /site/courses[/:id]` — course CRUD (staff.controller pattern)
- `PUT /site/courses/:id/fee` — upsert fee row
- `GET /site/admissions` / `PUT /site/admissions/steps` (set-all, stats pattern) /
  `PUT /site/admissions/settings`
- `GET /site/hall-of-fame` / `PUT /site/hall-of-fame/:courseId` (set the ≤3 entries for a course)
- `media.controller`: allow `COURSE`, `HOF` kinds
- **Public payload** (`public-site.service.ts`): add `courses[]` (with `feeAdmission/feeAnnual/feeIncludes`
  when public), `admissions { steps[], showFees, feeNote }`, `hallOfFame[]` (grouped per course);
  **remove `menu`** (grades). `EnquiryForm` select uses course names.
- **Onboarding** (`owner-schools.service.create`) + `packages/db/prisma/seed.ts`: create the
  4 default courses; keep default grades for Pro management use.

## Web — public site (apps/web/components/public/)

PublicSite.tsx is 880 lines; new sections go in `components/public/sections/` as separate
components (`CoursesFeatured`, `AcademicsSection`, `AdmissionsSection`, `HallOfFame`,
`AcademicsDropdown`) to keep files focused.

- Navbar: Academics hover dropdown (focusable, `:focus-within`), new anchors `#admissions`,
  `#hall-of-fame` shown when their content exists (courses always exist via defaults).
- Homepage: featured courses as 3D flip cards (click to flip, reduced-motion = instant swap),
  back face = details + highlights + phone input → `POST /public/enquiry`
  `{ parentName: 'Course card lead', phone, gradeInterest: course.name, message }`.
  NOTE: parentName is required by the enquiry DTO; card captures phone only, so a fixed
  marker parentName labels these leads in the admin inbox.
- Academics: all courses, image + tags (age range, "On homepage") + description + highlight chips.
- Admissions: numbered step cards + fee table (only when `showFees`) + fee note.
- Hall of Fame: dark brand-gradient section, class tabs → podium (1st center/large/gold,
  staggered rise animation, re-plays on switch).

## Web — admin portal (apps/web/app/app/website/)

Three new tabs — `Courses`, `Admissions`, `Hall of Fame` — extracted as components
(`courses-tab.tsx`, `admissions-tab.tsx`, `hof-tab.tsx`) following the existing Staff tab's
react-query + upload UX. Courses tab: reorderable list, editor (image, name, age range,
tagline, description, highlights one-per-line, featured toggle). Admissions tab: steps
list + per-course fee editor + public-fees toggle + fee note. HoF tab: course picker +
three medal slots (photo, name, achievement, year).

## Out of scope

Multi-page routing (site stays a one-page scroller), rich text, per-course detail pages,
fee payment.

## Verification

Local: docker-compose db+redis, migrate+seed, run api+web, drive acme.localhost — navbar
dropdown, flip card submit → enquiry row, admissions/HoF render, admin tabs CRUD.
Deploy: migrate prod DB (session pooler), push main, re-verify on acme.finokaft.com.
