# Phase 3 — School Admin CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a school admin log in and fully edit their own public-website content — branding, homepage, about, contact, social links, gallery images, and featured staff — all tenant-isolated.

**Architecture:** New NestJS `cms` module with tenant-scoped controllers (`SchoolJwtGuard` + `withTenant()` so Postgres RLS enforces `schoolId`), backed by the existing `StorageService` (MinIO) for media. Rebuilt Next.js school-admin pages under `apps/web/app/app/*` consuming those endpoints. Owner-override editing is explicitly deferred to a Phase 3b.

**Tech Stack:** NestJS 10, Prisma 5 (`withTenant` RLS), MinIO/S3 (`@aws-sdk`), multer (multipart), Next.js 14 App Router, React Query, Tailwind.

## Global Constraints

- School-user auth already exists (Phase 1 `AuthModule`, `POST /auth/login` resolved by school host e.g. `acme.localhost`). Access token is **school-audience**; protect CMS routes with the existing `SchoolJwtGuard` (`apps/api/src/common/auth/school-jwt.guard.ts`).
- ALL tenant data reads/writes go through `withTenant(schoolId, fn)` from `@skoolos/db` (RLS enforces isolation). NEVER use `getPlatformPrisma()` in a CMS (tenant) route.
- The current tenant's `schoolId` comes from `TenantContextService.requireTenant().schoolId` (`apps/api/src/modules/tenancy`) — the middleware sets it from the host and `SchoolJwtGuard` validates the token matches.
- Media is stored under per-school prefixes `schools/{schoolId}/{kind}` via `StorageService.upload(...)`; delete via `StorageService.delete(key)`. Every media row is a `MediaAsset` (never inline URLs elsewhere — reference `MediaAsset.id`).
- `MediaKind` values (exact): `LOGO`, `FAVICON`, `HERO`, `GALLERY`, `STAFF`, `PRINCIPAL`. `SocialPlatform` (exact): `FACEBOOK`, `INSTAGRAM`, `YOUTUBE`, `X`, `LINKEDIN`.
- Content entities already exist in the schema (Phase 1): `SchoolProfile` (1:1), `HomepageContent` (1:1), `StatItem`, `SocialLink`, `MediaAsset`, `FeaturedStaff`. Do NOT change the schema in this phase.
- Design reference: `mockups/school-admin.html` (the "Website" tab: Homepage, Gallery, About, Contact) and `mockups/public-site.html` (what the fields feed). Reuse `apps/web/components/ui/*`.
- Spec: `docs/superpowers/specs/2026-07-03-skoolos-school-website-platform-design.md` §5.2.

---

## File structure (Phase 3)

**API — new module `apps/api/src/modules/cms/`:**
- `index.ts` (`CmsModule`)
- `internal/cms.module.ts`
- `internal/cms.dto.ts` (all request DTOs, class-validator)
- `internal/site-content.service.ts` — profile/homepage/stats/social read+write (withTenant)
- `internal/site-content.controller.ts` — `GET /site/content`, `PUT /site/profile`, `PUT /site/homepage`, `PUT /site/stats`, `PUT /site/social`
- `internal/media.service.ts` — upload (StorageService) + MediaAsset CRUD
- `internal/media.controller.ts` — `POST /site/media`, `GET /site/media`, `DELETE /site/media/:id`
- `internal/staff.service.ts` + `internal/staff.controller.ts` — `GET/POST/PUT/DELETE /site/staff`
- `internal/*.spec.ts`; `apps/api/test/cms.e2e-spec.ts`

**API — modify:** `apps/api/src/app.module.ts` (register `CmsModule`).

**Web — rebuild under `apps/web/app/app/`:**
- `layout.tsx` (school-admin shell: sidebar nav → Website, and later-phase items greyed/omitted)
- `page.tsx` (admin dashboard — simple welcome + quick links)
- `website/page.tsx` (the content editor with tabs: Branding, Homepage, About, Contact, Gallery, Staff)
- Delete old-model pages: `classes`, `enrollments`, `grades`, `people`, `subjects`, `settings` under `apps/web/app/app/` (those return in Phase 4 management).

---

### Task 1: Site-content read + update service (profile/homepage/stats/social)

**Files:**
- Create: `apps/api/src/modules/cms/internal/site-content.service.ts`, `cms.dto.ts`, `cms.module.ts`, `apps/api/src/modules/cms/index.ts`, `site-content.controller.ts`
- Create test: `apps/api/src/modules/cms/internal/site-content.service.spec.ts` (pure DTO→data mapping if any) and rely on `cms.e2e-spec.ts` (Task 5) for integration.
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `withTenant`, `getTenantPrisma` from `@skoolos/db`; `TenantContextService` (`.requireTenant().schoolId`); `SchoolJwtGuard`.
- Produces:
  - `SiteContentService.getContent(schoolId): Promise<{ profile, homepage, stats, socialLinks }>`
  - `updateProfile(schoolId, dto)`, `updateHomepage(schoolId, dto)`, `setStats(schoolId, items[])`, `setSocial(schoolId, links[])` — all return the updated aggregate via `getContent`.

- [ ] **Step 1: DTOs in `cms.dto.ts`**

```ts
import { IsArray, IsHexColor, IsIn, IsOptional, IsString, IsUrl, Length, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional() @IsHexColor() brandColorPrimary?: string;
  @IsOptional() @IsHexColor() brandColorSecondary?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 200) email?: string;
  @IsOptional() @IsString() @Length(0, 200) addressLine1?: string;
  @IsOptional() @IsString() @Length(0, 200) addressLine2?: string;
  @IsOptional() @IsString() @Length(0, 100) city?: string;
  @IsOptional() @IsString() @Length(0, 100) region?: string;
  @IsOptional() @IsString() @Length(0, 20) postalCode?: string;
  @IsOptional() @IsString() @Length(0, 100) country?: string;
  @IsOptional() @IsString() @Length(0, 500) mapEmbedUrl?: string;
  @IsOptional() @IsString() logoAssetId?: string;
  @IsOptional() @IsString() faviconAssetId?: string;
}

export class UpdateHomepageDto {
  @IsOptional() @IsString() @Length(0, 200) headline?: string;
  @IsOptional() @IsString() @Length(0, 400) subheadline?: string;
  @IsOptional() @IsString() @Length(0, 4000) aboutText?: string;
  @IsOptional() @IsString() @Length(0, 120) principalName?: string;
  @IsOptional() @IsString() @Length(0, 2000) principalMessage?: string;
  @IsOptional() @IsString() heroAssetId?: string;
  @IsOptional() @IsString() principalPhotoAssetId?: string;
}

export class StatItemDto {
  @IsString() @Length(1, 60) label!: string;
  @IsString() @Length(1, 60) value!: string;
  @IsInt() @Min(0) order!: number;
}
export class SetStatsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => StatItemDto) items!: StatItemDto[];
}

export class SocialLinkDto {
  @IsIn(['FACEBOOK','INSTAGRAM','YOUTUBE','X','LINKEDIN']) platform!: string;
  @IsUrl() url!: string;
  @IsInt() @Min(0) order!: number;
}
export class SetSocialDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SocialLinkDto) links!: SocialLinkDto[];
}
```

- [ ] **Step 2: Implement `site-content.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { UpdateProfileDto, UpdateHomepageDto, StatItemDto, SocialLinkDto } from './cms.dto';

@Injectable()
export class SiteContentService {
  async getContent(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [profile, homepage, stats, socialLinks] = await Promise.all([
        tx.schoolProfile.findUnique({ where: { schoolId } }),
        tx.homepageContent.findUnique({ where: { schoolId } }),
        tx.statItem.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.socialLink.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
      ]);
      return { profile, homepage, stats, socialLinks };
    });
  }

  async updateProfile(schoolId: string, dto: UpdateProfileDto) {
    await withTenant(schoolId, (tx) =>
      tx.schoolProfile.update({ where: { schoolId }, data: dto }));
    return this.getContent(schoolId);
  }

  async updateHomepage(schoolId: string, dto: UpdateHomepageDto) {
    await withTenant(schoolId, (tx) =>
      tx.homepageContent.update({ where: { schoolId }, data: dto }));
    return this.getContent(schoolId);
  }

  async setStats(schoolId: string, items: StatItemDto[]) {
    await withTenant(schoolId, async (tx) => {
      await tx.statItem.deleteMany({ where: { schoolId } });
      if (items.length) await tx.statItem.createMany({ data: items.map((i) => ({ ...i, schoolId })) });
    });
    return this.getContent(schoolId);
  }

  async setSocial(schoolId: string, links: SocialLinkDto[]) {
    await withTenant(schoolId, async (tx) => {
      await tx.socialLink.deleteMany({ where: { schoolId } });
      if (links.length) await tx.socialLink.createMany({ data: links.map((l) => ({ platform: l.platform as any, url: l.url, order: l.order, schoolId })) });
    });
    return this.getContent(schoolId);
  }
}
```
Note: `SchoolProfile`/`HomepageContent` rows are created at school-provisioning (Phase 2 create-school seeds them; Phase 1 seed too). If a school could lack them, use `upsert` instead of `update` — verify against the seed/create-school (they DO create both), so `update` is safe; if the e2e reveals a missing row, switch to `upsert`.

- [ ] **Step 3: Controller `site-content.controller.ts`**

```ts
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { SiteContentService } from './site-content.service';
import { UpdateProfileDto, UpdateHomepageDto, SetStatsDto, SetSocialDto } from './cms.dto';

@Controller('site')
@UseGuards(SchoolJwtGuard)
export class SiteContentController {
  constructor(private readonly content: SiteContentService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get('content') get() { return this.content.getContent(this.sid()); }
  @Put('profile') profile(@Body() dto: UpdateProfileDto) { return this.content.updateProfile(this.sid(), dto); }
  @Put('homepage') homepage(@Body() dto: UpdateHomepageDto) { return this.content.updateHomepage(this.sid(), dto); }
  @Put('stats') stats(@Body() dto: SetStatsDto) { return this.content.setStats(this.sid(), dto.items); }
  @Put('social') social(@Body() dto: SetSocialDto) { return this.content.setSocial(this.sid(), dto.links); }
}
```
Confirm `SchoolJwtGuard` sets/permits the tenant context (Phase 1 binds token.schoolId to the host tenant). `cms.module.ts` provides both services + controllers and imports `TenancyModule` (global, so `TenantContextService` injectable). Register `CmsModule` in `app.module.ts`.

- [ ] **Step 4: Typecheck + boot + curl**

```bash
pnpm --filter @skoolos/api typecheck
# boot API (roles env), login as acme admin to get a school token:
curl -s -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-Host: acme.localhost' -d '{"email":"admin@acme.test","password":"Passw0rd!"}'   # → accessToken
# then:
curl -s http://localhost:3001/site/content -H 'X-Forwarded-Host: acme.localhost' -H "Authorization: Bearer $TOKEN"   # → { profile, homepage, stats, socialLinks }
curl -s -X PUT http://localhost:3001/site/homepage -H 'Content-Type: application/json' -H 'X-Forwarded-Host: acme.localhost' -H "Authorization: Bearer $TOKEN" -d '{"headline":"New headline"}'
```
Expected: GET returns the aggregate; PUT returns it with the updated headline. Verify a request WITHOUT a token → 401, and a token for acme used with `X-Forwarded-Host: beacon.localhost` → rejected (isolation).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/cms apps/api/src/app.module.ts
git commit -m "feat(api): tenant-scoped site content (profile/homepage/stats/social)"
```

---

### Task 2: Media upload + gallery (MediaAsset via MinIO)

**Files:**
- Create: `apps/api/src/modules/cms/internal/media.service.ts`, `media.controller.ts`
- Modify: `cms.module.ts` (add `StorageModule` import + register), `cms.dto.ts` (media DTOs)

**Interfaces:**
- Consumes: `StorageService` (`apps/api/src/common/storage`), `withTenant`.
- Produces: `MediaService.upload(schoolId, kind, file): Promise<MediaAsset>`; `list(schoolId, kind?)`; `remove(schoolId, id)`.

- [ ] **Step 1: DTO + service**

`cms.dto.ts` add:
```ts
export class ListMediaDto { @IsOptional() @IsIn(['LOGO','FAVICON','HERO','GALLERY','STAFF','PRINCIPAL']) kind?: string; }
```
`media.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { StorageService } from '../../../common/storage/storage.service';

const KINDS = ['LOGO','FAVICON','HERO','GALLERY','STAFF','PRINCIPAL'] as const;
type Kind = typeof KINDS[number];

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  async upload(schoolId: string, kind: Kind, file: { originalname: string; buffer: Buffer; mimetype: string }) {
    const { key, url } = await this.storage.upload(`schools/${schoolId}/${kind.toLowerCase()}`, file.originalname, file.buffer, file.mimetype);
    return withTenant(schoolId, (tx) => tx.mediaAsset.create({ data: { schoolId, kind, storageKey: key, url, byteSize: file.buffer.length } }));
  }
  async list(schoolId: string, kind?: Kind) {
    return withTenant(schoolId, (tx) => tx.mediaAsset.findMany({ where: { schoolId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' } }));
  }
  async remove(schoolId: string, id: string) {
    const asset = await withTenant(schoolId, (tx) => tx.mediaAsset.findUnique({ where: { id } }));
    if (!asset || asset.schoolId !== schoolId) throw new NotFoundException('Media not found');
    await this.storage.delete(asset.storageKey);
    await withTenant(schoolId, (tx) => tx.mediaAsset.delete({ where: { id } }));
    return { ok: true };
  }
}
```

- [ ] **Step 2: Controller with multipart**

`media.controller.ts`:
```ts
import { BadRequestException, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { MediaService } from './media.service';
import { ListMediaDto } from './cms.dto';

const KINDS = ['LOGO','FAVICON','HERO','GALLERY','STAFF','PRINCIPAL'];

@Controller('site/media')
@UseGuards(SchoolJwtGuard)
export class MediaController {
  constructor(private readonly media: MediaService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@UploadedFile() file: any, @Query('kind') kind: string) {
    if (!file) throw new BadRequestException('file required');
    if (!KINDS.includes(kind)) throw new BadRequestException('invalid kind');
    if (!/^image\//.test(file.mimetype)) throw new BadRequestException('only images allowed');
    return this.media.upload(this.sid(), kind as any, file);
  }
  @Get() list(@Query() q: ListMediaDto) { return this.media.list(this.sid(), q.kind as any); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.media.remove(this.sid(), id); }
}
```
`cms.module.ts`: import `StorageModule` (`apps/api/src/common/storage/storage.module.ts`) and add `MediaService` + `MediaController`.

- [ ] **Step 3: Boot + curl an upload**

```bash
# with a small test png:
curl -s -X POST "http://localhost:3001/site/media?kind=GALLERY" -H 'X-Forwarded-Host: acme.localhost' -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/test.png"
curl -s "http://localhost:3001/site/media?kind=GALLERY" -H 'X-Forwarded-Host: acme.localhost' -H "Authorization: Bearer $TOKEN"
```
Create `/tmp/test.png` first: `printf '\x89PNG\r\n\x1a\n' > /tmp/test.png` (minimal — or a real small png). Expected: upload returns a MediaAsset with `url`; list includes it. Delete it after. Verify the object exists in MinIO (optional: check the returned url is reachable).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/cms
git commit -m "feat(api): school media upload + gallery (MinIO, tenant-scoped)"
```

---

### Task 3: Featured staff CRUD

**Files:**
- Create: `apps/api/src/modules/cms/internal/staff.service.ts`, `staff.controller.ts`; add DTOs to `cms.dto.ts`
- Modify: `cms.module.ts`

**Interfaces:**
- Produces: `StaffService.list(schoolId)`, `create(schoolId, dto)`, `update(schoolId, id, dto)`, `remove(schoolId, id)`. `FeaturedStaff` fields: name, role, photoAssetId?, order, teacherId? (null in this phase).

- [ ] **Step 1: DTOs**

```ts
export class UpsertStaffDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 120) role!: string;
  @IsOptional() @IsString() photoAssetId?: string;
  @IsInt() @Min(0) order!: number;
}
```

- [ ] **Step 2: Service**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { UpsertStaffDto } from './cms.dto';

@Injectable()
export class StaffService {
  list(schoolId: string) { return withTenant(schoolId, (tx) => tx.featuredStaff.findMany({ where: { schoolId }, orderBy: { order: 'asc' } })); }
  create(schoolId: string, dto: UpsertStaffDto) { return withTenant(schoolId, (tx) => tx.featuredStaff.create({ data: { ...dto, schoolId } })); }
  async update(schoolId: string, id: string, dto: UpsertStaffDto) {
    const row = await withTenant(schoolId, (tx) => tx.featuredStaff.findUnique({ where: { id } }));
    if (!row || row.schoolId !== schoolId) throw new NotFoundException('Staff not found');
    return withTenant(schoolId, (tx) => tx.featuredStaff.update({ where: { id }, data: dto }));
  }
  async remove(schoolId: string, id: string) {
    const row = await withTenant(schoolId, (tx) => tx.featuredStaff.findUnique({ where: { id } }));
    if (!row || row.schoolId !== schoolId) throw new NotFoundException('Staff not found');
    await withTenant(schoolId, (tx) => tx.featuredStaff.delete({ where: { id } }));
    return { ok: true };
  }
}
```

- [ ] **Step 3: Controller** (`/site/staff`, SchoolJwtGuard, `ParseUUIDPipe` on `:id`), register in module.

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { StaffService } from './staff.service';
import { UpsertStaffDto } from './cms.dto';

@Controller('site/staff')
@UseGuards(SchoolJwtGuard)
export class StaffController {
  constructor(private readonly staff: StaffService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }
  @Get() list() { return this.staff.list(this.sid()); }
  @Post() create(@Body() dto: UpsertStaffDto) { return this.staff.create(this.sid(), dto); }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertStaffDto) { return this.staff.update(this.sid(), id, dto); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.staff.remove(this.sid(), id); }
}
```

- [ ] **Step 4: Boot + curl CRUD; commit**

```bash
git add apps/api/src/modules/cms
git commit -m "feat(api): featured staff CRUD (tenant-scoped)"
```

---

### Task 4: CMS e2e (tenant isolation + content round-trip)

**Files:**
- Create: `apps/api/test/cms.e2e-spec.ts`

**Interfaces:**
- Consumes: the running API; school login helper for acme + beacon.

- [ ] **Step 1: Write the e2e**

Test (API booted, like owner e2e): log in as acme admin; PUT `/site/homepage` `{headline:'Acme HQ'}`; GET `/site/content` → homepage.headline === 'Acme HQ'; add a featured staff → list length increases; **isolation**: acme's token used with `X-Forwarded-Host: beacon.localhost` on `/site/content` is rejected (401/403), proving a school token can't edit another school. Clean up created staff in afterAll. Include the same DATABASE_URL_TEST header-comment note as `owner.e2e-spec.ts`.

- [ ] **Step 2: Run it (API booted) + commit**

```bash
cd apps/api && DATABASE_URL=... DATABASE_URL_APP=...skoolos_app... DATABASE_URL_PLATFORM=...skoolos_platform... DATABASE_URL_TEST=...skoolos... DISABLE_THROTTLER=true npx jest --config test/jest-e2e.config.js cms --runInBand
git add apps/api/test/cms.e2e-spec.ts
git commit -m "test(api): cms content round-trip + cross-school rejection e2e"
```

---

### Task 5: Web — school-admin shell + dashboard

**Files:**
- Modify: `apps/web/app/app/layout.tsx`, `apps/web/app/app/page.tsx`
- Delete: `apps/web/app/app/{classes,enrollments,grades,people,subjects,settings}/page.tsx`

- [ ] **Step 1: Shell + guard**

Rebuild `layout.tsx` as the school-admin shell (teal accent per `mockups/school-admin.html`): sidebar with **Dashboard** and **Website** (management items come in Phase 4 — omit). Auth guard: redirect to `/login` if no school-audience token in `useAuthStore` (audience `'school'`). All API calls via `useApi({ audience: 'school' })` (host header defaults to the current school subdomain — the ApiClient sends the browser Host automatically; confirm `useApi` without an explicit `hostHeader` still works for school audience, since the page is served from `<slug>.localhost`).

- [ ] **Step 2: Dashboard page** — simple welcome + a "Edit your website" CTA linking to `/app/website`. Delete the 6 old-model page dirs.

- [ ] **Step 3: Typecheck + boot + curl 200; commit**

Verify `http://acme.localhost:3000/app` renders 200. Commit `feat(web): school-admin shell + dashboard`.

---

### Task 6: Web — website content editor (branding/homepage/about/contact/social)

**Files:**
- Create: `apps/web/app/app/website/page.tsx`

**Interfaces:**
- Consumes: `GET /site/content`, `PUT /site/profile`, `PUT /site/homepage`, `PUT /site/social`, `PUT /site/stats`.

- [ ] **Step 1: Tabbed editor**

Port the "Website" tab UI from `mockups/school-admin.html`. Tabs: **Branding** (brand colors, logo — logo upload lands in Task 7), **Homepage** (headline, subheadline, stats rows), **About** (aboutText, principalName, principalMessage), **Contact** (phone, email, address fields, social links). Load via `useQuery(['site-content'], () => api.get('/site/content'))`; each tab's Save calls the matching PUT via `useMutation` and invalidates `['site-content']`; toast on success/error. Declare local interfaces for the content shape.

- [ ] **Step 2: Typecheck + manual verify + commit**

Edit headline → Save → reload shows persisted value. Commit `feat(web): school website content editor`.

---

### Task 7: Web — gallery manager + logo/hero image pickers

**Files:**
- Modify: `apps/web/app/app/website/page.tsx` (add Gallery tab + wire logo/hero upload into Branding/Homepage tabs)

**Interfaces:**
- Consumes: `POST /site/media?kind=`, `GET /site/media?kind=GALLERY`, `DELETE /site/media/:id`; sets `logoAssetId`/`heroAssetId` via `PUT /site/profile`/`/site/homepage`.

- [ ] **Step 1: Gallery tab**

Upload (file input → `FormData` POST to `/site/media?kind=GALLERY`), grid of images from `GET /site/media?kind=GALLERY`, delete button per image. For logo (Branding) and hero (Homepage): an upload control that POSTs kind=LOGO/HERO then PUTs the returned asset id into profile/homepage. Invalidate relevant queries after each op; show upload progress/disabled state.

- [ ] **Step 2: Manual verify (upload an image, see it appear, delete it) + commit**

Commit `feat(web): gallery manager + logo/hero upload`.

---

### Task 8: Web — featured staff manager + end-to-end verify

**Files:**
- Modify: `apps/web/app/app/website/page.tsx` (Staff tab)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /site/staff`, `POST /site/media?kind=STAFF`.

- [ ] **Step 1: Staff tab**

List staff cards; "Add staff" (name, role, photo upload → kind=STAFF → photoAssetId); edit/delete. Wire to the staff endpoints; invalidate `['site-staff']`.

- [ ] **Step 2: Full flow verify**

Log in as `admin@acme.test` at `acme.localhost:3000/app` → Website → edit homepage, upload a gallery image, add a staff member → all persist across reload. Confirm `pnpm --filter @skoolos/web typecheck` and `pnpm --filter @skoolos/api typecheck` are clean and the cms e2e + tenant-isolation e2e pass.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(web): featured staff manager; phase 3 cms complete"
```

---

## Self-review notes (author)

- **Spec coverage (§5.2):** SchoolProfile/HomepageContent/StatItem/SocialLink → Tasks 1,6; MediaAsset (gallery + logo/hero/staff photos) → Tasks 2,7; FeaturedStaff → Tasks 3,8; tenant isolation → Tasks 1–4 (withTenant/RLS + e2e). MenuItem editing is DEFERRED (menu is class-wise/derived — belongs with Phase 4 classes).
- **Deferred to Phase 3b / later:** owner-override editing (owner edits any school's content via a platform path — a parallel set of `/owner/schools/:id/content` endpoints reusing the same services with `getPlatformPrisma`), menu editor, image cropping/optimization, per-school storage quotas.
- **Assumptions to verify during execution:** `SchoolJwtGuard` establishes the tenant context so `TenantContextService.requireTenant().schoolId` is populated on CMS routes (Phase 1 binds token↔host); `SchoolProfile`/`HomepageContent` rows always exist for a live school (seed + Phase 2 create-school create them — else switch `update`→`upsert`); `@nestjs/platform-express` `FileInterceptor` is available (it is — `@nestjs/platform-express` is a dependency; `@types/multer` is present).
- **Isolation:** every CMS route is `SchoolJwtGuard` + `withTenant()`; no `getPlatformPrisma()` in this module; media keys are per-school-prefixed. The e2e asserts a school token cannot act on another school's host.
