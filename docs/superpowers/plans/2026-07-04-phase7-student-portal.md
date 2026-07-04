# Phase 7 — Student Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal per-student portal — a student logs in on their school subdomain and sees their timetable, announcements addressed to them, and a read-only profile. School admins provision student logins and post announcements.

**Architecture:** Reuse the school-audience JWT (`SchoolJwtGuard`) + `RolesGuard`/`@Roles`. Link a `Student` to its login `User` via a new `Student.userId`. A student resolves ONLY their own `Student` row (`userId = req.user.sub`) inside `withTenant`, so cross-student access is impossible. New `Announcement` model (nullable `classSectionId`: null = school-wide) with `tenant_iso` RLS. Timetable reuses `TimetableService.listForClass`.

**Tech Stack:** NestJS 10 (api), Next.js 14 App Router (web), Prisma 5 + Postgres RLS, Tailwind, @tanstack/react-query, sonner.

## Global Constraints

- **schoolId provenance:** tenant `schoolId` ONLY from `TenantContextService.requireTenant().schoolId`. NEVER client input.
- **Tenant DB access:** every tenant read/write via `withTenant(schoolId, fn)`. `getPlatformPrisma()` is FORBIDDEN in the student/announcement/management paths.
- **Role enforcement:** student routes use `@UseGuards(SchoolJwtGuard, RolesGuard)` + `@Roles('STUDENT')`. Admin routes use `@Roles('SCHOOL_ADMIN')`. `RolesGuard` reads `req.user.role` (set by `SchoolJwtGuard`). `Roles` from `apps/api/src/common/auth/roles.decorator.ts`; `RolesGuard` from `apps/api/src/common/auth/roles.guard.ts`.
- **A student resolves only their own data:** always `tx.student.findFirst({ where: { userId: req.user.sub } })` (or `findUnique` on the unique `userId`) inside `withTenant`. Never accept a studentId from the client for `/me/*`.
- **Password provisioning:** temp password = `randomBytes(8).toString('base64url')`, hashed via `PasswordService.hash` (`import { PasswordService } from '../../auth'`). Mirror `owner-schools.service.ts:91-92,102`.
- **Web tenant-host rule:** every web `useApi` call (admin AND portal) passes `hostHeader` from `useHost()` (`@/components/use-host`); queries `enabled: !!host`.
- **Error mapping:** create→P2002→`ConflictException`(409); update→P2025→404/P2002→409; delete→P2025→404/P2003→409. Helpers `isP2002/isP2025/isP2003` from `apps/api/src/modules/management/internal/prisma-errors.ts`.
- **New table RLS:** a new tenant table needs `ENABLE`+`FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_iso ... USING/WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true))`. Table GRANTs to `skoolos_app` are automatic via `ALTER DEFAULT PRIVILEGES` — do NOT re-grant.

---

## File Structure

- `packages/db/prisma/schema.prisma` — `Student.userId String? @unique @db.Uuid`; new `Announcement` model.
- `packages/db/prisma/migrations/<ts>_student_login_and_announcements/migration.sql` — the column, the table, and the table's RLS policy.
- `apps/api/src/modules/management/` — extend: `students.service.ts`/`students.controller.ts` gain `createLogin`. NEW `announcements.service.ts`/`announcements.controller.ts`; register in `management.module.ts`; DTOs in `management.dto.ts`.
- `apps/api/src/modules/portal/` (NEW module) — `portal.service.ts` (profile/timetable/announcements for the caller), `portal.controller.ts` (`/me/*`, `@Roles('STUDENT')`), `portal.module.ts`, `index.ts`; register in `app.module.ts`.
- `apps/api/test/student.e2e-spec.ts` (NEW).
- `apps/web/app/app/students/page.tsx` — "Create login" action. `apps/web/app/app/announcements/page.tsx` (NEW) + nav entry.
- `apps/web/app/portal/` (NEW route group) — `layout.tsx`, `page.tsx`, `timetable/page.tsx`, `announcements/page.tsx`, `profile/page.tsx`.
- `apps/web/app/login/page.tsx` — role-based redirect (STUDENT → `/portal`).

---

### Task 1: Schema — Student.userId + Announcement model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_student_login_and_announcements/migration.sql`

**Interfaces:**
- Produces: `Student.userId: string | null`; `Announcement { id, schoolId, classSectionId (nullable), title, body, createdByUserId (nullable), createdAt }` in the Prisma client.

- [ ] **Step 1:** In `schema.prisma`, add to `model Student` (after `photoAssetId`):

```prisma
  userId         String?  @unique @db.Uuid
```

- [ ] **Step 2:** Add the new model (place near `Enquiry`):

```prisma
model Announcement {
  id              String        @id @default(uuid()) @db.Uuid
  schoolId        String        @db.Uuid
  classSectionId  String?       @db.Uuid
  title           String
  body            String
  createdByUserId String?       @db.Uuid
  createdAt       DateTime      @default(now())
  school          School        @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  classSection    ClassSection? @relation(fields: [classSectionId], references: [id], onDelete: SetNull)

  @@index([schoolId])
  @@index([schoolId, classSectionId])
}
```

- [ ] **Step 3:** Add the back-relations so Prisma validates: on `model School` add `announcements Announcement[]`; on `model ClassSection` add `announcements Announcement[]`. (Find those models and add the fields; match the existing relation-field style.)

- [ ] **Step 4:** Create the migration SQL. The `Student.userId` column + unique index, the `Announcement` table, and its RLS policy (GRANTs are automatic):

```sql
-- Student login linkage
ALTER TABLE "Student" ADD COLUMN "userId" UUID;
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- Announcements
CREATE TABLE "Announcement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "classSectionId" UUID,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_schoolId_idx" ON "Announcement"("schoolId");
CREATE INDEX "Announcement_schoolId_classSectionId_idx" ON "Announcement"("schoolId", "classSectionId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: own-tenant read/write (GRANTs auto-applied via ALTER DEFAULT PRIVILEGES)
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "Announcement"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
```

> Confirm `gen_random_uuid()` is what the baseline uses for defaults (grep the baseline migration); if it uses a different default, match it. If unsure, `uuid_generate_v4()` vs `gen_random_uuid()` — use whichever the existing `CREATE TABLE` statements use.

- [ ] **Step 5:** Apply + regenerate. Run: `pnpm --filter @skoolos/db migrate:deploy && pnpm --filter @skoolos/db generate`. Expected: applied, client regenerated.
- [ ] **Step 6:** Verify the RLS policy exists and the app role can be blocked: `docker exec skoolos-postgres psql -U skoolos -d skoolos -tAc "SELECT relrowsecurity FROM pg_class WHERE relname='Announcement';"` → `t`. Typecheck db: `pnpm --filter @skoolos/db typecheck` → 0.
- [ ] **Step 7:** Commit `feat(db): Student.userId + Announcement model with RLS`.

---

### Task 2: API — student login provisioning

**Files:**
- Modify: `apps/api/src/modules/management/students.service.ts`, `students.controller.ts`, `management.module.ts` (StudentsService needs `PasswordService` injected — import `AuthModule` if not already available; check how other management providers get it — if `PasswordService` isn't exported to management, add it to the `management.module` imports via the auth module's exports).

**Interfaces:**
- Consumes: `PasswordService` (`import { PasswordService } from '../auth'` — verify the exact export path from `apps/api/src/modules/auth/index.ts`), `withTenant`, `TenantContextService`, `randomBytes`.
- Produces: `StudentsService.createLogin(schoolId, studentId): Promise<{ email: string; tempPassword: string }>`; route `POST /manage/students/:id/login`.

- [ ] **Step 1:** Add to `StudentsService`:

```ts
async createLogin(schoolId: string, studentId: string) {
  return withTenant(schoolId, async (tx) => {
    const student = await tx.student.findFirst({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');
    if (student.userId) throw new ConflictException('Student already has a login');

    // Deterministic, unique-per-school email for the student login.
    const email = `student.${student.admissionNo.toLowerCase()}@${schoolId}.students.local`;
    const tempPassword = randomBytes(8).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);

    const user = await tx.user.create({
      data: { schoolId, email, passwordHash, role: 'STUDENT' },
    });
    await tx.student.update({ where: { id: studentId }, data: { userId: user.id } });
    return { email, tempPassword };
  });
}
```
Add imports: `randomBytes` from `node:crypto`; `PasswordService` (constructor-inject `private readonly passwords: PasswordService`). Handle the `user.create` P2002 (duplicate email) → `ConflictException('Login already exists')` using `isP2002`.

> **Email choice:** the `User` unique is `(schoolId, email)`. The synthetic email above is stable and unique per student. If the product later wants real emails, that's a separate change. The student logs in with THIS email + temp password on their school subdomain. Return it so the admin can share it.

- [ ] **Step 2:** Add to `StudentsController` (it already has `SchoolJwtGuard` + `@RequireFeature('MANAGEMENT')` at class level — verify; add `RolesGuard` to the guards and `@Roles('SCHOOL_ADMIN')` on this method, or class-level if all methods are admin-only):

```ts
@Post(':id/login')
createLogin(@Param('id', ParseUUIDPipe) id: string) {
  return this.students.createLogin(this.schoolId(), id);
}
```
(Use the controller's existing `this.schoolId()` helper / `requireTenant` pattern.)

- [ ] **Step 3:** Ensure `RolesGuard` is applied. If the students controller doesn't already use it, add `@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)` and `@Roles('SCHOOL_ADMIN')` at the class level (all student-management routes are admin-only). Confirm `RolesGuard` is provided/available (it's exported from the auth module per `auth.module.ts`).
- [ ] **Step 4:** Typecheck api → 0.
- [ ] **Step 5:** Commit `feat(api): school admin can provision a student login`.

---

### Task 3: API — announcements CRUD (school-admin)

**Files:**
- Create: `apps/api/src/modules/management/announcements.service.ts`, `announcements.controller.ts`
- Modify: `management.module.ts` (register), `management.dto.ts` (DTOs)

**Interfaces:**
- Produces: `AnnouncementsService.{list,create,update,remove}`; routes `GET/POST/PATCH/DELETE /manage/announcements` (`@Roles('SCHOOL_ADMIN')`).

- [ ] **Step 1: DTOs** (`management.dto.ts`):

```ts
export class CreateAnnouncementDto {
  @IsString() @Length(1, 160) title!: string;
  @IsString() @Length(1, 4000) body!: string;
  @IsOptional() @IsUUID() classSectionId?: string; // omitted = school-wide
}
export class UpdateAnnouncementDto {
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @Length(1, 4000) body?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
}
```
(Add any missing `class-validator` imports.)

- [ ] **Step 2: Service** (`announcements.service.ts`):

```ts
import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { isP2002, isP2025 } from './internal/prisma-errors';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

@Injectable()
export class AnnouncementsService {
  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        include: { classSection: { select: { name: true } } },
      }),
    );
  }

  async create(schoolId: string, createdByUserId: string, dto: CreateAnnouncementDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
        if (!cs) throw new BadRequestException('classSectionId not found');
      }
      try {
        return await tx.announcement.create({
          data: {
            schoolId,
            title: dto.title,
            body: dto.body,
            classSectionId: dto.classSectionId ?? null,
            createdByUserId,
          },
        });
      } catch (e) {
        if (isP2002(e)) throw new ConflictException('Duplicate announcement');
        throw e;
      }
    });
  }

  async update(schoolId: string, id: string, dto: UpdateAnnouncementDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
        if (!cs) throw new BadRequestException('classSectionId not found');
      }
      try {
        return await tx.announcement.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
            ...(dto.classSectionId !== undefined ? { classSectionId: dto.classSectionId } : {}),
          },
        });
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }

  async remove(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.announcement.delete({ where: { id } });
        return { ok: true };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }
}
```

- [ ] **Step 3: Controller** (`announcements.controller.ts`) — admin-only, tenant-resolved, reads the current user for `createdByUserId`:

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
@Controller('manage/announcements')
export class AnnouncementsController {
  constructor(
    private readonly svc: AnnouncementsService,
    private readonly tenant: TenantContextService,
  ) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get() list() { return this.svc.list(this.sid()); }
  @Post() create(@Body() dto: CreateAnnouncementDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.create(this.sid(), u.sub, dto);
  }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.svc.update(this.sid(), id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(this.sid(), id); }
}
```
(Verify `CurrentUser` decorator + `SchoolJwtPayload.sub` exist — they do, used by prior phases.)

- [ ] **Step 4:** Register `AnnouncementsService`/`AnnouncementsController` in `management.module.ts`. Announcements are NOT `@RequireFeature`-gated (any school can post). Typecheck api → 0.
- [ ] **Step 5:** Commit `feat(api): school-admin announcements CRUD`.

---

### Task 4: API — student portal endpoints (`portal` module)

**Files:**
- Create: `apps/api/src/modules/portal/portal.service.ts`, `portal.controller.ts`, `portal.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts` (register `PortalModule`)

**Interfaces:**
- Consumes: `TenantContextService`, `withTenant`, `RolesGuard`/`@Roles('STUDENT')`, `TimetableService.listForClass` (import from management — `PortalModule` imports `ManagementModule`, which exports `TimetableService`).
- Produces: `GET /me/profile`, `GET /me/timetable`, `GET /me/announcements` (all STUDENT-only, resolve caller's own Student).

- [ ] **Step 1: Service** (`portal.service.ts`) — resolves the caller's own Student:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { TimetableService } from '../management/timetable.service';

@Injectable()
export class PortalService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly timetable: TimetableService,
  ) {}

  private async myStudent(schoolId: string, userId: string) {
    return withTenant(schoolId, (tx) =>
      tx.student.findFirst({
        where: { userId },
        include: { classSection: { select: { id: true, name: true } } },
      }),
    );
  }

  async profile(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    // Resolve photo URL if present (mirror how public-site resolves asset ids).
    let photoUrl: string | null = null;
    if (s.photoAssetId) {
      photoUrl = await withTenant(schoolId, async (tx) => {
        const a = await tx.mediaAsset.findFirst({ where: { id: s.photoAssetId! }, select: { url: true } });
        return a?.url ?? null;
      });
    }
    return {
      firstName: s.firstName,
      lastName: s.lastName,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      className: s.classSection?.name ?? null,
      photoUrl,
    };
  }

  async timetable(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return [];
    return this.timetable.listForClass(schoolId, s.classSectionId);
  }

  async announcements(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: {
          schoolId,
          OR: [{ classSectionId: null }, ...(s.classSectionId ? [{ classSectionId: s.classSectionId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }
}
```

> Note: `myStudent` matches on `userId` inside `withTenant`, so RLS + the `userId` filter guarantee a student can only ever load THEIR OWN row. There is no code path that takes a studentId from the request for `/me/*`.

- [ ] **Step 2: Controller** (`portal.controller.ts`):

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PortalService } from './portal.service';

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT')
@Controller('me')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('profile') profile(@CurrentUser() u: SchoolJwtPayload) { return this.portal.profile(u.sub); }
  @Get('timetable') timetable(@CurrentUser() u: SchoolJwtPayload) { return this.portal.timetable(u.sub); }
  @Get('announcements') announcements(@CurrentUser() u: SchoolJwtPayload) { return this.portal.announcements(u.sub); }
}
```

- [ ] **Step 3: Module** (`portal.module.ts`) — imports `TenancyModule` and `ManagementModule` (to inject `TimetableService`); provides `PortalService`; controllers `PortalController`. Register `PortalModule` in `app.module.ts`. Verify `ManagementModule` exports `TimetableService` (it does per `management.module.ts` exports).

- [ ] **Step 4:** Typecheck api → 0.
- [ ] **Step 5:** Commit `feat(api): student portal endpoints (/me/profile, timetable, announcements)`.

---

### Task 5: API — student portal e2e

**Files:** Create `apps/api/test/student.e2e-spec.ts` (mirror `community.e2e-spec.ts` helpers: `schoolToken`, `getPlatformPrisma`, `disconnectAll`; run against a running API with `DATABASE_URL_TEST` = dev DB, API booted `DISABLE_THROTTLER=true`).

**Setup:** beacon (PRO, has MANAGEMENT) already has a Student (admissionNo `05A-01`, Aarav, in a class). Use `getPlatformPrisma` in `beforeAll` to find that student's id + classSectionId, or create a dedicated throwaway student in beacon. Track and clean up any created User/Announcement/Student in `afterAll`.

- [ ] **Step 1:** Tests:
  1. **Admin creates login** → `POST /manage/students/:id/login` as beacon admin → 201 `{ email, tempPassword }`. Second call → 409.
  2. **Student logs in** → `POST /auth/login` (beacon host) with the returned email + tempPassword → 201 with an accessToken. (Assert the token works.)
  3. **Profile** → `GET /me/profile` with the student token → 200, `firstName` matches, `className` non-null.
  4. **Timetable** → seed one timetable slot for the student's class (via admin `POST /manage/timetable` or `getPlatformPrisma`); `GET /me/timetable` → array includes it.
  5. **Announcement targeting** → admin creates (a) a school-wide announcement (no classSectionId), (b) one for the student's class, (c) one for a DIFFERENT class (create a throwaway class or use another). `GET /me/announcements` → contains (a) and (b), does NOT contain (c).
  6. **Role isolation** → student token on `POST /manage/announcements` → 403; admin token on `GET /me/profile` → 403.
- [ ] **Step 2:** Boot API (`DISABLE_THROTTLER=true`), run `DATABASE_URL_TEST=<dev DB> ... jest ... student.e2e-spec`. Then full suite for no regressions. Note counts.
- [ ] **Step 3:** Commit `test(api): student portal e2e (login provisioning, profile, timetable, announcement targeting, role isolation)`.

---

### Task 6: Web — school-admin "Create login" + announcements page

**Files:**
- Modify: `apps/web/app/app/students/page.tsx` (add "Create login" per student)
- Create: `apps/web/app/app/announcements/page.tsx`
- Modify: `apps/web/app/app/layout.tsx` (nav entry for Announcements)

- [ ] **Step 1:** On the students page, add a per-row "Create login" button → `useMutation` `POST /manage/students/${id}/login`; on success show the returned `{ email, tempPassword }` in a toast/modal that the admin can copy (show once). Disable/hide if the student already has a login (the student row includes `userId` — surface it from the list query; if the list doesn't return `userId`, it does now that the column exists — confirm the select). Mirror the existing mutation/invalidation/toast pattern on that page. Keep `hostHeader` on the `useApi`.
- [ ] **Step 2:** Create `/app/announcements/page.tsx`: list announcements (title, target = class name or "Whole school", date), a create form (title, body, optional class select from `GET /manage/classes` or the sections endpoint), and delete. Mirror `/app/events/page.tsx` structure. Every `useApi` carries `hostHeader`.
- [ ] **Step 3:** Add nav item `{ href: '/app/announcements', label: 'Announcements', icon: <lucide icon e.g. Megaphone> }` to `NAV_ITEMS` in `layout.tsx` (verify the icon name exists in lucide-react).
- [ ] **Step 4:** Typecheck web → 0. Boot + smoke: as beacon admin, create a login for the seeded student (capture email+temp password), post a school-wide and a class announcement.
- [ ] **Step 5:** Commit `feat(web): admin student-login provisioning + announcements page`.

---

### Task 7: Web — student portal + role-based login redirect

**Files:**
- Create: `apps/web/app/portal/layout.tsx`, `page.tsx`, `timetable/page.tsx`, `announcements/page.tsx`, `profile/page.tsx`
- Modify: `apps/web/app/login/page.tsx` (redirect STUDENT → `/portal`, others → `/app`)

- [ ] **Step 1:** In `login/page.tsx`, after a successful login read the role (from the login response or the decoded token / auth store) and `router.replace(role === 'STUDENT' ? '/portal' : '/app')`. Find how the current code obtains the role post-login (it currently hardcodes `/app`); if the login response doesn't include role, decode it from the access token or read `/auth/me`. Keep it minimal.
- [ ] **Step 2:** `portal/layout.tsx` — a student shell (school name/logo header, nav: Home / Timetable / Announcements / Profile, logout). Use the school-audience auth + `useHost()`. Mirror the visual style of `app/layout.tsx` but simpler. Guard: if not logged in as STUDENT, redirect to `/login` (mirror how `/app` protects itself).
- [ ] **Step 3:** `portal/page.tsx` (dashboard) — greet the student (name from `GET /me/profile`), show today's timetable rows (filter `GET /me/timetable` to today's `dayOfWeek`) and the 3 latest announcements. `portal/timetable/page.tsx` — full weekly grid (reuse the day/period layout idea from `app/availability` or a simple day-grouped list). `portal/announcements/page.tsx` — list of `GET /me/announcements` (title, body, target, date). `portal/profile/page.tsx` — read-only card (photo, name, class, roll no, admission no). EVERY `useApi` carries `hostHeader` from `useHost()`, queries `enabled: !!host`.
- [ ] **Step 4:** Typecheck web → 0. Boot + smoke: log in as the student (email + temp password from Task 6) at `beacon.localhost:3000/login` → lands on `/portal`; timetable + announcements + profile render.
- [ ] **Step 5:** Commit `feat(web): student portal (dashboard, timetable, announcements, profile)`.

---

### Task 8: Full Phase 7 verification

**Files:** none (verification only).

- [ ] **Step 1:** Typecheck api + web → 0/0.
- [ ] **Step 2:** Full e2e (boot API `DISABLE_THROTTLER=true`, `DATABASE_URL_TEST` = dev DB): expected all suites green (prior 53 + student suite).
- [ ] **Step 3:** Manual chain (web+api up): admin creates a student login → student logs in → lands on `/portal` → sees their timetable + a school-wide announcement + a class announcement (but NOT another class's) + profile. Admin who is SCHOOL_ADMIN cannot reach `/portal` data (403); student cannot reach `/app` management APIs (403).
- [ ] **Step 4:** No commit. Then run superpowers:finishing-a-development-branch.

---

## Self-Review (author)

- **Spec coverage:** student login provisioning (T2) ✓; announcements w/ per-class targeting (T3) ✓; student timetable via reuse (T4) ✓; profile (T4) ✓; web admin + portal (T6/T7) ✓; e2e incl. targeting + role isolation (T5) ✓.
- **Isolation:** `/me/*` always resolves the caller's own Student by `userId=sub` inside `withTenant`; no client-supplied studentId; no `getPlatformPrisma` in portal/announcements/management. Announcement RLS = `tenant_iso`. Role isolation asserted (T5.6).
- **Type consistency:** `Student.userId` (T1) is the join key used by `PortalService.myStudent` (T4) and set by `createLogin` (T2). `Announcement.classSectionId` nullable (T1) drives targeting in both `create` (T3) and student `announcements` filter (T4).
- **Placeholder scan:** none. The synthetic student email format is specified explicitly in T2.
- **Carry-over (opportunistic, non-blocking):** Phase 6 minors (reject `approvedByUserId`, unpopulated `createdByUserId`, coverAssetId clear) + go-live gating (SETUP→LIVE) remain deferred — fix only if touching those files.
