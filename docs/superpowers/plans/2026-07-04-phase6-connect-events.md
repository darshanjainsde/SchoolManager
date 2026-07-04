# Phase 6 — Connect / Cross-School Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each school publish its own events and submit events to a cross-school "Connect" network that the platform owner moderates; approved network events appear on every school's public site alongside the host school's own events.

**Architecture:** The `Event` model and its RLS policies already exist (`tenant_iso` for own-tenant read/write + `read_network_events` `FOR SELECT USING (scope='NETWORK' AND status='APPROVED')`). Postgres OR-combines permissive policies, so a single `withTenant(hostSchoolId)` query returns the host's own events plus every approved network event — no `getPlatformPrisma` in the tenant/public path. Because `MediaAsset` and `School` are tenant-isolated, a network event from another school cannot resolve its cover image or origin name under the host tenant; we therefore **denormalize** `coverUrl` and `originSchoolName` onto the event at creation (snapshotted from the creating school, which can read its own data). Owner moderation lives in the existing platform-audience `owner` module (uses `getPlatformPrisma`, which is allowed there).

**Tech Stack:** NestJS 10 (api), Next.js 14 App Router (web), Prisma 5 (`@skoolos/db`), Postgres RLS, BullMQ (unused here), Tailwind.

## Global Constraints

- **schoolId provenance:** tenant `schoolId` comes ONLY from `TenantContextService.requireTenant().schoolId` (admin) or `.get()` (public). NEVER from client input.
- **Tenant DB access:** every tenant read/write goes through `withTenant(schoolId, fn)`. `getPlatformPrisma()` (BYPASSRLS) is allowed ONLY in the `owner`/`platform`/`features`/`auth`/`tenancy` paths — NEVER in `cms`/`management`/`public` modules.
- **Feature gating:** the school-side events endpoints and the public Connect section are gated by the `EVENTS` feature (`@RequireFeature('EVENTS')` + `RequireFeatureGuard`; `EVENTS` ∈ STANDARD, PRO — NOT BASIC). The public site must return NO events for a school lacking `EVENTS`.
- **Error mapping template:** create → catch P2002→`ConflictException` (409). update (single tx) → P2025→`NotFoundException` (404), P2002→409. delete → P2025→404, P2003→`ConflictException` (409). Use `isP2002/isP2025/isP2003` from `apps/api/src/modules/management/internal/prisma-errors.ts`.
- **Web tenant host:** every `/app` page's `useApi` MUST pass `hostHeader` from `useHost()` (`@/components/use-host`). Public browser fetches send `X-Forwarded-Host: window.location.host`.
- **Status workflow:** SCHOOL event created by school admin → `status='APPROVED'` immediately (self-published, host-only). NETWORK event submitted by school admin → `status='PENDING'` (awaits owner). Owner approve → `APPROVED` (+ `approvedByUserId`, `approvedAt`); reject → `REJECTED`. Owner-created network event → `NETWORK` + `APPROVED` immediately.
- **Public visibility rule:** the public site shows events where `status='APPROVED'` AND (`scope='SCHOOL'` [host-only via RLS] OR `scope='NETWORK'`), ordered by `startAt asc`, excluding events whose `endAt` (or `startAt` when `endAt` null) is in the past.

---

## File Structure

- `packages/db/prisma/schema.prisma` — add `coverUrl String?`, `originSchoolName String?` to `Event`.
- `packages/db/prisma/migrations/<ts>_event_denormalized_display/migration.sql` — the two columns.
- `apps/api/src/modules/community/` (NEW module):
  - `events.service.ts` — school-side own-event CRUD (tenant).
  - `events.controller.ts` — `/manage/events` (SchoolJwtGuard + `@RequireFeature('EVENTS')`).
  - `public-events.service.ts` — reads approved host + network events for the public site.
  - `community.dto.ts` — Create/Update DTOs + `PublicEvent` shape.
  - `community.module.ts`, `index.ts`.
- `apps/api/src/modules/public/public.dto.ts` — add `events: PublicEvent[]` to `PublicSiteData`.
- `apps/api/src/modules/public/public-site.service.ts` — call `PublicEventsService`, gate on `EVENTS`.
- `apps/api/src/modules/owner/internal/owner-events.service.ts` (NEW) + additions to `owner.controller.ts` / `owner.dto.ts` — moderation + owner network create.
- `apps/api/test/community.e2e-spec.ts` (NEW) — school create, network moderation, cross-school visibility, gating, isolation.
- `apps/web/lib/public-api.ts` — add `events` to `PublicSiteData`.
- `apps/web/components/public/PublicSite.tsx` — Connect/Events section (ported from `mockups/public-site.html` #events).
- `apps/web/app/app/events/page.tsx` (NEW) + nav entry — school-admin events management.
- `apps/web/app/platform/connect/page.tsx` (NEW) + owner nav entry — owner moderation queue.

---

### Task 1: Schema — denormalized display fields on Event

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Event model)
- Create: `packages/db/prisma/migrations/<timestamp>_event_denormalized_display/migration.sql`

**Interfaces:**
- Produces: `Event.coverUrl: string | null`, `Event.originSchoolName: string | null` in the generated Prisma client.

- [ ] **Step 1:** In `schema.prisma`, add to `model Event` (after `venue`):

```prisma
  coverUrl         String?
  originSchoolName String?
```

- [ ] **Step 2:** Create the migration SQL (RLS policies already exist — do NOT touch them):

```sql
ALTER TABLE "Event" ADD COLUMN "coverUrl" TEXT;
ALTER TABLE "Event" ADD COLUMN "originSchoolName" TEXT;
```

- [ ] **Step 3:** Apply + regenerate. Run: `pnpm --filter @skoolos/db exec prisma migrate deploy && pnpm --filter @skoolos/db exec prisma generate`
Expected: migration applied, client regenerated, no drift.

- [ ] **Step 4:** Typecheck db package. Run: `pnpm --filter @skoolos/db typecheck` (or `exec tsc --noEmit`). Expected: 0 errors.

- [ ] **Step 5:** Commit `feat(db): denormalized coverUrl + originSchoolName on Event`.

---

### Task 2: API — school-side event CRUD (`community` module)

**Files:**
- Create: `apps/api/src/modules/community/events.service.ts`, `events.controller.ts`, `community.dto.ts`, `community.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts` (register `CommunityModule`)

**Interfaces:**
- Consumes: `TenantContextService.requireTenant()`, `withTenant`, `RequireFeature`/`RequireFeatureGuard`, `SchoolJwtGuard`, prisma-error helpers.
- Produces: `EventsService.{list,create,update,remove}`; routes `GET/POST/PATCH/DELETE /manage/events`.

- [ ] **Step 1: DTOs** (`community.dto.ts`):

```ts
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateEventDto {
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
  @IsIn(['SCHOOL', 'NETWORK']) scope!: 'SCHOOL' | 'NETWORK';
}

export class UpdateEventDto {
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsUUID() coverAssetId?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
}

export interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startAt: string;
  endAt: string | null;
  venue: string | null;
  scope: 'SCHOOL' | 'NETWORK';
  originSchoolName: string | null; // null when it's the host school's own event
  isHost: boolean;                 // true when this event belongs to the viewing school
}
```

- [ ] **Step 2: Service** (`events.service.ts`) — snapshot `coverUrl` + `originSchoolName` at create; scope drives initial status:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { isP2002, isP2025, isP2003 } from '../management/internal/prisma-errors';
import { CreateEventDto, UpdateEventDto } from './community.dto';

@Injectable()
export class EventsService {
  constructor(private readonly tenant: TenantContextService) {}

  async list() {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.event.findMany({ where: { schoolId }, orderBy: { startAt: 'desc' } }),
    );
  }

  async create(dto: CreateEventDto) {
    const { schoolId } = this.tenant.requireTenant();
    if (dto.endAt && new Date(dto.endAt) < new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }
    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { name: true },
      });
      let coverUrl: string | null = null;
      if (dto.coverAssetId) {
        const asset = await tx.mediaAsset.findFirst({
          where: { schoolId, id: dto.coverAssetId },
          select: { url: true },
        });
        if (!asset) throw new BadRequestException('coverAssetId not found');
        coverUrl = asset.url;
      }
      const status = dto.scope === 'NETWORK' ? 'PENDING' : 'APPROVED';
      try {
        return await tx.event.create({
          data: {
            schoolId,
            title: dto.title,
            description: dto.description ?? null,
            coverAssetId: dto.coverAssetId ?? null,
            coverUrl,
            startAt: new Date(dto.startAt),
            endAt: dto.endAt ? new Date(dto.endAt) : null,
            venue: dto.venue ?? null,
            scope: dto.scope,
            status,
            originSchoolName: school.name,
          },
        });
      } catch (e) {
        if (isP2002(e)) throw new NotFoundException('Duplicate event');
        throw e;
      }
    });
  }

  async update(id: string, dto: UpdateEventDto) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      let coverUrl: string | undefined;
      if (dto.coverAssetId) {
        const asset = await tx.mediaAsset.findFirst({
          where: { schoolId, id: dto.coverAssetId },
          select: { url: true },
        });
        if (!asset) throw new BadRequestException('coverAssetId not found');
        coverUrl = asset.url;
      }
      try {
        return await tx.event.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.coverAssetId !== undefined ? { coverAssetId: dto.coverAssetId, coverUrl } : {}),
            ...(dto.startAt !== undefined ? { startAt: new Date(dto.startAt) } : {}),
            ...(dto.endAt !== undefined ? { endAt: dto.endAt ? new Date(dto.endAt) : null } : {}),
            ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
          },
        });
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Event not found');
        throw e;
      }
    });
  }

  async remove(id: string) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.event.delete({ where: { id } });
        return { ok: true };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Event not found');
        if (isP2003(e)) throw new NotFoundException('Event in use');
        throw e;
      }
    });
  }
}
```

> Note: `event.update({ where: { id } })` under RLS only mutates rows the host owns (the `id` PK plus `tenant_iso` WITH CHECK); another school's id yields P2025→404. Verify this in the e2e (Task 5 isolation test).

- [ ] **Step 3: Controller** (`events.controller.ts`):

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './community.dto';

@UseGuards(SchoolJwtGuard, RequireFeatureGuard)
@RequireFeature('EVENTS')
@Controller('manage/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get() list() { return this.events.list(); }
  @Post() create(@Body() dto: CreateEventDto) { return this.events.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.events.remove(id); }
}
```

> Confirm the exact `RequireFeature`/`RequireFeatureGuard` import path against an existing management controller (`apps/api/src/modules/management/*.controller.ts`) and mirror it.

- [ ] **Step 4: Module** (`community.module.ts`) + `index.ts`, then register in `app.module.ts`. Mirror `management.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class CommunityModule {}
```

- [ ] **Step 5:** Typecheck api. Run: `pnpm --filter @skoolos/api typecheck`. Expected: 0 errors.
- [ ] **Step 6:** Commit `feat(api): school-side event CRUD (EVENTS-gated, /manage/events)`.

---

### Task 3: API — owner moderation + owner network create

**Files:**
- Create: `apps/api/src/modules/owner/internal/owner-events.service.ts`
- Modify: `apps/api/src/modules/owner/internal/owner.controller.ts`, `owner.dto.ts`, `owner.module.ts`

**Interfaces:**
- Consumes: `getPlatformPrisma` (allowed in owner module), the platform JWT guard + owner-host guard already used by `owner.controller.ts`.
- Produces: `GET /owner/events?status=PENDING`, `PATCH /owner/events/:id` `{ action:'APPROVE'|'REJECT' }`, `POST /owner/events` `{ schoolId, title, ... }`.

- [ ] **Step 1: DTOs** (append to `owner.dto.ts`):

```ts
export class ModerateEventDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
}

export class OwnerCreateEventDto {
  @IsUUID() schoolId!: string;
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
}
```
(Add any missing imports — `IsIn, IsUUID, IsString, IsOptional, IsDateString, Length` — from `class-validator`.)

- [ ] **Step 2: Service** (`owner-events.service.ts`) — platform reads/writes across all schools:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { ModerateEventDto, OwnerCreateEventDto } from './owner.dto';

@Injectable()
export class OwnerEventsService {
  async listNetwork(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const db = getPlatformPrisma();
    return db.event.findMany({
      where: { scope: 'NETWORK', ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { school: { select: { name: true, slug: true } } },
    });
  }

  async moderate(id: string, dto: ModerateEventDto, ownerUserId: string) {
    const db = getPlatformPrisma();
    const ev = await db.event.findFirst({ where: { id, scope: 'NETWORK' } });
    if (!ev) throw new NotFoundException('Network event not found');
    const status = dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    return db.event.update({
      where: { id },
      data: {
        status,
        approvedByUserId: ownerUserId,
        approvedAt: dto.action === 'APPROVE' ? new Date() : null,
      },
    });
  }

  async createNetwork(dto: OwnerCreateEventDto, ownerUserId: string) {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({
      where: { id: dto.schoolId },
      select: { name: true },
    });
    if (!school) throw new NotFoundException('School not found');
    return db.event.create({
      data: {
        schoolId: dto.schoolId,
        title: dto.title,
        description: dto.description ?? null,
        startAt: new Date(dto.startAt),
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        venue: dto.venue ?? null,
        scope: 'NETWORK',
        status: 'APPROVED',
        originSchoolName: school.name,
        approvedByUserId: ownerUserId,
        approvedAt: new Date(),
      },
    });
  }
}
```

- [ ] **Step 3: Controller** — add routes to `owner.controller.ts` (reuse its existing class guards; read the owner user id the same way the file already reads the current platform user — mirror the existing pattern, e.g. `@CurrentUser()`):

```ts
  @Get('events')
  listEvents(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.ownerEvents.listNetwork(status);
  }

  @Patch('events/:id')
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateEventDto,
    @CurrentUser() user: PlatformJwtPayload,
  ) {
    return this.ownerEvents.moderate(id, dto, user.sub);
  }

  @Post('events')
  createEvent(@Body() dto: OwnerCreateEventDto, @CurrentUser() user: PlatformJwtPayload) {
    return this.ownerEvents.createNetwork(dto, user.sub);
  }
```
(Add `OwnerEventsService` to the constructor + provider list in `owner.module.ts`; add missing imports: `Query, Patch, Post, Param, ParseUUIDPipe, Body`, the DTOs, and the current-user decorator/type already used in the file.)

- [ ] **Step 4:** Typecheck api. Run: `pnpm --filter @skoolos/api typecheck`. Expected: 0 errors.
- [ ] **Step 5:** Commit `feat(api): owner network-event moderation + create`.

---

### Task 4: API — include events on the public site (EVENTS-gated)

**Files:**
- Create: `apps/api/src/modules/community/public-events.service.ts`
- Modify: `community.module.ts` (provide+export `PublicEventsService`), `apps/api/src/modules/public/public.module.ts` (import `CommunityModule`), `public.dto.ts` (`events: PublicEvent[]`), `public-site.service.ts` (call it, gate on `EVENTS`).

**Interfaces:**
- Consumes: `withTenant` (already inside `getSite`'s transaction — pass `tx`), `PublicEvent`.
- Produces: `PublicEventsService.forHost(tx, hostSchoolId): Promise<PublicEvent[]>`.

- [ ] **Step 1: Service** (`public-events.service.ts`) — pure mapping over the shared `tx`, no new connection:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@skoolos/db';
import type { PublicEvent } from './community.dto';

@Injectable()
export class PublicEventsService {
  // Runs inside the caller's withTenant(hostSchoolId) transaction. RLS returns
  // the host's own rows (tenant_iso) OR any NETWORK+APPROVED row (read_network_events).
  async forHost(tx: Prisma.TransactionClient, hostSchoolId: string): Promise<PublicEvent[]> {
    const now = new Date();
    const rows = await tx.event.findMany({
      where: {
        status: 'APPROVED',
        OR: [{ scope: 'SCHOOL' }, { scope: 'NETWORK' }],
        OR2: undefined as never, // placeholder removed below
      } as never,
      orderBy: { startAt: 'asc' },
    });
    return rows
      .filter((e) => (e.endAt ?? e.startAt) >= now)
      .map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        coverUrl: e.coverUrl,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
        venue: e.venue,
        scope: e.scope as 'SCHOOL' | 'NETWORK',
        originSchoolName: e.scope === 'NETWORK' ? e.originSchoolName : null,
        isHost: e.schoolId === hostSchoolId,
      }));
  }
}
```

> Implementer: write the `where` cleanly — `{ status: 'APPROVED', OR: [{ scope: 'SCHOOL' }, { scope: 'NETWORK' }] }`. The placeholder above just flags that both scopes are wanted; do NOT ship the `OR2`/`as never` hack. Prefer a DB-side upcoming filter (`OR: [{ endAt: { gte: now } }, { endAt: null, startAt: { gte: now } }]`) instead of the in-memory `.filter` if it reads cleanly; either is acceptable as long as past events are excluded.

- [ ] **Step 2:** `public.dto.ts` — add `events: PublicEvent[]` to `PublicSiteData` (import `PublicEvent` from `../community/community.dto`).

- [ ] **Step 3:** `public-site.service.ts` — inject `PublicEventsService`, and inside the `withTenant` block add:

```ts
const events = has('EVENTS') ? await this.publicEvents.forHost(tx, schoolId) : [];
```
Include `events` in the returned object. Wire `CommunityModule` into `public.module.ts` imports and add `PublicEventsService` to the constructor.

- [ ] **Step 4:** Typecheck api. Run: `pnpm --filter @skoolos/api typecheck`. Expected: 0 errors.
- [ ] **Step 5:** Commit `feat(api): public site includes approved host + network events`.

---

### Task 5: API — community e2e (moderation + cross-school visibility + isolation + gating)

**Files:**
- Create: `apps/api/test/community.e2e-spec.ts` (mirror `public.e2e-spec.ts` / `owner.e2e-spec.ts` helpers: `schoolToken(host,email,pw)`, `ownerToken()`, `getPlatformPrisma`, cleanup in `afterAll`).

**Interfaces:** Consumes running API on `localhost:3001` (same DB as the test's Prisma — run with `DATABASE_URL_TEST` = the dev DB, per the header note in `owner.e2e-spec.ts`).

- [ ] **Step 1:** Write these tests (assert the round-trip, not internals):
  1. **School publishes own SCHOOL event** → `POST /manage/events {scope:'SCHOOL'}` as beacon admin → 201, status APPROVED. `GET /public/site` for `beacon.localhost` → `events[]` contains it with `isHost:true`, `originSchoolName:null`.
  2. **Network submission is hidden until approved** → beacon admin `POST {scope:'NETWORK'}` → 201 status PENDING. `GET /public/site` for `acme.localhost` → `events[]` does NOT contain it.
  3. **Owner approves → visible network-wide** → `PATCH /owner/events/:id {action:'APPROVE'}` → 200. `GET /public/site` for `acme.localhost` → now contains it with `isHost:false`, `scope:'NETWORK'`, `originSchoolName:'Beacon Public School'`.
  4. **EVENTS gating** → toggle a school to BASIC (or use a BASIC school if seeded); its `GET /public/site` → `events:[]`; its `POST /manage/events` → 403.
  5. **Isolation** → acme admin `PATCH /manage/events/:beaconEventId` → 404 (RLS: not acme's row); `DELETE` likewise 404.
  6. **Owner create network event** → `POST /owner/events {schoolId:beacon,...}` → 201 APPROVED, appears on acme's public site.

- [ ] **Step 2:** Run: boot API (`DATABASE_URL_TEST` = dev DB), then `pnpm --filter @skoolos/api exec jest --config test/jest-e2e.config.js --runInBand community.e2e-spec`. Expected: all pass. Then run the FULL suite to confirm no regressions (target: prior 38 + new).
- [ ] **Step 3:** Commit `test(api): connect events e2e (moderation, cross-school visibility, gating, isolation)`.

---

### Task 6: Web — public Connect/Events section

**Files:**
- Modify: `apps/web/lib/public-api.ts` (add `events` to `PublicSiteData`), `apps/web/components/public/PublicSite.tsx`.

**Interfaces:** Consumes `data.events` (shape mirrors `PublicEvent`). Section renders only when `data.events.length > 0`.

- [ ] **Step 1:** `public-api.ts` — add to `PublicSiteData`:

```ts
  events: {
    id: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    startAt: string;
    endAt: string | null;
    venue: string | null;
    scope: 'SCHOOL' | 'NETWORK';
    originSchoolName: string | null;
    isHost: boolean;
  }[];
```

- [ ] **Step 2:** In `PublicSite.tsx`, add an `#events` section (place it after Academics or after Gallery — match mockup order). Port the tilt-card layout from `mockups/public-site.html` lines ~251-270. Badge logic: `isHost` → "Our School" (brand pill); else → `Network · ${originSchoolName ?? 'Network'}` (iris pill). Show cover via `coverUrl` (background-image) when present, else a gradient placeholder. Format `startAt` with `new Date(e.startAt).toLocaleString()` (date + time). Add a "Connect · Events" nav link gated on `data.events.length > 0`. Use the existing `.reveal` / glass / tilt classes already in the component's CSS (add a `.tilt` rule if not present, mirroring the mockup).

- [ ] **Step 3:** Typecheck web (`pnpm --filter @skoolos/web exec tsc --noEmit`) → 0. Boot web+api; verify `curl -s localhost:3000 -H 'Host: beacon.localhost' | grep -o 'id="events"'` after seeding at least one event (create via `/manage/events`). Confirm a network event created by beacon shows on `acme.localhost` once approved.
- [ ] **Step 4:** Commit `feat(web): public site Connect/Events section`.

---

### Task 7: Web — school-admin events management page

**Files:**
- Create: `apps/web/app/app/events/page.tsx`
- Modify: the `/app` nav/layout to add an "Events" link (mirror how `availability`/`teachers` links were added).

**Interfaces:** Uses `useApi({ audience:'school', hostHeader: useHost() })` — MUST pass `hostHeader`. Endpoints `/manage/events` (GET/POST/PATCH/DELETE).

- [ ] **Step 1:** Build a page that lists the school's events (title, date, scope badge, status badge), a "New event" form (title, description, startAt, endAt, venue, scope select SCHOOL|NETWORK), and delete. Mirror the structure/query-invalidation patterns of an existing `/app` page (e.g. `teachers/page.tsx`). On create with `scope:'NETWORK'`, surface that it goes to the owner for approval (status will show PENDING). Handle empty state.
- [ ] **Step 2:** Typecheck web → 0. Boot; log in as `admin@beacon.test`, create a SCHOOL event and a NETWORK event; confirm they list with correct status; confirm the SCHOOL event appears on the public site.
- [ ] **Step 3:** Commit `feat(web): school-admin events management page`.

---

### Task 8: Web — owner Connect moderation page

**Files:**
- Create: `apps/web/app/platform/connect/page.tsx`
- Modify: owner portal nav to add a "Connect" link (mirror existing platform nav entries).

**Interfaces:** Uses the platform-audience `useApi` pattern already used by other `/platform` pages (owner JWT; host `owner.localhost`). Endpoints `/owner/events?status=PENDING` (GET), `/owner/events/:id` (PATCH approve/reject), `/owner/events` (POST create network event with a school picker).

- [ ] **Step 1:** Build a moderation queue: list PENDING network events (title, school name, date), Approve / Reject buttons (PATCH), and a "Create network event" form with a school dropdown (fetch schools from the existing owner schools list endpoint). On approve/reject, invalidate the query. Show a tab/filter for APPROVED history (optional, only if it mirrors existing patterns cheaply — else omit; YAGNI).
- [ ] **Step 2:** Typecheck web → 0. Boot; log in as owner; approve the beacon network event from Task 7; confirm it now renders on `acme.localhost`'s public site.
- [ ] **Step 3:** Commit `feat(web): owner Connect moderation page`.

---

### Task 9: Full Phase 6 verification

**Files:** none (verification only).

- [ ] **Step 1:** Typecheck api + web → 0/0.
- [ ] **Step 2:** Full e2e (boot API with `DATABASE_URL_TEST` = dev DB): `pnpm --filter @skoolos/api exec jest --config test/jest-e2e.config.js --runInBand`. Expected: all suites green (38 prior + community suite).
- [ ] **Step 3:** End-to-end manual chain (web+api up): beacon admin creates SCHOOL event → shows on beacon public site only; beacon admin submits NETWORK event → PENDING, not visible anywhere public; owner approves → visible on beacon AND acme public sites with "Network · Beacon Public School" badge; owner creates a network event for beacon → auto-visible on acme; BASIC-gated school shows no events section and 403s on `/manage/events`.
- [ ] **Step 4:** No commit (verification). Then run superpowers:finishing-a-development-branch.

---

## Self-Review Notes (author)

- **Spec coverage:** Event model reuse ✓ (Task 1 only denormalizes display fields); scope=SCHOOL host-only ✓ (RLS + status filter, Task 4/5); scope=NETWORK+APPROVED network-wide ✓ (RLS read policy, Task 4/5); owner moderation ✓ (Task 3/8); owner direct-create auto-approved ✓ (Task 3). Public "Connect" section ✓ (Task 6).
- **Isolation:** no `getPlatformPrisma` in `community`/`public`; owner uses it legitimately. Cross-tenant display data (cover, origin name) is denormalized at write time so the public read needs no cross-tenant reads. Isolation asserted in Task 5.5.
- **Carry-over (fold in opportunistically, not blocking):** go-live gating (SETUP→LIVE owner action + LIVE-only public gate — see progress ledger); P4/P5 deferred minors (uniform `ApiError.status` web handling, timetable assign P2003 catch, teachers `include:{school:false}` dead code, years no PUT/DELETE, gradeInterest max length). If touching the relevant files, fix; otherwise leave for a cleanup pass.
- **Placeholder scan:** the `OR2/as never` block in Task 4 Step 1 is intentionally flagged with instructions to replace — implementer must ship the clean `where`.
