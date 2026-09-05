# SkoolOS

Multi-tenant School Management SaaS. **Phase 1: Auth, RBAC & multi-tenant core.**
See `docs/ARCHITECTURE.md` for the big-picture stack and scaling story.

## Quick start (local)

```bash
# 1. Copy env
cp .env.example .env

# 2. Bring up infra (Postgres, Redis, MinIO, MailHog)
docker compose up -d

# 3. Install deps and generate Prisma client
#    (re-run `pnpm install` after every branch switch — branches pin different
#     majors, and a stale node_modules fails as confusing type errors instead.
#     See docs/DEPENDENCIES.md)
pnpm install
pnpm db:generate

# 4. Apply migrations (creates schema + RLS policies + skoolos_app / skoolos_platform roles)
pnpm db:migrate     # accept default name on first run

# 5. Seed two demo schools + a platform owner
pnpm db:seed

# 6. Start everything (api on :3001, web on :3000, worker on :3002)
pnpm dev
```

Then visit:

| URL                              | What                              |
| -------------------------------- | --------------------------------- |
| http://localhost:3000            | Web landing page (shows API health) |
| http://localhost:3001/health     | API health probe                  |
| http://localhost:3001/ready      | API readiness (db + redis)        |
| http://localhost:3001/api/docs   | Swagger / OpenAPI                 |
| http://localhost:8025            | MailHog (captured emails)         |
| http://localhost:9001            | MinIO console                     |

## Workspace layout

```
apps/
  api/      NestJS REST API + Swagger + module-boundary monolith
  web/      Next.js 14 App Router
  worker/   BullMQ consumer
packages/
  db/       Prisma schema + client
  types/    Shared TS types & domain events
  config/   zod-validated env loader
```

## CI-equivalent checks (run locally before pushing)

```bash
pnpm lint
pnpm typecheck
pnpm boundary       # module-boundary rule — fails on cross-module internal imports
pnpm build
pnpm test
```

## Demo credentials (after `pnpm db:seed`)

| Tenant     | URL (Host header)              | Email                    | Password    |
| ---------- | ------------------------------ | ------------------------ | ----------- |
| Acme       | `acme.localhost:3001`          | `admin@acme.test`        | `Passw0rd!` |
| Acme       | `acme.localhost:3001`          | `teacher@acme.test`      | `Passw0rd!` |
| Acme       | `acme.localhost:3001`          | `student@acme.test`      | `Passw0rd!` |
| Acme       | `acme.localhost:3001`          | `parent@acme.test`       | `Passw0rd!` |
| Acme       | `acme.localhost:3001`          | `staff@acme.test`        | `Passw0rd!` |
| Beacon     | `beacon.localhost:3001`        | `<role>@beacon.test`     | `Passw0rd!` |
| **Owner**  | `owner.localhost:3001`         | `owner@skoolos.local`    | `OwnerPassw0rd!` + TOTP |

The platform-owner TOTP secret + current code are printed at the end of
`pnpm db:seed`. Add the otpauth URL to your authenticator app, then log in at
`/platform/auth/login` with the host header `owner.localhost`.

### Try it

```bash
# School admin login
curl -H "Host: acme.localhost" -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@acme.test","password":"Passw0rd!"}'

# Platform owner login (replace 123456 with current TOTP)
curl -H "Host: owner.localhost" -X POST http://localhost:3001/platform/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@skoolos.local","password":"OwnerPassw0rd!","totp":"123456"}'
```

## Security tests

Phase 1 ships 23 integration tests covering tenant isolation, Postgres-level
RLS, IDOR / object-level authz, role isolation, platform boundary, JWT
audience separation, account lockout, and refresh-token rotation with reuse
detection:

```bash
pnpm --filter @skoolos/api test:e2e
```

## What's next

Type `continue` to start Phase 2: Platform Owner Portal + School Onboarding
Wizard (the headline feature — provision a new school + custom domain in one
form).
