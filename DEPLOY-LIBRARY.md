# Deploying the library service

Two Vercel projects, one database schema, one DNS record. The library is a
**separate microservice** — nothing here touches the Sckools projects, and
nothing in Sckools' deploy config should ever reference `@library/*`.

---

## Why `vercel.json` carries no comments

Both `vercel.json` files in this service are plain JSON with no `"//"` keys.

That is deliberate. Vercel validates `vercel.json` against a schema at
deploy-creation time and rejects the **entire deployment** when it fails — not
the offending line, the whole thing. This repo has already lost 15 preview
deploys to a config-level fault that no local build caught, and a sub-daily
cron once rejected a whole deployment the same way. An unknown property inside
a `headers` array item is not worth finding out about from a failed deploy, so
the reasoning lives in this file instead.

### `apps/library-web/vercel.json`

| Setting | Why |
|---|---|
| `regions: ["bom1"]` | Same region as `library-api` and the staging Postgres. A console rendering in Mumbai that calls an API in Washington pays a round trip on every request for nothing. |
| `buildCommand` filters to `@library/web` | It deliberately does **not** run `@library/db generate`. This app never imports Prisma — it talks to `library-api` over HTTP — and adding the client would give the console a build-time dependency on a database it is not supposed to know about. |
| `Cache-Control: private, no-store` on `/console/*` | Every response is scoped to one librarian's token and one tenant. A shared cache here would serve one school's overdue list to another school. |
| Security headers on `/(.*)` | Tokens live in `localStorage` (see `lib/session.ts`, which is honest about the trade-off). The mitigation is a strict transport/CSP posture on console routes, not the storage choice. |

`connect-src` is **not** pinned in the config because the API origin differs
between staging and production; it comes from `NEXT_PUBLIC_LIBRARY_API_URL`.

### `apps/library-api/vercel.json`

Already in place. Bundles with `ncc` into a single `api/index.js`, routes
everything to it, and runs one **daily** cron. Daily matters: a sub-daily cron
on a Hobby plan makes Vercel reject the whole deployment.

---

## What has to exist before the first deploy

Four things, and three of them are decisions only the account owner can make.

1. **A `library` schema on the staging Postgres**, with the service's two roles.
   The library keeps its own `_prisma_migrations` under `?schema=library`, which
   is what stops its migrations colliding with Sckools'.
2. **Migrations run against staging.** Every schema change on this project has
   been gated by the owner; these are no exception.
3. **A Redis URL** for rate limiting and the tenant-lookup cache. Upstash is fine.
4. **The Supabase token rotated.** It was published in a chat log against a
   public repository.

---

## Environment variables

### `library-api`

| Name | Notes |
|---|---|
| `LIBRARY_DATABASE_URL` | Pooled, `?schema=library`, `connection_limit=1`. Serverless makes connections the scarce resource, not CPU. |
| `LIBRARY_DIRECT_URL` | Direct (non-pooled). The Prisma CLI needs this for migrations; the pooler cannot run them. |
| `LIBRARY_DATABASE_URL_APP` | The RLS-bound application role. Neither owner nor superuser nor `BYPASSRLS` — that is what actually binds it to the row-level policies. |
| `LIBRARY_DATABASE_URL_PLATFORM` | The `BYPASSRLS` role. Seed and platform-level lookups only. |
| `LIBRARY_REDIS_URL` | Throttler + org lookup cache. |
| `LIBRARY_JWT_SECRET` | Access tokens. |
| `LIBRARY_REFRESH_SECRET` | Refresh tokens. Must differ from the access secret. |
| `LIBRARY_PLATFORM_HOST` | The host that resolves to platform context rather than a tenant. |

### `library-web`

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_LIBRARY_API_URL` | The `library-api` deployment's origin. Public by necessity — it is called from the browser. |

---

## Tenancy on staging

The API resolves the tenant from the **`X-Library-Host` header**, not the URL,
because Vercel's ingress overwrites `X-Forwarded-Host`. The web client sends it
on every request (`lib/api.ts`). A request without it resolves to
`{ kind: 'unknown' }` and 401s with no clue why — that is the first thing to
check if staging appears to reject valid logins.

Each school is a subdomain of the library host, e.g.
`raffles.library.trackyour.in`. A token's org must match the host-resolved org;
the API rejects a valid token presented against another tenant's host, and that
control is what makes an unauthenticated host header safe.

---

## Verifying the deploy

Do not stop at "the build went green". Drive the product:

1. `GET /ready` on the API — it checks the database and Redis, and fails fast
   rather than hanging when Redis is unreachable.
2. Log in to the console as a seeded librarian.
3. Search a member by name and by code.
4. Issue a book, renew it, return it, and confirm the fine.
5. Open holds, overdue and fines and confirm every row names a person and a book.

Step 5 exists because a shape can be right while the data behind it is empty —
the local hydration path looked fine for a while precisely because those lists
had no rows in them.
