# Library Service — Phase 0a: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data and security spine of the library microservice — its own Prisma package, its own Postgres schema with fail-closed row-level security, org resolution, auth, and the plan/quota entitlement engine — so that Phase 1 can add features without ever revisiting tenancy or isolation.

**Architecture:** A new `@library/db` package owns a Prisma schema that generates into its **own client directory** and connects with `?schema=library`, so its migration history and tables are invisible to `@skoolos/db`. A new `apps/library-api` NestJS app mirrors `apps/api`'s module conventions (public `index.ts`, everything else in `internal/`, enforced by dependency-cruiser). Every tenant query runs through `withOrg()`, which opens a transaction and sets a transaction-scoped GUC that Postgres RLS policies read — so pgbouncer connection reuse can never leak a tenant.

**Tech Stack:** TypeScript 5.4, NestJS 10.3 (matching `apps/api`), Prisma 5.13, PostgreSQL 17 (Supabase, ap-south-1), ioredis + Upstash, argon2, Jest 29 + ts-jest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-08-library-service-design.md`

## Global Constraints

- **Zero imports from Sckools code.** `apps/library-api` and `packages/library-db` must never import `@skoolos/db`, `@skoolos/config`, `@skoolos/types`, or anything under `apps/api/`. This is enforced by a dependency-cruiser rule in Task 12.
- **Prisma client output is `../generated/client`.** Two Prisma schemas in one repo both defaulting to `node_modules/.prisma/client` overwrite each other. The library generator MUST set an explicit `output`.
- **Every pooled connection URL carries `?schema=library&pgbouncer=true&connection_limit=1`.** Runtime uses the transaction pooler `:6543`; migrations use the session pooler `:5432`.
- **Region `bom1`** in every `vercel.json`.
- **Every table with an `orgId` column gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and at least one policy.** The only allow-listed exceptions are `RefreshToken`, `PasswordResetToken`, `RegistrationToken` (hash-keyed, single-use). Task 3 enforces this with a test.
- **No state transition is ever performed by a scheduler.** `OVERDUE` / `EXPIRING` / `EXPIRED` are computed at read time, never stored. No enum in this plan may contain them.
- **Nothing in process memory.** No in-memory caches, counters, locks, or rate-limit state. Redis or Postgres only.
- **NestJS dependency versions are copied verbatim from `apps/api/package.json`** (`@nestjs/common ^10.3.7` etc.), not the latest available. The spec text says "NestJS 11"; the repo runs 10.3 and the repo wins.
- **Commit after every task.** Never `git add -A` — this repo's sibling checkout accumulates iCloud ` 2` conflict copies. Always `git add` explicit paths.
- **Work in `/Users/darshanjain/skoolos-library`** on branch `feat/library-service`.

---

### Task 1: `@library/db` package scaffold and the `withOrg` tenancy wrapper

**Files:**
- Create: `packages/library-db/package.json`
- Create: `packages/library-db/tsconfig.json`
- Create: `packages/library-db/prisma/schema.prisma`
- Create: `packages/library-db/src/index.ts`
- Create: `packages/library-db/jest.config.js`
- Test: `packages/library-db/src/with-org.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `getLibraryTenantPrisma(): PrismaClient` — RLS-bound client
  - `getLibraryPlatformPrisma(): PrismaClient` — BYPASSRLS client
  - `withOrg<T>(orgId: string, fn: (tx: LibraryTx) => Promise<T>, client?: PrismaClient): Promise<T>`
  - `type LibraryTx = Prisma.TransactionClient`
  - `disconnectLibrary(): Promise<void>`

- [ ] **Step 1: Create the package manifest**

`packages/library-db/package.json`:

```json
{
  "name": "@library/db",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "migrate:status": "prisma migrate status",
    "seed": "tsx prisma/seed.ts",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json || true",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "@prisma/client": "^5.13.0",
    "prisma": "^5.13.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.30",
    "argon2": "^0.40.1",
    "jest": "^29.7.0",
    "pg": "^8.11.5",
    "ts-jest": "^29.1.2",
    "tsx": "^4.7.2",
    "typescript": "^5.4.5"
  }
}
```

`packages/library-db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*.ts", "prisma/**/*.ts"],
  "exclude": ["node_modules", "dist", "generated"]
}
```

`packages/library-db/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.spec\\.ts$'],
};
```

- [ ] **Step 2: Create the Prisma schema skeleton**

`packages/library-db/prisma/schema.prisma`. Note `output` — without it this client overwrites `@skoolos/db`'s.

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../generated/client"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}

datasource db {
  provider  = "postgresql"
  url       = env("LIBRARY_DATABASE_URL")
  directUrl = env("LIBRARY_DIRECT_URL")
}
```

- [ ] **Step 3: Write the failing test**

`packages/library-db/src/with-org.spec.ts`:

```ts
import { withOrg } from './index';

const ORG = '11111111-1111-4111-8111-111111111111';

function fakeClient(captured: string[]) {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRawUnsafe: async (sql: string) => { captured.push(sql); return 0; } }),
  } as never;
}

describe('withOrg', () => {
  it('rejects a non-UUID org id before touching the database', async () => {
    const captured: string[] = [];
    await expect(
      withOrg("' OR 1=1 --", async () => 'never', fakeClient(captured)),
    ).rejects.toThrow('withOrg: orgId must be a UUID');
    expect(captured).toHaveLength(0);
  });

  it('sets the transaction-scoped GUC before running the callback', async () => {
    const captured: string[] = [];
    const result = await withOrg(ORG, async () => 'ok', fakeClient(captured));
    expect(result).toBe('ok');
    expect(captured).toEqual([`SET LOCAL app.current_org = '${ORG}'`]);
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

```bash
cd /Users/darshanjain/skoolos-library
pnpm install
pnpm --filter @library/db exec jest src/with-org.spec.ts
```

Expected: FAIL — `Cannot find module './index'` or `withOrg is not a function`.

- [ ] **Step 5: Write the implementation**

`packages/library-db/src/index.ts`:

```ts
import { Prisma, PrismaClient } from '../generated/client';

export type LibraryTx = Prisma.TransactionClient;

/**
 * Two clients, mirroring the Sckools split:
 *   library_app      — non-superuser, RLS-bound. Every request path.
 *   library_platform — BYPASSRLS. Login, host lookup, org console, crons only,
 *                      each re-scoping by orgId in code.
 * Migrations run as the superuser via LIBRARY_DIRECT_URL.
 */
let tenantClient: PrismaClient | undefined;
let platformClient: PrismaClient | undefined;

function makeClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export function getLibraryTenantPrisma(): PrismaClient {
  if (!tenantClient) {
    const url = process.env.LIBRARY_DATABASE_URL_APP ?? process.env.LIBRARY_DATABASE_URL;
    if (!url) throw new Error('LIBRARY_DATABASE_URL_APP (or LIBRARY_DATABASE_URL) must be set');
    tenantClient = makeClient(url);
  }
  return tenantClient;
}

export function getLibraryPlatformPrisma(): PrismaClient {
  if (!platformClient) {
    const url = process.env.LIBRARY_DATABASE_URL_PLATFORM ?? process.env.LIBRARY_DATABASE_URL;
    if (!url) throw new Error('LIBRARY_DATABASE_URL_PLATFORM (or LIBRARY_DATABASE_URL) must be set');
    platformClient = makeClient(url);
  }
  return platformClient;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Run `fn` inside a transaction with `SET LOCAL app.current_org` set, so RLS
 * policies grant access to exactly that org's rows.
 *
 * SET LOCAL is transaction-scoped, which is why the transaction wrapper is
 * mandatory rather than stylistic: pgbouncer reuses server connections between
 * clients, and a session-scoped SET would leak the previous tenant's id.
 *
 * `orgId` is untrusted input → UUID-validated before interpolation.
 */
export async function withOrg<T>(
  orgId: string,
  fn: (tx: LibraryTx) => Promise<T>,
  client: PrismaClient = getLibraryTenantPrisma(),
): Promise<T> {
  if (!UUID_RE.test(orgId)) throw new Error('withOrg: orgId must be a UUID');
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org = '${orgId}'`);
    return fn(tx);
  });
}

export async function disconnectLibrary(): Promise<void> {
  await Promise.all([tenantClient?.$disconnect(), platformClient?.$disconnect()]);
  tenantClient = undefined;
  platformClient = undefined;
}

export { PrismaClient, Prisma } from '../generated/client';
export * from '../generated/client';
```

- [ ] **Step 6: Run the test and verify it passes**

```bash
pnpm --filter @library/db exec jest src/with-org.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/library-db/package.json packages/library-db/tsconfig.json \
        packages/library-db/jest.config.js packages/library-db/prisma/schema.prisma \
        packages/library-db/src/index.ts packages/library-db/src/with-org.spec.ts pnpm-lock.yaml
git commit -m "feat(library-db): package scaffold and the withOrg tenancy wrapper"
```

---

### Task 2: Identity and org models, and the first migration

**Files:**
- Modify: `packages/library-db/prisma/schema.prisma`
- Create: `packages/library-db/prisma/migrations/<timestamp>_init_identity/migration.sql` (generated)
- Test: `packages/library-db/src/schema-shape.spec.ts`

**Interfaces:**
- Consumes: `withOrg`, `getLibraryTenantPrisma` from Task 1.
- Produces: Prisma models `LibraryOrg`, `LibraryDomain`, `OrgTheme`, `Branch`, `LibUser`, `Member`, `RefreshToken`, `AuditLog`, `IdempotencyKey`, `PlanOverride`; enums `Plan`, `OrgStatus`, `LibDomainType`, `LibDomainStatus`, `LibRole`, `MemberType`, `MemberStatus`.

- [ ] **Step 1: Append the enums and models to the schema**

Append to `packages/library-db/prisma/schema.prisma`:

```prisma
enum Plan {
  FREE
  MINI
  PRO
}

enum OrgStatus {
  SETUP
  LIVE
  SUSPENDED
}

enum LibDomainType {
  SUBDOMAIN
  CUSTOM
}

enum LibDomainStatus {
  PENDING
  LIVE
  ERROR
}

/// Library logins. MemberType drives circulation policy and is deliberately a
/// separate axis — a TEACHER member has no administrative reach.
enum LibRole {
  ORG_OWNER
  LIBRARIAN
  ASSISTANT
  MEMBER
}

enum MemberType {
  STUDENT
  TEACHER
  EXTERNAL
}

enum MemberStatus {
  PENDING
  ACTIVE
  SUSPENDED
  EXPIRED
}

model LibraryOrg {
  id           String    @id @default(uuid()) @db.Uuid
  slug         String    @unique
  name         String
  plan         Plan      @default(FREE)
  status       OrgStatus @default(SETUP)
  currency     String    @default("INR")
  timezone     String    @default("Asia/Kolkata")
  locale       String    @default("en-IN")
  contactEmail String?
  contactPhone String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  domains   LibraryDomain[]
  theme     OrgTheme?
  branches  Branch[]
  users     LibUser[]
  members   Member[]
  overrides PlanOverride[]
}

model LibraryDomain {
  id        String          @id @default(uuid()) @db.Uuid
  orgId     String          @db.Uuid
  hostname  String          @unique
  type      LibDomainType   @default(SUBDOMAIN)
  status    LibDomainStatus @default(PENDING)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  org LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
}

model OrgTheme {
  id               String   @id @default(uuid()) @db.Uuid
  orgId            String   @unique @db.Uuid
  logoUrl          String?
  primaryColor     String   @default("#2E3A87")
  accentColor      String   @default("#8F671D")
  receiptHeader    String?
  receiptFooter    String?
  /// Per-org display labels for the fixed MemberType enum, e.g.
  /// {"EXTERNAL":"Alumni"}. The enum stays fixed because CirculationPolicy is
  /// keyed on it; only the label is configurable.
  memberTypeLabels Json     @default("{}")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  org LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
}

model PlanOverride {
  id      String  @id @default(uuid()) @db.Uuid
  orgId   String  @db.Uuid
  key     String
  enabled Boolean

  org LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, key])
  @@index([orgId])
}

model Branch {
  id        String   @id @default(uuid()) @db.Uuid
  orgId     String   @db.Uuid
  name      String
  code      String
  address   String?
  phone     String?
  openTime  String?
  closeTime String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  org     LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  members Member[]

  @@unique([orgId, code])
  @@index([orgId])
}

model LibUser {
  id             String    @id @default(uuid()) @db.Uuid
  orgId          String    @db.Uuid
  email          String?
  phone          String?
  passwordHash   String
  role           LibRole
  branchIds      String[]  @db.Uuid
  memberId       String?   @unique @db.Uuid
  active         Boolean   @default(true)
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?
  lastLoginAt    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  org      LibraryOrg     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  member   Member?        @relation(fields: [memberId], references: [id], onDelete: SetNull)
  refresh  RefreshToken[]

  @@unique([orgId, email])
  @@unique([orgId, phone])
  @@index([orgId])
}

model Member {
  id           String       @id @default(uuid()) @db.Uuid
  orgId        String       @db.Uuid
  homeBranchId String?      @db.Uuid
  code         String
  memberType   MemberType   @default(STUDENT)
  firstName    String
  lastName     String
  phone        String?
  email        String?
  photoUrl     String?
  address      String?
  customFields Json         @default("{}")
  status       MemberStatus @default(PENDING)
  joinedAt     DateTime     @default(now())
  /// Holds the Sckools Student.id / Teacher.id when the services merge.
  /// Present from the first migration so the merge needs no schema change.
  externalRef  String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  org        LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  homeBranch Branch?    @relation(fields: [homeBranchId], references: [id], onDelete: SetNull)
  login      LibUser?

  @@unique([orgId, code])
  @@index([orgId, status])
  @@index([orgId, externalRef])
}

/// Hash-keyed and single-use. Deliberately has no RLS policy — see the
/// allow-list in the RLS coverage audit (Task 3).
model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @db.Uuid
  tokenHash String    @unique
  familyId  String    @db.Uuid
  revokedAt DateTime?
  expiresAt DateTime
  createdAt DateTime  @default(now())

  user LibUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @db.Uuid
  actorUserId String?  @db.Uuid
  action      String
  entity      String
  entityId    String?
  before      Json?
  after       Json?
  ip          String?
  at          DateTime @default(now())

  @@index([orgId, at])
}

model IdempotencyKey {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @db.Uuid
  key            String
  endpoint       String
  requestHash    String
  responseStatus Int
  responseBody   Json
  createdAt      DateTime @default(now())

  @@unique([orgId, key])
  @@index([createdAt])
}
```

- [ ] **Step 2: Write the failing test**

`packages/library-db/src/schema-shape.spec.ts`. This is a guard test — it reads the schema file as text, so it needs no database and runs in CI on every push. It pins the invariants a future edit could silently break.

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

describe('library schema invariants', () => {
  it('generates into its own client directory, never the shared default', () => {
    expect(schema).toMatch(/output\s*=\s*"\.\.\/generated\/client"/);
  });

  it('never stores a time-derived status the way a scheduler would need', () => {
    // OVERDUE / EXPIRING / EXPIRED are computed at read time from dueAt /
    // endDate. Storing them would require a cron to flip them, and Vercel Hobby
    // allows daily crons only — a missed run would then corrupt state.
    for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
      expect(schema).not.toContain(`\n  ${forbidden}\n`);
    }
  });

  it('keeps Member.externalRef so the Sckools merge needs no migration', () => {
    expect(schema).toMatch(/externalRef\s+String\?/);
  });

  it('keeps LibUser and Member as separate tables', () => {
    expect(schema).toMatch(/^model LibUser \{/m);
    expect(schema).toMatch(/^model Member \{/m);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm --filter @library/db exec jest src/schema-shape.spec.ts
```

Expected: FAIL on the `MemberStatus` enum containing `EXPIRED` — because the enum written in Step 1 does contain it.

- [ ] **Step 4: Fix the real problem the test found**

`MemberStatus.EXPIRED` is exactly the anti-pattern the constraint forbids: a membership that "expires" because a date passed needs a cron to flip it. Replace it with a stored end date and compute the state.

In `packages/library-db/prisma/schema.prisma`, change the enum and add the column:

```prisma
enum MemberStatus {
  PENDING
  ACTIVE
  SUSPENDED
}
```

and in `model Member`, add below `status`:

```prisma
  /// null = no expiry. Membership expiry is computed from this at read time,
  /// never stored as a status — see the no-scheduler rule in the spec (§6.3).
  membershipEndsAt DateTime?
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
pnpm --filter @library/db exec jest src/schema-shape.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Generate the client and the migration**

Requires `LIBRARY_DIRECT_URL` in the root `.env` pointing at the session pooler with `?schema=library`.

```bash
pnpm --filter @library/db exec prisma generate
pnpm --filter @library/db exec prisma migrate dev --name init_identity --create-only
```

Open the generated `migration.sql` and confirm every `CREATE TABLE` is unqualified (Prisma scopes it via the connection's `?schema=library`). If any table is written as `public."X"`, the URL is missing `?schema=library` — fix the URL, delete the migration folder, and regenerate.

- [ ] **Step 7: Apply it and verify**

```bash
pnpm --filter @library/db exec prisma migrate deploy
pnpm --filter @library/db exec prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 8: Commit**

```bash
git add packages/library-db/prisma/schema.prisma \
        packages/library-db/prisma/migrations \
        packages/library-db/src/schema-shape.spec.ts
git commit -m "feat(library-db): identity and org models with the first migration"
```

---

### Task 3: Row-level security and the coverage audit

**Files:**
- Create: `packages/library-db/prisma/migrations/<timestamp>_rls_identity/migration.sql` (hand-written)
- Create: `packages/library-db/src/rls-audit.ts`
- Test: `packages/library-db/src/rls-audit.spec.ts`

**Interfaces:**
- Consumes: `getLibraryPlatformPrisma` from Task 1; the tables from Task 2.
- Produces: `auditRlsCoverage(client): Promise<RlsAuditResult>` where
  `RlsAuditResult = { ok: boolean; unprotected: string[]; allowListed: string[] }`.
  The testboard's non-functional panel calls this exact function (Plan B, Task 6).

- [ ] **Step 1: Write the RLS migration by hand**

Prisma does not generate RLS. Create `packages/library-db/prisma/migrations/20260809120000_rls_identity/migration.sql`:

```sql
-- Fail-closed tenancy. current_setting(..., true) returns NULL when the GUC is
-- unset, so an unscoped query compares orgId = NULL, which is never true, and
-- returns zero rows rather than every row.

-- LibraryOrg is keyed by id, not orgId.
ALTER TABLE "LibraryOrg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryOrg" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "LibraryOrg"
  USING ("id" = current_setting('app.current_org', true)::uuid)
  WITH CHECK ("id" = current_setting('app.current_org', true)::uuid);

-- Every other tenant table is keyed by orgId.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'LibraryDomain','OrgTheme','PlanOverride','Branch','LibUser','Member',
    'AuditLog','IdempotencyKey'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = current_setting(''app.current_org'', true)::uuid) '
      'WITH CHECK ("orgId" = current_setting(''app.current_org'', true)::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
```

- [ ] **Step 2: Write the failing test**

`packages/library-db/src/rls-audit.spec.ts`. It runs against a real database, so it is skipped when `LIBRARY_DATABASE_URL_PLATFORM` is absent — that keeps `pnpm test` green on a laptop with no credentials while still gating CI, where the variable is set.

```ts
import { auditRlsCoverage } from './rls-audit';
import { getLibraryPlatformPrisma, disconnectLibrary } from './index';

const live = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM);
const describeLive = live ? describe : describe.skip;

describeLive('RLS coverage audit', () => {
  afterAll(async () => { await disconnectLibrary(); });

  it('reports every orgId-bearing table as forced and policied', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.unprotected).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('allow-lists exactly the three hash-keyed token tables', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.allowListed.sort()).toEqual(
      ['PasswordResetToken', 'RefreshToken', 'RegistrationToken'].sort(),
    );
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm --filter @library/db exec jest src/rls-audit.spec.ts
```

Expected: FAIL — `Cannot find module './rls-audit'`.

- [ ] **Step 4: Write the implementation**

`packages/library-db/src/rls-audit.ts`:

```ts
import type { PrismaClient } from '../generated/client';

/**
 * Tables that legitimately carry no RLS policy. Each is keyed by a hash of a
 * single-use secret, so possession of the token IS the authorisation and there
 * is no tenant column to scope by. Adding a fourth entry requires editing this
 * list, which is visible in review — that is the point.
 */
export const RLS_ALLOW_LIST = ['RefreshToken', 'PasswordResetToken', 'RegistrationToken'];

export interface RlsAuditResult {
  ok: boolean;
  /** Tables with an orgId column that are missing FORCE RLS or a policy. */
  unprotected: string[];
  allowListed: string[];
}

export async function auditRlsCoverage(client: PrismaClient): Promise<RlsAuditResult> {
  const rows = await client.$queryRawUnsafe<{ relname: string }[]>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'library'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'library'
          AND col.table_name = c.relname
          AND col.column_name IN ('orgId', 'id')
          AND (col.column_name = 'orgId' OR c.relname = 'LibraryOrg')
      )
      AND NOT (
        c.relrowsecurity
        AND c.relforcerowsecurity
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
      )
    ORDER BY c.relname
  `);

  const unprotected = rows
    .map((r) => r.relname)
    .filter((name) => !RLS_ALLOW_LIST.includes(name));

  return { ok: unprotected.length === 0, unprotected, allowListed: RLS_ALLOW_LIST };
}
```

- [ ] **Step 5: Apply the migration and run the test**

```bash
pnpm --filter @library/db exec prisma migrate deploy
pnpm --filter @library/db exec jest src/rls-audit.spec.ts
```

Expected: PASS, 2 tests. If `unprotected` is non-empty, the migration missed a table — add it to the `ARRAY[...]` list and write a follow-up migration rather than editing the applied one.

- [ ] **Step 6: Commit**

```bash
git add packages/library-db/prisma/migrations packages/library-db/src/rls-audit.ts \
        packages/library-db/src/rls-audit.spec.ts
git commit -m "feat(library-db): forced RLS on every tenant table plus the coverage audit"
```

---

### Task 4: `apps/library-api` scaffold with env config and health endpoints

**Files:**
- Create: `apps/library-api/package.json`, `tsconfig.json`, `jest.config.js`, `vercel.json`, `server.ts`
- Create: `apps/library-api/src/main.ts`, `src/app.module.ts`, `src/configure-app.ts`
- Create: `apps/library-api/src/config/env.ts`
- Create: `apps/library-api/src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `apps/library-api/test/env.setup.js`
- Test: `apps/library-api/src/config/env.spec.ts`, `apps/library-api/src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: `getLibraryTenantPrisma`, `disconnectLibrary` from Task 1.
- Produces:
  - `loadLibraryEnv(): LibraryEnv` — validated env, throws on missing required keys
  - `GET /live` → `{ status: 'ok' }`
  - `GET /ready` → `{ status: 'ok' | 'degraded', db: 'ok' | 'error', redis: 'ok' | 'error' }`

The library gets its own env module rather than reusing `@skoolos/config`, whose zod schema requires `S3_ENDPOINT`, `SMTP_*` and other keys the library does not have — importing it would make the library refuse to boot without Sckools' secrets.

- [ ] **Step 1: Create the package manifest**

`apps/library-api/package.json`. Versions copied verbatim from `apps/api/package.json`.

```json
{
  "name": "@library/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "bundle": "ncc build server.ts -o api --external argon2 --external @prisma/client",
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "@library/db": "workspace:*",
    "@nestjs/common": "^10.3.7",
    "@nestjs/core": "^10.3.7",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/platform-express": "^10.3.7",
    "@nestjs/throttler": "^5.1.2",
    "@prisma/client": "^5.13.0",
    "@vercel/ncc": "^0.38.3",
    "argon2": "^0.40.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "ioredis": "^5.4.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.7",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.11.30",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.2",
    "tsx": "^4.7.2",
    "typescript": "^5.4.5"
  }
}
```

`apps/library-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  },
  "include": ["src/**/*.ts", "server.ts"],
  "exclude": ["node_modules", "dist", "api"]
}
```

`apps/library-api/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  setupFiles: ['<rootDir>/../test/env.setup.js'],
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@library/db$': '<rootDir>/../../../packages/library-db/src',
  },
};
```

`apps/library-api/test/env.setup.js` — runs before the module registry loads, so modules calling `loadLibraryEnv()` at import time find a valid fake environment:

```js
process.env.NODE_ENV = 'test';
process.env.LIBRARY_DATABASE_URL_APP ||= 'postgresql://u:p@localhost:5432/db?schema=library';
process.env.LIBRARY_DATABASE_URL_PLATFORM ||= 'postgresql://u:p@localhost:5432/db?schema=library';
process.env.LIBRARY_REDIS_URL ||= 'redis://localhost:6379';
process.env.LIBRARY_JWT_SECRET ||= 'test-jwt-secret-at-least-32-characters-long';
process.env.LIBRARY_REFRESH_SECRET ||= 'test-refresh-secret-at-least-32-chars-ok';
process.env.LIBRARY_PLATFORM_HOST ||= 'library.trackyour.in';
```

`apps/library-api/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["bom1"],
  "installCommand": "cd ../.. && NODE_ENV=development pnpm install --frozen-lockfile=false && pnpm --filter @library/db generate",
  "buildCommand": "pnpm run bundle",
  "functions": { "api/index.js": { "maxDuration": 60 } },
  "routes": [{ "src": "/(.*)", "dest": "/api/index.js" }],
  "crons": [{ "path": "/internal/cron/notification-outbox", "schedule": "0 2 * * *" }]
}
```

> Only daily crons. A sub-daily schedule is rejected by Vercel Hobby and **fails the entire deployment**.

- [ ] **Step 2: Write the failing env test**

`apps/library-api/src/config/env.spec.ts`:

```ts
import { loadLibraryEnv } from './env';

describe('loadLibraryEnv', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('accepts the test environment', () => {
    const env = loadLibraryEnv();
    expect(env.LIBRARY_PLATFORM_HOST).toBe('library.trackyour.in');
    expect(env.NODE_ENV).toBe('test');
  });

  it('refuses to boot without a database url', () => {
    delete process.env.LIBRARY_DATABASE_URL_APP;
    delete process.env.LIBRARY_DATABASE_URL;
    expect(() => loadLibraryEnv({ force: true })).toThrow(/LIBRARY_DATABASE_URL_APP/);
  });

  it('refuses a jwt secret shorter than 32 characters', () => {
    process.env.LIBRARY_JWT_SECRET = 'too-short';
    expect(() => loadLibraryEnv({ force: true })).toThrow(/LIBRARY_JWT_SECRET/);
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

```bash
pnpm install
pnpm --filter @library/api exec jest src/config/env.spec.ts
```

Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 4: Write the env module**

`apps/library-api/src/config/env.ts`:

```ts
import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function loadRootDotenv(start: string = process.cwd()): void {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) { loadDotenv({ path: candidate, override: false }); return; }
    const parent = resolve(dir, '..');
    if (parent === dir) return;
    dir = parent;
  }
}
loadRootDotenv();

const pg = z.string().startsWith('postgres');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LIBRARY_API_PORT: z.coerce.number().int().positive().default(3101),

  LIBRARY_DATABASE_URL_APP: pg,
  LIBRARY_DATABASE_URL_PLATFORM: pg,
  LIBRARY_REDIS_URL: z.string().startsWith('redis'),

  LIBRARY_JWT_SECRET: z.string().min(32),
  LIBRARY_REFRESH_SECRET: z.string().min(32),
  LIBRARY_ACCESS_TTL: z.string().default('15m'),
  LIBRARY_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  LIBRARY_PLATFORM_HOST: z.string().min(1),
  CRON_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

export type LibraryEnv = z.infer<typeof schema>;

let cached: LibraryEnv | undefined;

export function loadLibraryEnv(opts: { force?: boolean } = {}): LibraryEnv {
  if (cached && !opts.force) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid library environment: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}
```

- [ ] **Step 5: Run it and verify it passes**

```bash
pnpm --filter @library/api exec jest src/config/env.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing health test**

`apps/library-api/src/health/health.controller.spec.ts`:

```ts
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('/live never touches a dependency', async () => {
    const controller = new HealthController(
      async () => { throw new Error('db down'); },
      async () => { throw new Error('redis down'); },
    );
    expect(await controller.live()).toEqual({ status: 'ok' });
  });

  it('/ready reports ok when both dependencies answer', async () => {
    const controller = new HealthController(async () => {}, async () => {});
    expect(await controller.ready()).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('/ready degrades rather than throwing when redis is down', async () => {
    const controller = new HealthController(async () => {}, async () => { throw new Error('x'); });
    expect(await controller.ready()).toEqual({ status: 'degraded', db: 'ok', redis: 'error' });
  });
});
```

- [ ] **Step 7: Run it and verify it fails**

```bash
pnpm --filter @library/api exec jest src/health/health.controller.spec.ts
```

Expected: FAIL — `Cannot find module './health.controller'`.

- [ ] **Step 8: Write the health controller and module**

`apps/library-api/src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject } from '@nestjs/common';

export const DB_PROBE = 'DB_PROBE';
export const REDIS_PROBE = 'REDIS_PROBE';

export type Probe = () => Promise<void>;

@Controller()
export class HealthController {
  constructor(
    @Inject(DB_PROBE) private readonly dbProbe: Probe,
    @Inject(REDIS_PROBE) private readonly redisProbe: Probe,
  ) {}

  /** Liveness must never depend on anything external, or a Redis blip restarts the app. */
  @Get('live')
  async live(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; db: string; redis: string }> {
    const [db, redis] = await Promise.all([
      this.dbProbe().then(() => 'ok').catch(() => 'error'),
      this.redisProbe().then(() => 'ok').catch(() => 'error'),
    ]);
    return { status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded', db, redis };
  }
}
```

`apps/library-api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { getLibraryTenantPrisma } from '@library/db';
import { loadLibraryEnv } from '../config/env';
import { DB_PROBE, HealthController, REDIS_PROBE, type Probe } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DB_PROBE,
      useFactory: (): Probe => async () => { await getLibraryTenantPrisma().$queryRawUnsafe('SELECT 1'); },
    },
    {
      provide: REDIS_PROBE,
      useFactory: (): Probe => {
        const redis = new Redis(loadLibraryEnv().LIBRARY_REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
        });
        return async () => {
          if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
          await redis.ping();
        };
      },
    },
  ],
})
export class HealthModule {}
```

- [ ] **Step 9: Write the app bootstrap**

`apps/library-api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

@Module({ imports: [HealthModule] })
export class AppModule {}
```

`apps/library-api/src/configure-app.ts`:

```ts
import { ValidationPipe, type INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.set?.('trust proxy', 1);
}
```

`apps/library-api/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { loadLibraryEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(loadLibraryEnv().LIBRARY_API_PORT);
}
void bootstrap();
```

`apps/library-api/server.ts` — Vercel owns the socket, so `init()` not `listen()`, and the container is cached on a module-level promise across warm invocations:

```ts
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';
import { configureApp } from './src/configure-app';

const server = express();
let ready: Promise<void> | undefined;

async function init(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  configureApp(app);
  await app.init();
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  ready ??= init();
  await ready;
  (server as unknown as (a: unknown, b: unknown) => void)(req, res);
}
```

- [ ] **Step 10: Run the health test and verify it passes**

```bash
pnpm --filter @library/api exec jest src/health
```

Expected: PASS, 3 tests.

- [ ] **Step 11: Commit**

```bash
git add apps/library-api pnpm-lock.yaml
git commit -m "feat(library-api): app scaffold, validated env, live and ready endpoints"
```

---

### Task 5: Org resolution — lookup service, Redis cache, middleware

**Files:**
- Create: `apps/library-api/src/modules/tenancy/index.ts`
- Create: `apps/library-api/src/modules/tenancy/internal/org-lookup.service.ts`
- Create: `apps/library-api/src/modules/tenancy/internal/org-context.service.ts`
- Create: `apps/library-api/src/modules/tenancy/internal/org.middleware.ts`
- Create: `apps/library-api/src/modules/tenancy/internal/tenancy.module.ts`
- Modify: `apps/library-api/src/app.module.ts`
- Test: `apps/library-api/src/modules/tenancy/internal/org-lookup.service.spec.ts`

**Interfaces:**
- Consumes: `getLibraryPlatformPrisma` from Task 1; `loadLibraryEnv` from Task 4.
- Produces:
  - `type OrgContext = { kind: 'tenant'; orgId: string; orgSlug: string; hostname: string } | { kind: 'unknown'; hostname: string }`
  - `orgMiddleware(req, res, next)` — sets `req.org` and runs the rest of the request inside an `AsyncLocalStorage` scope
  - `OrgContextService.current(): OrgContext | undefined`
  - `OrgLookupService.resolveByHostname(host: string): Promise<OrgContext>`

- [ ] **Step 1: Write the failing test**

`apps/library-api/src/modules/tenancy/internal/org-lookup.service.spec.ts`:

```ts
import { OrgLookupService } from './org-lookup.service';

const ORG = '22222222-2222-4222-8222-222222222222';

function deps(overrides: Partial<{ domainRow: unknown; slugRow: unknown; cached: string | null }> = {}) {
  const calls = { db: 0, cacheGet: 0, cacheSet: 0 };
  return {
    calls,
    service: new OrgLookupService(
      {
        findDomain: async () => { calls.db++; return overrides.domainRow ?? null; },
        findBySlug: async () => { calls.db++; return overrides.slugRow ?? null; },
      },
      {
        get: async () => { calls.cacheGet++; return overrides.cached ?? null; },
        set: async () => { calls.cacheSet++; },
      },
      'library.trackyour.in',
    ),
  };
}

describe('OrgLookupService', () => {
  it('resolves a live custom domain to its org', async () => {
    const { service } = deps({ domainRow: { orgId: ORG, org: { slug: 'raffles' } } });
    await expect(service.resolveByHostname('books.raffles.edu')).resolves.toEqual({
      kind: 'tenant', orgId: ORG, orgSlug: 'raffles', hostname: 'books.raffles.edu',
    });
  });

  it('falls back to <slug>.<platform host> when no domain row exists', async () => {
    const { service } = deps({ slugRow: { id: ORG, slug: 'raffles' } });
    await expect(service.resolveByHostname('raffles.library.trackyour.in')).resolves.toEqual({
      kind: 'tenant', orgId: ORG, orgSlug: 'raffles', hostname: 'raffles.library.trackyour.in',
    });
  });

  it('returns unknown for an unrecognised host rather than guessing', async () => {
    const { service } = deps();
    await expect(service.resolveByHostname('nope.example.com')).resolves.toEqual({
      kind: 'unknown', hostname: 'nope.example.com',
    });
  });

  it('serves from cache without touching the database', async () => {
    const { service, calls } = deps({ cached: JSON.stringify({ orgId: ORG, orgSlug: 'raffles' }) });
    await service.resolveByHostname('raffles.library.trackyour.in');
    expect(calls.db).toBe(0);
  });

  it('falls open to the database when the cache throws', async () => {
    const service = new OrgLookupService(
      { findDomain: async () => ({ orgId: ORG, org: { slug: 'raffles' } }), findBySlug: async () => null },
      { get: async () => { throw new Error('redis down'); }, set: async () => { throw new Error('redis down'); } },
      'library.trackyour.in',
    );
    await expect(service.resolveByHostname('books.raffles.edu')).resolves.toMatchObject({ kind: 'tenant' });
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm --filter @library/api exec jest src/modules/tenancy
```

Expected: FAIL — `Cannot find module './org-lookup.service'`.

- [ ] **Step 3: Write the lookup service**

`apps/library-api/src/modules/tenancy/internal/org-lookup.service.ts`:

```ts
export type OrgContext =
  | { kind: 'tenant'; orgId: string; orgSlug: string; hostname: string }
  | { kind: 'unknown'; hostname: string };

export interface OrgStore {
  findDomain(hostname: string): Promise<{ orgId: string; org: { slug: string } } | null>;
  findBySlug(slug: string): Promise<{ id: string; slug: string } | null>;
}

export interface OrgCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

const TTL = 60;

export class OrgLookupService {
  constructor(
    private readonly store: OrgStore,
    private readonly cache: OrgCache,
    private readonly platformHost: string,
  ) {}

  async resolveByHostname(hostname: string): Promise<OrgContext> {
    const host = hostname.trim().toLowerCase().split(':')[0];
    if (!host) return { kind: 'unknown', hostname };

    const key = `libhost:${host}`;
    try {
      const cached = await this.cache.get(key);
      if (cached) {
        const { orgId, orgSlug } = JSON.parse(cached) as { orgId: string; orgSlug: string };
        return { kind: 'tenant', orgId, orgSlug, hostname: host };
      }
    } catch { /* cache is never a source of truth — fall through to the database */ }

    const domain = await this.store.findDomain(host);
    if (domain) return this.remember(key, domain.orgId, domain.org.slug, host);

    const suffix = `.${this.platformHost}`;
    if (host.endsWith(suffix)) {
      const slug = host.slice(0, -suffix.length);
      if (slug && !slug.includes('.')) {
        const org = await this.store.findBySlug(slug);
        if (org) return this.remember(key, org.id, org.slug, host);
      }
    }
    return { kind: 'unknown', hostname: host };
  }

  private async remember(key: string, orgId: string, orgSlug: string, hostname: string): Promise<OrgContext> {
    try { await this.cache.set(key, JSON.stringify({ orgId, orgSlug }), TTL); } catch { /* ignore */ }
    return { kind: 'tenant', orgId, orgSlug, hostname };
  }
}
```

- [ ] **Step 4: Run it and verify it passes**

```bash
pnpm --filter @library/api exec jest src/modules/tenancy
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the context service and middleware**

`apps/library-api/src/modules/tenancy/internal/org-context.service.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { OrgContext } from './org-lookup.service';

export const orgStore = new AsyncLocalStorage<OrgContext>();

@Injectable()
export class OrgContextService {
  current(): OrgContext | undefined { return orgStore.getStore(); }

  /** Throws rather than returning a default — an unresolved tenant must never fall back to "some org". */
  requireOrgId(): string {
    const ctx = this.current();
    if (!ctx || ctx.kind !== 'tenant') throw new Error('No tenant resolved for this request');
    return ctx.orgId;
  }
}
```

`apps/library-api/src/modules/tenancy/internal/org.middleware.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import { OrgLookupService, type OrgContext } from './org-lookup.service';
import { orgStore } from './org-context.service';

const env = loadLibraryEnv();
const redis = new Redis(env.LIBRARY_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

async function connect(): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
}

const lookup = new OrgLookupService(
  {
    findDomain: (hostname) =>
      getLibraryPlatformPrisma().libraryDomain.findFirst({
        where: { hostname, status: 'LIVE' },
        select: { orgId: true, org: { select: { slug: true } } },
      }),
    findBySlug: (slug) =>
      getLibraryPlatformPrisma().libraryOrg.findFirst({
        where: { slug, status: { not: 'SUSPENDED' } },
        select: { id: true, slug: true },
      }),
  },
  {
    get: async (key) => { await connect(); return redis.get(key); },
    set: async (key, value, ttl) => { await connect(); await redis.set(key, value, 'EX', ttl); },
  },
  env.LIBRARY_PLATFORM_HOST,
);

/**
 * Tenant identity rides the request host. Resolution order:
 *   1. `X-Library-Host` — app-controlled, required because Vercel's ingress
 *      overwrites X-Forwarded-Host, which would collapse every request to one host.
 *   2. `req.hostname` — honours X-Forwarded-Host when trust proxy is on.
 *   3. `req.headers.host` — covers supertest, which sets Host directly.
 *
 * Functional middleware using module-level singletons rather than Nest DI:
 * middleware DI is unreliable under tsx because decorator metadata is not
 * consistently emitted at runtime, and these services have no Nest dependencies.
 */
export function orgMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const explicit = (req.headers['x-library-host'] ?? '').toString().trim();
  const host = explicit || req.hostname || (req.headers.host ?? '').toString();
  void lookup
    .resolveByHostname(host)
    .then((ctx: OrgContext) => {
      (req as Request & { org?: OrgContext }).org = ctx;
      orgStore.run(ctx, () => next());
    })
    .catch((err) => next(err));
}
```

`apps/library-api/src/modules/tenancy/internal/tenancy.module.ts`:

```ts
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { OrgContextService } from './org-context.service';
import { orgMiddleware } from './org.middleware';

@Module({ providers: [OrgContextService], exports: [OrgContextService] })
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(orgMiddleware).forRoutes('*');
  }
}
```

`apps/library-api/src/modules/tenancy/index.ts` — the module's only public surface:

```ts
export { TenancyModule } from './internal/tenancy.module';
export { OrgContextService } from './internal/org-context.service';
export type { OrgContext } from './internal/org-lookup.service';
```

- [ ] **Step 6: Wire it into the app module**

Replace `apps/library-api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './modules/tenancy';

@Module({ imports: [TenancyModule, HealthModule] })
export class AppModule {}
```

- [ ] **Step 7: Run the whole suite**

```bash
pnpm --filter @library/api test
```

Expected: PASS, all suites.

- [ ] **Step 8: Commit**

```bash
git add apps/library-api/src/modules/tenancy apps/library-api/src/app.module.ts
git commit -m "feat(library-api): host-based org resolution with fail-open Redis cache"
```

---

### Task 6: The cross-org isolation harness

**Files:**
- Create: `apps/library-api/test/helpers/live-db.ts`
- Test: `apps/library-api/test/isolation.e2e.spec.ts`
- Create: `apps/library-api/test/jest-e2e.config.js`
- Modify: `apps/library-api/package.json` (add `test:e2e`)

**Interfaces:**
- Consumes: `withOrg`, `getLibraryPlatformPrisma` from Task 1.
- Produces: `seedTwoOrgs(): Promise<{ orgA: SeededOrg; orgB: SeededOrg }>` and `cleanupOrgs(ids: string[]): Promise<void>`, where `SeededOrg = { id: string; slug: string; branchId: string; memberId: string }`. Plan B and Phase 1 both reuse these.

This is the highest-value test in the build: it proves the RLS policies actually work, rather than proving the `where` clauses do.

- [ ] **Step 1: Create the e2e jest config**

`apps/library-api/test/jest-e2e.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/.*\\.e2e\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.e2e\\.spec\\.ts$'],
  moduleNameMapper: { '^@library/db$': '<rootDir>/../../packages/library-db/src' },
  testTimeout: 30000,
};
```

Add to `apps/library-api/package.json` scripts:

```json
"test:e2e": "jest --config test/jest-e2e.config.js --runInBand"
```

- [ ] **Step 2: Write the seed helper**

`apps/library-api/test/helpers/live-db.ts`:

```ts
import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';

export interface SeededOrg { id: string; slug: string; branchId: string; memberId: string }

export const LIVE = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM?.includes('postgres'));

/** Two orgs, because a single-tenant seed cannot prove tenant isolation. */
export async function seedTwoOrgs(suffix: string): Promise<{ orgA: SeededOrg; orgB: SeededOrg }> {
  const prisma = getLibraryPlatformPrisma();
  const make = async (slug: string): Promise<SeededOrg> => {
    const org = await prisma.libraryOrg.create({
      data: { slug: `${slug}-${suffix}`, name: slug, status: 'LIVE' },
    });
    const branch = await prisma.branch.create({
      data: { orgId: org.id, name: 'Main', code: 'MAIN' },
    });
    const member = await prisma.member.create({
      data: {
        orgId: org.id, homeBranchId: branch.id, code: 'LIB-00001',
        firstName: 'Test', lastName: slug, status: 'ACTIVE',
      },
    });
    return { id: org.id, slug: org.slug, branchId: branch.id, memberId: member.id };
  };
  return { orgA: await make('alpha'), orgB: await make('bravo') };
}

export async function cleanupOrgs(ids: string[]): Promise<void> {
  const prisma = getLibraryPlatformPrisma();
  await prisma.libraryOrg.deleteMany({ where: { id: { in: ids } } });
  await disconnectLibrary();
}
```

- [ ] **Step 3: Write the failing isolation test**

`apps/library-api/test/isolation.e2e.spec.ts`:

```ts
import { withOrg } from '@library/db';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

describeLive('cross-org isolation is enforced by Postgres, not by where clauses', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => { ({ orgA, orgB } = await seedTwoOrgs(Date.now().toString(36))); });
  afterAll(async () => { await cleanupOrgs([orgA.id, orgB.id]); });

  it('cannot read another org\'s member even when asked for it by id', async () => {
    const found = await withOrg(orgA.id, (tx) => tx.member.findUnique({ where: { id: orgB.memberId } }));
    expect(found).toBeNull();
  });

  it('cannot list another org\'s branches', async () => {
    const branches = await withOrg(orgA.id, (tx) => tx.branch.findMany());
    expect(branches.map((b) => b.id)).not.toContain(orgB.branchId);
  });

  it('cannot update another org\'s member', async () => {
    await expect(
      withOrg(orgA.id, (tx) => tx.member.update({ where: { id: orgB.memberId }, data: { firstName: 'Hacked' } })),
    ).rejects.toThrow();
    const untouched = await withOrg(orgB.id, (tx) => tx.member.findUnique({ where: { id: orgB.memberId } }));
    expect(untouched?.firstName).toBe('Test');
  });

  it('cannot insert a row belonging to another org', async () => {
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.branch.create({ data: { orgId: orgB.id, name: 'Smuggled', code: 'SMUG' } })),
    ).rejects.toThrow();
  });

  it('returns zero rows when no org is scoped at all', async () => {
    // Not via withOrg: a raw tenant-client query with no GUC set must see nothing.
    const { getLibraryTenantPrisma } = await import('@library/db');
    const rows = await getLibraryTenantPrisma().member.findMany();
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it and verify it fails, then passes**

```bash
pnpm --filter @library/api test:e2e
```

If `LIBRARY_DATABASE_URL_PLATFORM` is unset the suite skips — set it first, or run it in CI. Expected once live: PASS, 5 tests. **If the "zero rows when no org is scoped" test fails, RLS is not actually on** — go back to Task 3 and re-check `FORCE ROW LEVEL SECURITY`, and confirm the app connects as `library_app`, not the superuser (a superuser bypasses RLS silently).

- [ ] **Step 5: Commit**

```bash
git add apps/library-api/test apps/library-api/package.json
git commit -m "test(library-api): cross-org isolation proven against real RLS policies"
```

---

### Task 7: Password hashing, login, and the JWT guard

**Files:**
- Create: `apps/library-api/src/modules/auth/index.ts`
- Create: `apps/library-api/src/modules/auth/internal/password.service.ts`
- Create: `apps/library-api/src/modules/auth/internal/auth.service.ts`
- Create: `apps/library-api/src/modules/auth/internal/auth.controller.ts`
- Create: `apps/library-api/src/modules/auth/internal/lib-jwt.guard.ts`
- Create: `apps/library-api/src/modules/auth/internal/auth.module.ts`
- Create: `apps/library-api/src/modules/auth/internal/dto.ts`
- Test: `apps/library-api/src/modules/auth/internal/auth.service.spec.ts`

**Interfaces:**
- Consumes: `OrgContextService` from Task 5; `loadLibraryEnv` from Task 4.
- Produces:
  - `type LibJwtPayload = { sub: string; org: string; role: LibRole; branches: string[]; aud: 'library' }`
  - `LibJwtGuard` — validates the bearer token, sets `req.user: LibJwtPayload`
  - `AuthService.login(orgId, identifier, password): Promise<{ accessToken, refreshToken }>`
  - `PasswordService.hash(plain): Promise<string>` / `verify(hash, plain): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

`apps/library-api/src/modules/auth/internal/auth.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const ORG = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'u1', orgId: ORG, role: 'LIBRARIAN', branchIds: [], passwordHash: 'HASH', active: true, failedAttempts: 0, lockedUntil: null };

function make(overrides: Partial<{ user: unknown; verify: boolean }> = {}) {
  const recorded: { failures: number; resets: number } = { failures: 0, resets: 0 };
  const service = new AuthService(
    {
      findByIdentifier: async () => (overrides.user === undefined ? USER : overrides.user),
      recordFailure: async () => { recorded.failures++; },
      recordSuccess: async () => { recorded.resets++; },
    } as never,
    { verify: async () => overrides.verify ?? true } as never,
    { signAccess: () => 'access', issueRefresh: async () => 'refresh' } as never,
  );
  return { service, recorded };
}

describe('AuthService.login', () => {
  it('issues both tokens for a correct password', async () => {
    const { service, recorded } = make();
    await expect(service.login(ORG, 'a@b.com', 'pw')).resolves.toEqual({
      accessToken: 'access', refreshToken: 'refresh',
    });
    expect(recorded.resets).toBe(1);
  });

  it('gives the same error for an unknown user and a wrong password', async () => {
    const missing = make({ user: null });
    const wrong = make({ verify: false });
    const a = await missing.service.login(ORG, 'nobody@b.com', 'pw').catch((e) => e);
    const b = await wrong.service.login(ORG, 'a@b.com', 'bad').catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(b).toBeInstanceOf(UnauthorizedException);
    expect(a.message).toBe(b.message);
  });

  it('counts a failure so the lockout can engage', async () => {
    const { service, recorded } = make({ verify: false });
    await service.login(ORG, 'a@b.com', 'bad').catch(() => undefined);
    expect(recorded.failures).toBe(1);
  });

  it('refuses a locked account before checking the password', async () => {
    const locked = { ...USER, lockedUntil: new Date(Date.now() + 60_000) };
    const { service } = make({ user: locked, verify: true });
    await expect(service.login(ORG, 'a@b.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a deactivated account', async () => {
    const { service } = make({ user: { ...USER, active: false } });
    await expect(service.login(ORG, 'a@b.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm --filter @library/api exec jest src/modules/auth
```

Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 3: Write the password service**

`apps/library-api/src/modules/auth/internal/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try { return await argon2.verify(hash, plain); } catch { return false; }
  }
}
```

- [ ] **Step 4: Write the auth service**

`apps/library-api/src/modules/auth/internal/auth.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { PasswordService } from './password.service';

export interface AuthUserRow {
  id: string; orgId: string; role: string; branchIds: string[];
  passwordHash: string; active: boolean; failedAttempts: number; lockedUntil: Date | null;
}

export interface AuthStore {
  findByIdentifier(orgId: string, identifier: string): Promise<AuthUserRow | null>;
  recordFailure(userId: string): Promise<void>;
  recordSuccess(userId: string): Promise<void>;
}

export interface TokenIssuer {
  signAccess(user: AuthUserRow): string;
  issueRefresh(user: AuthUserRow): Promise<string>;
}

/** One message and one shape for every failure — never reveal which half was wrong. */
const GENERIC = 'Invalid credentials';

@Injectable()
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenIssuer,
  ) {}

  async login(orgId: string, identifier: string, password: string) {
    const user = await this.store.findByIdentifier(orgId, identifier);
    if (!user || !user.active) throw new UnauthorizedException(GENERIC);
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(GENERIC);
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.store.recordFailure(user.id);
      throw new UnauthorizedException(GENERIC);
    }
    await this.store.recordSuccess(user.id);
    return { accessToken: this.tokens.signAccess(user), refreshToken: await this.tokens.issueRefresh(user) };
  }
}
```

- [ ] **Step 5: Run it and verify it passes**

```bash
pnpm --filter @library/api exec jest src/modules/auth
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Write the JWT guard**

`apps/library-api/src/modules/auth/internal/lib-jwt.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadLibraryEnv } from '../../../config/env';

export interface LibJwtPayload {
  sub: string;
  org: string;
  role: 'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER';
  branches: string[];
  aud: 'library';
}

/**
 * There is no global JWT guard — a controller without @UseGuards is
 * unauthenticated. The authz matrix suite is what makes that safe: any endpoint
 * missing from the matrix fails the build.
 */
@Injectable()
export class LibJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers.authorization ?? '') as string;
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: LibJwtPayload;
    try {
      payload = this.jwt.verify<LibJwtPayload>(header.slice(7), {
        secret: loadLibraryEnv().LIBRARY_JWT_SECRET,
        audience: 'library',
      });
    } catch { throw new UnauthorizedException(); }

    // The token's org must match the host-resolved org, or a valid token from
    // one tenant would work against another tenant's subdomain.
    if (req.org?.kind !== 'tenant' || req.org.orgId !== payload.org) throw new UnauthorizedException();
    req.user = payload;
    return true;
  }
}
```

- [ ] **Step 7: Write the DTO, controller and module**

`apps/library-api/src/modules/auth/internal/dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(1) identifier!: string;
  @IsString() @MinLength(1) password!: string;
}
```

`apps/library-api/src/modules/auth/internal/auth.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgContextService } from '../../tenancy';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly orgs: OrgContextService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(this.orgs.requireOrgId(), dto.identifier, dto.password);
  }
}
```

`apps/library-api/src/modules/auth/internal/auth.module.ts` wires the concrete store and issuer. Write it now with the Prisma-backed `AuthStore` and a `TokenIssuer` that signs `{ sub, org, role, branches, aud: 'library' }` with `LIBRARY_JWT_SECRET` and delegates refresh issuance to Task 8's service.

`apps/library-api/src/modules/auth/index.ts`:

```ts
export { AuthModule } from './internal/auth.module';
export { LibJwtGuard, type LibJwtPayload } from './internal/lib-jwt.guard';
export { PasswordService } from './internal/password.service';
```

- [ ] **Step 8: Run the full suite and commit**

```bash
pnpm --filter @library/api test
git add apps/library-api/src/modules/auth apps/library-api/src/app.module.ts
git commit -m "feat(library-api): argon2id login with a generic failure and the library JWT guard"
```

---

### Task 8: Refresh rotation with family revocation

**Files:**
- Create: `apps/library-api/src/modules/auth/internal/refresh.service.ts`
- Modify: `apps/library-api/src/modules/auth/internal/auth.controller.ts`
- Test: `apps/library-api/src/modules/auth/internal/refresh.service.spec.ts`

**Interfaces:**
- Consumes: `AuthUserRow` from Task 7.
- Produces: `RefreshService.issue(user): Promise<string>`, `RefreshService.rotate(rawToken): Promise<{ accessToken, refreshToken }>`.

- [ ] **Step 1: Write the failing test**

`apps/library-api/src/modules/auth/internal/refresh.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { RefreshService } from './refresh.service';

const FAMILY = '44444444-4444-4444-8444-444444444444';

function make(row: unknown) {
  const state = { revokedFamilies: [] as string[], created: 0 };
  const service = new RefreshService(
    {
      findByHash: async () => row,
      create: async () => { state.created++; },
      revokeFamily: async (familyId: string) => { state.revokedFamilies.push(familyId); },
      markUsed: async () => {},
      loadUser: async () => ({ id: 'u1', orgId: 'o1', role: 'LIBRARIAN', branchIds: [] }),
    } as never,
    { signAccess: () => 'access' } as never,
    30,
  );
  return { service, state };
}

describe('RefreshService.rotate', () => {
  const valid = { id: 'r1', userId: 'u1', familyId: FAMILY, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) };

  it('issues a new pair for a live token', async () => {
    const { service, state } = make(valid);
    await expect(service.rotate('raw')).resolves.toMatchObject({ accessToken: 'access' });
    expect(state.created).toBe(1);
  });

  it('revokes the WHOLE family when a revoked token is replayed', async () => {
    const { service, state } = make({ ...valid, revokedAt: new Date() });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
  });

  it('rejects an expired token without revoking the family', async () => {
    const { service, state } = make({ ...valid, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([]);
  });

  it('rejects an unknown token', async () => {
    const { service } = make(null);
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm --filter @library/api exec jest src/modules/auth/internal/refresh.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/library-api/src/modules/auth/internal/refresh.service.ts`:

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface RefreshRow {
  id: string; userId: string; familyId: string; revokedAt: Date | null; expiresAt: Date;
}

export interface RefreshStore {
  findByHash(hash: string): Promise<RefreshRow | null>;
  create(row: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  markUsed(id: string): Promise<void>;
  loadUser(userId: string): Promise<{ id: string; orgId: string; role: string; branchIds: string[] }>;
}

export interface AccessSigner { signAccess(user: { id: string; orgId: string; role: string; branchIds: string[] }): string }

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

@Injectable()
export class RefreshService {
  constructor(
    private readonly store: RefreshStore,
    private readonly signer: AccessSigner,
    private readonly ttlDays: number,
  ) {}

  async issue(user: { id: string }, familyId = randomUUID()): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.store.create({
      userId: user.id,
      tokenHash: sha256(raw),
      familyId,
      expiresAt: new Date(Date.now() + this.ttlDays * 86_400_000),
    });
    return raw;
  }

  /**
   * Replay of an already-revoked token means the token was stolen: the thief and
   * the owner now both hold tokens in the same family. Revoking the family — in
   * its own committed write, BEFORE the 401 — logs both out rather than letting
   * the thief keep rotating.
   */
  async rotate(raw: string): Promise<{ accessToken: string; refreshToken: string }> {
    const row = await this.store.findByHash(sha256(raw));
    if (!row) throw new UnauthorizedException();

    if (row.revokedAt) {
      await this.store.revokeFamily(row.familyId);
      throw new UnauthorizedException();
    }
    if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    await this.store.markUsed(row.id);
    const user = await this.store.loadUser(row.userId);
    return {
      accessToken: this.signer.signAccess(user),
      refreshToken: await this.issue(user, row.familyId),
    };
  }
}
```

- [ ] **Step 4: Run it, then wire `POST /auth/refresh` into the controller and run the suite**

```bash
pnpm --filter @library/api test
```

Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add apps/library-api/src/modules/auth
git commit -m "feat(library-api): refresh rotation that revokes the whole family on replay"
```

---

### Task 9: The plan resolver — capabilities and quotas

**Files:**
- Create: `apps/library-api/src/modules/plans/index.ts`
- Create: `apps/library-api/src/modules/plans/internal/resolve.ts`
- Create: `apps/library-api/src/modules/plans/internal/plan-resolver.service.ts`
- Create: `apps/library-api/src/modules/plans/internal/plans.module.ts`
- Test: `apps/library-api/src/modules/plans/internal/resolve.spec.ts`

**Interfaces:**
- Consumes: `getLibraryPlatformPrisma` from Task 1; `loadLibraryEnv` from Task 4.
- Produces:
  - `type CapabilityKey` (the union below), `type Quotas = { branches: number; adminSeats: number }`
  - `resolvePlan(plan, overrides): { capabilities: Set<CapabilityKey>; quotas: Quotas }`
  - `PlanResolverService.forOrg(orgId): Promise<{ capabilities: Set<CapabilityKey>; quotas: Quotas }>`
  - `PlanResolverService.invalidate(orgId): Promise<void>`

- [ ] **Step 1: Write the failing test**

`apps/library-api/src/modules/plans/internal/resolve.spec.ts`:

```ts
import { resolvePlan } from './resolve';

describe('resolvePlan', () => {
  it('gives FREE the operational capabilities but no money features', () => {
    const { capabilities, quotas } = resolvePlan('FREE', []);
    expect(capabilities.has('CATALOG')).toBe(true);
    expect(capabilities.has('CIRCULATION')).toBe(true);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(false);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('gives MINI the money features but still one branch and one admin', () => {
    const { capabilities, quotas } = resolvePlan('MINI', []);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(true);
    expect(capabilities.has('WHATSAPP_RECEIPT')).toBe(true);
    expect(capabilities.has('MULTI_BRANCH')).toBe(false);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('gives PRO everything MINI has, plus unlimited branches and admins', () => {
    const mini = resolvePlan('MINI', []).capabilities;
    const { capabilities, quotas } = resolvePlan('PRO', []);
    for (const key of mini) expect(capabilities.has(key)).toBe(true);
    expect(capabilities.has('MULTI_BRANCH')).toBe(true);
    expect(quotas).toEqual({ branches: Infinity, adminSeats: Infinity });
  });

  it('lets an override switch a capability on for one org', () => {
    const { capabilities } = resolvePlan('FREE', [{ key: 'REVENUE_DASHBOARD', enabled: true }]);
    expect(capabilities.has('REVENUE_DASHBOARD')).toBe(true);
  });

  it('lets an override switch a capability off', () => {
    const { capabilities } = resolvePlan('PRO', [{ key: 'MULTI_BRANCH', enabled: false }]);
    expect(capabilities.has('MULTI_BRANCH')).toBe(false);
  });

  it('ignores an override naming a capability that does not exist', () => {
    const { capabilities } = resolvePlan('FREE', [{ key: 'NOT_A_REAL_KEY', enabled: true }]);
    expect(capabilities.has('NOT_A_REAL_KEY' as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

```bash
pnpm --filter @library/api exec jest src/modules/plans
```

Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 3: Write the resolver**

`apps/library-api/src/modules/plans/internal/resolve.ts`:

```ts
export const CAPABILITIES = [
  'CATALOG', 'CIRCULATION', 'MEMBERS', 'SEATS', 'ATTENDANCE', 'QR_REGISTRATION', 'BASIC_ANALYTICS',
  'FEES', 'EXPENSES', 'REVENUE_DASHBOARD', 'REPORTS_EXPORT', 'CUSTOM_REG_FORM',
  'WHATSAPP_RECEIPT', 'WHATSAPP_DUE_REMINDER',
  'MULTI_BRANCH', 'MULTI_ADMIN', 'WHATSAPP_EXPIRY_REMINDER', 'PRIORITY_SUPPORT',
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number];
export type PlanKey = 'FREE' | 'MINI' | 'PRO';
export interface Quotas { branches: number; adminSeats: number }

const FREE: CapabilityKey[] = [
  'CATALOG', 'CIRCULATION', 'MEMBERS', 'SEATS', 'ATTENDANCE', 'QR_REGISTRATION', 'BASIC_ANALYTICS',
];
const MINI: CapabilityKey[] = [
  ...FREE, 'FEES', 'EXPENSES', 'REVENUE_DASHBOARD', 'REPORTS_EXPORT', 'CUSTOM_REG_FORM',
  'WHATSAPP_RECEIPT', 'WHATSAPP_DUE_REMINDER',
];
const PRO: CapabilityKey[] = [
  ...MINI, 'MULTI_BRANCH', 'MULTI_ADMIN', 'WHATSAPP_EXPIRY_REMINDER', 'PRIORITY_SUPPORT',
];

const PLANS: Record<PlanKey, { caps: CapabilityKey[]; quotas: Quotas }> = {
  FREE: { caps: FREE, quotas: { branches: 1, adminSeats: 1 } },
  MINI: { caps: MINI, quotas: { branches: 1, adminSeats: 1 } },
  PRO: { caps: PRO, quotas: { branches: Infinity, adminSeats: Infinity } },
};

const isCapability = (key: string): key is CapabilityKey =>
  (CAPABILITIES as readonly string[]).includes(key);

/**
 * Returns capabilities AND quotas. Librify's tiers gate on counts (1 branch,
 * 1 admin), which a boolean-only Set cannot express — that is the whole reason
 * this differs from the Sckools feature resolver.
 */
export function resolvePlan(
  plan: PlanKey,
  overrides: { key: string; enabled: boolean }[],
): { capabilities: Set<CapabilityKey>; quotas: Quotas } {
  const base = PLANS[plan];
  const capabilities = new Set<CapabilityKey>(base.caps);
  for (const o of overrides) {
    if (!isCapability(o.key)) continue;
    if (o.enabled) capabilities.add(o.key);
    else capabilities.delete(o.key);
  }
  return { capabilities, quotas: { ...base.quotas } };
}
```

- [ ] **Step 4: Run it and verify it passes**

```bash
pnpm --filter @library/api exec jest src/modules/plans
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Write the cached service**

`apps/library-api/src/modules/plans/internal/plan-resolver.service.ts` — same fail-open cache-aside shape as `FeatureResolverService` in `apps/api`: try Redis `libfeat:<orgId>` (300 s), fall through to the platform client on any error, write back, and expose `invalidate(orgId)`. Serialize as `{ capabilities: string[]; quotas: { branches: number | null; adminSeats: number | null } }` with `null` standing in for `Infinity`, because `JSON.stringify(Infinity)` produces `null` and would otherwise silently become `0` on parse.

- [ ] **Step 6: Run the suite and commit**

```bash
pnpm --filter @library/api test
git add apps/library-api/src/modules/plans
git commit -m "feat(library-api): plan resolver returning capabilities and quotas"
```

---

### Task 10: Entitlement, role and branch guards

**Files:**
- Create: `apps/library-api/src/modules/plans/internal/require-feature.decorator.ts`
- Create: `apps/library-api/src/modules/plans/internal/require-feature.guard.ts`
- Create: `apps/library-api/src/modules/plans/internal/require-quota.ts`
- Create: `apps/library-api/src/common/guards/roles.guard.ts`
- Create: `apps/library-api/src/common/guards/branch-scope.guard.ts`
- Test: `apps/library-api/src/modules/plans/internal/require-feature.guard.spec.ts`
- Test: `apps/library-api/src/common/guards/branch-scope.guard.spec.ts`

**Interfaces:**
- Consumes: `PlanResolverService` from Task 9; `LibJwtPayload` from Task 7.
- Produces:
  - `@RequireFeature(...keys: CapabilityKey[])` and `RequireFeatureGuard`
  - `assertQuota(tx, orgId, quota, table): Promise<void>` — counts inside the caller's transaction
  - `@Roles(...roles: LibRole[])` and `RolesGuard`
  - `BranchScopeGuard` — rejects a request whose `branchId` param is outside `req.user.branches` (empty array = all branches)

- [ ] **Step 1: Write the failing guard tests**

`apps/library-api/src/common/guards/branch-scope.guard.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { BranchScopeGuard } from './branch-scope.guard';

const ctx = (user: unknown, params: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, params, query: {} }) }) }) as never;

describe('BranchScopeGuard', () => {
  const guard = new BranchScopeGuard();

  it('allows an org owner with no branch restriction', () => {
    expect(guard.canActivate(ctx({ role: 'ORG_OWNER', branches: [] }, { branchId: 'b1' }))).toBe(true);
  });

  it('allows a librarian reaching their own branch', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, { branchId: 'b1' }))).toBe(true);
  });

  it('rejects a librarian reaching another branch', () => {
    expect(() => guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, { branchId: 'b2' })))
      .toThrow(ForbiddenException);
  });

  it('allows a request that names no branch at all', () => {
    expect(guard.canActivate(ctx({ role: 'LIBRARIAN', branches: ['b1'] }, {}))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
pnpm --filter @library/api exec jest src/common/guards
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the branch guard**

`apps/library-api/src/common/guards/branch-scope.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Org isolation is the SECURITY boundary and lives in Postgres (RLS).
 * Branch is an AUTHORIZATION boundary and lives here — so its failure mode is a
 * 403, not a cross-tenant read. An empty `branches` array means "all branches".
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const branches: string[] = req.user?.branches ?? [];
    if (branches.length === 0) return true;
    const requested = req.params?.branchId ?? req.query?.branchId;
    if (!requested) return true;
    if (!branches.includes(requested)) throw new ForbiddenException('Branch out of scope');
    return true;
  }
}
```

- [ ] **Step 4: Write the feature guard, decorator, roles guard and `assertQuota`**

`assertQuota` must count **inside the caller's transaction**, so two concurrent branch creations on a FREE plan cannot both pass:

```ts
import { ForbiddenException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

export async function assertQuota(
  tx: LibraryTx,
  orgId: string,
  limit: number,
  count: (tx: LibraryTx, orgId: string) => Promise<number>,
  what: string,
): Promise<void> {
  if (limit === Infinity) return;
  const current = await count(tx, orgId);
  if (current >= limit) {
    throw new ForbiddenException(`Your plan allows ${limit} ${what}. Upgrade to add more.`);
  }
}
```

Write `RequireFeatureGuard` to read the decorator's metadata via `Reflector`, call `PlanResolverService.forOrg(req.org.orgId)`, and throw `ForbiddenException` naming the missing capability. Write `RolesGuard` to read `@Roles()` metadata and compare against `req.user.role`.

- [ ] **Step 5: Run all guard tests and commit**

```bash
pnpm --filter @library/api test
git add apps/library-api/src/common/guards apps/library-api/src/modules/plans
git commit -m "feat(library-api): feature, quota, role and branch-scope guards"
```

---

### Task 11: Redis-backed throttling and idempotency

**Files:**
- Create: `apps/library-api/src/common/throttler/redis-throttler.storage.ts`
- Create: `apps/library-api/src/common/idempotency/idempotency.interceptor.ts`
- Modify: `apps/library-api/src/app.module.ts`
- Test: `apps/library-api/src/common/throttler/redis-throttler.storage.spec.ts`
- Test: `apps/library-api/src/common/idempotency/idempotency.interceptor.spec.ts`

**Interfaces:**
- Consumes: `loadLibraryEnv` from Task 4; `withOrg` from Task 1.
- Produces: `RedisThrottlerStorage implements ThrottlerStorage`, `IdempotencyInterceptor`.

- [ ] **Step 1: Write the failing throttler test**

`apps/library-api/src/common/throttler/redis-throttler.storage.spec.ts`:

```ts
import { RedisThrottlerStorage } from './redis-throttler.storage';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    client: {
      status: 'ready',
      connect: async () => {},
      incr: async (key: string) => { const n = (store.get(key) ?? 0) + 1; store.set(key, n); return n; },
      pexpire: async () => 1,
      pttl: async () => 30_000,
    } as never,
  };
}

describe('RedisThrottlerStorage', () => {
  it('counts hits in Redis so every lambda shares one limit', async () => {
    const { client } = fakeRedis();
    const storage = new RedisThrottlerStorage(client);
    const first = await storage.increment('ip:1', 60_000, 100, 0, 'default');
    const second = await storage.increment('ip:1', 60_000, 100, 0, 'default');
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
  });

  it('namespaces every key under lib: so it cannot collide with another product', async () => {
    const { client, store } = fakeRedis();
    await new RedisThrottlerStorage(client).increment('ip:1', 60_000, 100, 0, 'default');
    expect([...store.keys()].every((k) => k.startsWith('lib:throttle:'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails, then implement**

```bash
pnpm --filter @library/api exec jest src/common/throttler
```

Implement `RedisThrottlerStorage` against `@nestjs/throttler`'s `ThrottlerStorage` interface: `INCR` the key, set `PEXPIRE` on first hit, return `{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }`. Register it in `app.module.ts`:

```ts
ThrottlerModule.forRoot({
  throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
  storage: new RedisThrottlerStorage(),
}),
```

> The default in-memory storage is per-lambda, so N warm instances permit N× the stated limit. That is a live gap in Sckools and is not repeated here.

- [ ] **Step 3: Write the failing idempotency test**

The interceptor must: hash `method + path + body`; on a hit with the **same** hash replay the stored response; on a hit with a **different** hash throw 409; on a miss run the handler and store the result. Write those four cases as tests, run them red, then implement.

- [ ] **Step 4: Run the suite and commit**

```bash
pnpm --filter @library/api test
git add apps/library-api/src/common apps/library-api/src/app.module.ts
git commit -m "feat(library-api): Redis-backed throttling and idempotent writes"
```

---

### Task 12: Seed, module boundary, CI, and the preflight gate

**Files:**
- Create: `packages/library-db/prisma/seed.ts`
- Create: `.dependency-cruiser.library.cjs`
- Create: `.github/workflows/library-ci.yml`
- Create: `scripts/preflight-library.sh`
- Modify: `package.json` (root scripts)
- Test: `apps/library-api/src/app.module.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `pnpm preflight:library`, `pnpm --filter @library/db seed`, a green CI run.

- [ ] **Step 1: Write the seed**

`packages/library-db/prisma/seed.ts` creates the two orgs the isolation suite and the dashboard both need: `raffles` (a Raffles library — one branch, four shifts' worth of seats deferred to Phase 2, 300 members, a `LIBRARIAN` login `library@sckool.com`, and an `ORG_OWNER`), and `northgate` (a second org existing purely so isolation has something to fail against). The owner password comes from `LIBRARY_SEED_PASSWORD`, never a literal — hash it with `PasswordService`.

- [ ] **Step 2: Write the boundary rule**

`.dependency-cruiser.library.cjs`:

```js
/**
 * Two rules:
 *   1. Library modules talk to each other only through their index.ts.
 *   2. The library imports NOTHING from Sckools — that coupling is what the
 *      whole separate-service design exists to prevent.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internal-import',
      severity: 'error',
      from: { path: '^apps/library-api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/library-api/src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^apps/library-api/src/modules/$1/',
      },
    },
    {
      name: 'no-sckools-imports',
      severity: 'error',
      comment: 'The library service must never import Sckools code. Merging later is a routing change; a shared import makes it a rewrite.',
      from: { path: '^(apps/library-api|packages/library-db)/' },
      to: { path: '^(apps/api|packages/(db|config|types))/|^@skoolos/' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsPreCompilationDeps: true },
};
```

- [ ] **Step 3: Write the guard test for the app module**

`apps/library-api/src/app.module.spec.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('library-api wiring guards', () => {
  it('registers a Redis-backed throttler, never the in-memory default', () => {
    const source = readFileSync(join(__dirname, 'app.module.ts'), 'utf8');
    expect(source).toContain('RedisThrottlerStorage');
  });

  it('declares only daily crons — a sub-daily schedule fails the whole deploy', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '../vercel.json'), 'utf8'));
    for (const cron of vercel.crons ?? []) {
      const [minute, hour] = cron.schedule.split(' ');
      expect(minute).not.toBe('*');
      expect(hour).not.toBe('*');
      expect(hour).not.toContain('/');
    }
  });

  it('pins the Mumbai region to stay co-located with the database', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '../vercel.json'), 'utf8'));
    expect(vercel.regions).toEqual(['bom1']);
  });

  it('every module folder exposes a public index.ts', () => {
    const dir = join(__dirname, 'modules');
    for (const mod of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      expect(readdirSync(join(dir, mod.name))).toContain('index.ts');
    }
  });
});
```

- [ ] **Step 4: Run it and fix anything it catches**

```bash
pnpm --filter @library/api exec jest src/app.module.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the preflight script**

`scripts/preflight-library.sh` — same shape as `scripts/preflight.sh`, running lint, typecheck, `depcruise --config .dependency-cruiser.library.cjs`, build, unit tests, and (when `LIBRARY_DATABASE_URL_PLATFORM` is set) `test:e2e`. Add to root `package.json`:

```json
"preflight:library": "bash scripts/preflight-library.sh",
"library:migrate": "pnpm --filter @library/db migrate:deploy",
"library:seed": "pnpm --filter @library/db seed"
```

- [ ] **Step 6: Write the CI workflow**

`.github/workflows/library-ci.yml` — triggers on pushes touching `apps/library-api/**`, `packages/library-db/**` or the workflow itself, plus `workflow_dispatch` with `target` and `suites` inputs (Plan B's dispatch calls exactly this). Steps: checkout, pnpm, install, `prisma generate`, lint, typecheck, boundary, unit tests, then e2e using the `library-staging` environment's secrets. Emit a JSON report to `library-report.json` for Plan B to ingest.

- [ ] **Step 7: Run the whole gate**

```bash
pnpm preflight:library
```

Expected: every step ✓.

- [ ] **Step 8: Commit and push**

```bash
git add packages/library-db/prisma/seed.ts .dependency-cruiser.library.cjs \
        .github/workflows/library-ci.yml scripts/preflight-library.sh package.json \
        apps/library-api/src/app.module.spec.ts
git commit -m "chore(library): seed, module boundary, CI workflow and preflight gate"
git push origin feat/library-service
```

---

## Self-review notes

**Spec coverage.** Phase 0 items from spec §14 map as: worktree/branch (done before this plan) · `packages/library-db` schema+RLS+roles+migration → Tasks 1-3 · API skeleton → Task 4 · tenancy → Task 5 · auth → Tasks 7-8 · plan/quota resolver → Task 9 · guards → Task 10 · Redis throttler + idempotency → Task 11 · `/ready` → Task 4 · CI + `preflight:library` → Task 12 · seed → Task 12.

**Deliberately deferred to Plan B (testboard):** the testboard app, its schema, signed ingest, dispatch, the prod read-only guard, and the non-functional probes. `auditRlsCoverage` (Task 3) and `seedTwoOrgs` (Task 6) are built here because they belong to the library, and Plan B consumes both.

**Deferred to Phase 1, with reasons:** Sentry wiring (needs a DSN, and there is nothing to observe until endpoints exist) · the authz matrix suite (needs more than two endpoints to be meaningful — Task 6's isolation harness is the half that can be built now, and the matrix generator joins it with the first real controllers) · structured request logging.

**Known gap to close in Plan B or Phase 1:** `PasswordResetToken` and `RegistrationToken` appear in the RLS allow-list (Task 3) but their models are not created until Phase 1/4. The audit passes either way because it only inspects tables that exist; the allow-list is written ahead so the entries are reviewed once, not twice.
