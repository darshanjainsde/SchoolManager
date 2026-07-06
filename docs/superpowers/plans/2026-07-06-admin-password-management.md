# School Admin Password Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the platform owner reset a school admin's password from the owner portal (shown once) and let the school admin change their own password, as a self-contained module that touches no existing auth/owner code and adds no DB migration.

**Architecture:** One new NestJS module `admin-credentials` holds two controllers — an owner-side controller (`GET /owner/schools/:id/admins`, `POST /owner/schools/:id/admins/:userId/reset-password`) and a school-admin-side controller (`POST /auth/change-password`). Both reuse the existing `PasswordService` (argon2) and `getPlatformPrisma()` (BYPASSRLS) and mutate only the existing `User` / `RefreshToken` tables. The web adds an `AdminAccessCard` on the owner school-detail page and an `/account/password` page for admins. The only edits to existing files are: register the module in `app.module.ts`, render the card on the school-detail page, and add one link on the profile page.

**Tech Stack:** NestJS 10, Prisma 5.13, argon2, jest + ts-jest (API); Next.js 14 App Router, @tanstack/react-query, react-hook-form + zod, sonner, zustand (web). pnpm workspace filters.

## Global Constraints

- **Local-tree corruption — stage by explicit path ONLY.** `apps/api/src` contains iCloud " 2" conflict-copy corruption. NEVER `git add -A`, `git add .`, or `git commit -a`. Every commit stages only the exact paths listed in that step.
- **No database schema/migration change.** Reuse `User` and `RefreshToken` tables only.
- **No edits to existing auth/owner logic.** Do not modify `auth.service.ts`, `auth.controller.ts`, `owner.controller.ts`, or `owner-schools.service.ts`. The only permitted edits to existing files are `apps/api/src/app.module.ts` (module registration), `apps/web/app/platform/schools/[id]/page.tsx` (render the card), and `apps/web/app/me/profile/page.tsx` (add a link).
- **IDOR guard is mandatory.** Owner endpoints run on the BYPASSRLS platform role. Every user lookup MUST be scoped `where { id: userId, schoolId, role: 'SCHOOL_ADMIN' }` (reset) / `where { schoolId, role: 'SCHOOL_ADMIN' }` (list) and 404 on mismatch.
- **Session revocation on every credential change.** Reset and change-password both revoke the target user's non-revoked refresh tokens.
- **Password rules:** generated reset password = `randomBytes(12).toString('base64url')`; admin-chosen `newPassword` min length 8 and must differ from current.
- **Never `git add -A`.** (Repeated because it is the highest-risk mistake here.)

---

## File Structure

**New (API):**
- `apps/api/src/modules/admin-credentials/index.ts` — module barrel export.
- `apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts` — the NestJS module.
- `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.ts` — owner-side: `listAdmins`, `resetPassword`.
- `apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts` — owner-side routes.
- `apps/api/src/modules/admin-credentials/internal/account.service.ts` — admin-side: `changePassword`.
- `apps/api/src/modules/admin-credentials/internal/account.controller.ts` — admin-side route.
- `apps/api/src/modules/admin-credentials/internal/dto.ts` — `ChangePasswordDto`.
- `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.spec.ts` — unit tests (owner side).
- `apps/api/src/modules/admin-credentials/internal/account.service.spec.ts` — unit tests (admin side).

**New (web):**
- `apps/web/components/admin-access-card.tsx` — owner "Admin access" card.
- `apps/web/app/account/password/page.tsx` — admin change-password page.

**Modified (additive only):**
- `apps/api/src/app.module.ts` — import + register `AdminCredentialsModule`.
- `apps/web/app/platform/schools/[id]/page.tsx` — import + render `<AdminAccessCard>`.
- `apps/web/app/me/profile/page.tsx` — add a link to `/account/password`.

---

### Task 1: Owner-side credential service + routes (view admins, reset password)

**Files:**
- Create: `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.ts`
- Create: `apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts`
- Create: `apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts`
- Create: `apps/api/src/modules/admin-credentials/index.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.spec.ts`

**Interfaces:**
- Consumes: `PasswordService` from `../../auth` (`hash(plain: string): Promise<string>`); `getPlatformPrisma()` from `@skoolos/db`; `OwnerHostGuard` from `../../owner/internal/owner-host.guard`; globally-provided `PlatformJwtGuard` from `../../../common/auth/platform-jwt.guard`.
- Produces: `AdminCredentialsService.listAdmins(schoolId: string): Promise<AdminRow[]>` where `AdminRow = { userId: string; email: string; isActive: boolean; lastLoginAt: Date | null; lockedUntil: Date | null }`; `AdminCredentialsService.resetPassword(schoolId: string, userId: string): Promise<{ password: string }>`. `AdminCredentialsModule` (registered in `AppModule`). Owner routes `GET /owner/schools/:id/admins` and `POST /owner/schools/:id/admins/:userId/reset-password`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.spec.ts`:

```ts
const mockDb = {
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => mockDb }));

import { AdminCredentialsService } from './admin-credentials.service';

describe('AdminCredentialsService', () => {
  const passwords = { hash: jest.fn().mockResolvedValue('HASH') } as any;
  const svc = new AdminCredentialsService(passwords);
  beforeEach(() => jest.clearAllMocks());

  it('resetPassword 404s and mutates nothing when user is not a SCHOOL_ADMIN of that school', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    await expect(svc.resetPassword('school-1', 'user-x')).rejects.toThrow(/not found/i);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-x', schoolId: 'school-1', role: 'SCHOOL_ADMIN' },
      select: { id: true },
    });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('resetPassword hashes a fresh password and revokes the user\'s sessions', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockDb.user.update.mockReturnValue('U');
    mockDb.refreshToken.updateMany.mockReturnValue('R');
    const res = await svc.resetPassword('school-1', 'user-1');
    expect(typeof res.password).toBe('string');
    expect(res.password.length).toBeGreaterThan(10);
    expect(passwords.hash).toHaveBeenCalledWith(res.password);
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'HASH', failedLoginAttempts: 0, lockedUntil: null },
    });
    expect(mockDb.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', schoolId: 'school-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it('listAdmins scopes to SCHOOL_ADMIN of the school and maps rows', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@x.test', isActive: true, lastLoginAt: null, lockedUntil: null },
    ]);
    const rows = await svc.listAdmins('school-1');
    expect(mockDb.user.findMany).toHaveBeenCalledWith({
      where: { schoolId: 'school-1', role: 'SCHOOL_ADMIN' },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, isActive: true, lastLoginAt: true, lockedUntil: true },
    });
    expect(rows).toEqual([
      { userId: 'u1', email: 'a@x.test', isActive: true, lastLoginAt: null, lockedUntil: null },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @skoolos/api exec jest admin-credentials.service`
Expected: FAIL — `Cannot find module './admin-credentials.service'`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/admin-credentials/internal/admin-credentials.service.ts`:

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { PasswordService } from '../../auth';

export interface AdminRow {
  userId: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
}

/**
 * Owner-side school-admin credential control. Runs on the BYPASSRLS platform
 * connection, so every lookup is explicitly scoped by schoolId + role — that
 * scoping is the only thing preventing an IDOR onto another school or an OWNER.
 */
@Injectable()
export class AdminCredentialsService {
  private readonly logger = new Logger(AdminCredentialsService.name);

  constructor(private readonly passwords: PasswordService) {}

  async listAdmins(schoolId: string): Promise<AdminRow[]> {
    const db = getPlatformPrisma();
    const users = await db.user.findMany({
      where: { schoolId, role: 'SCHOOL_ADMIN' },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, isActive: true, lastLoginAt: true, lockedUntil: true },
    });
    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
    }));
  }

  async resetPassword(schoolId: string, userId: string): Promise<{ password: string }> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({
      where: { id: userId, schoolId, role: 'SCHOOL_ADMIN' },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Admin not found for this school');

    const password = randomBytes(12).toString('base64url');
    const passwordHash = await this.passwords.hash(password);

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      db.refreshToken.updateMany({
        where: { userId: user.id, schoolId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log({ actor: 'owner', schoolId, targetUserId: user.id, action: 'admin.password.reset' });
    return { password };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @skoolos/api exec jest admin-credentials.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the controller, module, and barrel**

Create `apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { AdminCredentialsService } from './admin-credentials.service';

@ApiTags('owner')
@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class AdminCredentialsController {
  constructor(private readonly svc: AdminCredentialsService) {}

  @Get('schools/:id/admins')
  listAdmins(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listAdmins(id);
  }

  @Post('schools/:id/admins/:userId/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.svc.resetPassword(id, userId);
  }
}
```

Create `apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { AdminCredentialsService } from './admin-credentials.service';
import { AdminCredentialsController } from './admin-credentials.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminCredentialsController],
  providers: [AdminCredentialsService, OwnerHostGuard],
})
export class AdminCredentialsModule {}
```

Create `apps/api/src/modules/admin-credentials/index.ts`:

```ts
export { AdminCredentialsModule } from './internal/admin-credentials.module';
```

- [ ] **Step 6: Register the module in AppModule**

In `apps/api/src/app.module.ts`, add the import near the other module imports:

```ts
import { AdminCredentialsModule } from './modules/admin-credentials';
```

and add `AdminCredentialsModule` to the `imports` array, immediately after `OwnerModule,`:

```ts
    OwnerModule,
    AdminCredentialsModule,
```

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @skoolos/api build`
Expected: succeeds (tsc, no type errors).

- [ ] **Step 8: Commit (explicit paths only)**

```bash
git add apps/api/src/modules/admin-credentials/internal/admin-credentials.service.ts \
        apps/api/src/modules/admin-credentials/internal/admin-credentials.service.spec.ts \
        apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts \
        apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts \
        apps/api/src/modules/admin-credentials/index.ts \
        apps/api/src/app.module.ts
git commit -m "feat(api): owner-side school-admin password reset + admin listing"
```

---

### Task 2: Admin-side self-service change-password

**Files:**
- Create: `apps/api/src/modules/admin-credentials/internal/account.service.ts`
- Create: `apps/api/src/modules/admin-credentials/internal/account.controller.ts`
- Create: `apps/api/src/modules/admin-credentials/internal/dto.ts`
- Modify: `apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts`
- Test: `apps/api/src/modules/admin-credentials/internal/account.service.spec.ts`

**Interfaces:**
- Consumes: `PasswordService` (`hash`, `verify(hash, plain): Promise<boolean>`); `getPlatformPrisma()`; `TenantContextService.requireTenant(): { schoolId: string }` from `../../tenancy`; `SchoolJwtGuard` (global); `CurrentUser` decorator returning `{ sub: string }`.
- Produces: `AccountService.changePassword(schoolId: string, userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true }>`; route `POST /auth/change-password`; `ChangePasswordDto { currentPassword: string; newPassword: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/admin-credentials/internal/account.service.spec.ts`:

```ts
const mockDb = {
  user: { findFirst: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => mockDb }));

import { AccountService } from './account.service';

describe('AccountService.changePassword', () => {
  const passwords = { hash: jest.fn().mockResolvedValue('NEWHASH'), verify: jest.fn() } as any;
  const svc = new AccountService(passwords);
  beforeEach(() => jest.clearAllMocks());

  it('401s and mutates nothing when the current password is wrong', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: 'OLD' });
    passwords.verify.mockResolvedValue(false);
    await expect(svc.changePassword('s1', 'u1', 'wrong', 'brandnew1')).rejects.toThrow(/incorrect/i);
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('401s when the user is not found in this tenant', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    await expect(svc.changePassword('s1', 'u1', 'x', 'brandnew1')).rejects.toThrow(/invalid/i);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', schoolId: 's1' },
      select: { id: true, passwordHash: true },
    });
  });

  it('updates the hash and revokes sessions on success', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: 'OLD' });
    passwords.verify.mockResolvedValue(true);
    mockDb.user.update.mockReturnValue('U');
    mockDb.refreshToken.updateMany.mockReturnValue('R');
    const res = await svc.changePassword('s1', 'u1', 'current1', 'brandnew1');
    expect(res).toEqual({ ok: true });
    expect(passwords.hash).toHaveBeenCalledWith('brandnew1');
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'NEWHASH' },
    });
    expect(mockDb.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', schoolId: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @skoolos/api exec jest account.service`
Expected: FAIL — `Cannot find module './account.service'`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/admin-credentials/internal/account.service.ts`:

```ts
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { PasswordService } from '../../auth';

/**
 * Self-service password change for a logged-in school user. Requires the
 * current password, and revokes all of the user's sessions so the change
 * propagates everywhere.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly passwords: PasswordService) {}

  async changePassword(
    schoolId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    if (newPassword === currentPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash } }),
      db.refreshToken.updateMany({
        where: { userId: user.id, schoolId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.logger.log({ actor: userId, schoolId, action: 'admin.password.change' });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @skoolos/api exec jest account.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the DTO and controller**

Create `apps/api/src/modules/admin-credentials/internal/dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

Create `apps/api/src/modules/admin-credentials/internal/account.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { AccountService } from './account.service';
import { ChangePasswordDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: SchoolJwtPayload,
  ) {
    const ctx = this.tenantCtx.requireTenant();
    return this.account.changePassword(ctx.schoolId, user.sub, dto.currentPassword, dto.newPassword);
  }
}
```

- [ ] **Step 6: Register the admin-side pieces in the module**

In `apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts`, add imports and register the new controller + service:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { AdminCredentialsService } from './admin-credentials.service';
import { AdminCredentialsController } from './admin-credentials.controller';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminCredentialsController, AccountController],
  providers: [AdminCredentialsService, AccountService, OwnerHostGuard],
})
export class AdminCredentialsModule {}
```

- [ ] **Step 7: Typecheck the API**

Run: `pnpm --filter @skoolos/api build`
Expected: succeeds.

- [ ] **Step 8: Commit (explicit paths only)**

```bash
git add apps/api/src/modules/admin-credentials/internal/account.service.ts \
        apps/api/src/modules/admin-credentials/internal/account.service.spec.ts \
        apps/api/src/modules/admin-credentials/internal/account.controller.ts \
        apps/api/src/modules/admin-credentials/internal/dto.ts \
        apps/api/src/modules/admin-credentials/internal/admin-credentials.module.ts
git commit -m "feat(api): self-service change-password for school admins"
```

---

### Task 3: Owner portal "Admin access" card

**Files:**
- Create: `apps/web/components/admin-access-card.tsx`
- Modify: `apps/web/app/platform/schools/[id]/page.tsx`

**Interfaces:**
- Consumes: `useApi({ audience: 'platform', hostHeader: OWNER_HOST })`; `GET /owner/schools/:id/admins` → `AdminRow[]`; `POST /owner/schools/:id/admins/:userId/reset-password` → `{ password: string }`; UI `Card`, `Badge`, `Button`; `toast` from sonner; `OWNER_HOST` from `@/lib/hosts`; `useAuthStore`.
- Produces: `export function AdminAccessCard({ schoolId }: { schoolId: string })`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/admin-access-card.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

interface AdminRow {
  userId: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

export function AdminAccessCard({ schoolId }: { schoolId: string }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const [revealed, setRevealed] = useState<{ userId: string; password: string } | null>(null);

  const { data: admins, isLoading, error } = useQuery({
    queryKey: ['owner-school-admins', schoolId],
    queryFn: () => api.get<AdminRow[]>(`/owner/schools/${schoolId}/admins`),
    enabled: !!refreshToken,
  });

  const reset = useMutation({
    mutationFn: (userId: string) =>
      api.post<{ password: string }>(`/owner/schools/${schoolId}/admins/${userId}/reset-password`),
    onSuccess: (res, userId) => {
      setRevealed({ userId, password: res.password });
      toast.success('Password reset — copy it now, it is shown once');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin access</CardTitle>
        <CardDescription>Login email and password reset for this school&apos;s administrators.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}
        {admins && admins.length === 0 && <p className="text-sm text-slate-500">No admins found.</p>}
        <ul className="divide-y divide-slate-100">
          {admins?.map((a) => {
            const locked = a.lockedUntil ? new Date(a.lockedUntil) > new Date() : false;
            const resetting = reset.isPending && reset.variables === a.userId;
            return (
              <li key={a.userId} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="font-mono text-sm text-slate-800">{a.email}</span>
                    <span className="text-xs text-slate-400">
                      Last login: {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'never'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!a.isActive && <Badge tone="neutral">inactive</Badge>}
                    {locked && <Badge tone="warning">locked</Badge>}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reset.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Reset password for ${a.email}? Their current password stops working immediately.`,
                          )
                        ) {
                          reset.mutate(a.userId);
                        }
                      }}
                    >
                      {resetting ? 'Resetting…' : 'Reset password'}
                    </Button>
                  </div>
                </div>
                {revealed?.userId === a.userId && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-amber-800">New password — shown once</span>
                      <code className="font-mono text-sm text-amber-900">{revealed.password}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard?.writeText(revealed.password);
                          toast.success('Copied');
                        }}
                      >
                        Copy
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRevealed(null)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render the card on the school-detail page**

In `apps/web/app/platform/schools/[id]/page.tsx`, add the import after the existing component imports (e.g. after the `useAuthStore` import line):

```tsx
import { AdminAccessCard } from '@/components/admin-access-card';
```

Then render it in the JSX immediately before the `{/* Domains list ... */}` block (i.e. after the Feature-flags `</Card>` and before the domains section):

```tsx
      {/* Admin access ────────────────────────────────────────────────────── */}
      <AdminAccessCard schoolId={school.id} />

```

- [ ] **Step 3: Typecheck / build the web app**

Run: `pnpm --filter @skoolos/web build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Manually verify (owner portal)**

Start the app (or use the deployed preview). On `owner.finokaft.com/platform/schools/<id>`, confirm the "Admin access" card lists the admin email, "Reset password" prompts a confirm, and on confirm shows a one-time password with Copy/Dismiss. Reload → password is gone; the admin can log in with the new password at `<slug>.finokaft.com/login`.

- [ ] **Step 5: Commit (explicit paths only)**

```bash
git add apps/web/components/admin-access-card.tsx \
        "apps/web/app/platform/schools/[id]/page.tsx"
git commit -m "feat(web): owner Admin access card — view email + reset password"
```

---

### Task 4: Admin change-password page + profile link

**Files:**
- Create: `apps/web/app/account/password/page.tsx`
- Modify: `apps/web/app/me/profile/page.tsx`

**Interfaces:**
- Consumes: `useApi({ audience: 'school', hostHeader: host })`; `POST /auth/change-password { currentPassword, newPassword }`; `useHost()`; `useAuthStore().clear`; `Card`, `Input`, `Label`, `Button`; react-hook-form + zod; `toast`.
- Produces: page at route `/account/password`; a link to it on `/me/profile`.

- [ ] **Step 1: Write the change-password page**

Create `apps/web/app/account/password/page.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/use-api';
import { useAuthStore } from '@/lib/auth-store';
import { useHost } from '@/components/use-host';

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string().min(8),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different',
  });
type FormValues = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const router = useRouter();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const clear = useAuthStore((s) => s.clear);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues) {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password changed — please sign in again');
      clear();
      router.replace('/login');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold text-slate-900">Change password</h1></header>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Update your password</CardTitle>
          <CardDescription>You&apos;ll be signed out of all devices and asked to sign in again.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div>
              <Label htmlFor="currentPassword" required>Current password</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              {form.formState.errors.currentPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.currentPassword.message}</p>}
            </div>
            <div>
              <Label htmlFor="newPassword" required>New password</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
              {form.formState.errors.newPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.newPassword.message}</p>}
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>Confirm new password</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
              {form.formState.errors.confirmPassword && <p className="mt-1 text-xs text-rose-600">{form.formState.errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add a link on the profile page**

In `apps/web/app/me/profile/page.tsx`, add the import at the top:

```tsx
import Link from 'next/link';
```

Then add this block immediately after the closing `</Card>` (before the closing `</div>`):

```tsx
      <Link href="/account/password" className="text-sm text-indigo-600 hover:underline">
        Change password →
      </Link>
```

- [ ] **Step 3: Typecheck / build the web app**

Run: `pnpm --filter @skoolos/web build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Manually verify (admin portal)**

On `<slug>.finokaft.com/me/profile`, click "Change password →". Submit with a wrong current password → error toast, no change. Submit with correct current + a new 8+ char password → success toast, redirected to `/login`, and the new password works while the old one is rejected.

- [ ] **Step 5: Commit (explicit paths only)**

```bash
git add apps/web/app/account/password/page.tsx \
        apps/web/app/me/profile/page.tsx
git commit -m "feat(web): school-admin self-service change-password page + profile link"
```

---

## Self-Review

**1. Spec coverage:**
- View admin login email + status → Task 1 `listAdmins` + Task 3 card. ✅
- Reset password shown once → Task 1 `resetPassword` + Task 3 reveal box. ✅
- Unlock account + revoke sessions on reset → Task 1 (`failedLoginAttempts:0, lockedUntil:null`, `refreshToken.updateMany`). ✅
- Self-service change password → Task 2 + Task 4. ✅
- Sign out everywhere + redirect to /login after change → Task 2 revoke + Task 4 `clear()` + `router.replace('/login')`. ✅
- Standalone module, no schema change, minimal additive edits → new `admin-credentials` module; only `app.module.ts`, school-detail page, profile page edited. ✅
- IDOR guard → Task 1 `where { id, schoolId, role:'SCHOOL_ADMIN' }` (tested). ✅
- Current-password required on change → Task 2 `verify` (tested). ✅
- Rate limit on change-password → Task 2 `@Throttle({ limit: 5 })`. ✅
- Audit log lines → Task 1 & 2 `logger.log({... action })`. ✅
- One-time password not logged → pino `autoLogging` logs no bodies + redacts auth headers (verified in `app.module.ts`); response body carries the password. ✅

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands. ✅

**3. Type consistency:** `AdminRow` fields (`userId,email,isActive,lastLoginAt,lockedUntil`) match between service, spec, controller response, and web `AdminRow` interface (web types dates as `string` over JSON — intentional). `resetPassword` returns `{ password }` consumed as `{ password: string }` in the card. `changePassword` returns `{ ok: true }`. Route strings match between controller and web callers (`/owner/schools/:id/admins`, `/owner/schools/:id/admins/:userId/reset-password`, `/auth/change-password`). ✅

## Notes for the implementer
- Run all commands from the repo root: `/Users/darshanjain/Documents/SchoolManager/SchoolManager`.
- If `pnpm --filter @skoolos/api exec jest <pattern>` needs the Prisma client, run `pnpm --filter @skoolos/db generate` once first.
- Do NOT touch any `"… 2.ts"` conflict-copy files; stage only the exact paths in each commit step.
