# Library Phase 1a — Catalogue & Circulation API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the lending half of the library — titles, authors, categories, copies, full-text search, bulk import, and the issue/return/renew/hold/fine flows — on top of the Phase 0a foundation, so Phase 1b's console has a real API to drive.

**Architecture:** Every circulation decision goes through **pure functions** that take plain data and an injected clock and return a verdict, so the rules are exhaustively table-testable without a database and the API, a future mobile app, and any report can never disagree about them. Concurrency is answered by the database — partial unique indexes and `SELECT … FOR UPDATE` — never by application check-then-write. Two carry-forward items from the Phase 0a review are front-loaded because both are stated preconditions for what follows.

**Tech Stack:** TypeScript 5.4, NestJS 10.3, Prisma 5.13, PostgreSQL 17 (Supabase ap-south-1), Jest 29 + ts-jest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-08-library-service-design.md` §5.2, §5.3, §6, §9.6
**Predecessor:** `docs/superpowers/plans/2026-08-09-library-phase0a-foundation.md` (shipped)
**Ledger — read before starting:** `docs/superpowers/plans/2026-08-09-library-phase0a-LEDGER.md`

## Global Constraints

- **Zero imports from Sckools code.** Never `@skoolos/db`, `@skoolos/config`, `@skoolos/types`, or anything under `apps/api/`. Enforced by `.dependency-cruiser.library.cjs`, which scans `apps/library-api` and `packages/library-db` as directory roots.
- **Every new table carrying `orgId` gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy using `NULLIF(current_setting('app.current_org', true), '')::uuid` in **both** `USING` and `WITH CHECK`. The `NULLIF` is mandatory: a pooled connection returns `''`, not NULL, after `SET LOCAL`, and `''::uuid` raises a cast error instead of failing closed. The hardened `auditRlsCoverage` will reject a policy that does not reference `app.current_org`.
- **No state transition is ever performed by a scheduler.** `OVERDUE`, `DUE_SOON`, `EXPIRING`, `EXPIRED` are computed at read time from `dueAt` / `endDate`. They must not appear in any enum. The only stored statuses are ones a human action changed.
- **Nothing in process memory** — no caches, counters, or locks that would be per-instance under horizontal scaling.
- **Migrations are append-only and must be timestamped in dependency order.** A migration ordered wrongly passes on every existing database and fails the first fresh deploy with P3018 — this already happened once.
- **Use explicit `@Inject()`** on every Nest constructor parameter. `tsx` does not reliably emit `design:paramtypes`, and a bare-typed param can silently resolve to `undefined`.
- **`assertQuota`-style counting must hold a `pg_advisory_xact_lock` before counting.** Counting inside a transaction is necessary but not sufficient: under READ COMMITTED two transactions that both `BEGIN` before either commits see the same snapshot.
- **Never `git add -A`** — explicit paths only. Never commit `.env`, `packages/library-db/generated/`, or `apps/library-api/api/`.
- **Commit each increment.** Infrastructure errors killed agents five times during Phase 0a; incremental commits saved the work every time.
- **`pnpm preflight:library` must pass before any task is considered done.**

## Environment

- Worktree `/Users/darshanjain/skoolos-library`, branch `feat/library-service`.
- Local stack: `docker compose -f docker-compose.library.yml up -d` → `library-postgres` on **55432**, `library-redis` on **56379**. Never touch the Sckools containers on 5432.
- Gitignored root `.env` holds every variable. `pnpm --filter <pkg> exec …` does **not** load it — use `set -a && source .env && set +a`.
- Staging is live and seeded (`docs/superpowers/plans/2026-08-11-library-staging-runbook.md`).

## File structure

```
packages/library-db/prisma/
  schema.prisma                                  + Title Author TitleAuthor Category
                                                   TitleCategory Copy CirculationPolicy
                                                   Loan Hold Fine
  migrations/<ts>_catalogue/migration.sql        tables + FTS generated column + GIN
  migrations/<ts>_catalogue_rls/migration.sql    forced RLS + policies
  migrations/<ts>_circulation/migration.sql      tables + partial unique indexes
  migrations/<ts>_circulation_rls/migration.sql  forced RLS + policies

apps/library-api/src/modules/catalog/
  index.ts                                       public surface only
  internal/catalog.module.ts
  internal/titles.service.ts        titles + authors + categories
  internal/copies.service.ts        copies, barcode allocation
  internal/search.service.ts        tsvector query building
  internal/import.service.ts        CSV dry-run + apply, ISBN lookup
  internal/catalog.controller.ts
  internal/dto.ts

apps/library-api/src/modules/circulation/
  index.ts
  internal/policy.ts                PURE — no DB, no Nest, injected clock
  internal/policy.spec.ts           table-driven, exhaustive
  internal/circulation.module.ts
  internal/loans.service.ts         issue / return / renew
  internal/holds.service.ts         place / cancel / promote / expire
  internal/fines.service.ts         accrual, waiver
  internal/circulation.controller.ts
  internal/dto.ts

apps/library-api/test/
  authz-matrix.e2e.spec.ts          role × endpoint, generated from one table
  endpoints.ts                      the endpoint table both suites read
```

`circulation` may import `catalog` through its `index.ts` (it moves copies). `catalog` must **never** import `circulation`.

---

### Task 1: Refresh grace window — stop a double-tap logging the user out

**Files:**
- Modify: `apps/library-api/src/modules/auth/internal/refresh.service.ts`
- Modify: `apps/library-api/src/modules/auth/internal/auth.module.ts` (store gains `findSupersededChild`)
- Test: `apps/library-api/src/modules/auth/internal/refresh.service.spec.ts`
- Test: `apps/library-api/test/refresh-store.e2e.spec.ts`

**Interfaces:**
- Consumes: `RefreshService`, `RefreshStore`, `RefreshRow` from Phase 0a.
- Produces: `RefreshRow` gains `supersededAt: Date | null` and `replacedByHash: string | null`; `RefreshStore` gains `findByHash` returning those fields.

**Why this is first.** Phase 0a's rotation revokes the entire token family when an already-revoked token is replayed — correct for theft. But a client double-tap, a duplicate tab sharing storage, or a mobile retry-on-timeout produces two concurrent rotations; the loser's late read sees the token revoked and kills the winner's brand-new token. This was reproduced under 5-way contention. It must be fixed before any mobile client exists.

- [ ] **Step 1: Add the columns**

In `packages/library-db/prisma/schema.prisma`, `model RefreshToken`, add:

```prisma
  /// Set when this token was rotated normally. Within GRACE_MS of this
  /// timestamp a replay is treated as a duplicate request (the client
  /// retried) rather than theft, and the replacement token is returned
  /// again instead of revoking the family.
  supersededAt   DateTime?
  replacedByHash String?
```

Generate and apply:

```bash
set -a && source .env && set +a
pnpm --filter @library/db exec prisma migrate dev --name refresh_grace
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/library-api/src/modules/auth/internal/refresh.service.spec.ts`:

```ts
describe('RefreshService.rotate — grace window', () => {
  const FAMILY = '44444444-4444-4444-8444-444444444444';
  const base = {
    id: 'r1', userId: 'u1', familyId: FAMILY, revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    supersededAt: null as Date | null, replacedByHash: null as string | null,
  };

  function make(row: unknown) {
    const state = { revokedFamilies: [] as string[], created: 0 };
    const service = new RefreshService(
      {
        findByHash: async () => row,
        create: async () => { state.created++; },
        revokeFamily: async (f: string) => { state.revokedFamilies.push(f); },
        markUsed: async () => ({ count: 1 }),
        loadUser: async () => ({ id: 'u1', orgId: 'o1', role: 'LIBRARIAN', branchIds: [] }),
      } as never,
      { signAccess: () => 'access' } as never,
      30,
    );
    return { service, state };
  }

  it('replaying a JUST-rotated token returns the same replacement, not a family revoke', async () => {
    const { service, state } = make({
      ...base, revokedAt: new Date(), supersededAt: new Date(Date.now() - 1_000),
      replacedByHash: 'HASH_OF_CHILD',
    });
    await expect(service.rotate('raw')).resolves.toMatchObject({ accessToken: 'access' });
    expect(state.revokedFamilies).toEqual([]);
    expect(state.created).toBe(0); // reuses the existing child, mints nothing new
  });

  it('replaying a token superseded LONG ago still revokes the family', async () => {
    const { service, state } = make({
      ...base, revokedAt: new Date(), supersededAt: new Date(Date.now() - 600_000),
      replacedByHash: 'HASH_OF_CHILD',
    });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
  });

  it('a revoked token that was never superseded revokes the family immediately', async () => {
    const { service, state } = make({ ...base, revokedAt: new Date() });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
  });
});
```

- [ ] **Step 3: Run and confirm they fail**

```bash
pnpm --filter @library/api exec jest src/modules/auth/internal/refresh.service.spec.ts
```
Expected: the first two FAIL (family revoked / rejected when it should replay).

- [ ] **Step 4: Implement**

In `refresh.service.ts`, add above the class:

```ts
/**
 * How long after a normal rotation a replay of the parent is treated as a
 * duplicate request rather than theft. Covers double-taps, duplicate tabs
 * sharing storage, and mobile retry-on-timeout. Long enough to absorb a
 * retry, far shorter than any plausible offline-theft window.
 */
export const REFRESH_GRACE_MS = 15_000;
```

Replace the `if (row.revokedAt)` branch in `rotate`:

```ts
    if (row.revokedAt) {
      const superseded = row.supersededAt?.getTime();
      const withinGrace = superseded !== undefined && Date.now() - superseded <= REFRESH_GRACE_MS;
      if (withinGrace && row.replacedByHash) {
        // A concurrent sibling already rotated this token. Hand back the same
        // child rather than treating a retry as theft — revoking here would log
        // the legitimate winner out.
        const user = await this.store.loadUser(row.userId);
        return { accessToken: this.signer.signAccess(user), refreshToken: row.replacedByHash };
      }
      await this.store.revokeFamily(row.familyId);
      throw new UnauthorizedException();
    }
```

> **`replacedByHash` stores the hash, and the raw token cannot be recovered from it.** So the grace path must persist the raw child token, not its hash. Change the column to store the raw replacement (renaming it `replacedByToken`) and note in a comment that this row is already a secret-bearing row protected exactly like `tokenHash` — it is the same token the legitimate client already holds. Update the schema, the migration, and the tests to match before moving on.

Then in the success path, record supersession in the same transaction that marks the parent used.

- [ ] **Step 5: Confirm green, then prove the grace window under real concurrency**

Extend `apps/library-api/test/refresh-store.e2e.spec.ts` with a barrier-forced test: two concurrent `rotate()` calls on one valid token must both resolve, and the family must remain unrevoked. Prove it discriminates by setting `REFRESH_GRACE_MS = 0`, watching it fail, restoring it.

- [ ] **Step 6: Commit**

```bash
git add packages/library-db/prisma/schema.prisma packages/library-db/prisma/migrations \
        apps/library-api/src/modules/auth apps/library-api/test/refresh-store.e2e.spec.ts
git commit -m "fix(library-api): refresh grace window — a retried rotation is not theft"
```

---

### Task 2: The authz matrix harness

**Files:**
- Create: `apps/library-api/test/endpoints.ts`
- Create: `apps/library-api/test/authz-matrix.e2e.spec.ts`
- Modify: `apps/library-api/test/helpers/live-db.ts` (add `seedLogins`)

**Interfaces:**
- Consumes: `seedTwoOrgs`, `cleanupOrgs`, `LIVE` from Phase 0a.
- Produces: `ENDPOINTS: EndpointSpec[]` where
  `EndpointSpec = { method: 'GET'|'POST'|'PATCH'|'DELETE'; path: string; roles: LibRole[]; anonymous?: boolean }`,
  and `seedLogins(orgId): Promise<Record<LibRole, string>>` returning an access token per role.

**Why this is second.** Phase 0a ships with no global JWT guard by design, and three of the four guards fail open when `LibJwtGuard` has not run — `BranchScopeGuard` grants all branches on an empty `branches` array, and `RequireFeatureGuard` resolves the plan from the *unauthenticated* host header. The final review's ruling: that is acceptable **only if the matrix is built before any tenant-data controller**. Every later task in this plan adds endpoints to `ENDPOINTS`, and the suite fails if an endpoint exists without a row.

- [ ] **Step 1: Write the endpoint table**

`apps/library-api/test/endpoints.ts`:

```ts
export type Role = 'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER';

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  /** Roles that must receive a non-401/403. Every other role must be denied. */
  roles: Role[];
  /** True when the route is deliberately reachable without a token. */
  anonymous?: boolean;
  /** A minimal valid body, for methods that need one. */
  body?: Record<string, unknown>;
}

export const ENDPOINTS: EndpointSpec[] = [
  { method: 'POST', path: '/auth/login', roles: [], anonymous: true, body: { identifier: 'x@y.z', password: 'nope' } },
  { method: 'POST', path: '/auth/refresh', roles: [], anonymous: true, body: { refreshToken: 'nope' } },
];
```

- [ ] **Step 2: Write the failing matrix suite**

`apps/library-api/test/authz-matrix.e2e.spec.ts`:

```ts
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { ENDPOINTS, type Role } from './endpoints';
import { LIVE, cleanupOrgs, seedTwoOrgs, seedLogins, type SeededOrg } from './helpers/live-db';

const ROLES: Role[] = ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER'];
const describeLive = LIVE ? describe : describe.skip;

describeLive('authz matrix — every role against every endpoint', () => {
  let app: import('@nestjs/common').INestApplication;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let tokens: Record<Role, string>;
  const host = (o: SeededOrg) => `${o.slug}.library.trackyour.in`;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(Date.now().toString(36)));
    tokens = await seedLogins(orgA.id);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app?.close(); await cleanupOrgs([orgA.id, orgB.id]); });

  it('covers every registered route', () => {
    const server = app.getHttpAdapter().getInstance();
    const registered: string[] = [];
    for (const layer of server._router?.stack ?? []) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) {
        registered.push(`${m.toUpperCase()} ${layer.route.path}`);
      }
    }
    const listed = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    const missing = registered.filter((r) => !listed.has(r));
    expect(missing).toEqual([]); // add the endpoint to test/endpoints.ts
  });

  for (const ep of ENDPOINTS) {
    for (const role of ROLES) {
      const allowed = ep.anonymous || ep.roles.includes(role);
      it(`${ep.method} ${ep.path} — ${role} is ${allowed ? 'allowed' : 'denied'}`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgA))
          .set('Authorization', `Bearer ${tokens[role]}`)
          .send(ep.body ?? {});
        if (allowed) expect([401, 403]).not.toContain(res.status);
        else expect([401, 403]).toContain(res.status);
      });
    }

    if (!ep.anonymous) {
      it(`${ep.method} ${ep.path} — rejects a token with no bearer at all`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgA))
          .send(ep.body ?? {});
        expect([401, 403]).toContain(res.status);
      });

      it(`${ep.method} ${ep.path} — rejects org A's token against org B's host`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgB))
          .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
          .send(ep.body ?? {});
        expect([401, 403]).toContain(res.status);
      });
    }
  }
});
```

- [ ] **Step 3: Run, confirm it fails, implement `seedLogins`**

```bash
set -a && source .env && set +a
pnpm --filter @library/api test:e2e
```
Expected: FAIL — `seedLogins` is not exported. Implement it in `test/helpers/live-db.ts`: create one `LibUser` per role in the given org with a known argon2id password, then mint an access token for each using the same signer the auth module uses.

- [ ] **Step 4: Confirm green and prove it catches an unlisted endpoint**

Add a throwaway controller with one route, run the suite, confirm the "covers every registered route" test fails naming it, then remove the controller.

- [ ] **Step 5: Commit**

```bash
git add apps/library-api/test/endpoints.ts apps/library-api/test/authz-matrix.e2e.spec.ts \
        apps/library-api/test/helpers/live-db.ts
git commit -m "test(library-api): authz matrix — every role against every endpoint"
```

---

### Task 3: Catalogue schema, full-text search index, and RLS

**Files:**
- Modify: `packages/library-db/prisma/schema.prisma`
- Create: `packages/library-db/prisma/migrations/<ts>_catalogue/migration.sql`
- Create: `packages/library-db/prisma/migrations/<ts>_catalogue_rls/migration.sql`
- Test: `packages/library-db/src/schema-shape.spec.ts` (extend)

**Interfaces:**
- Produces: models `Title`, `Author`, `TitleAuthor`, `Category`, `TitleCategory`, `Copy`; enums `AuthorRole` (`AUTHOR|EDITOR|TRANSLATOR`), `CopyCondition` (`NEW|GOOD|FAIR|POOR`), `CopyStatus` (`AVAILABLE|ON_LOAN|ON_HOLD_SHELF|IN_TRANSIT|LOST|DAMAGED|WITHDRAWN`).

- [ ] **Step 1: Add the models**

Append to `schema.prisma` (fields exactly as spec §5.2):

```prisma
enum AuthorRole { AUTHOR EDITOR TRANSLATOR }
enum CopyCondition { NEW GOOD FAIR POOR }
enum CopyStatus { AVAILABLE ON_LOAN ON_HOLD_SHELF IN_TRANSIT LOST DAMAGED WITHDRAWN }

model Title {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @db.Uuid
  isbn13        String?
  isbn10        String?
  title         String
  subtitle      String?
  publisher     String?
  publishedYear Int?
  edition       String?
  language      String   @default("en")
  callNumber    String?
  coverUrl      String?
  description   String?
  pageCount     Int?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  org        LibraryOrg     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  authors    TitleAuthor[]
  categories TitleCategory[]
  copies     Copy[]

  @@index([orgId])
  @@index([orgId, callNumber])
}

model Author {
  id       String @id @default(uuid()) @db.Uuid
  orgId    String @db.Uuid
  name     String
  sortName String

  org    LibraryOrg    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  titles TitleAuthor[]

  @@unique([orgId, sortName])
  @@index([orgId])
}

model TitleAuthor {
  titleId  String     @db.Uuid
  authorId String     @db.Uuid
  role     AuthorRole @default(AUTHOR)

  title  Title  @relation(fields: [titleId], references: [id], onDelete: Cascade)
  author Author @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@id([titleId, authorId, role])
  @@index([authorId])
}

model Category {
  id       String  @id @default(uuid()) @db.Uuid
  orgId    String  @db.Uuid
  name     String
  parentId String? @db.Uuid

  org      LibraryOrg      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  parent   Category?       @relation("CategoryTree", fields: [parentId], references: [id], onDelete: SetNull)
  children Category[]      @relation("CategoryTree")
  titles   TitleCategory[]

  @@unique([orgId, name])
  @@index([orgId])
}

model TitleCategory {
  titleId    String @db.Uuid
  categoryId String @db.Uuid

  title    Title    @relation(fields: [titleId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([titleId, categoryId])
  @@index([categoryId])
}

model Copy {
  id              String        @id @default(uuid()) @db.Uuid
  orgId           String        @db.Uuid
  titleId         String        @db.Uuid
  branchId        String        @db.Uuid
  barcode         String
  accessionNumber String?
  shelf           String?
  condition       CopyCondition @default(GOOD)
  acquiredAt      DateTime?
  acquisitionCost Decimal?      @db.Decimal(10, 2)
  status          CopyStatus    @default(AVAILABLE)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  org    LibraryOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  title  Title      @relation(fields: [titleId], references: [id], onDelete: Restrict)
  branch Branch     @relation(fields: [branchId], references: [id], onDelete: Restrict)

  @@unique([orgId, barcode])
  @@index([titleId, status])
  @@index([orgId, branchId, status])
}
```

Add the back-relations on `LibraryOrg` and `Branch`.

> `Copy.title` and `Copy.branch` use `onDelete: Restrict`, not Cascade: deleting a title that still has physical copies, or a branch that still holds stock, is a data-loss bug and should fail loudly.

- [ ] **Step 2: Generate the migration and add the search column by hand**

```bash
set -a && source .env && set +a
pnpm --filter @library/db exec prisma migrate dev --name catalogue --create-only
```

Prisma cannot express a generated `tsvector`. Append to the generated `migration.sql`:

```sql
-- Full-text search. A generated column keeps the vector in lockstep with the
-- row automatically, so no trigger and no application code can forget it.
-- GIN over tsvector is correct well past 1M titles per org; an external search
-- engine is never needed at school scale.
ALTER TABLE "Title"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("subtitle", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("publisher", '')), 'C') ||
    setweight(to_tsvector('simple', coalesce("callNumber", '')), 'C')
  ) STORED;

CREATE INDEX "title_search" ON "Title" USING GIN ("searchVector");
CREATE UNIQUE INDEX "title_isbn13_per_org" ON "Title" ("orgId", "isbn13") WHERE "isbn13" IS NOT NULL;
```

Add `searchVector Unsupported("tsvector")?` to the `Title` model so Prisma tolerates the column.

> Author names are deliberately **not** in the vector — they live in a joined table and a generated column cannot reach across a join. Task 6 handles author search with a separate `ILIKE` on `Author.sortName`, unioned into the result.

- [ ] **Step 3: Write the RLS migration**

`migrations/<ts+1>_catalogue_rls/migration.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Title','Author','Category','Copy'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) '
      'WITH CHECK ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Join tables carry no orgId; they are reachable only through a parent the
-- policies above already scope, and both FKs cascade from that parent.
ALTER TABLE "TitleAuthor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TitleAuthor" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "TitleAuthor"
  USING (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"));

ALTER TABLE "TitleCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TitleCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "TitleCategory"
  USING (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
```

> The join-table policies work because the `EXISTS` subquery is itself RLS-filtered — a `Title` from another org is invisible, so the row is unreachable. **The hardened `auditRlsCoverage` requires every policy to reference `app.current_org` literally**, and these do not. Add `TitleAuthor` and `TitleCategory` to the audit's allow-list with a comment explaining the indirection, and add a test asserting that a `TitleAuthor` row belonging to org B is invisible under org A's scope.

- [ ] **Step 4: Apply and verify tenancy holds on the new tables**

```bash
pnpm --filter @library/db exec prisma migrate deploy
pnpm --filter @library/db exec jest src/rls-audit.spec.ts
pnpm --filter @library/api test:e2e
```

Extend `apps/library-api/test/isolation.e2e.spec.ts` to cover `Title`, `Copy` and `TitleAuthor` the same way it covers `Member` and `Branch`.

- [ ] **Step 5: Commit**

```bash
git add packages/library-db/prisma/schema.prisma packages/library-db/prisma/migrations \
        packages/library-db/src/rls-audit.ts apps/library-api/test/isolation.e2e.spec.ts
git commit -m "feat(library-db): catalogue schema, full-text index and forced RLS"
```

---

### Task 4: Circulation schema, the concurrency constraints, and RLS

**Files:**
- Modify: `packages/library-db/prisma/schema.prisma`
- Create: `packages/library-db/prisma/migrations/<ts>_circulation/migration.sql`
- Create: `packages/library-db/prisma/migrations/<ts>_circulation_rls/migration.sql`
- Test: `apps/library-api/test/loan-constraints.e2e.spec.ts`

**Interfaces:**
- Produces: models `CirculationPolicy`, `Loan`, `Hold`, `Fine`; enums `LoanStatus` (`ACTIVE|RETURNED|LOST`), `HoldStatus` (`PENDING|READY|COLLECTED|EXPIRED|CANCELLED`), `FineKind` (`OVERDUE|DAMAGE|LOST|OTHER`), `FineStatus` (`OPEN|PAID|WAIVED|PARTIAL`).

- [ ] **Step 1: Add the models**

Per spec §5.3. `Loan` has `issuedAt, dueAt, returnedAt, renewCount, issuedByUserId, returnedByUserId, status`. **No `OVERDUE` in `LoanStatus`** — it is computed. `Hold` is keyed on `titleId`, not `copyId`, with `queuePosition`, `readyCopyId`, `readyAt`, `expiresAt`.

- [ ] **Step 2: Add the constraints that carry correctness**

Append to the generated `migration.sql`:

```sql
-- A copy can have at most ONE active loan, ever. Two desks scanning the same
-- barcode simultaneously: the loser gets a 409 from the database. Constraints
-- do not race; application check-then-write does.
CREATE UNIQUE INDEX "loan_one_active_per_copy"
  ON "Loan" ("copyId") WHERE "returnedAt" IS NULL;

-- One pending or ready hold per member per title.
CREATE UNIQUE INDEX "hold_one_pending_per_member_title"
  ON "Hold" ("memberId", "titleId") WHERE "status" IN ('PENDING', 'READY');

-- The hot read paths. "Overdue loans" is one indexed range scan over dueAt,
-- not a status scan over a column a cron has to keep fresh.
CREATE INDEX "loan_member_active" ON "Loan" ("orgId", "memberId") WHERE "returnedAt" IS NULL;
CREATE INDEX "loan_due"           ON "Loan" ("orgId", "dueAt")    WHERE "returnedAt" IS NULL;
CREATE INDEX "hold_title_queue"   ON "Hold" ("titleId", "queuePosition") WHERE "status" = 'PENDING';
CREATE INDEX "fine_member_open"   ON "Fine" ("orgId", "memberId") WHERE "status" IN ('OPEN', 'PARTIAL');
```

- [ ] **Step 3: Write the RLS migration** — same shape as Task 3 Step 3, for `CirculationPolicy`, `Loan`, `Hold`, `Fine`.

- [ ] **Step 4: Write the failing constraint test**

`apps/library-api/test/loan-constraints.e2e.spec.ts` — seed an org, a branch, a title, one copy, two members. Fire **two concurrent** transactions behind a barrier, each creating a `Loan` on the same copy. Assert exactly one succeeds and the other rejects, then assert exactly one row exists.

Prove it discriminates: drop the partial unique index, watch both succeed, recreate it.

- [ ] **Step 5: Apply, run, commit**

```bash
pnpm --filter @library/db exec prisma migrate deploy
pnpm --filter @library/api test:e2e
git add packages/library-db/prisma apps/library-api/test/loan-constraints.e2e.spec.ts
git commit -m "feat(library-db): circulation schema with database-enforced loan uniqueness"
```

---

### Task 5: The circulation policy engine — pure, exhaustively tested

**Files:**
- Create: `apps/library-api/src/modules/circulation/internal/policy.ts`
- Test: `apps/library-api/src/modules/circulation/internal/policy.spec.ts`

**Interfaces:**
- Produces, all pure and clock-injected:

```ts
export type IssueDenial =
  | 'MEMBER_NOT_ACTIVE' | 'MEMBER_LIMIT_REACHED' | 'COPY_NOT_AVAILABLE'
  | 'COPY_ON_HOLD_FOR_OTHER' | 'OUTSTANDING_FINES_EXCEED_LIMIT' | 'BRANCH_MISMATCH';

export interface Policy {
  maxBooks: number; loanDays: number; renewLimit: number; renewDays: number;
  finePerDay: number; graceDays: number; maxFine: number | null;
  maxHolds: number; holdShelfDays: number; maxOutstandingFine: number | null;
}

evaluateIssue(p: Policy, member, copy, openLoans, openFineTotal, now: Date):
  { allowed: true; dueAt: Date } | { allowed: false; reason: IssueDenial }

evaluateRenew(p: Policy, loan, pendingHoldsOnTitle: number, now: Date):
  { allowed: true; newDueAt: Date } | { allowed: false; reason: 'RENEW_LIMIT' | 'HAS_HOLDS' | 'ALREADY_OVERDUE' }

computeFine(p: Policy, dueAt: Date, at: Date): { days: number; amount: number }
loanState(loan, now: Date): 'ACTIVE' | 'DUE_SOON' | 'OVERDUE' | 'RETURNED'
nextHoldToPromote(holds, now: Date): Hold | null
```

- [ ] **Step 1: Write the table-driven failing tests**

Cover at minimum: a member at exactly `maxBooks` is denied and one below is allowed; a suspended member is denied; a copy that is `ON_HOLD_SHELF` for someone else is denied but for *this* member is allowed; fines below `maxOutstandingFine` allow and at-or-above deny; `graceDays` fully absorbed produces a zero fine and one day past grace produces exactly `finePerDay`; `maxFine` caps a long overdue; renewal is refused when the title has pending holds; renewal is refused at `renewLimit`; `loanState` returns `DUE_SOON` inside the window and `OVERDUE` one second after `dueAt`; `nextHoldToPromote` skips an expired hold and returns the lowest queue position.

Every case takes an explicit `now` — never `new Date()` inside a test.

- [ ] **Step 2-4:** Run red, implement, run green.

- [ ] **Step 5: Commit**

```bash
git add apps/library-api/src/modules/circulation/internal/policy.ts \
        apps/library-api/src/modules/circulation/internal/policy.spec.ts
git commit -m "feat(library-api): pure circulation policy engine"
```

---

### Task 6: Catalogue service, controller and search

**Files:** `apps/library-api/src/modules/catalog/**`, `apps/library-api/test/endpoints.ts` (extend)

**Interfaces:**
- Consumes: `withOrg`, `LibraryTx`; `LibJwtGuard`, `RolesGuard`, `BranchScopeGuard`, `RequireFeatureGuard`; `assertQuota`.
- Produces: `GET /catalog/titles` (search), `POST /catalog/titles`, `GET /catalog/titles/:id`, `PATCH /catalog/titles/:id`, `DELETE /catalog/titles/:id`, `POST /catalog/titles/:id/copies`, `PATCH /catalog/copies/:id`, `GET /catalog/copies/by-barcode/:barcode`, `GET /catalog/categories`, `POST /catalog/categories`.

- [ ] **Step 1: Add every endpoint to `test/endpoints.ts` first.** The matrix suite will fail until the controller exists — that is the intended order. `ASSISTANT` gets read-only (`GET` only); `LIBRARIAN` and `ORG_OWNER` get writes; `MEMBER` gets search and title detail only.

- [ ] **Step 2: Write the search test**

Search must rank title matches above publisher matches, match a partial word prefix, find a title by its author's name, and return results scoped to the caller's org only. Table-driven against seeded fixtures.

- [ ] **Step 3-4: Implement, confirm green.**

Search combines a `tsvector` query with an author `ILIKE`, unioned and de-duplicated, ordered by `ts_rank` then title. Use `to_tsquery` with `:*` prefix matching on the last term. Parameterise everything — never interpolate the query string.

- [ ] **Step 5: Commit.**

---

### Task 7: ISBN lookup and CSV bulk import

**Files:** `apps/library-api/src/modules/catalog/internal/import.service.ts` + spec

**Interfaces:**
- Produces: `POST /catalog/import/titles` (multipart CSV, `?dryRun=true`), `GET /catalog/isbn/:isbn`.
- `importTitles(orgId, rows, opts): Promise<{ created: number; updated: number; skipped: number; errors: RowError[] }>` where `RowError = { row: number; field: string; message: string }`.

**Why now, not later.** Sckools has no bulk import, which makes onboarding a 600-student school a week of manual entry. A library with 8,000 copies is worse. This ships with the catalogue, not after it.

- [ ] Dry run returns the same diff the real run would apply, without writing.
- [ ] Per-row errors are reported with row number and field; one bad row does not abort the file.
- [ ] Idempotent by ISBN within an org — re-importing the same file updates rather than duplicating.
- [ ] Hard cap of 2,000 rows per request so it fits the 60s function budget; over that returns 413 naming the limit.
- [ ] ISBN lookup calls Open Library, with a timeout, and degrades to "not found" rather than failing the request.

---

### Task 8: Issue and return

**Files:** `apps/library-api/src/modules/circulation/internal/loans.service.ts` + spec + e2e

**Interfaces:**
- Produces: `POST /circulation/issue` `{ barcode, memberId }`, `POST /circulation/return` `{ barcode }`.

- [ ] **Issue**, in one transaction: resolve copy by barcode → load member, policy, open loans, open fine total → `evaluateIssue` → create `Loan`, set `Copy.status = ON_LOAN`, write `AuditLog`. If the copy was `ON_HOLD_SHELF` for this member, mark that hold `COLLECTED` in the same transaction.
- [ ] **Return**, in one transaction: resolve the active loan → set `returnedAt` → `computeFine`, creating a `Fine` row **only if amount > 0** → then either promote the next hold (`Copy.status = ON_HOLD_SHELF`, hold → `READY`, queue a `HOLD_READY` outbox row) or set `Copy.status = AVAILABLE`.
- [ ] Hold promotion takes `SELECT … FOR UPDATE` on the title's pending holds so two simultaneous returns cannot promote the same hold twice. Prove it with a barrier-forced concurrent test.
- [ ] Both endpoints accept `Idempotency-Key` — a barcode scanner double-fire must not create two loans. Note the interceptor converges the *response* but the handler can still run twice concurrently, so the partial unique index from Task 4 is what actually prevents the double loan. Assert that in a test.
- [ ] Full flow e2e: issue → return on time (no fine) → issue → return late (fine matches `computeFine` to the rupee).

---

### Task 9: Renew and holds

**Files:** `apps/library-api/src/modules/circulation/internal/holds.service.ts` + spec + e2e

**Interfaces:**
- Produces: `POST /circulation/renew`, `POST /circulation/holds`, `DELETE /circulation/holds/:id`, `GET /circulation/holds`.

- [ ] Renew refuses when the title has pending holds — the rule that keeps a queue moving.
- [ ] Holds are placed on a **title**, queue position assigned under `FOR UPDATE`.
- [ ] A `READY` hold expires after `policy.holdShelfDays`, computed at read time and swept opportunistically on the next return for that title. **No cron.**
- [ ] `maxHolds` enforced via `assertQuota`'s advisory-lock pattern.
- [ ] E2E: two members hold the same title → return promotes exactly the first → they collect → second promotes → let it expire → third promotes.

---

### Task 10: Fines, waivers, and the day-end report

**Files:** `apps/library-api/src/modules/circulation/internal/fines.service.ts` + spec + e2e

**Interfaces:**
- Produces: `GET /circulation/fines`, `POST /circulation/fines/:id/waive`, `GET /circulation/overdue`, `GET /circulation/day-report`.

- [ ] Waiver requires `LIBRARIAN` or `ORG_OWNER` — **`ASSISTANT` must be denied**, asserted in the matrix.
- [ ] A waiver records `waivedByUserId`, `waivedAmount` and `waivedReason`, and writes an `AuditLog` row.
- [ ] `GET /circulation/overdue` is one indexed range scan on `loan_due` — assert with `EXPLAIN` in a test that it uses the index and does not sequential-scan.
- [ ] `GET /circulation/day-report` returns issued / returned / overdue / fines-accrued for a date, reconciling to the rupee against seeded fixtures.

---

## Self-review

**Spec coverage.** §5.2 → Task 3 · §5.3 → Task 4 · §6.1 policy engine → Task 5 · §6.2 issue/return/renew/hold → Tasks 8-9 · §6.3 no-scheduler → enforced in Tasks 4, 9 · §6.4 concurrency → Tasks 4, 8, 9 · §9.6 bulk import → Task 7 · fines → Task 10 · search → Task 6.

**Carry-forward from Phase 0a.** Refresh grace window → Task 1. Authz matrix → Task 2. *Still open after this plan and belonging to 1b or later:* `PlanResolverService.invalidate()` wiring (needs the org console), login throttling per `(org, identifier)`, and org-cache suspension invalidation.

**Known gap deliberately left.** The notification outbox is referenced by Task 8's hold promotion but is not built until Phase 4. Task 8 writes the outbox row; nothing drains it yet. That is correct — the row is the durable record and the drain is a later concern — but the e2e must assert the row is written, not that a message was sent.

**Type consistency checked.** `Policy` in Task 5 matches the `CirculationPolicy` columns in Task 4. `CopyStatus` values used in Tasks 8-9 match the enum in Task 3. `IssueDenial` members are referenced only in Tasks 5 and 8, identically.
