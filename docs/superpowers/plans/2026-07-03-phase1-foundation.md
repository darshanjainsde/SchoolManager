# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the academic-ERP foundation with a clean, normalized, multi-tenant foundation for the school-website platform: stripped API, new Prisma schema, RLS + roles, feature/tier system, and seed — all provably tenant-isolated.

**Architecture:** Shared Postgres with a `schoolId` on every tenant row; isolation enforced by Postgres RLS (role `skoolos_app`, session var `app.current_tenant`) plus app-level `withTenant()` scoping, with cross-tenant leak tests. Feature access is derived from a school's tier plus per-school overrides, cached in Redis. Three services kept (`apps/web`, `apps/api`, `apps/worker`); ERP modules deleted.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Redis (ioredis), Jest, pnpm workspaces, Turbo.

## Global Constraints

- Node `>=20`; pnpm `9.15.4`; package manager pinned in root `package.json`.
- Tenant session variable is **`app.current_tenant`** (already used by `withTenant()` in `packages/db/src/index.ts`) — do NOT rename it.
- Runtime DB roles: **`skoolos_app`** (RLS-enforced, NOT bypass) for tenant queries; **`skoolos_platform`** (`BYPASSRLS`) for owner/platform paths. Migrations run as superuser via `DATABASE_URL`.
- Every tenant-owned table has a non-null `schoolId` (except `School` itself, matched on `id`, and `User`/`AuditLog` where `schoolId` is nullable for the platform owner).
- Every RLS policy uses `current_setting('app.current_tenant', true)` (the `true` = default-deny when unset).
- Every unique constraint on tenant data is scoped by `schoolId`; every multi-column index leads with `schoolId`.
- Feature keys (exact strings): `PUBLIC_SITE`, `GALLERY`, `ENQUIRY`, `SOCIAL`, `ABOUT_CONTACT`, `EVENTS`, `MANAGEMENT`.
- Tiers (exact strings): `BASIC`, `STANDARD`, `PRO`.
- Roles (exact strings): `OWNER`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`.
- Reference spec: `docs/superpowers/specs/2026-07-03-skoolos-school-website-platform-design.md`.

---

## File structure (Phase 1)

**Delete:**
- `apps/api/src/modules/finance/`, `apps/api/src/modules/admissions/`, `apps/api/src/modules/assessment/`, `apps/api/src/modules/attendance/`
- `apps/api/src/modules/academics/` (rebuilt in Phase 4 — remove now)
- `apps/api/src/modules/comms/` (student-portal announcements return in a later phase)
- `packages/db/prisma/migrations/*` (reset to a single clean baseline)

**Create:**
- `packages/db/prisma/schema.prisma` (rewrite)
- `packages/db/prisma/migrations/20260703_000000_baseline/migration.sql` (generated)
- `packages/db/prisma/migrations/20260703_000100_rls_and_roles/migration.sql` (hand-written)
- `packages/db/src/features.ts` (tier→feature map + resolver)
- `apps/api/src/modules/features/index.ts`
- `apps/api/src/modules/features/internal/features.module.ts`
- `apps/api/src/modules/features/internal/feature-resolver.service.ts`
- `apps/api/src/modules/features/internal/feature-resolver.service.spec.ts`
- `apps/api/src/modules/features/internal/require-feature.guard.ts`
- `apps/api/src/modules/features/internal/require-feature.decorator.ts`
- `apps/api/test/tenant-isolation.e2e-spec.ts`

**Modify:**
- `apps/api/src/app.module.ts` (remove deleted module imports, add `FeaturesModule`)
- `packages/db/prisma/seed.ts` (rewrite for new model)
- `.env.example` (already has the three DB URLs — verify)

---

### Task 1: Strip ERP modules so the API boots clean

**Files:**
- Delete: `apps/api/src/modules/{finance,admissions,assessment,attendance,academics,comms}/`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: an `AppModule` that imports only `TenancyModule`, `AuthModule`, `PlatformModule`, plus the common modules and `HealthModule`. Later tasks add `FeaturesModule`.

- [ ] **Step 1: Delete the ERP module directories**

```bash
cd /Users/darshanjain/Documents/SchoolManager/SchoolManager
git rm -r apps/api/src/modules/finance apps/api/src/modules/admissions \
  apps/api/src/modules/assessment apps/api/src/modules/attendance \
  apps/api/src/modules/academics apps/api/src/modules/comms
```

- [ ] **Step 2: Remove their imports from `app.module.ts`**

Delete these import lines:
```ts
import { AcademicsModule } from './modules/academics';
import { AttendanceModule } from './modules/attendance';
import { AssessmentModule } from './modules/assessment';
import { AdmissionsModule } from './modules/admissions';
import { FinanceModule } from './modules/finance';
import { CommsModule } from './modules/comms';
```
And remove `AcademicsModule, AttendanceModule, AssessmentModule, AdmissionsModule, FinanceModule, CommsModule` from the `imports: [...]` array. Leave `TenancyModule, AuthModule, PlatformModule` in place.

- [ ] **Step 3: Remove now-broken platform controllers that referenced ERP models**

The platform module has usage/stats controllers that read ERP tables. For Phase 1, comment out or delete references to removed models in `apps/api/src/modules/platform/internal/platform-stats.controller.ts` and `platform-usage.controller.ts` — reduce them to school/user/domain counts only. Grep first:
```bash
grep -rl "invoice\|payment\|enrollment\|attendance\|exam\|assignment\|feeStructure" apps/api/src/modules/platform/
```
For each hit, remove the offending query/field so only `school`, `user`, `customDomain` reads remain.

- [ ] **Step 4: Typecheck the API**

Run: `pnpm --filter @skoolos/api typecheck`
Expected: PASS (no references to deleted modules/models). Fix any remaining import by deleting the dead reference.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(api): remove ERP modules (finance/admissions/assessment/attendance/academics/comms)"
```

---

### Task 2: Rewrite the Prisma schema (normalized model)

**Files:**
- Modify (rewrite): `packages/db/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma models `School, Domain, FeatureOverride, User, RefreshToken, AuditLog, SchoolProfile, HomepageContent, StatItem, SocialLink, MenuItem, MediaAsset, FeaturedStaff, AcademicYear, Grade, ClassSection, Subject, Teacher, TeacherSubject, Student, Period, TimetableSlot, Event, Enquiry` and enums `Tier, SchoolStatus, DomainType, DomainStatus, UserRole, MediaKind, SocialPlatform, MenuKind, EventScope, EventStatus, EnquiryStatus`. Field names below are relied on by all later tasks.

- [ ] **Step 1: Replace `schema.prisma` with the normalized model**

Write `packages/db/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Enums ────────────────────────────────────────────────
enum Tier { BASIC STANDARD PRO }
enum SchoolStatus { SETUP LIVE SUSPENDED }
enum DomainType { SUBDOMAIN CUSTOM }
enum DomainStatus { PENDING LIVE ERROR }
enum UserRole { OWNER SCHOOL_ADMIN TEACHER STUDENT }
enum MediaKind { LOGO FAVICON HERO GALLERY STAFF EVENT PRINCIPAL }
enum SocialPlatform { FACEBOOK INSTAGRAM YOUTUBE X LINKEDIN }
enum MenuKind { CLASS PAGE CUSTOM }
enum EventScope { SCHOOL NETWORK }
enum EventStatus { DRAFT PENDING APPROVED REJECTED }
enum EnquiryStatus { NEW CONTACTED CLOSED }

// ── Tenancy & access ─────────────────────────────────────
model School {
  id        String       @id @default(uuid()) @db.Uuid
  name      String
  slug      String       @unique
  tier      Tier         @default(BASIC)
  status    SchoolStatus @default(SETUP)
  timezone  String       @default("Asia/Kolkata")
  locale    String       @default("en-IN")
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  domains          Domain[]
  featureOverrides FeatureOverride[]
  users            User[]
  auditLogs        AuditLog[]
  profile          SchoolProfile?
  homepage         HomepageContent?
  stats            StatItem[]
  socialLinks      SocialLink[]
  menuItems        MenuItem[]
  media            MediaAsset[]
  featuredStaff    FeaturedStaff[]
  academicYears    AcademicYear[]
  grades           Grade[]
  classSections    ClassSection[]
  subjects         Subject[]
  teachers         Teacher[]
  students         Student[]
  periods          Period[]
  timetableSlots   TimetableSlot[]
  events           Event[]
  enquiries        Enquiry[]
}

model Domain {
  id        String       @id @default(uuid()) @db.Uuid
  schoolId  String       @db.Uuid
  hostname  String       @unique
  type      DomainType   @default(SUBDOMAIN)
  status    DomainStatus @default(PENDING)
  isPrimary Boolean      @default(false)
  createdAt DateTime     @default(now())
  school    School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
}

model FeatureOverride {
  id         String  @id @default(uuid()) @db.Uuid
  schoolId   String  @db.Uuid
  featureKey String
  enabled    Boolean
  school     School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, featureKey])
  @@index([schoolId])
}

model User {
  id                  String    @id @default(uuid()) @db.Uuid
  schoolId            String?   @db.Uuid
  email               String
  passwordHash        String
  role                UserRole
  isActive            Boolean   @default(true)
  mfaSecret           String?
  failedLoginAttempts Int       @default(0)
  lockedUntil         DateTime?
  lastLoginAt         DateTime?
  createdAt           DateTime  @default(now())
  school              School?   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  refreshTokens       RefreshToken[]

  @@unique([schoolId, email])
  @@index([schoolId])
}

model RefreshToken {
  id           String    @id @default(uuid()) @db.Uuid
  schoolId     String?   @db.Uuid
  userId       String    @db.Uuid
  familyId     String    @db.Uuid
  tokenHash    String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?   @db.Uuid
  createdAt    DateTime  @default(now())
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([schoolId])
  @@index([userId])
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  schoolId    String?  @db.Uuid
  actorUserId String?  @db.Uuid
  action      String
  entity      String
  entityId    String?
  meta        Json?
  createdAt   DateTime @default(now())
  school      School?  @relation(fields: [schoolId], references: [id], onDelete: SetNull)

  @@index([schoolId])
}

// ── Website content (CMS) ────────────────────────────────
model SchoolProfile {
  id                String  @id @default(uuid()) @db.Uuid
  schoolId          String  @unique @db.Uuid
  logoAssetId       String? @db.Uuid
  faviconAssetId    String? @db.Uuid
  brandColorPrimary String  @default("#3ee6b0")
  brandColorSecondary String @default("#7c6cff")
  phone             String?
  email             String?
  addressLine1      String?
  addressLine2      String?
  city              String?
  region            String?
  postalCode        String?
  country           String?
  geoLat            Float?
  geoLng            Float?
  mapEmbedUrl       String?
  school            School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
}

model HomepageContent {
  id                 String  @id @default(uuid()) @db.Uuid
  schoolId           String  @unique @db.Uuid
  heroAssetId        String? @db.Uuid
  headline           String  @default("Welcome")
  subheadline        String?
  aboutText          String?
  principalName      String?
  principalMessage   String?
  principalPhotoAssetId String? @db.Uuid
  school             School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
}

model StatItem {
  id       String @id @default(uuid()) @db.Uuid
  schoolId String @db.Uuid
  label    String
  value    String
  order    Int    @default(0)
  school   School @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
}

model SocialLink {
  id       String         @id @default(uuid()) @db.Uuid
  schoolId String         @db.Uuid
  platform SocialPlatform
  url      String
  order    Int            @default(0)
  school   School         @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
}

model MenuItem {
  id       String   @id @default(uuid()) @db.Uuid
  schoolId String   @db.Uuid
  label    String
  slug     String
  order    Int      @default(0)
  kind     MenuKind @default(CUSTOM)
  parentId String?  @db.Uuid
  refId    String?  @db.Uuid
  school   School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  parent   MenuItem? @relation("MenuTree", fields: [parentId], references: [id], onDelete: Cascade)
  children MenuItem[] @relation("MenuTree")

  @@unique([schoolId, slug])
  @@index([schoolId])
}

model MediaAsset {
  id         String    @id @default(uuid()) @db.Uuid
  schoolId   String    @db.Uuid
  kind       MediaKind
  storageKey String
  url        String
  caption    String?
  order      Int       @default(0)
  width      Int?
  height     Int?
  byteSize   Int?
  createdAt  DateTime  @default(now())
  school     School    @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId, kind])
}

model FeaturedStaff {
  id           String  @id @default(uuid()) @db.Uuid
  schoolId     String  @db.Uuid
  teacherId    String? @db.Uuid
  name         String
  role         String
  photoAssetId String? @db.Uuid
  order        Int     @default(0)
  school       School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  teacher      Teacher? @relation(fields: [teacherId], references: [id], onDelete: SetNull)

  @@index([schoolId])
}

// ── Management (Pro) ─────────────────────────────────────
model AcademicYear {
  id        String   @id @default(uuid()) @db.Uuid
  schoolId  String   @db.Uuid
  name      String
  startDate DateTime
  endDate   DateTime
  isCurrent Boolean  @default(false)
  school    School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSections  ClassSection[]
  timetableSlots TimetableSlot[]

  @@unique([schoolId, name])
  @@index([schoolId])
}

model Grade {
  id       String @id @default(uuid()) @db.Uuid
  schoolId String @db.Uuid
  name     String
  order    Int    @default(0)
  school   School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSections ClassSection[]

  @@unique([schoolId, name])
  @@index([schoolId])
}

model ClassSection {
  id             String  @id @default(uuid()) @db.Uuid
  schoolId       String  @db.Uuid
  gradeId        String  @db.Uuid
  name           String
  classTeacherId String? @db.Uuid
  academicYearId String  @db.Uuid
  school         School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  grade          Grade        @relation(fields: [gradeId], references: [id], onDelete: Cascade)
  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Cascade)
  classTeacher   Teacher?     @relation("ClassTeacher", fields: [classTeacherId], references: [id], onDelete: SetNull)
  students       Student[]
  timetableSlots TimetableSlot[]

  @@unique([schoolId, gradeId, name, academicYearId])
  @@index([schoolId])
}

model Subject {
  id       String @id @default(uuid()) @db.Uuid
  schoolId String @db.Uuid
  name     String
  code     String
  school   School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  teacherSubjects TeacherSubject[]
  timetableSlots  TimetableSlot[]

  @@unique([schoolId, code])
  @@index([schoolId])
}

model Teacher {
  id             String  @id @default(uuid()) @db.Uuid
  schoolId       String  @db.Uuid
  userId         String? @db.Uuid
  firstName      String
  lastName       String
  email          String?
  phone          String?
  photoAssetId   String? @db.Uuid
  primarySubjectId String? @db.Uuid
  bio            String?
  isActive       Boolean @default(true)
  school         School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  teacherSubjects TeacherSubject[]
  classSections  ClassSection[] @relation("ClassTeacher")
  timetableSlots TimetableSlot[]
  featuredIn     FeaturedStaff[]

  @@index([schoolId])
}

model TeacherSubject {
  id        String  @id @default(uuid()) @db.Uuid
  schoolId  String  @db.Uuid
  teacherId String  @db.Uuid
  subjectId String  @db.Uuid
  teacher   Teacher @relation(fields: [teacherId], references: [id], onDelete: Cascade)
  subject   Subject @relation(fields: [subjectId], references: [id], onDelete: Cascade)

  @@unique([teacherId, subjectId])
  @@index([schoolId])
}

model Student {
  id             String   @id @default(uuid()) @db.Uuid
  schoolId       String   @db.Uuid
  admissionNo    String
  firstName      String
  lastName       String
  classSectionId String?  @db.Uuid
  rollNo         String?
  dob            DateTime?
  gender         String?
  guardianName   String?
  guardianPhone  String?
  photoAssetId   String?  @db.Uuid
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  school         School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection   ClassSection? @relation(fields: [classSectionId], references: [id], onDelete: SetNull)

  @@unique([schoolId, admissionNo])
  @@index([schoolId, classSectionId])
}

model Period {
  id        String @id @default(uuid()) @db.Uuid
  schoolId  String @db.Uuid
  order     Int
  label     String
  startTime String
  endTime   String
  school    School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  timetableSlots TimetableSlot[]

  @@unique([schoolId, order])
  @@index([schoolId])
}

model TimetableSlot {
  id             String @id @default(uuid()) @db.Uuid
  schoolId       String @db.Uuid
  classSectionId String @db.Uuid
  dayOfWeek      Int
  periodId       String @db.Uuid
  subjectId      String @db.Uuid
  teacherId      String @db.Uuid
  academicYearId String @db.Uuid
  school         School       @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection   ClassSection @relation(fields: [classSectionId], references: [id], onDelete: Cascade)
  period         Period       @relation(fields: [periodId], references: [id], onDelete: Cascade)
  subject        Subject      @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  teacher        Teacher      @relation(fields: [teacherId], references: [id], onDelete: Cascade)
  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Cascade)

  @@unique([schoolId, classSectionId, dayOfWeek, periodId, academicYearId], name: "class_slot")
  @@unique([schoolId, teacherId, dayOfWeek, periodId, academicYearId], name: "teacher_slot")
  @@index([schoolId])
}

// ── Community ────────────────────────────────────────────
model Event {
  id              String      @id @default(uuid()) @db.Uuid
  schoolId        String      @db.Uuid
  title           String
  description     String?
  coverAssetId    String?     @db.Uuid
  startAt         DateTime
  endAt           DateTime?
  venue           String?
  scope           EventScope  @default(SCHOOL)
  status          EventStatus @default(DRAFT)
  createdByUserId String?     @db.Uuid
  approvedByUserId String?    @db.Uuid
  approvedAt      DateTime?
  createdAt       DateTime    @default(now())
  school          School      @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
  @@index([scope, status])
}

model Enquiry {
  id           String        @id @default(uuid()) @db.Uuid
  schoolId     String        @db.Uuid
  parentName   String
  phone        String
  email        String?
  gradeInterest String?
  message      String?
  status       EnquiryStatus @default(NEW)
  createdAt    DateTime      @default(now())
  school       School        @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
}
```

- [ ] **Step 2: Validate the schema**

Run: `cd packages/db && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Generate the client**

Run: `pnpm --filter @skoolos/db generate`
Expected: `Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): normalized school-website-platform schema"
```

---

### Task 3: Reset migrations to a clean baseline + RLS/roles

**Files:**
- Delete: `packages/db/prisma/migrations/2026061*/` (all existing)
- Create: `packages/db/prisma/migrations/20260703_000000_baseline/migration.sql` (generated)
- Create: `packages/db/prisma/migrations/20260703_000100_rls_and_roles/migration.sql` (hand-written)

**Interfaces:**
- Produces: a database where every tenant table has `FORCE ROW LEVEL SECURITY` and a tenant policy on `app.current_tenant`; `Event` additionally readable when `scope=NETWORK AND status=APPROVED`; roles `skoolos_app`/`skoolos_platform` exist with grants.

- [ ] **Step 1: Remove old migrations and recreate the local DB**

```bash
cd /Users/darshanjain/Documents/SchoolManager/SchoolManager
git rm -r packages/db/prisma/migrations/2026061*
docker exec skoolos-postgres psql -U skoolos -d postgres -c "DROP DATABASE IF EXISTS skoolos;"
docker exec skoolos-postgres psql -U skoolos -d postgres -c "CREATE DATABASE skoolos;"
```

- [ ] **Step 2: Generate the baseline migration from the schema**

```bash
cd packages/db
DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public \
  npx prisma migrate dev --name baseline --create-only
```
Expected: a new folder `migrations/<timestamp>_baseline/migration.sql`. Rename it to `20260703_000000_baseline` for deterministic ordering:
```bash
mv migrations/*_baseline migrations/20260703_000000_baseline
```

- [ ] **Step 3: Hand-write the RLS + roles migration**

Create `packages/db/prisma/migrations/20260703_000100_rls_and_roles/migration.sql`:

```sql
-- Roles ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_app') THEN
    CREATE ROLE skoolos_app LOGIN PASSWORD 'skoolos_app_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_platform') THEN
    CREATE ROLE skoolos_platform LOGIN PASSWORD 'skoolos_platform_pw' BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO skoolos_app, skoolos_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skoolos_app, skoolos_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skoolos_app, skoolos_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skoolos_app, skoolos_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO skoolos_app, skoolos_platform;

-- Helper: enable + force RLS and add the standard tenant policy on a column.
-- We inline per-table for clarity/auditability.

-- School: matched on id (a school sees only itself).
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "School"
  USING (id::text = current_setting('app.current_tenant', true))
  WITH CHECK (id::text = current_setting('app.current_tenant', true));

-- Every other tenant table: matched on "schoolId".
-- (schoolId-nullable tables User/RefreshToken/AuditLog: platform rows have NULL
--  schoolId and are only ever read via the BYPASSRLS platform role.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Domain','FeatureOverride','User','RefreshToken','AuditLog',
    'SchoolProfile','HomepageContent','StatItem','SocialLink','MenuItem',
    'MediaAsset','FeaturedStaff','AcademicYear','Grade','ClassSection',
    'Subject','Teacher','TeacherSubject','Student','Period','TimetableSlot',
    'Enquiry'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;

-- Event: own-tenant read/write PLUS read of approved network events.
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "Event"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
CREATE POLICY read_network_events ON "Event" FOR SELECT
  USING (scope = 'NETWORK' AND status = 'APPROVED');
```

- [ ] **Step 4: Apply migrations**

```bash
cd packages/db
DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public \
  npx prisma migrate deploy
```
Expected: both migrations applied, "All migrations have been successfully applied."

- [ ] **Step 5: Verify RLS is on for a sample table**

```bash
docker exec skoolos-postgres psql -U skoolos -d skoolos -c \
  "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Student','Event','School') ORDER BY relname;"
```
Expected: `relrowsecurity` and `relforcerowsecurity` are `t` for all three.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(db): clean baseline migration + RLS/roles for new schema"
```

---

### Task 4: Feature/tier resolution (shared package function)

**Files:**
- Create: `packages/db/src/features.ts`
- Modify: `packages/db/src/index.ts` (re-export)
- Test: `packages/db/src/features.spec.ts`

**Interfaces:**
- Produces:
  - `type FeatureKey = 'PUBLIC_SITE'|'GALLERY'|'ENQUIRY'|'SOCIAL'|'ABOUT_CONTACT'|'EVENTS'|'MANAGEMENT'`
  - `const TIER_FEATURES: Record<Tier, FeatureKey[]>`
  - `function resolveFeatures(tier: Tier, overrides: { featureKey: string; enabled: boolean }[]): Set<FeatureKey>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/features.spec.ts`:
```ts
import { resolveFeatures, TIER_FEATURES } from './features';

describe('resolveFeatures', () => {
  it('BASIC includes public site, gallery, enquiry, social; not events/management', () => {
    const f = resolveFeatures('BASIC', []);
    expect(f.has('PUBLIC_SITE')).toBe(true);
    expect(f.has('GALLERY')).toBe(true);
    expect(f.has('ENQUIRY')).toBe(true);
    expect(f.has('SOCIAL')).toBe(true);
    expect(f.has('EVENTS')).toBe(false);
    expect(f.has('MANAGEMENT')).toBe(false);
  });

  it('STANDARD adds about/contact and events', () => {
    const f = resolveFeatures('STANDARD', []);
    expect(f.has('ABOUT_CONTACT')).toBe(true);
    expect(f.has('EVENTS')).toBe(true);
    expect(f.has('MANAGEMENT')).toBe(false);
  });

  it('PRO adds management', () => {
    expect(resolveFeatures('PRO', []).has('MANAGEMENT')).toBe(true);
  });

  it('an enabled override adds a feature above the tier', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'EVENTS', enabled: true }]);
    expect(f.has('EVENTS')).toBe(true);
  });

  it('a disabled override removes a tier feature', () => {
    const f = resolveFeatures('PRO', [{ featureKey: 'MANAGEMENT', enabled: false }]);
    expect(f.has('MANAGEMENT')).toBe(false);
  });

  it('ignores unknown override keys', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'NOPE', enabled: true }]);
    expect(f.has('PUBLIC_SITE')).toBe(true);
    expect((f as Set<string>).has('NOPE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @skoolos/db exec jest src/features.spec.ts`
Expected: FAIL — cannot find `./features`.
(If `@skoolos/db` has no jest config, add one: create `packages/db/jest.config.js` with `module.exports = { preset: 'ts-jest', testEnvironment: 'node', roots: ['<rootDir>/src'] };` and add `jest`, `ts-jest`, `@types/jest` devDeps + a `"test": "jest"` script, then re-run.)

- [ ] **Step 3: Implement `features.ts`**

Create `packages/db/src/features.ts`:
```ts
import type { Tier } from '@prisma/client';

export type FeatureKey =
  | 'PUBLIC_SITE' | 'GALLERY' | 'ENQUIRY' | 'SOCIAL'
  | 'ABOUT_CONTACT' | 'EVENTS' | 'MANAGEMENT';

const ALL_KEYS: FeatureKey[] = ['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','MANAGEMENT'];
const isFeatureKey = (k: string): k is FeatureKey => (ALL_KEYS as string[]).includes(k);

const BASIC: FeatureKey[] = ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL'];
const STANDARD: FeatureKey[] = [...BASIC, 'ABOUT_CONTACT', 'EVENTS'];
const PRO: FeatureKey[] = [...STANDARD, 'MANAGEMENT'];

export const TIER_FEATURES: Record<Tier, FeatureKey[]> = {
  BASIC, STANDARD, PRO,
};

export function resolveFeatures(
  tier: Tier,
  overrides: { featureKey: string; enabled: boolean }[],
): Set<FeatureKey> {
  const set = new Set<FeatureKey>(TIER_FEATURES[tier]);
  for (const o of overrides) {
    if (!isFeatureKey(o.featureKey)) continue;
    if (o.enabled) set.add(o.featureKey);
    else set.delete(o.featureKey);
  }
  return set;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/db/src/index.ts`, add near the other exports:
```ts
export * from './features';
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @skoolos/db test`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/features.ts packages/db/src/features.spec.ts packages/db/src/index.ts packages/db/jest.config.js packages/db/package.json
git commit -m "feat(db): tier→feature resolver with per-school overrides"
```

---

### Task 5: FeatureResolverService + guard (API, Redis-cached)

**Files:**
- Create: `apps/api/src/modules/features/internal/feature-resolver.service.ts`
- Create: `apps/api/src/modules/features/internal/feature-resolver.service.spec.ts`
- Create: `apps/api/src/modules/features/internal/require-feature.decorator.ts`
- Create: `apps/api/src/modules/features/internal/require-feature.guard.ts`
- Create: `apps/api/src/modules/features/internal/features.module.ts`
- Create: `apps/api/src/modules/features/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `resolveFeatures`, `getPlatformPrisma` from `@skoolos/db`; tenant context from `TenantContextService` (`apps/api/src/modules/tenancy/internal/tenant-context.service.ts`) exposing the current `schoolId`.
- Produces:
  - `FeatureResolverService.getFeatures(schoolId: string): Promise<Set<FeatureKey>>` (Redis-cached, key `feat:{schoolId}`, TTL 300s)
  - `FeatureResolverService.invalidate(schoolId: string): Promise<void>`
  - `@RequireFeature('MANAGEMENT')` decorator + `RequireFeatureGuard` returning 403 when absent.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/modules/features/internal/feature-resolver.service.spec.ts`:
```ts
import { FeatureResolverService } from './feature-resolver.service';

describe('FeatureResolverService.computeFor', () => {
  it('merges tier + overrides using the shared resolver', () => {
    const svc = new FeatureResolverService();
    const set = svc.computeFor('PRO', [{ featureKey: 'MANAGEMENT', enabled: false }]);
    expect(set.has('MANAGEMENT')).toBe(false);
    expect(set.has('EVENTS')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @skoolos/api exec jest src/modules/features/internal/feature-resolver.service.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/features/internal/feature-resolver.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { getPlatformPrisma, resolveFeatures, type FeatureKey } from '@skoolos/db';
import type { Tier } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

@Injectable()
export class FeatureResolverService {
  private readonly env = loadEnv();
  private readonly redis = new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  private static readonly TTL = 300;

  /** Pure merge — unit-testable without IO. */
  computeFor(tier: Tier, overrides: { featureKey: string; enabled: boolean }[]): Set<FeatureKey> {
    return resolveFeatures(tier, overrides);
  }

  async getFeatures(schoolId: string): Promise<Set<FeatureKey>> {
    const key = `feat:${schoolId}`;
    try {
      await this.connect();
      const cached = await this.redis.get(key);
      if (cached) return new Set(JSON.parse(cached) as FeatureKey[]);
    } catch { /* fall through to DB */ }

    const prisma = getPlatformPrisma();
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { tier: true, featureOverrides: { select: { featureKey: true, enabled: true } } },
    });
    if (!school) return new Set();
    const set = this.computeFor(school.tier, school.featureOverrides);
    try { await this.redis.set(key, JSON.stringify([...set]), 'EX', FeatureResolverService.TTL); } catch { /* ignore */ }
    return set;
  }

  async invalidate(schoolId: string): Promise<void> {
    try { await this.connect(); await this.redis.del(`feat:${schoolId}`); } catch { /* ignore */ }
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
  }
}
```

- [ ] **Step 4: Run the unit test, verify pass**

Run: `pnpm --filter @skoolos/api exec jest src/modules/features/internal/feature-resolver.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the decorator + guard**

Create `apps/api/src/modules/features/internal/require-feature.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@skoolos/db';

export const REQUIRE_FEATURE = 'require_feature';
export const RequireFeature = (key: FeatureKey) => SetMetadata(REQUIRE_FEATURE, key);
```

Create `apps/api/src/modules/features/internal/require-feature.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@skoolos/db';
import { REQUIRE_FEATURE } from './require-feature.decorator';
import { FeatureResolverService } from './feature-resolver.service';
import { TenantContextService } from '../../tenancy/internal/tenant-context.service';

@Injectable()
export class RequireFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureResolverService,
    private readonly tenant: TenantContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<FeatureKey | undefined>(REQUIRE_FEATURE, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;
    const schoolId = this.tenant.current()?.schoolId;
    if (!schoolId) throw new ForbiddenException('No tenant context');
    const set = await this.features.getFeatures(schoolId);
    if (!set.has(required)) throw new ForbiddenException(`Feature ${required} not enabled for this school`);
    return true;
  }
}
```
Note: confirm `TenantContextService` exposes `current()` returning `{ schoolId?: string }`. If the accessor differs, read `apps/api/src/modules/tenancy/internal/tenant-context.service.ts` and adapt the two `this.tenant.*` calls to the real API (do not change the tenancy service).

- [ ] **Step 6: Wire the module**

Create `apps/api/src/modules/features/internal/features.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TenancyModule } from '../../tenancy';
import { FeatureResolverService } from './feature-resolver.service';
import { RequireFeatureGuard } from './require-feature.guard';

@Module({
  imports: [TenancyModule],
  providers: [FeatureResolverService, RequireFeatureGuard],
  exports: [FeatureResolverService, RequireFeatureGuard],
})
export class FeaturesModule {}
```

Create `apps/api/src/modules/features/index.ts`:
```ts
export { FeaturesModule } from './internal/features.module';
export { FeatureResolverService } from './internal/feature-resolver.service';
export { RequireFeature } from './internal/require-feature.decorator';
export { RequireFeatureGuard } from './internal/require-feature.guard';
```

In `apps/api/src/app.module.ts` add `import { FeaturesModule } from './modules/features';` and include `FeaturesModule` in `imports`.
(If `TenancyModule` does not already `exports` `TenantContextService`, add it to that module's `exports` array so the guard can inject it.)

- [ ] **Step 7: Typecheck + unit tests**

Run: `pnpm --filter @skoolos/api typecheck && pnpm --filter @skoolos/api exec jest src/modules/features`
Expected: typecheck PASS; feature spec PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/features apps/api/src/app.module.ts
git commit -m "feat(api): FeatureResolverService + RequireFeature guard (Redis-cached)"
```

---

### Task 6: Rewrite the seed (owner + demo schools with new model)

**Files:**
- Modify (rewrite): `packages/db/prisma/seed.ts`

**Interfaces:**
- Consumes: `getPlatformPrisma` from `@skoolos/db`; `argon2` for hashing.
- Produces: an owner `User` (`schoolId=null`, role `OWNER`), two schools (`acme` STANDARD, `beacon` PRO) each with a `Domain` (`<slug>.localhost`), a `SCHOOL_ADMIN` user, `SchoolProfile`, `HomepageContent`, a few `Grade`s; Beacon (PRO) also gets a `Teacher`, `ClassSection`, and `Student`.

- [ ] **Step 1: Rewrite `seed.ts`**

Replace `packages/db/prisma/seed.ts` with:
```ts
import { loadEnv } from '@skoolos/config';
loadEnv();
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import { hash } from 'argon2';

async function main() {
  const db = getPlatformPrisma();
  const PW = 'Passw0rd!';
  const OWNER_PW = 'OwnerPassw0rd!';

  // Platform owner (no school).
  await db.user.upsert({
    where: { schoolId_email: { schoolId: null as unknown as string, email: 'owner@skoolos.local' } },
    update: {},
    create: { email: 'owner@skoolos.local', passwordHash: await hash(OWNER_PW), role: 'OWNER' },
  }).catch(async () => {
    // schoolId null can't use the compound unique in some Prisma versions; fall back to findFirst.
    const existing = await db.user.findFirst({ where: { email: 'owner@skoolos.local', schoolId: null } });
    if (!existing) await db.user.create({ data: { email: 'owner@skoolos.local', passwordHash: await hash(OWNER_PW), role: 'OWNER' } });
  });

  for (const [slug, name, tier] of [
    ['acme', 'Acme International', 'STANDARD'],
    ['beacon', 'Beacon Public School', 'PRO'],
  ] as const) {
    const school = await db.school.upsert({
      where: { slug },
      update: { tier, status: 'LIVE' },
      create: { slug, name, tier, status: 'LIVE' },
    });
    await db.domain.upsert({
      where: { hostname: `${slug}.localhost` },
      update: {},
      create: { schoolId: school.id, hostname: `${slug}.localhost`, type: 'SUBDOMAIN', status: 'LIVE', isPrimary: true },
    });
    await db.user.upsert({
      where: { schoolId_email: { schoolId: school.id, email: `admin@${slug}.test` } },
      update: {},
      create: { schoolId: school.id, email: `admin@${slug}.test`, passwordHash: await hash(PW), role: 'SCHOOL_ADMIN' },
    });
    await db.schoolProfile.upsert({
      where: { schoolId: school.id },
      update: {},
      create: { schoolId: school.id, phone: '+91 98765 43210', email: `info@${slug}.test`, city: 'Bengaluru', country: 'India' },
    });
    await db.homepageContent.upsert({
      where: { schoolId: school.id },
      update: {},
      create: { schoolId: school.id, headline: `Welcome to ${name}`, subheadline: 'A future-ready school.' },
    });
    for (const [i, g] of ['Nursery', 'Grade 1', 'Grade 5', 'Grade 6'].entries()) {
      await db.grade.upsert({
        where: { schoolId_name: { schoolId: school.id, name: g } },
        update: {}, create: { schoolId: school.id, name: g, order: i },
      });
    }

    if (tier === 'PRO') {
      const year = await db.academicYear.upsert({
        where: { schoolId_name: { schoolId: school.id, name: '2026-27' } },
        update: {}, create: { schoolId: school.id, name: '2026-27', startDate: new Date('2026-06-01'), endDate: new Date('2027-04-30'), isCurrent: true },
      });
      const grade5 = await db.grade.findFirstOrThrow({ where: { schoolId: school.id, name: 'Grade 5' } });
      const teacher = await db.teacher.create({
        data: { schoolId: school.id, firstName: 'Meera', lastName: 'Nair', email: 'meera@beacon.test' },
      });
      const section = await db.classSection.create({
        data: { schoolId: school.id, gradeId: grade5.id, name: 'A', academicYearId: year.id, classTeacherId: teacher.id },
      });
      await db.student.create({
        data: { schoolId: school.id, admissionNo: '05A-01', firstName: 'Aarav', lastName: 'Sharma', classSectionId: section.id, rollNo: '1', guardianName: 'Rohan Sharma', guardianPhone: '+91 90000 11111' },
      });
    }
  }

  console.log('\n──── SEED COMPLETE ────');
  console.log('Owner:  owner@skoolos.local /', OWNER_PW);
  console.log('Acme (STANDARD):   admin@acme.test /', PW, '→ http://acme.localhost');
  console.log('Beacon (PRO):      admin@beacon.test /', PW, '→ http://beacon.localhost');
  await disconnectAll();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the seed**

```bash
cd packages/db
DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public npx tsx prisma/seed.ts
```
Expected: prints "SEED COMPLETE" and the three credential lines, no errors.

- [ ] **Step 3: Verify data landed and is queryable**

```bash
docker exec skoolos-postgres psql -U skoolos -d skoolos -c \
  "SELECT s.slug, s.tier, count(st.*) AS students FROM \"School\" s LEFT JOIN \"Student\" st ON st.\"schoolId\"=s.id GROUP BY s.slug, s.tier ORDER BY s.slug;"
```
Expected: `acme|STANDARD|0` and `beacon|PRO|1`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed owner + demo schools (STANDARD/PRO) for new model"
```

---

### Task 7: Cross-tenant leak test (proves isolation)

**Files:**
- Create: `apps/api/test/tenant-isolation.e2e-spec.ts`
- Verify: `apps/api/test/jest-e2e.config.js` exists (it does — used by `test:e2e`)

**Interfaces:**
- Consumes: `getTenantPrisma`, `withTenant`, `getPlatformPrisma` from `@skoolos/db`.
- Produces: a passing suite proving that with tenant A's context, tenant B's rows are invisible, and that a write under A's context cannot forge B's `schoolId`.

- [ ] **Step 1: Write the leak test**

Create `apps/api/test/tenant-isolation.e2e-spec.ts`:
```ts
import { getPlatformPrisma, getTenantPrisma, withTenant, disconnectAll } from '@skoolos/db';

describe('RLS tenant isolation', () => {
  let acmeId: string;
  let beaconId: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    acmeId = (await p.school.findUniqueOrThrow({ where: { slug: 'acme' } })).id;
    beaconId = (await p.school.findUniqueOrThrow({ where: { slug: 'beacon' } })).id;
    // Ensure each school has at least one enquiry to read.
    await p.enquiry.create({ data: { schoolId: acmeId, parentName: 'A-Parent', phone: '1' } });
    await p.enquiry.create({ data: { schoolId: beaconId, parentName: 'B-Parent', phone: '2' } });
  });

  afterAll(async () => { await disconnectAll(); });

  it('tenant A cannot see tenant B enquiries', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.enquiry.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.schoolId === acmeId)).toBe(true);
    expect(rows.some((r) => r.schoolId === beaconId)).toBe(false);
  });

  it('tenant A sees only its own school row', async () => {
    const schools = await withTenant(acmeId, (tx) => tx.school.findMany());
    expect(schools.map((s) => s.id)).toEqual([acmeId]);
  });

  it('a write under A cannot forge a B-owned row (RLS WITH CHECK)', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.enquiry.create({ data: { schoolId: beaconId, parentName: 'X', phone: '3' } }),
      ),
    ).rejects.toThrow();
  });

  it('approved NETWORK events are visible cross-tenant; SCHOOL events are not', async () => {
    const p = getPlatformPrisma();
    await p.event.create({ data: { schoolId: beaconId, title: 'Net', startAt: new Date(), scope: 'NETWORK', status: 'APPROVED' } });
    await p.event.create({ data: { schoolId: beaconId, title: 'Local', startAt: new Date(), scope: 'SCHOOL', status: 'APPROVED' } });
    const visible = await withTenant(acmeId, (tx) => tx.event.findMany());
    const titles = visible.map((e) => e.title);
    expect(titles).toContain('Net');
    expect(titles).not.toContain('Local');
  });
});
```

- [ ] **Step 2: Ensure the e2e runner points the tenant client at `skoolos_app`**

The test must connect as the RLS-bound role. Confirm `.env` has `DATABASE_URL_APP=postgresql://skoolos_app:skoolos_app_pw@localhost:5432/skoolos?schema=public` (it does per `.env.example`). The e2e config sets `NODE_ENV=test`; ensure it loads `.env`. If the suite needs env, prepend the run with the three URLs (Step 3 does this).

- [ ] **Step 3: Run the leak suite**

```bash
cd apps/api
DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public \
DATABASE_URL_APP=postgresql://skoolos_app:skoolos_app_pw@localhost:5432/skoolos?schema=public \
DATABASE_URL_PLATFORM=postgresql://skoolos_platform:skoolos_platform_pw@localhost:5432/skoolos?schema=public \
  npx jest --config test/jest-e2e.config.js tenant-isolation --runInBand
```
Expected: 4 passing. (If the "forge" test does NOT throw, RLS `WITH CHECK` is missing — revisit Task 3 Step 3.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/tenant-isolation.e2e-spec.ts
git commit -m "test(api): cross-tenant RLS isolation suite (read + write + network events)"
```

---

### Task 8: Boot the API and smoke-test health

**Files:**
- None (verification task)

- [ ] **Step 1: Start the API against the seeded DB**

```bash
cd /Users/darshanjain/Documents/SchoolManager/SchoolManager
DATABASE_URL_APP=postgresql://skoolos_app:skoolos_app_pw@localhost:5432/skoolos?schema=public \
DATABASE_URL_PLATFORM=postgresql://skoolos_platform:skoolos_platform_pw@localhost:5432/skoolos?schema=public \
  pnpm --filter @skoolos/api dev &
sleep 12
```

- [ ] **Step 2: Hit health**

Run: `curl -s http://localhost:3001/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 3: Confirm the platform login still resolves the owner**

Run:
```bash
curl -s -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' \
  -H 'X-Forwarded-Host: acme.localhost' -d '{"email":"admin@acme.test","password":"Passw0rd!"}' | head -c 80
```
Expected: a JSON body containing `accessToken` (confirms auth + tenancy + new schema work end-to-end).
(If the auth service references removed columns, adjust it minimally to the new `User` model — it already looks up by `schoolId_email`.)

- [ ] **Step 4: Stop the dev server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 5: Commit any auth adjustments**

```bash
git add -A
git commit -m "fix(api): align auth with new User model" || echo "nothing to commit"
```

---

## Self-review notes (author)

- **Spec coverage:** §2 removals → Task 1. §5 data model → Task 2. §4 isolation (RLS/roles + network-event exception) → Task 3 & Task 7. §6 feature/tier → Tasks 4–5. §11 migration/seed → Tasks 3, 6. §10 leak tests → Task 7. Public-site rendering (§7), owner/admin portals, management CRUD, events/enquiry endpoints, media pipeline are **later phases** (Phase 2+), intentionally out of this plan.
- **Deferred to Phase 2+ (tracked):** owner portal, school-admin CMS, management CRUD, public site, Connect endpoints, media/S3 pipeline, per-tenant rate limiting, audit interceptor wiring for overrides.
- **Assumptions to verify during execution:** `TenantContextService.current()` accessor name; `TenancyModule` exports `TenantContextService`; Prisma's handling of the `schoolId=null` compound unique in the owner upsert (seed includes a fallback).
```
