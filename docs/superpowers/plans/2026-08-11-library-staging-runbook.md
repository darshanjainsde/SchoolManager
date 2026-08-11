# Library service — staging runbook

**Staging is LIVE as of 2026-08-11.** Migrations applied, RLS verified enforcing,
seed data in place. This file records how, so it is repeatable.

## Facts

| | |
|---|---|
| Supabase project | `pnczxkyteaocpdoufwyz` (ap-south-1) |
| Pooler host | `aws-1-ap-south-1.pooler.supabase.com` — `:6543` runtime, `:5432` migrations |
| Username form | `<role>.pnczxkyteaocpdoufwyz` |
| Schemas | `library`, `testboard` |
| Orgs seeded | `raffles` (300 members), `northgate` (5) — the second exists so isolation has a tenant to fail against |
| Logins | `owner@raffles.test`, `librarian@raffles.test` — password from `LIBRARY_SEED_PASSWORD` (currently `password`) |

## Why migrations do NOT run as `postgres`

Supabase's `postgres` role is **not a true superuser** — it cannot
`ALTER DEFAULT PRIVILEGES FOR ROLE <other>` (42501). And its password was never
needed: the Supabase **Management API** runs SQL as `postgres` directly, which is how
the one-time grant below was made.

```
POST https://api.supabase.com/v1/projects/<ref>/database/query
Authorization: Bearer <sbp_ PAT>
{"query":"..."}
```

One-time grant, already applied:

```sql
GRANT CREATE ON SCHEMA library   TO library_platform;
GRANT CREATE ON SCHEMA testboard TO testboard_app;
```

`library_app` deliberately has **no** CREATE — verified
`has_schema_privilege('library_app','library','CREATE') = false`. That is what keeps
it a pure runtime role.

Migrations therefore run as **`library_platform`**. Tables end up owned by it rather
than `postgres`; that is safe because what protects tenancy is `relrowsecurity` plus
`library_app` being neither owner, superuser, nor BYPASSRLS — not `FORCE`. The RLS
migration itself carries the explicit `GRANT ... ON ALL TABLES` that `library_app`
needs, so no default-privileges rule is required.

## Deploy migrations to staging

```bash
export LIBRARY_DIRECT_URL='postgresql://library_platform.pnczxkyteaocpdoufwyz:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?schema=library'
export LIBRARY_DATABASE_URL="$LIBRARY_DIRECT_URL"
pnpm --filter @library/db exec prisma migrate deploy
```

## Verify tenancy actually holds (run after every migration)

```bash
export LIBRARY_DATABASE_URL_PLATFORM='postgresql://library_platform....:5432/postgres?schema=library'
export LIBRARY_DATABASE_URL_APP='postgresql://library_app....:5432/postgres?schema=library'
pnpm --filter @library/db exec jest src/rls-audit.spec.ts    # schema-wide policy audit
pnpm --filter @library/api exec jest --config test/jest-e2e.config.js --runInBand
```

Both were green against staging on 2026-08-11 — 4 audit tests and 9 e2e, including
the isolation suite that asserts an unscoped query returns zero rows.

## Seed

```bash
export LIBRARY_SEED_PASSWORD='<pw>'
pnpm --filter @library/db seed     # idempotent; safe to re-run
```

## OWED: credential rotation

Every credential below passed through a chat log, and the repo is public.

1. **Supabase PAT** (`sbp_…`) — highest priority. It runs SQL as `postgres` on the
   whole project and is not scoped to this schema.
2. **`library_platform`** — `BYPASSRLS` means this password reads every tenant.
3. `library_app`, `testboard_app` — all three currently share one weak value.
4. Upstash Redis token; GitHub PAT.

Rotate before staging holds anything real.
