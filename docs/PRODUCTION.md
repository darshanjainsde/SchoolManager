# SkoolOS — Production deploy checklist

> **THIS DOCUMENT DESCRIBED A DEPLOYMENT THAT DOES NOT EXIST.**
>
> It documented API + worker on Railway with a Neon database. Neither is true:
> the API runs as a Vercel Function (project `skoolos-api`, region `bom1`) and
> the database is **Supabase**, which three CI workflows deploy against
> (`db-backup`, `db-migrate`, `db-restore-drill`).
>
> Trusting it cost real time — it is why a round of scale work documented
> Neon-specific connection settings for a Supabase database, and why a
> `connection_limit` value quoted below was treated as production truth when
> nothing verifies it.
>
> **Authoritative sources, in order:** the CI workflows, then
> `docs/DATABASE.md`, then `apps/api/vercel.json`. Read those, not this.
> The Railway path below is kept only because the Dockerfile still exists and
> the option is real — it is not what is deployed.


Two supported targets:

| Target | What goes where |
| ------ | --------------- |
| **Path A — Railway only** (simplest) | API + worker + web all on Railway. Postgres + Redis are Railway add-ons. |
| **Path B — Vercel + Railway** | Web on Vercel, API + worker on Railway. Postgres + Redis are Railway add-ons. |

Both paths assume Cloudflare R2 for object storage and Resend for transactional email. Both end with you operating the system from `owner.<your-domain>` — same Phase 1/2 owner portal you used locally.

---

## 1. One-time accounts to create

- A **domain** (e.g. `skoolos.app`). Pointed to Cloudflare DNS.
- A **Cloudflare account** — for DNS, and optionally R2 for storage.
- A **Railway account** — for API, worker, Postgres, Redis.
- A **Vercel account** — only if you take Path B.
- A **Resend account** — once verified, you store the API key in the owner portal (not in env vars).
- A **Stripe account** in test mode — same: keys go into the owner portal once provisioned.

---

## 2. Generate the encryption key

`PLATFORM_SETTINGS_KEY` is the AES-256-GCM key used to encrypt every secret stored via the owner portal (Stripe, Resend, Ably, OTel). It MUST be set before the first owner login — without it the fallback key is derived from the JWT secret, which is acceptable for dev but not prod.

```bash
openssl rand -hex 32   # → 64-char hex; paste this as the env var
```

---

## 3. Provision Postgres + Redis on Railway

1. New Railway project → **Add → Database → Postgres 16**.
2. **Add → Database → Redis**.
3. Wait for both to provision. Note the auto-generated `DATABASE_URL` and `REDIS_URL` — they will be referenced by the API and worker services.

> The repo's `packages/db/prisma/migrations/...` includes a migration that creates two non-superuser DB roles (`skoolos_app` RLS-bound, `skoolos_platform` BYPASSRLS). Railway runs as the Postgres superuser by default, which means **the migration creates both roles successfully**.

After provisioning, you have three URLs you'll need to set:

| Env var | Value |
| ------- | ----- |
| `DATABASE_URL` | Railway-provided superuser URL (used only for migrations + tests) |
| `DATABASE_URL_APP` | Replace `postgres:<password>` segment with `skoolos_app:skoolos_app_pw` |
| `DATABASE_URL_PLATFORM` | Replace with `skoolos_platform:skoolos_platform_pw` |

(The two non-superuser passwords default to those literal strings inside the migration. For production, run a one-off `ALTER USER skoolos_app PASSWORD '…';` in `railway connect Postgres` immediately after first deploy, then update env.)

---

## 4. Deploy the API + worker

In the Railway project:

1. **Add → Empty Service → Connect repo** → select this repo.
2. Set **Service name = skoolos-api**, **Dockerfile path = apps/api/Dockerfile**.
3. Variables (copy from above + add):
   ```
   NODE_ENV=production
   API_PORT=3001
   PLATFORM_HOST=skoolos.app
   PLATFORM_OWNER_HOST=owner.skoolos.app
   INGRESS_CNAME_TARGET=ingress.skoolos.app   # whatever the Vercel/CF tunnel uses
   INGRESS_A_RECORD=76.76.21.21               # placeholder; only used by the verify worker
   JWT_SCHOOL_ACCESS_SECRET=<openssl rand -hex 32>
   JWT_SCHOOL_REFRESH_SECRET=<openssl rand -hex 32>
   JWT_PLATFORM_ACCESS_SECRET=<openssl rand -hex 32>
   JWT_PLATFORM_REFRESH_SECRET=<openssl rand -hex 32>
   JWT_ACCESS_TTL=900
   JWT_REFRESH_TTL=2592000
   LOCKOUT_MAX_ATTEMPTS=5
   LOCKOUT_DURATION_SECONDS=900
   PLATFORM_SETTINGS_KEY=<openssl rand -hex 32>
   ENABLE_SWAGGER=false
   ```
4. Repeat for **skoolos-worker** with `Dockerfile path = apps/worker/Dockerfile`. Share the same env vars (just change `WORKER_PORT=3002` and drop `API_PORT`).
5. Deploy. The first deploy runs `prisma migrate deploy` automatically (see the Dockerfile CMD).

The S3/MinIO + SMTP env vars are **optional** at first boot. The web admin sets them via the **/platform/settings** page once you log in (Resend, Stripe). Until they're set, related features cleanly return 503.

---

## 5. Deploy the web

### Path A — Railway

Add another service: same repo, **build command** `pnpm --filter @skoolos/web build`, **start command** `pnpm --filter @skoolos/web start`. Set `NEXT_PUBLIC_API_URL=https://<api-service-url>`.

### Path B — Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_API_URL  # → https://<api-service-url>.up.railway.app
vercel --prod
```

`vercel.json` is already in the repo: it tells Vercel to build only the `@skoolos/web` workspace.

---

## 6. DNS

In Cloudflare:

- `skoolos.app          A    <railway-web-ip>`
- `*.skoolos.app        CNAME <railway-web-url>`
- `owner.skoolos.app    CNAME <railway-web-url>`
- `api.skoolos.app      CNAME <railway-api-url>` (only if your web app calls the API by host name)

If you took Path B (Vercel for web), point the wildcard at Vercel instead and add the domain in Vercel's dashboard (wildcard subdomains require Vercel Pro).

---

## 7. First login

1. `railway run --service skoolos-api -- pnpm --filter @skoolos/db seed` — seeds the platform owner. The TOTP secret is printed to logs.
2. Visit `https://owner.skoolos.app/platform/login`.
3. Email `owner@skoolos.local`, password from the seed output, TOTP from your authenticator app.

Once in:

- Open **/platform/settings** and paste your Resend, Stripe, Ably keys (any/all are optional).
- Open **/platform/onboard** to create your first school.
- The freshly-provisioned school is reachable at `https://<slug>.skoolos.app`.

---

## 8. Backups & monitoring

- **Postgres backups** — Railway Pro keeps daily snapshots. Enable point-in-time recovery if your plan supports it.
- **Audit log** — every mutating endpoint writes an `AuditLog` row via the platform Prisma. Read it via SQL or build a thin owner-portal page (Phase 9 idea).
- **Per-tenant usage** — `GET /platform/usage` (owner-only) returns row counts + payment totals per school. Backed by a SQL view, fast for thousands of tenants.
- **Health probes** — `/health` (process up) and `/ready` (DB + Redis reachable).
- **OpenTelemetry** — once you paste `otel.endpoint` + `otel.headers` in settings, the API can be wired to push traces to Grafana Cloud / Honeycomb. (The infrastructure hooks are there; full OTel SDK install is Phase 9 work.)

---

## 9. Scaling notes

- The architecture is single-binary today. To scale horizontally:
  - **API replicas** — add Railway replicas. Stateless, share Redis + Postgres.
  - **Worker replicas** — same, BullMQ handles concurrency.
  - **SSE realtime** — the in-process `SseBusService` is single-instance. For multi-API-replica fan-out, swap it for a Redis pub/sub bridge (`PUBLISH`/`PSUBSCRIBE`) or move to Ably (already config-ready via the settings page).
  - **Postgres** — Supabase transaction pooler (port 6543) with `?pgbouncer=true`.
    The `connection_limit` is NOT verified from here — read it from the Vercel
    dashboard. Measured at 100 concurrent users: limit 1 gives ~285 req/s,
    limit 5 gives ~755. See `.env.production.example` for the full curve.

---

## 10. Hardening pass before going live

| Item | Done? |
| ---- | ----- |
| All env secrets generated fresh (not the dev defaults) | [ ] |
| `skoolos_app` / `skoolos_platform` DB role passwords rotated | [ ] |
| Wildcard subdomain DNS verified | [ ] |
| Resend domain verified (DKIM + SPF) | [ ] |
| Stripe webhook URL pointed at `/webhooks/stripe`, signing secret set in /platform/settings | [ ] |
| `PLATFORM_IP_ALLOWLIST` configured (comma-separated CIDRs that may reach `owner.<domain>`) | [ ] |
| Owner portal TOTP enrolled on a real authenticator app | [ ] |
| One smoke onboard → invite-accept → log-in round trip | [ ] |

When all ten boxes are ticked, you're production-ready.
