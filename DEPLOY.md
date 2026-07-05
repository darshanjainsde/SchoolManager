# Deploying SkoolOS to Vercel

This is a pnpm/Turbo monorepo with two deployable apps:

- **`apps/web`** — Next.js 14 (the public sites, owner portal, school admin, student portal)
- **`apps/api`** — NestJS 10 (runs on Vercel as a serverless function via `apps/api/server.ts`)

Plus managed services: **Postgres** (Neon), **Redis** (Upstash), **object storage** (Vercel Blob or S3), and **SMTP**.

The multi-tenant magic is already in the code: the app resolves each school from the request Host header, with a subdomain slug-fallback (`<slug>.PLATFORM_HOST`). So **onboarding a school = the owner clicks "Add School" and it's instantly live at `<slug>.skoolos.app`** — no per-school deploy or DNS.

---

## 0. One-time prerequisites

```bash
npm i -g vercel
vercel login
vercel link --repo        # creates .vercel/repo.json (monorepo)
```

Create **two Vercel projects** from this repo (dashboard → Add New → Project → same Git repo, twice):

| Project | Root Directory | Framework |
|---|---|---|
| `skoolos-web` | `apps/web` | Next.js (auto) |
| `skoolos-api` | `apps/api` | Other (Node) |

Each app has its own `vercel.json` (install runs from the repo root and generates the Prisma client).

---

## 1. Database (Neon) — the one thing to get right

The app uses **Postgres RLS with two roles**: `skoolos_app` (RLS-enforced, non-superuser) and `skoolos_platform` (BYPASSRLS). Migrations run as the owner/superuser. Neon supports custom roles + RLS, so it fits.

1. Create a Neon project + database `skoolos`.
2. Run the role setup once (the migration `20260703_000100_rls_and_roles` creates these, but confirm the roles exist and the passwords match your env). If setting up manually as the Neon owner:
   ```sql
   CREATE ROLE skoolos_app LOGIN PASSWORD '<app-pw>';
   CREATE ROLE skoolos_platform LOGIN PASSWORD '<platform-pw>' BYPASSRLS;
   GRANT USAGE ON SCHEMA public TO skoolos_app, skoolos_platform;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skoolos_app, skoolos_platform;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skoolos_app, skoolos_platform;
   ```
3. **Use the POOLED connection string** (Neon's `-pooler` host) for `DATABASE_URL_APP` and `DATABASE_URL_PLATFORM` — serverless functions open many short-lived connections and will exhaust a direct connection. Use the direct (non-pooled) string for `DATABASE_URL` (migrations only).
4. Apply migrations (from your machine or CI, as the owner role):
   ```bash
   DATABASE_URL='<direct owner url>' pnpm --filter @skoolos/db exec prisma migrate deploy
   ```
5. Seed the owner + demo data if you want (optional):
   ```bash
   DATABASE_URL='<direct owner url>' pnpm --filter @skoolos/db seed
   ```

---

## 2. Redis (Upstash) & storage & email

- **Upstash Redis** → `REDIS_URL` (`rediss://…`). Used for the host-lookup cache, feature cache, and rate limiting.
- **Vercel Blob** (or any S3-compatible bucket) → `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET`.
- **SMTP** (Postmark/Resend/SES) → `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`.

> The BullMQ worker (`apps/worker`) is a health-only stub and is **not** deployed — nothing long-running is required.

---

## 3. Environment variables

Copy `.env.production.example`. Set the vars in each Vercel project (Production scope):

- **`skoolos-api`**: everything (DB × 3, Redis, S3, SMTP, all 4 JWT secrets, `PLATFORM_HOST`, `PLATFORM_OWNER_HOST`, `NODE_ENV=production`, optional `CORS_EXTRA_ORIGINS`).
- **`skoolos-web`**: `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL` (both → the api domain), `PLATFORM_HOST`, `PLATFORM_OWNER_HOST`.

Generate JWT secrets: `openssl rand -base64 32` (four distinct values).

---

## 4. Domains — the zero-touch onboarding path

1. Buy `skoolos.app` and **point its nameservers at Vercel** (Vercel → Domains → add). Vercel-managed DNS is what lets it auto-issue the **wildcard SSL cert**.
2. On **`skoolos-web`**, add domains:
   - `skoolos.app` (marketing/launcher, optional)
   - `owner.skoolos.app` (owner portal)
   - **`*.skoolos.app`** ← the wildcard. This is the whole game: every school gets `<slug>.skoolos.app` with valid HTTPS the instant it's created.
3. On **`skoolos-api`**, add `api.skoolos.app`.

Set `PLATFORM_HOST=skoolos.app`, `PLATFORM_OWNER_HOST=owner.skoolos.app`.

### Custom school domains (later, opt-in)

The owner portal can attach a school's own domain (e.g. `greenwoodschool.com`) via Vercel's Domains API (`POST /v10/projects/{web-project}/domains`). The school sets one CNAME to `cname.vercel-dns.com`; add the hostname to the `Domain` table (`status: PENDING → LIVE` once verified) and to `CORS_EXTRA_ORIGINS`. This is the "Vercel for Platforms" pattern; the `Domain` model already supports it. Not required to launch.

---

## 5. Deploy

```bash
vercel --prod                       # from apps/web  → deploys the web project
vercel --prod                       # from apps/api  → deploys the api project
```

(or connect Git and push — Vercel builds both projects.)

---

## 6. Onboarding a school (the payoff)

1. Owner signs in at `owner.skoolos.app`, clicks **Add School**, picks tier + features.
2. The school is created as **`SETUP`** — its admin can log in at `<slug>.skoolos.app` and build the site, but the **public site 404s** until published.
3. When ready, the owner opens the school and clicks **Publish (go live)** (`PATCH /owner/schools/:id/status` → `LIVE`). The public site is live immediately.

That's it — no engineer, no deploy, no DNS per school.

---

## Notes & caveats

- **Prisma + serverless connections:** always use the Neon **pooled** URL for the two runtime roles. Without it you'll hit connection limits under load.
- **Cold starts:** NestJS bootstraps once per cold start; Fluid Compute reuses warm instances, so steady-state latency is fine.
- **CORS** is now driven by `PLATFORM_HOST` (+ `CORS_EXTRA_ORIGINS`), so `*.skoolos.app` browsers are allowed automatically — no code change per school.
- **Swagger** is off in production unless `ENABLE_SWAGGER=true`.
- **Alternative:** if you'd rather run the API as a long-lived container (avoids serverless connection nuance entirely), the same `apps/api` runs on Railway/Render/Fly via `pnpm --filter @skoolos/api start` — only the web app needs to be on Vercel. The wildcard-subdomain onboarding story is identical.
