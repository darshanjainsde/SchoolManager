# Marketing Site + Owner Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved v5 marketing site on sckools.com (+ /pricing with USD⇄INR toggle), platform-level leads + owner-editable marketing config, a password gate at /owner, and an upgraded owner dashboard (per-school stats, enquiry CSV, admin impersonation) — SEO-optimized for the brand query "sckools".

**Architecture:** Host-branched Next.js root (platform host → marketing site; school hosts unchanged). New platform-level Prisma models (no RLS — same class as School/User). New NestJS `marketing` module + additions to `auth` and `owner` modules following existing patterns (Throttle, Public decorator, sha256 single-use tokens like PasswordResetToken, IssuedTokens via existing JWT services).

**Tech Stack:** Next.js 14 App Router, NestJS + Prisma, CSS animations (IntersectionObserver reveal, no new deps), react-query (existing), nodemailer (existing MailService).

## Global Constraints

- Never `git add -A` (iCloud " 2" conflict copies); stage explicit paths only.
- Every browser→API fetch must send `X-Skoolos-Host` (Vercel overwrites X-Forwarded-Host).
- Reveal animations: `reveal`/`in` class must live on a static wrapper, never a state-driven className.
- Prod DB changes via Supabase Management API + manual `_prisma_migrations` insert.
- User-facing brand is "Sckools"; internal identifiers stay `@skoolos/*`.
- Prices/copy per approved mockup v5 (artifact d56a7c09): $19/₹999, $49/₹2,499, $99/₹4,999 samples.
- `prefers-reduced-motion` respected in all new CSS.

---

### Task 1: DB models + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append models + enum + User relation)
- Create: `packages/db/prisma/migrations/20260711_000000_marketing_and_impersonation/migration.sql`
- Modify: `packages/config/src/index.ts` (add `OWNER_GATE_PASSWORD: z.string().optional()`)

**Interfaces (Produces):** Prisma models `MarketingLead` (fields: id, name?, phone, school?, interest?, source, status LeadStatus default NEW, createdAt), `MarketingConfig` (singleton id "default"; priceBasicUsd/Inr, priceStdUsd/Inr, priceProUsd/Inr, contactEmail, contactPhone, updatedAt), `ImpersonationToken` (userId, schoolId, tokenHash unique, expiresAt, usedAt?, createdAt; user relation onDelete Cascade), `enum LeadStatus { NEW CONTACTED CLOSED }`.

- [ ] Append models to schema.prisma exactly as in the spec; add `impersonationTokens ImpersonationToken[]` to User.
- [ ] Write migration.sql (CREATE TYPE "LeadStatus"; CREATE TABLE "MarketingLead", "MarketingConfig", "ImpersonationToken" with FK + indexes on ImpersonationToken(userId), MarketingLead(status,createdAt)). No RLS — platform tables.
- [ ] Apply locally: `cd packages/db && DIRECT_URL="$DATABASE_URL" pnpm prisma migrate deploy && pnpm prisma generate` (DATABASE_URL from apps/api/.env). Expected: migration applied.
- [ ] `pnpm --filter @skoolos/db build` then commit schema + migration + config.

### Task 2: API — marketing module (public config + lead capture)

**Files:**
- Create: `apps/api/src/modules/marketing/{index.ts,internal/marketing.module.ts,internal/marketing.controller.ts,internal/marketing.service.ts,internal/marketing.dto.ts}`
- Modify: `apps/api/src/app.module.ts` (import MarketingModule)
- Modify: `apps/api/src/common/mail/mail.service.ts` (add `sendLeadNotification`)
- Test: `apps/api/src/modules/marketing/internal/marketing.service.spec.ts`

**Interfaces (Produces):**
- `GET /marketing/config` → `{ prices: { basic:{usd,inr}, standard:{usd,inr}, pro:{usd,inr} }, contactEmail, contactPhone }` — @Public; upserts default row on first read.
- `POST /marketing/leads` body `{ name?, phone (7–16 chars, digits/+/space/-), school?, interest?, source }` → `{ ok:true }` — @Public, @Throttle 5/min; fires `mail.sendLeadNotification(configContactEmail, lead)` best-effort.
- Service methods: `getConfig()`, `updateConfig(dto)` (used by owner in Task 5), `createLead(dto)`, `listLeads(status?)`, `setLeadStatus(id,status)`.

- [ ] Write failing spec: createLead persists + normalizes phone, rejects garbage phone (DTO-level, test via validation pipe or service guard), getConfig returns defaults when table empty.
- [ ] Implement DTOs (class-validator, matching existing cms.dto.ts style), service (getPlatformPrisma), controller (tenant-free routes — confirm tenant middleware ignores non-tenant hosts as it does for /owner).
- [ ] `pnpm --filter api test -- marketing` → PASS; `pnpm --filter api build` → clean. Commit.

### Task 3: API — owner gate

**Files:**
- Modify: `apps/api/src/modules/owner/internal/owner-auth.controller.ts` (+`POST /owner/auth/gate`)
- Modify: `apps/api/src/modules/owner/internal/owner-auth.service.ts` (+`gateLogin(password)`)
- Modify: `apps/api/src/modules/owner/internal/owner.dto.ts` or auth dto file (+GateLoginDto)
- Test: extend `owner-auth.service` spec.

**Interfaces (Produces):** `POST /owner/auth/gate` `{password}` → `IssuedTokens` (same shape as owner login). 401 on mismatch, 503 when `OWNER_GATE_PASSWORD` unset. Guarded by OwnerHostGuard? NO — gate must be reachable from sckools.com/owner page: controller already lives under owner host guard; keep gate on same controller (OwnerHostGuard allows OWNER_HOST; web calls with hostHeader OWNER_HOST like platform login does). Throttle 5/min. Compare via `timingSafeEqual` on sha256 digests. Issues tokens for the single OWNER user (`role:'OWNER', schoolId:null`).

- [ ] Failing tests: right password issues tokens; wrong → Unauthorized; env unset → ServiceUnavailable.
- [ ] Implement; run tests → PASS; build; commit.

### Task 4: API — impersonation (mint + exchange)

**Files:**
- Create: `apps/api/src/modules/owner/internal/impersonation.service.ts`
- Modify: `apps/api/src/modules/owner/internal/owner.controller.ts` (+`POST schools/:id/impersonate`)
- Modify: `apps/api/src/modules/auth/internal/auth.controller.ts` (+`POST /auth/impersonate`, @Public, @Throttle 10/min, tenant ctx)
- Modify: `apps/api/src/modules/auth/internal/auth.service.ts` (expose `issueForUser(schoolId, userId, extraClaims?)` reusing its private issue path)
- Modify: `apps/api/src/modules/auth/internal/dto.ts` (+ImpersonateDto {token})
- Modify: owner module providers.
- Test: `impersonation.service.spec.ts`

**Interfaces (Produces):**
- Owner: `POST /owner/schools/:id/impersonate` → `{ url }` where url = `https://<primary LIVE domain || slug.PLATFORM_HOST>/login?imp=<raw>`; raw = `randomBytes(24).toString('base64url')`, stored sha256, TTL 15 min; target = first active SCHOOL_ADMIN of the school; 404 no school, 409 no active admin. Logger.warn audit line.
- Tenant: `POST /auth/impersonate` `{token}` → school-audience `IssuedTokens & { impersonated: true }`; validates hash exists, unused, unexpired, `schoolId === tenantCtx.schoolId`; marks usedAt in same transaction; access token carries `imp: true` claim; **no refresh token row semantics change** (reuse normal issue; acceptable: session behaves like a normal login but is audit-logged).

- [ ] Failing tests: mint+exchange happy path; reuse → Unauthorized; expired → Unauthorized; wrong host/school → Unauthorized.
- [ ] Implement; tests PASS; build; commit.

### Task 5: API — owner overview, leads, config, CSV

**Files:**
- Create: `apps/api/src/modules/owner/internal/owner-overview.service.ts`
- Modify: `apps/api/src/modules/owner/internal/owner.controller.ts`
- Modify: owner module providers (import MarketingModule for service reuse).

**Interfaces (Produces):**
- `GET /owner/overview` → `{ totals: { schools, live, storageBytes, enquiriesThisMonth, newLeads }, schools: [{ id, name, slug, tier, status, primaryDomain, storageBytes, enquiries, newEnquiries, events }] }` (groupBy aggregates; one query per metric, joined in memory).
- `GET /owner/leads?status=` → MarketingLead[]; `PATCH /owner/leads/:id` `{status}` → lead.
- `GET /owner/marketing-config` / `PUT /owner/marketing-config` (dto mirrors config fields) → config.
- `GET /owner/schools/:id/enquiries.csv` → `text/csv` attachment `Content-Disposition: attachment; filename="<slug>-enquiries.csv"`, columns `createdAt,parentName,phone,email,gradeInterest,message,status`, RFC4180 quoting.

- [ ] Implement (aggregates via prisma groupBy on MediaAsset.byteSize sum / Enquiry counts / Event counts, all `where schoolId in (...)`), CSV via @Res() with proper escaping helper + unit test for the escaping helper.
- [ ] Tests PASS; build; commit.

### Task 6: Web — marketing site + /pricing + SEO

**Files:**
- Create: `apps/web/components/marketing/{MarketingSite.tsx,marketing.css,CallbackModal.tsx,FlipFeatureCards.tsx,TeaserDeck.tsx,OrbitStage.tsx,TierLadder.tsx,Hero.tsx,Marquee.tsx,WhySwitch.tsx,marketing-api.ts}`
- Create: `apps/web/app/pricing/page.tsx`, `apps/web/components/marketing/PricingCards.tsx`
- Create: `apps/web/app/sitemap.ts`, `apps/web/app/robots.ts`
- Modify: `apps/web/app/page.tsx` (platform host → MarketingSite; delete PlatformLanding usage), `apps/web/lib/public-api.ts` (+fetchMarketingConfig)
- Delete: `apps/web/components/PlatformLanding.tsx`

**Interfaces (Consumes):** `GET /marketing/config`, `POST /marketing/leads` (with X-Skoolos-Host header; source values: `'modal'`, `'flip:<feature>'`, `'pricing:<tier>'`, `'deck'`).

Key requirements (from approved mockup — port the v5 CSS/JSX faithfully):
- Sections: hero (browser mock + bobbing chips + counters + drawn underline), marquee, 6 flip feature cards (click→phone capture→POST lead→success→auto flip-back), teaser deck (6 shimmer cards), events orbit spotlight, tier ladder, why-switch + promise, CTA band, footer (config contact).
- CallbackModal: name/phone/school/interest; every "Request a callback" opens it (context prefills interest).
- Reveal via IntersectionObserver on static wrappers; respect reduced motion; counters animate once.
- SEO: `generateMetadata` on `/` (platform host): title `Sckools — School Websites, Admissions & Inter-School Events Network`, description ≤160 chars, canonical `https://sckools.com/`, OG+Twitter cards, `metadataBase`. `/pricing`: title `Sckools Pricing — Basic, Standard & Pro Plans for Schools`. JSON-LD: Organization + Product w/ three Offers (USD prices from config) via `<script type="application/ld+json">`. `sitemap.ts` → `/` + `/pricing` on `https://sckools.com`; `robots.ts` → allow all, disallow `/owner`,`/platform`,`/app`,`/login`,`/portal`,`/teacher`,`/me`,`/account`; sitemap ref. School hosts: robots/sitemap must not advertise platform routes (host-independent static output acceptable: disallowed paths are private on every host; sitemap URLs absolute to sckools.com).
- H1 exactly one per page; semantic sections with aria-labels; alt text n/a (CSS visuals).

- [ ] Build components; wire pages; `pnpm --filter web build` → clean typecheck.
- [ ] Manual: localhost:3000 (platform host) shows marketing site; beacon.localhost:3000 unchanged school site; /pricing toggle flips currency; callback POST creates lead row (check via psql) and Mailhog message. Commit.

### Task 7: Web — /owner gate + platform dashboard upgrade

**Files:**
- Create: `apps/web/app/owner/page.tsx` (gate)
- Modify: `apps/web/app/platform/page.tsx` (new dashboard: KPI row, school cards w/ metrics + Visit/Impersonate/CSV/Manage, leads table w/ status patch, marketing settings form)
- Modify: `apps/web/app/login/page.tsx` (handle `?imp=` exchange on mount → setTokens school audience → replace('/app'))
- Modify: `apps/web/app/app/layout.tsx` (banner when JWT payload has `imp: true` — decode access token client-side, display-only)

**Interfaces (Consumes):** Task 3–5 endpoints. Gate: `api.post('/owner/auth/gate',{password})` with hostHeader OWNER_HOST → setTokens platform → replace('/platform'). CSV: authenticated fetch → blob → `<a download>`. Impersonate: `api.request(POST /owner/schools/:id/impersonate)` → `window.open(url)`.

- [ ] Implement; `pnpm --filter web build` clean; manual local pass (gate → dashboard, impersonate beacon admin, CSV download, lead status change, settings save reflected on /pricing within 60 s). Commit.

### Task 8: Prod rollout + verification + SEO submission

- [ ] Prod migration via Supabase Management API (tables + enum + `_prisma_migrations` insert with sha256 of migration.sql).
- [ ] Vercel env: add `OWNER_GATE_PASSWORD` (value from user — ask at deploy time), redeploy skoolos-api + skoolos-web via push to main.
- [ ] Live verify: sckools.com marketing site + view-source SEO tags + JSON-LD; /pricing toggle; callback → lead in owner console + email to admin@sckools.com; /owner gate; impersonation into acme; CSV download; school sites untouched (beacon.sckools.com).
- [ ] `curl https://sckools.com/sitemap.xml` + `/robots.txt` correct.
- [ ] Hand owner Search Console instructions (verify domain via DNS TXT on Hostinger, submit sitemap, request indexing for / and /pricing).

## Self-Review

Spec coverage: all spec sections map to Tasks 1–8. Types checked: IssuedTokens reused from owner-auth.service; LeadStatus enum shared db→api→web. No placeholders — component internals intentionally reference the approved v5 mockup file as the source of copy/CSS (committed in scratchpad → ported in Task 6).
