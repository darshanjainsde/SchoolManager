# SkoolOS — Architecture

> Living document. Updated each phase. Source of truth for "why" decisions.

## 1. Stack

| Layer            | Choice                                                              |
| ---------------- | ------------------------------------------------------------------- |
| Web              | Next.js 14 (App Router), TS, Tailwind, shadcn/ui, React Query       |
| API              | NestJS 10 (TS) REST + OpenAPI/Swagger                               |
| Worker           | Node + BullMQ consumer (`apps/worker`)                              |
| DB               | PostgreSQL 16 + Prisma ORM + **Row-Level Security**                 |
| Cache / queues   | Redis 7 (cache, sessions, rate-limit, BullMQ broker)                |
| Object storage   | S3-compatible. **MinIO** locally → S3/R2 in prod (env-swap, no code change) |
| Mail (dev)       | MailHog SMTP                                                        |
| Auth (Phase 1+)  | JWT access+refresh, Argon2id, RBAC, audience-scoped tokens, TOTP 2FA for platform owner |
| Realtime (Ph 6)  | WebSocket gateway (NestJS)                                          |
| Payments (Ph 5)  | Stripe (test mode locally; live keys in prod)                       |
| Observability    | pino structured logs + OpenTelemetry hooks + Prometheus/Grafana (Phase 7) |
| Local infra      | Docker Compose for all dependencies, swappable via env              |
| CI               | GitHub Actions: install, lint, typecheck, **module-boundary**, build, test |

## 2. Repo layout (modular monolith)

```
apps/
  api/      NestJS — one deployable, internally split into isolated domain modules
  web/      Next.js — public site, tenant portals, /platform owner portal (Ph 2)
  worker/   BullMQ consumer — provisioning, report-card PDFs, domain verification, etc.
packages/
  db/       Prisma schema + client (shared by api + worker)
  types/    DTOs, enums, domain-event types (shared)
  config/   zod-validated env loader (shared)
```

### 2.1 Module isolation inside `apps/api`

Each domain module lives under `apps/api/src/modules/<name>/`:

```
modules/<name>/
  index.ts            ← PUBLIC INTERFACE. Only file siblings may import.
  internal/           ← implementation (controllers, services, repos, DTOs)
```

Cross-module access rules (enforced by `dependency-cruiser` in CI):

1. A module **publishes a service / interface** by re-exporting it from `index.ts`.
2. A consumer **imports only the published symbol** — never anything under `internal/`.
3. For loose coupling, modules prefer the **internal event bus** (`common/event-bus`)
   over direct calls. Publishers emit typed `DomainEvent`s; consumers subscribe.
4. Each module **owns its tables** — no other module reads/writes them directly.

These rules are what makes the monolith **extraction-ready**: each module is already
"shaped like" its own service.

## 3. Multi-tenancy

- **Shared database, shared schema.** Every tenant-scoped row carries `school_id UUID`.
- **Postgres Row-Level Security (RLS)** + `SET LOCAL app.current_tenant = '<uuid>'` at
  request scope → DB itself refuses cross-tenant reads even if the app forgets to filter.
- **App-layer scoping** (repository helpers) as defense-in-depth.
- **Tenant resolution at the edge** (Phase 1): either a platform subdomain
  (`acme.localhost` / `acme.skoolos.app`) or a verified custom domain. A
  Redis-backed `hostname → school_id` map gives O(1) routing; invalidated on
  domain changes.
- **Platform owner** uses a privileged DB role that bypasses RLS, served on a
  separate host (`owner.localhost`) with TOTP 2FA. School-user tokens and
  platform tokens have distinct audiences and are non-interchangeable.

### Trade-off: shared-schema vs schema-per-tenant

Chose shared-schema with RLS because:

- **One migration path** for thousands of tenants (schema-per-tenant compounds
  migration risk with every onboarding).
- **Cheaper connections** — no need for per-schema connection routing.
- **Better tooling/visibility** — analytics and platform-owner views are
  trivial joins, not federated queries.

The cost is operational discipline: every query must be RLS-aware. We mitigate
with (a) RLS as a hard backstop, (b) repository helpers that always inject
`school_id`, (c) recurring tenant-isolation tests in CI.

## 4. Access control — two mandatory layers

| Layer | What it enforces                                                       | Where |
| ----- | ---------------------------------------------------------------------- | ----- |
| A     | Tenant isolation: no school can see another's data                     | Postgres RLS + middleware |
| B     | Role + object-level authorization within a school                      | Central policy/guard service per endpoint |

The URL is never trusted: a student hitting `/api/students/<otherId>` or
`/api/invoices/<not-theirs>` must always get 403/404, never data. UI hiding is
not security. Phase 1 wires the central guard (CASL or policy services) and
adds **IDOR tests** that become a recurring part of the suite.

## 5. Scaling story

### Today (Phase 0)

One Postgres, one Redis, stateless API/worker — adding API replicas linearly
adds throughput. All shared state lives in Redis/Postgres.

### Documented vertical/horizontal path (no code change)

1. **Resize** Postgres + storage when CPU/IO trip thresholds.
2. **Read replicas.** Route attendance/results/report-card reads to replicas;
   writes stay on the primary. The repository layer is the integration point.
3. **PgBouncer** in front of Postgres (transaction pooling) so API replicas
   don't blow out connection counts.
4. **Per-tenant usage view** (Phase 7) attributes row-count and storage so we
   can size and bill by tenant.
5. **Horizontal sharding (much later).** Because every row is keyed by
   `school_id`, tenants are partitionable across clusters when a single
   instance hits its ceiling.

### Module extraction (later, demand-driven)

The lint rule already enforces extraction-readiness. Likely first extractions
(in order) and the trigger metrics that would justify each:

| Module        | Likely first because…                                                  | Trigger to extract                                  |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `comms`       | High fan-out at announcement/notification time; bursty                 | p95 latency on the API affected by comms broadcasts |
| `attendance`  | Very high write throughput at start-of-day windows                     | DB write IOPS saturating attendance write paths     |
| `auth`        | Independent scaling for login spikes; security blast-radius isolation  | Login/refresh QPS approaches API saturation         |

Extraction does **not** require a data-model rewrite — each module owns its
tables today, talks to others via published interfaces, and emits domain
events. Lift `comms` into its own service when (and only when) load data
justifies the operational cost.

## 6. Custom domain handling (Phase 2)

- The platform never registers or auto-configures DNS. The owner buys each
  school's domain at its own registrar.
- For each domain added in the portal, we **show the exact DNS records to
  paste** at the registrar (CNAME for subdomains → `INGRESS_CNAME_TARGET`,
  apex A/ALIAS → `INGRESS_A_RECORD`).
- A "Verify" BullMQ job resolves DNS + hits the host; status transitions
  `PENDING → VERIFYING → LIVE` or `ERROR`. cert-manager issues TLS on `LIVE`.
- Routing: the `hostname → school_id` Redis map is updated atomically when a
  domain flips to `LIVE`.

## 7. Phase 1 — what's now in place

| Concern                  | Implementation                                                        |
| ------------------------ | --------------------------------------------------------------------- |
| Tenancy resolver         | Express middleware → `hostname → schoolId` via Redis-backed lookup    |
| Tenant context           | `AsyncLocalStorage` — services read it without threading args         |
| RLS                      | Forced on every tenant table; `current_setting('app.current_tenant')` |
| DB roles                 | `skoolos_app` (RLS-bound) + `skoolos_platform` (BYPASSRLS)            |
| `withTenant(id, fn)`     | Wraps every tenant query in a tx with `SET LOCAL app.current_tenant`  |
| Password hashing         | Argon2id, OWASP-2023 default params                                   |
| JWT — school audience    | Distinct secrets per audience; `schoolId` claim re-validated per req   |
| JWT — platform audience  | Distinct secrets; platform tokens can never validate against school   |
| 2FA                      | Mandatory TOTP on platform login (otplib); identical-error messages   |
| Refresh rotation         | Per-rotation token row + `familyId`; reuse → revoke whole family      |
| Failed-login lockout     | 5 attempts → 15-min lockout, same path for user + platform users      |
| Platform host boundary   | `PlatformHostGuard` refuses platform routes on tenant subdomains      |
| Rate limiting            | `@nestjs/throttler` global + tighter per-endpoint limits on auth      |
| Audit log                | Interceptor on mutations → audit row via the platform Prisma          |
| Module boundaries        | `dependency-cruiser` rule fails CI on cross-module `internal/` imports |

## 8. Phase-by-phase delivery

Done: Phase 0 (scaffold) · Phase 1 (auth/tenancy/RLS).
Next: Phase 2 (owner portal + onboarding wizard + custom-domain DNS flow),
then School admin core, Teaching, CRM + Finance, Portals, Hardening + load,
Production handoff docs.
