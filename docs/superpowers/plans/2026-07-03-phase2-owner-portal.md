# Phase 2 — Owner Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform owner a working portal to log in, see all schools, add a school (with tier), and toggle per-school features — wired end-to-end to the new multi-tenant backend.

**Architecture:** New NestJS `owner` module (owner auth on the platform host + owner-scoped CRUD via the BYPASSRLS platform client), consumed by rebuilt Next.js owner pages under `apps/web/app/platform/*`. Owner is a `User` with `schoolId = null` and `role = OWNER`; owner auth issues a platform-audience JWT. Feature/tier changes invalidate the Redis feature cache from Phase 1.

**Tech Stack:** NestJS 10, Prisma 5, Postgres 16, Redis, otplib (TOTP), argon2, Next.js 14 (App Router), React Query, Zustand, Tailwind.

## Global Constraints

- Owner host is `PLATFORM_OWNER_HOST` (`owner.localhost` in dev); the tenant middleware resolves it to `{ kind: 'platform' }`. Owner endpoints must reject non-platform hosts.
- Owner auth requires **email + password + TOTP** (6-digit). Owner = `User` where `schoolId IS NULL` and `role = 'OWNER'`.
- Platform/owner reads use `getPlatformPrisma()` (BYPASSRLS) — this is the one legitimate cross-tenant client. NEVER expose it to tenant-scoped routes.
- Tiers (exact): `BASIC`, `STANDARD`, `PRO`. Feature keys (exact): `PUBLIC_SITE`, `GALLERY`, `ENQUIRY`, `SOCIAL`, `ABOUT_CONTACT`, `EVENTS`, `MANAGEMENT`. Roles (exact): `OWNER`, `SCHOOL_ADMIN`, `TEACHER`, `STUDENT`.
- After any tier or feature-override change for a school, call `FeatureResolverService.invalidate(schoolId)`.
- Reuse, do not re-create: `getPlatformPrisma`, `resolveFeatures`, `TIER_FEATURES`, `FeatureKey` (`@skoolos/db`); `FeatureResolverService` (`apps/api/src/modules/features`); `PasswordService` (`apps/api/src/modules/auth`); `PlatformJwtPayload`/`PlatformJwtGuard` (`apps/api/src/common/auth`); web UI primitives in `apps/web/components/ui/*`; the approved design in `mockups/owner-portal.html`.
- Design reference for every owner page: `mockups/owner-portal.html` (dashboard, schools table, add-school wizard, feature toggles). Port its markup/Tailwind; wire to the real API.
- Spec: `docs/superpowers/specs/2026-07-03-skoolos-school-website-platform-design.md` (§2 owner portal, §6 features, §8 auth).

---

## File structure (Phase 2)

**API — new module `apps/api/src/modules/owner/`:**
- `index.ts` — public barrel (`OwnerModule`)
- `internal/owner.module.ts`
- `internal/owner-auth.service.ts` — login (pwd+TOTP), refresh; issues platform JWT
- `internal/owner-auth.controller.ts` — `POST /owner/auth/login`, `POST /owner/auth/refresh`
- `internal/owner.controller.ts` — `GET /owner/stats`, `GET /owner/schools`, `GET /owner/schools/:id`, `POST /owner/schools`, `PATCH /owner/schools/:id/tier`, `PATCH /owner/schools/:id/features`
- `internal/owner-schools.service.ts` — stats, list, detail, create-school transaction, tier/feature mutations
- `internal/owner.dto.ts` — request DTOs (class-validator)
- `internal/owner-host.guard.ts` — rejects non-platform hosts
- `internal/*.spec.ts` — unit tests; `apps/api/test/owner.e2e-spec.ts` — e2e

**API — modify:** `apps/api/src/app.module.ts` (register `OwnerModule`); `apps/api/src/modules/auth/index.ts` (export `PasswordService` if not already); `packages/db/prisma/seed.ts` (set owner `mfaSecret`, print current TOTP).

**Web — rebuild under `apps/web/app/platform/`:**
- `login/page.tsx` (email+password+TOTP → `/owner/auth/login`)
- `layout.tsx` (owner shell: sidebar nav per mockup)
- `page.tsx` (dashboard/stats)
- `schools/page.tsx` (schools table)
- `schools/[id]/page.tsx` (detail + feature toggles + tier)
- `onboard/page.tsx` (3-step add-school wizard)
- **Delete** `apps/web/app/platform/onboard/success/page.tsx`, `apps/web/app/platform/settings/page.tsx` (old-model pages not in this phase) and the old CSV/branding wizard fields.
- **Modify:** `apps/web/lib/wizard-store.ts` (reduce to new wizard fields).

---

### Task 1: Owner auth service + controller (password + TOTP → platform JWT)

**Files:**
- Create: `apps/api/src/modules/owner/internal/owner-auth.service.ts`, `owner-auth.controller.ts`, `owner-host.guard.ts`, `owner.dto.ts`, `owner.module.ts`, `apps/api/src/modules/owner/index.ts`
- Create test: `apps/api/src/modules/owner/internal/owner-auth.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/modules/auth/index.ts`, `packages/db/prisma/seed.ts`

**Interfaces:**
- Consumes: `getPlatformPrisma`, `PasswordService`, `TenantContextService` (`.get()` → `{ kind }`), `PlatformJwtPayload`, `loadEnv`, `otplib.authenticator`, `@nestjs/jwt` `JwtService`.
- Produces: `OwnerAuthService.login(email, password, totp): Promise<{ accessToken, refreshToken, expiresIn }>`; `OwnerAuthService.refresh(rawToken)`; `OwnerHostGuard` (403 unless `tenant.get()?.kind === 'platform'`); `OwnerModule`.

- [ ] **Step 1: Seed the owner's TOTP secret**

In `packages/db/prisma/seed.ts`, where the owner `User` is created, set a fixed dev secret and print the current code. Add at the top: `import { authenticator } from 'otplib';` and use `mfaSecret: 'AIRFGVZFLVAH6J2C'` on the owner create/update. After the owner is ensured, add:
```ts
console.log('Owner TOTP secret: AIRFGVZFLVAH6J2C  current code:', authenticator.generate('AIRFGVZFLVAH6J2C'));
```
Re-run the seed:
```bash
cd packages/db && DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public npx tsx prisma/seed.ts
```
Expected: prints "SEED COMPLETE" and a 6-digit TOTP code, no errors.

- [ ] **Step 2: Export PasswordService from the auth barrel**

Confirm `apps/api/src/modules/auth/index.ts` exports `PasswordService`. If not, add `export { PasswordService } from './internal/password.service';` and ensure `AuthModule` has `exports: [PasswordService]` (add if missing). Verify: `grep -n PasswordService apps/api/src/modules/auth/index.ts`.

- [ ] **Step 3: Write the failing unit test for TOTP verification logic**

Create `apps/api/src/modules/owner/internal/owner-auth.service.spec.ts`:
```ts
import { authenticator } from 'otplib';
import { verifyTotp } from './owner-auth.service';

describe('verifyTotp', () => {
  const secret = 'AIRFGVZFLVAH6J2C';
  it('accepts a current code', () => {
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
  });
  it('rejects a wrong code', () => {
    expect(verifyTotp('000000', secret)).toBe(false);
  });
  it('rejects when secret is null', () => {
    expect(verifyTotp('123456', null)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `pnpm --filter @skoolos/api exec jest src/modules/owner/internal/owner-auth.service.spec.ts`
Expected: FAIL — cannot find module `./owner-auth.service`.

- [ ] **Step 5: Implement `owner-auth.service.ts`**

```ts
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { randomUUID, createHash } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from '../../auth';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';

export interface IssuedTokens { accessToken: string; refreshToken: string; expiresIn: number; }

/** Pure, unit-testable TOTP check (window ±1 step for clock skew). */
export function verifyTotp(code: string, secret: string | null): boolean {
  if (!secret) return false;
  authenticator.options = { window: 1 };
  try { return authenticator.check(code, secret); } catch { return false; }
}

@Injectable()
export class OwnerAuthService {
  private readonly env = loadEnv();
  constructor(private readonly jwt: JwtService, private readonly passwords: PasswordService) {}

  async login(email: string, password: string, totp: string): Promise<IssuedTokens> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({ where: { email: email.toLowerCase(), schoolId: null, role: 'OWNER' } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException('Account temporarily locked');
    const passOk = await this.passwords.verify(user.passwordHash, password);
    const totpOk = passOk && verifyTotp(totp, user.mfaSecret);
    if (!passOk || !totpOk) throw new UnauthorizedException('Invalid credentials');
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    return this.issue(user.id);
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    let payload: { sub: string; fam: string };
    try {
      payload = this.jwt.verify(rawToken, { secret: this.env.JWT_PLATFORM_REFRESH_SECRET, audience: 'platform-refresh' });
    } catch { throw new UnauthorizedException('Invalid refresh token'); }
    const db = getPlatformPrisma();
    const tokenHash = sha256(rawToken);
    const row = await db.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt) throw new UnauthorizedException('Refresh token invalid');
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(payload.sub, row.familyId);
  }

  private async issue(userId: string, familyId = randomUUID()): Promise<IssuedTokens> {
    const accessPayload: Omit<PlatformJwtPayload, 'iat' | 'exp'> = { sub: userId, aud: 'platform', role: 'OWNER', jti: randomUUID() };
    const accessToken = this.jwt.sign(accessPayload, { secret: this.env.JWT_PLATFORM_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL });
    const refreshToken = this.jwt.sign({ sub: userId, fam: familyId, jti: randomUUID() }, { secret: this.env.JWT_PLATFORM_REFRESH_SECRET, audience: 'platform-refresh', expiresIn: this.env.JWT_REFRESH_TTL });
    await getPlatformPrisma().refreshToken.create({ data: { userId, schoolId: null, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000) } });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL };
  }
}
function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }
```
Note: confirm `PlatformJwtPayload` shape in `apps/api/src/common/auth/jwt-payload.ts`; adapt the `role` field if its type differs (it should allow `'OWNER'` per Phase 1). If `PlatformJwtPayload.role` doesn't include `OWNER`, widen it there minimally.

- [ ] **Step 6: Run the unit test, verify pass**

Run: `pnpm --filter @skoolos/api exec jest src/modules/owner/internal/owner-auth.service.spec.ts`
Expected: 3 passing.

- [ ] **Step 7: Add the host guard, DTOs, controller, module**

`owner-host.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../tenancy';

@Injectable()
export class OwnerHostGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}
  canActivate(_ctx: ExecutionContext): boolean {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'platform') throw new ForbiddenException('Owner host required');
    return true;
  }
}
```
`owner.dto.ts` (login part; school DTOs added in Task 4):
```ts
import { IsEmail, IsString, Length, Matches } from 'class-validator';
export class OwnerLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
  @Matches(/^\d{6}$/) totp!: string;
}
export class RefreshDto { @IsString() refreshToken!: string; }
```
`owner-auth.controller.ts`:
```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerLoginDto, RefreshDto } from './owner.dto';

@Controller('owner/auth')
@UseGuards(OwnerHostGuard)
export class OwnerAuthController {
  constructor(private readonly auth: OwnerAuthService) {}
  @Public() @Post('login')
  login(@Body() dto: OwnerLoginDto) { return this.auth.login(dto.email, dto.password, dto.totp); }
  @Public() @Post('refresh')
  refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
}
```
Note: `@Public()` marks the route exempt from the global school-JWT guard (confirm the app's global guard honors `@Public()` — it does in Phase 1's `common/auth`). `owner.module.ts` and `index.ts`:
```ts
// owner.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerAuthController } from './owner-auth.controller';
import { OwnerHostGuard } from './owner-host.guard';
@Module({ imports: [JwtModule.register({}), AuthModule, FeaturesModule], controllers: [OwnerAuthController], providers: [OwnerAuthService, OwnerHostGuard] })
export class OwnerModule {}
```
```ts
// index.ts
export { OwnerModule } from './internal/owner.module';
```
Register `OwnerModule` in `apps/api/src/app.module.ts` imports.

- [ ] **Step 8: Typecheck + boot + curl login (with a real TOTP)**

```bash
pnpm --filter @skoolos/api typecheck
# boot with roles (background), then:
TOTP=$(node -e "console.log(require('otplib').authenticator.generate('AIRFGVZFLVAH6J2C'))")
curl -s -X POST http://localhost:3001/owner/auth/login -H 'Content-Type: application/json' \
  -H 'X-Forwarded-Host: owner.localhost' -d "{\"email\":\"owner@skoolos.local\",\"password\":\"OwnerPassw0rd!\",\"totp\":\"$TOTP\"}" | head -c 80
```
Expected: typecheck passes; curl returns JSON with `accessToken`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/owner apps/api/src/app.module.ts apps/api/src/modules/auth/index.ts packages/db/prisma/seed.ts
git commit -m "feat(api): owner auth (password + TOTP) issuing platform JWT"
```

---

### Task 2: Owner guard + stats endpoint

**Files:**
- Create: `apps/api/src/modules/owner/internal/owner-schools.service.ts` (stats method), `owner.controller.ts`
- Modify: `owner.module.ts`

**Interfaces:**
- Consumes: `getPlatformPrisma`, `PlatformJwtGuard` (`apps/api/src/common/auth/platform-jwt.guard.ts`), `OwnerHostGuard`.
- Produces: `OwnerSchoolsService.stats(): Promise<StatsResponse>` where `StatsResponse = { schools: { total: number; byTier: { BASIC: number; STANDARD: number; PRO: number }; live: number; suspended: number }; domains: { live: number } }`. `GET /owner/stats`.

- [ ] **Step 1: Implement `owner-schools.service.ts` stats**

```ts
import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

export interface StatsResponse {
  schools: { total: number; byTier: { BASIC: number; STANDARD: number; PRO: number }; live: number; suspended: number };
  domains: { live: number };
}

@Injectable()
export class OwnerSchoolsService {
  async stats(): Promise<StatsResponse> {
    const db = getPlatformPrisma();
    const [byTier, live, suspended, total, liveDomains] = await Promise.all([
      db.school.groupBy({ by: ['tier'], _count: true }),
      db.school.count({ where: { status: 'LIVE' } }),
      db.school.count({ where: { status: 'SUSPENDED' } }),
      db.school.count(),
      db.domain.count({ where: { status: 'LIVE' } }),
    ]);
    const tierMap = { BASIC: 0, STANDARD: 0, PRO: 0 } as Record<'BASIC'|'STANDARD'|'PRO', number>;
    for (const g of byTier) tierMap[g.tier as 'BASIC'|'STANDARD'|'PRO'] = g._count;
    return { schools: { total, byTier: tierMap, live, suspended }, domains: { live: liveDomains } };
  }
}
```

- [ ] **Step 2: Implement `owner.controller.ts` with guards**

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerSchoolsService } from './owner-schools.service';

@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerController {
  constructor(private readonly schools: OwnerSchoolsService) {}
  @Get('stats') stats() { return this.schools.stats(); }
}
```
Confirm `PlatformJwtGuard`'s constructor/behavior (it verifies a platform-audience JWT). If it requires a role check, ensure it admits `role: 'OWNER'`. Register `OwnerController` + `OwnerSchoolsService` in `owner.module.ts`.

- [ ] **Step 3: Boot + curl (authorized)**

```bash
# obtain token from Task 1 login, then:
curl -s http://localhost:3001/owner/stats -H 'X-Forwarded-Host: owner.localhost' -H "Authorization: Bearer $TOKEN"
```
Expected: JSON `{"schools":{"total":2,"byTier":{"BASIC":0,"STANDARD":1,"PRO":1},...}}`. Also verify an unauthenticated call returns 401 and a call without the owner host returns 403.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/owner
git commit -m "feat(api): owner stats endpoint (guarded by owner host + platform JWT)"
```

---

### Task 3: Owner schools list + detail

**Files:**
- Modify: `owner-schools.service.ts` (add `list`, `detail`), `owner.controller.ts` (add routes)

**Interfaces:**
- Consumes: `FeatureResolverService.getFeatures(schoolId)`, `resolveFeatures`, `TIER_FEATURES`.
- Produces: `list(): Promise<SchoolRow[]>` where `SchoolRow = { id: string; name: string; slug: string; tier: 'BASIC'|'STANDARD'|'PRO'; status: string; primaryDomain: string | null; features: string[] }`; `detail(id): Promise<SchoolDetail>` = `SchoolRow & { domains: { hostname: string; status: string; isPrimary: boolean }[] }`.

- [ ] **Step 1: Implement `list` and `detail`**

Add to `OwnerSchoolsService` (inject `FeatureResolverService` via constructor):
```ts
async list(): Promise<SchoolRow[]> {
  const db = getPlatformPrisma();
  const schools = await db.school.findMany({
    orderBy: { name: 'asc' },
    include: { domains: { where: { isPrimary: true }, take: 1 }, featureOverrides: true },
  });
  return schools.map((s) => ({
    id: s.id, name: s.name, slug: s.slug, tier: s.tier, status: s.status,
    primaryDomain: s.domains[0]?.hostname ?? null,
    features: [...resolveFeatures(s.tier, s.featureOverrides)],
  }));
}
async detail(id: string): Promise<SchoolDetail> {
  const db = getPlatformPrisma();
  const s = await db.school.findUniqueOrThrow({ where: { id }, include: { domains: true, featureOverrides: true } });
  return {
    id: s.id, name: s.name, slug: s.slug, tier: s.tier, status: s.status,
    primaryDomain: s.domains.find((d) => d.isPrimary)?.hostname ?? null,
    features: [...resolveFeatures(s.tier, s.featureOverrides)],
    domains: s.domains.map((d) => ({ hostname: d.hostname, status: d.status, isPrimary: d.isPrimary })),
  };
}
```
Add the `SchoolRow`/`SchoolDetail` interfaces and `import { resolveFeatures } from '@skoolos/db';` (and inject `FeatureResolverService` even if unused here — used in Task 5). Add controller routes:
```ts
@Get('schools') listSchools() { return this.schools.list(); }
@Get('schools/:id') schoolDetail(@Param('id') id: string) { return this.schools.detail(id); }
```

- [ ] **Step 2: Boot + curl**

`curl -s http://localhost:3001/owner/schools -H 'X-Forwarded-Host: owner.localhost' -H "Authorization: Bearer $TOKEN"`
Expected: array with acme (STANDARD, features incl. EVENTS, no MANAGEMENT) and beacon (PRO, includes MANAGEMENT).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/owner
git commit -m "feat(api): owner schools list + detail with resolved features"
```

---

### Task 4: Create school (transactional)

**Files:**
- Modify: `owner.dto.ts` (CreateSchoolDto), `owner-schools.service.ts` (create), `owner.controller.ts` (POST)
- Test: `apps/api/test/owner.e2e-spec.ts`

**Interfaces:**
- Produces: `create(dto): Promise<{ id: string; slug: string; tempPassword: string }>`. Creates `School` + primary `Domain` + admin `User` (role SCHOOL_ADMIN, random temp password) + `SchoolProfile` + `HomepageContent` + default grades, in one transaction.

- [ ] **Step 1: Add `CreateSchoolDto`**

In `owner.dto.ts`:
```ts
import { IsIn } from 'class-validator';
export class CreateSchoolDto {
  @IsString() @Length(2, 120) name!: string;
  @Matches(/^[a-z0-9-]{2,40}$/) slug!: string;
  @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO';
  @Matches(/^[a-z0-9.-]+$/) domainHostname!: string;
  @IsEmail() adminEmail!: string;
}
```

- [ ] **Step 2: Write the failing e2e test**

Create `apps/api/test/owner.e2e-spec.ts`:
```ts
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';

const BASE = 'http://localhost:3001';
async function ownerToken(): Promise<string> {
  const { authenticator } = await import('otplib');
  const res = await fetch(`${BASE}/owner/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'owner.localhost' },
    body: JSON.stringify({ email: 'owner@skoolos.local', password: 'OwnerPassw0rd!', totp: authenticator.generate('AIRFGVZFLVAH6J2C') }),
  });
  return (await res.json()).accessToken as string;
}

describe('POST /owner/schools', () => {
  const slug = `test-${Date.now()}`;
  afterAll(async () => {
    const db = getPlatformPrisma();
    await db.school.deleteMany({ where: { slug } });
    await disconnectAll();
  });
  it('creates a school with domain, admin, profile, grades', async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE}/owner/schools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'owner.localhost', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Test School', slug, tier: 'STANDARD', domainHostname: `${slug}.localhost`, adminEmail: `admin@${slug}.test` }),
    });
    expect(res.status).toBeLessThan(300);
    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({ where: { slug }, include: { domains: true, users: true, profile: true, homepage: true, grades: true } });
    expect(s.tier).toBe('STANDARD');
    expect(s.domains.some((d) => d.hostname === `${slug}.localhost` && d.isPrimary)).toBe(true);
    expect(s.users.some((u) => u.role === 'SCHOOL_ADMIN')).toBe(true);
    expect(s.profile).not.toBeNull();
    expect(s.homepage).not.toBeNull();
    expect(s.grades.length).toBeGreaterThan(0);
  });
});
```
This requires the API running. (The e2e globalSetup provisions the DB; the API must be booted separately for HTTP calls — the test brief for the executor notes to boot the API first.)

- [ ] **Step 3: Run it, verify it fails**

Run (API not yet implementing the route): `... npx jest --config test/jest-e2e.config.js owner --runInBand` → FAIL (404/route missing).

- [ ] **Step 4: Implement `create`**

```ts
import { ConflictException } from '@nestjs/common';
import { PasswordService } from '../../auth';
import { randomBytes } from 'node:crypto';
// inject: constructor(private readonly features: FeatureResolverService, private readonly passwords: PasswordService) {}

async create(dto: CreateSchoolDto): Promise<{ id: string; slug: string; tempPassword: string }> {
  const db = getPlatformPrisma();
  const clash = await db.school.findFirst({ where: { OR: [{ slug: dto.slug }, { domains: { some: { hostname: dto.domainHostname } } }] } });
  if (clash) throw new ConflictException('Slug or domain already in use');
  const tempPassword = randomBytes(6).toString('base64url');
  const passwordHash = await this.passwords.hash(tempPassword);
  const defaultGrades = ['Nursery', 'Grade 1', 'Grade 2', 'Grade 3'];
  const school = await db.$transaction(async (tx) => {
    const s = await tx.school.create({ data: { name: dto.name, slug: dto.slug, tier: dto.tier, status: 'SETUP' } });
    await tx.domain.create({ data: { schoolId: s.id, hostname: dto.domainHostname, type: 'CUSTOM', status: 'PENDING', isPrimary: true } });
    await tx.user.create({ data: { schoolId: s.id, email: dto.adminEmail.toLowerCase(), passwordHash, role: 'SCHOOL_ADMIN' } });
    await tx.schoolProfile.create({ data: { schoolId: s.id } });
    await tx.homepageContent.create({ data: { schoolId: s.id, headline: `Welcome to ${dto.name}` } });
    await tx.grade.createMany({ data: defaultGrades.map((name, order) => ({ schoolId: s.id, name, order })) });
    return s;
  });
  return { id: school.id, slug: school.slug, tempPassword };
}
```
Add controller route:
```ts
@Post('schools') createSchool(@Body() dto: CreateSchoolDto) { return this.schools.create(dto); }
```

- [ ] **Step 5: Run the e2e, verify pass**

Boot the API, then run the owner e2e. Expected: PASS (school + domain + admin + profile + homepage + grades created).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/owner apps/api/test/owner.e2e-spec.ts
git commit -m "feat(api): create-school endpoint (transactional: school+domain+admin+profile+grades)"
```

---

### Task 5: Tier + feature-override mutations (with cache invalidation)

**Files:**
- Modify: `owner.dto.ts`, `owner-schools.service.ts`, `owner.controller.ts`
- Test: extend `apps/api/test/owner.e2e-spec.ts`

**Interfaces:**
- Produces: `setTier(id, tier)`; `setFeature(id, featureKey, enabled)`. Both call `FeatureResolverService.invalidate(id)` after writing.

- [ ] **Step 1: DTOs**

```ts
export class SetTierDto { @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO'; }
export class SetFeatureDto {
  @IsIn(['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','MANAGEMENT']) featureKey!: string;
  @IsBoolean() enabled!: boolean;
}
```
(add `IsBoolean` to the class-validator import).

- [ ] **Step 2: Service methods**

```ts
async setTier(id: string, tier: 'BASIC'|'STANDARD'|'PRO') {
  await getPlatformPrisma().school.update({ where: { id }, data: { tier } });
  await this.features.invalidate(id);
  return this.detail(id);
}
async setFeature(id: string, featureKey: string, enabled: boolean) {
  await getPlatformPrisma().featureOverride.upsert({
    where: { schoolId_featureKey: { schoolId: id, featureKey } },
    update: { enabled }, create: { schoolId: id, featureKey, enabled },
  });
  await this.features.invalidate(id);
  return this.detail(id);
}
```

- [ ] **Step 3: Controller routes**

```ts
@Patch('schools/:id/tier') setTier(@Param('id') id: string, @Body() dto: SetTierDto) { return this.schools.setTier(id, dto.tier); }
@Patch('schools/:id/features') setFeature(@Param('id') id: string, @Body() dto: SetFeatureDto) { return this.schools.setFeature(id, dto.featureKey, dto.enabled); }
```

- [ ] **Step 4: Extend the e2e test**

Add a test: create a BASIC school, PATCH `/features` with `{ featureKey: 'EVENTS', enabled: true }`, GET detail, assert `features` includes `EVENTS`; PATCH `/tier` to `PRO`, assert `features` includes `MANAGEMENT`.
```ts
it('feature override and tier change reflect in resolved features', async () => {
  const token = await ownerToken();
  const db = getPlatformPrisma();
  const s = await db.school.findUniqueOrThrow({ where: { slug } });
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'owner.localhost', Authorization: `Bearer ${token}` };
  await fetch(`${BASE}/owner/schools/${s.id}/features`, { method: 'PATCH', headers: h, body: JSON.stringify({ featureKey: 'MANAGEMENT', enabled: true }) });
  const d1 = await (await fetch(`${BASE}/owner/schools/${s.id}`, { headers: h })).json();
  expect(d1.features).toContain('MANAGEMENT');
});
```

- [ ] **Step 5: Run e2e, verify pass; commit**

```bash
git add apps/api/src/modules/owner apps/api/test/owner.e2e-spec.ts
git commit -m "feat(api): owner tier + feature-override mutations with cache invalidation"
```

---

### Task 6: Web — owner login page (password + TOTP)

**Files:**
- Modify: `apps/web/app/platform/login/page.tsx`
- Verify: `apps/web/lib/use-api.ts`, `apps/web/lib/auth-store.ts` (audience `'platform'`, hostHeader `owner.localhost`)

**Interfaces:**
- Consumes: `useApi({ audience: 'platform', hostHeader: 'owner.localhost' })`; `POST /owner/auth/login`.

- [ ] **Step 1: Rewrite the login page to call the new endpoint**

Port the login card from `mockups/owner-portal.html` styling using existing `components/ui/*`. The form posts to `/owner/auth/login` with `{ email, password, totp }`. On success, `setTokens({ accessToken, refreshToken, audience: 'platform' })` and `router.replace('/platform')`. (The existing `platform/login/page.tsx` already does this against the old `/platform/auth/login` path — change the path to `/owner/auth/login`; keep the email/password/TOTP fields and validation `totp: /^\d{6}$/`.)

- [ ] **Step 2: Manual verify**

Boot web + API. Visit `http://owner.localhost:3000/platform/login`, log in with `owner@skoolos.local` / `OwnerPassw0rd!` / a current TOTP (generate via the seed output or `node -e "console.log(require('otplib').authenticator.generate('AIRFGVZFLVAH6J2C'))"`). Expected: redirect to `/platform`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/platform/login/page.tsx
git commit -m "feat(web): owner login wired to /owner/auth/login"
```

---

### Task 7: Web — owner shell + dashboard (stats)

**Files:**
- Modify: `apps/web/app/platform/layout.tsx`, `apps/web/app/platform/page.tsx`

**Interfaces:**
- Consumes: `GET /owner/stats` → `StatsResponse` (Task 2 shape).

- [ ] **Step 1: Layout shell**

Port the sidebar from `mockups/owner-portal.html` (Dashboard, Schools, Add School, Settings later). Use React Query `useQuery(['owner-stats'], () => api.get('/owner/stats'))`. Guard: if no `refreshToken` in the store, redirect to `/platform/login`.

- [ ] **Step 2: Dashboard cards**

Render stat cards from `StatsResponse`: total schools, by-tier (`BASIC·STANDARD·PRO`), live domains, suspended. Match the mockup's card grid.

- [ ] **Step 3: Manual verify + commit**

Visit `/platform` as owner → cards show `2 schools`, `0·1·1`. Commit:
```bash
git add apps/web/app/platform/layout.tsx apps/web/app/platform/page.tsx
git commit -m "feat(web): owner shell + dashboard stats"
```

---

### Task 8: Web — schools list

**Files:**
- Modify: `apps/web/app/platform/schools/page.tsx`

- [ ] **Step 1: Table**

`useQuery(['owner-schools'], () => api.get('/owner/schools'))`. Render the schools table from the mockup: name, primaryDomain, tier badge, status, features summary, and a "Manage" link to `/platform/schools/[id]`. Add an "Add School" button linking to `/platform/onboard`.

- [ ] **Step 2: Manual verify + commit**

`/platform/schools` shows acme + beacon with correct tier badges and feature summaries. Commit:
```bash
git add apps/web/app/platform/schools/page.tsx
git commit -m "feat(web): owner schools list"
```

---

### Task 9: Web — add-school wizard (3-step)

**Files:**
- Modify: `apps/web/app/platform/onboard/page.tsx`, `apps/web/lib/wizard-store.ts`

**Interfaces:**
- Consumes: `POST /owner/schools` with `{ name, slug, tier, domainHostname, adminEmail }`.

- [ ] **Step 1: Reduce the wizard store**

Rewrite `wizard-store.ts` to hold only: `step, name, slug, domainHostname, adminEmail, tier` (default `'STANDARD'`), with setters and `reset()`. Remove CSV/branding/subscriptionPlan fields.

- [ ] **Step 2: Rebuild the wizard UI (3 steps)**

Port the 3-step wizard from `mockups/owner-portal.html` (Basics → Choose tier [BASIC/STANDARD/PRO cards] → Confirm). On submit, `api.post('/owner/schools', {...})`; on success show the returned `tempPassword` (admin's initial password) in a success toast/box and route to `/platform/schools`.

- [ ] **Step 3: Manual verify + commit**

Run the wizard, create "Maple Leaf" (STANDARD, `maple.localhost`, `admin@maple.test`) → appears in the schools list. Commit:
```bash
git add apps/web/app/platform/onboard/page.tsx apps/web/lib/wizard-store.ts
git commit -m "feat(web): 3-step add-school wizard wired to create endpoint"
```

---

### Task 10: Web — school detail + feature/tier toggles

**Files:**
- Modify: `apps/web/app/platform/schools/[id]/page.tsx`
- Delete: `apps/web/app/platform/onboard/success/page.tsx`, `apps/web/app/platform/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /owner/schools/:id`, `PATCH /owner/schools/:id/tier`, `PATCH /owner/schools/:id/features`.

- [ ] **Step 1: Detail + toggles**

Render school name, primary domain, tier selector (BASIC/STANDARD/PRO) that PATCHes `/tier`, and a list of the 7 feature keys with switches that PATCH `/features` (`{ featureKey, enabled }`). After each mutation, invalidate the `['owner-schools']` and detail queries so the UI reflects resolved features. Show which features come from the tier vs. an override (compare against `TIER_FEATURES` — you may hardcode the tier→feature map on the web side or derive from the returned `features` list).

- [ ] **Step 2: Delete the two old-model pages**

```bash
git rm apps/web/app/platform/onboard/success/page.tsx apps/web/app/platform/settings/page.tsx
```
Remove any nav links to them in the layout.

- [ ] **Step 3: Manual verify + commit**

Toggle a feature on beacon, confirm the schools list reflects it. Commit:
```bash
git add apps/web/app/platform/schools/[id]/page.tsx apps/web/app/platform/layout.tsx
git commit -m "feat(web): school detail with tier + feature toggles"
```

---

### Task 11: End-to-end owner flow verification

**Files:** none (verification)

- [ ] **Step 1: Full flow**

With API + web booted: log in as owner at `owner.localhost:3000/platform/login` (password + TOTP) → dashboard shows stats → schools list shows acme/beacon → run the wizard to add a school → it appears in the list → open it → toggle a feature and change tier → change persists on reload.

- [ ] **Step 2: Confirm typecheck/tests green**

```bash
pnpm --filter @skoolos/api typecheck && pnpm --filter @skoolos/web typecheck
# owner e2e (API booted):
cd apps/api && DATABASE_URL=... DATABASE_URL_APP=...skoolos_app... DATABASE_URL_PLATFORM=...skoolos_platform... DISABLE_THROTTLER=true npx jest --config test/jest-e2e.config.js owner --runInBand
```
Expected: typechecks pass; owner e2e passes; tenant-isolation e2e still passes.

- [ ] **Step 3: Commit any final fixups**

```bash
git add -A && git commit -m "chore(phase2): owner portal end-to-end verified" || echo "nothing to commit"
```

---

## Self-review notes (author)

- **Spec coverage:** §2 owner portal (provision schools, pick tier, toggle features) → Tasks 1–5 (API) + 6–10 (web). §6 feature enforcement + cache invalidation → Tasks 3, 5. §8 owner auth (password + TOTP, platform audience) → Task 1. Content-override editor and events moderation are **Phase 3 / Phase 6** — intentionally NOT here.
- **Deferred to later phases:** owner editing a school's website content (Phase 3 builds the CMS; owner override reuses it), events moderation (Phase 6), custom-domain verification worker (returns when that module is rebuilt).
- **Assumptions to verify during execution:** `PlatformJwtGuard` admits `role: 'OWNER'` and reads the platform-audience secret; `PlatformJwtPayload.role` includes `'OWNER'`; the app's global guard honors `@Public()`; `use-api.ts` sends `X-Forwarded-Host` for the platform audience (it does — Phase 1 `api.ts` sets it from `hostHeader`).
- **Isolation note:** all owner endpoints use `getPlatformPrisma()` (BYPASSRLS) and are gated by `OwnerHostGuard` + `PlatformJwtGuard`; no tenant-scoped route gains access to the platform client.
