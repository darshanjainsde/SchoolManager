# Sckools.com marketing site + /owner console — design spec

**Date:** 2026-07-11 · **Status:** approved by owner (interactive mockup v5, artifact d56a7c09)

## Goal

Replace the internal dev launcher currently served at sckools.com with a public,
animated, SEO-optimized marketing site, and move the owner portal behind
`sckools.com/owner` with a single-password gate and a richer dashboard
(per-school stats, enquiry CSV export, admin impersonation, marketing-lead inbox,
marketing settings). School tenant sites (`*.sckools.com`) are untouched.

## Approved design (mockup v5)

Bright "daylight" theme: white/soft-blue paper ground, pastel washes, colorful
soft-shadow cards, coral hand-drawn underline in hero, navy CTA band. One
intentionally vivid section: the emerald/gold "Events Network spotlight stage"
with the orbit animation. Sections, in order:

1. **Hero** — "Your school, on a bigger stage." + browser-frame mockup of a
   school site with bobbing activity chips (enquiry / event / sponsor), animated
   counters, dot-grid backdrop, self-drawing coral underline.
2. **Feature marquee** — infinite horizontally scrolling chips of capabilities.
3. **Feature flip cards (6)** — "One platform. Zero developers needed."
   Click flips card 180° to a phone-capture form ("We'll call you — About:
   <feature>") that submits a lead tagged with the feature. Hover: lift + tilt,
   icon pop, spinning ↻ affordance.
4. **Teaser deck (6)** — "Every page your school needs, ready on day one."
   Glossy 3D-tilted floating gradient cards (Hall of Fame, Events, Courses,
   Admissions, Gallery, Enquiry Inbox) with staggered shimmer sweeps and
   one-line hooks; deliberately low-detail. Caption CTA opens callback modal.
5. **Events Network spotlight** — orbit animation ("YOUR EVENT" core, satellites:
   schools joined, students, sponsors matched, monetized) + 3 pillars: bigger
   arena for students, monetize events, we find sponsors on your behalf.
6. **Tier ladder** — Basic "Be found." / Standard "Be engaging." / Pro "Be the
   stage." with growth-story copy; Pro carries MOST GROWTH ribbon.
7. **Why switch** — agency-site vs Sckools comparison + onboarding promise
   banner: 2 months of custom feature support.
8. **CTA band** (navy card) + footer (contact email/phone from settings).
9. **Callback modal** — name, phone, school, interest select; reachable from
   every section; success state confirms "saved to owner console + email".

`/pricing`: three tier cards, **click-to-toggle USD $ ⇄ ₹ INR** with flip
animation. Default USD. Prices come from owner-editable settings (samples:
$19/₹999, $49/₹2,499, $99/₹4,999). Note under cards: custom feature support +
frequent updates included.

`/owner`: centered gate card, one password field → straight into console.

Owner console dashboard: KPI row (live schools, storage, enquiries/mo, new
leads), school cards (avatar, domain+tier, LIVE/SUSPENDED pill, metrics row:
storage / enquiries / new / events; actions: Visit site, ⚡Login as admin,
⬇Enquiries CSV, Manage), impersonation explainer, Marketing-leads table
(status NEW/CONTACTED/CLOSED), Marketing-site settings card (per-tier USD+INR
price, contact email, contact phone — live instantly).

## Architecture

Same monorepo, no new infra. Host-based branching already exists in
`apps/web/app/page.tsx`: platform host → marketing site (new components under
`components/marketing/`), school host → PublicSite (unchanged).
`PlatformLanding` (which leaks demo credentials publicly) is deleted from the
root route.

### Data model (packages/db, platform-level — NO tenant RLS)

```prisma
model MarketingLead {
  id        String   @id @default(uuid()) @db.Uuid
  name      String?          // null for flip-card phone-only captures
  phone     String
  school    String?
  interest  String?          // tier name or feature name
  source    String           // 'modal' | 'flip:<feature>' | 'pricing:<tier>'
  status    LeadStatus @default(NEW)   // NEW | CONTACTED | CLOSED
  createdAt DateTime @default(now())
}

model MarketingConfig {          // singleton row (id = 'default')
  id            String @id @default("default")
  priceBasicUsd Int    @default(19)
  priceBasicInr Int    @default(999)
  priceStdUsd   Int    @default(49)
  priceStdInr   Int    @default(2499)
  priceProUsd   Int    @default(99)
  priceProInr   Int    @default(4999)
  contactEmail  String @default("admin@sckools.com")
  contactPhone  String @default("")
  updatedAt     DateTime @updatedAt
}

model ImpersonationToken {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid           // target school admin
  schoolId  String   @db.Uuid
  tokenHash String   @unique            // sha256, mirrors PasswordResetToken
  expiresAt DateTime                    // now + 15 min
  usedAt    DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Migration applied to local + prod (Supabase Management API + manual
`_prisma_migrations` insert, as established).

### API (apps/api)

New `marketing` module:
- `GET /marketing/config` — public; returns prices + contact (cache 60s).
- `POST /marketing/leads` — public, `@Throttle(5/min)`; validates phone
  (7–15 digits, optional +); stores lead; best-effort notification email to
  `contactEmail` via existing MailService.

Owner module additions (existing guards: OwnerHostGuard + PlatformJwtGuard):
- `GET /owner/overview` — KPI aggregates + per-school metrics (storage =
  sum(MediaAsset.byteSize), enquiry counts total/NEW, event count).
- `GET /owner/leads?status=` / `PATCH /owner/leads/:id` (status).
- `GET /owner/marketing-config` / `PUT /owner/marketing-config`.
- `GET /owner/schools/:id/enquiries.csv` — text/csv attachment, all enquiry
  fields, platform client (owner is cross-tenant by design).
- `POST /owner/schools/:id/impersonate` — finds school's SCHOOL_ADMIN user,
  mints 24-byte base64url token (sha256 at rest, 15-min TTL, single-use),
  returns `{ url: https://<school primary domain>/login?imp=<token> }`.
  Audit-logged via Logger.warn.

Auth module addition:
- `POST /auth/owner-gate` — `@Public`, `@Throttle(5/min)`; body `{password}`;
  timing-safe compare against env `OWNER_GATE_PASSWORD`; when it matches,
  issues the same platform-audience token pair as owner login (finds the
  single OWNER user). 401 otherwise. If env unset → 503 (gate disabled).
- `POST /auth/impersonate` — `@Public`, `@Throttle(10/min)`, tenant host;
  body `{token}`; validates hash/expiry/single-use + schoolId matches host
  tenant; issues school-audience token pair for the admin user, marks used.
  Response includes `impersonated: true`.

`packages/config`: add optional `OWNER_GATE_PASSWORD`.

### Web (apps/web)

- `components/marketing/` — MarketingSite (sections as small components),
  CallbackModal, FlipFeatureCard, TeaserDeck, OrbitStage, PricingCards
  (client, currency toggle), shared `marketing.css` (the approved v5 CSS,
  adapted; IntersectionObserver reveal via the proven static-wrapper pattern;
  `prefers-reduced-motion` respected).
- `app/page.tsx` — platform host → `<MarketingSite config/>` (config fetched
  server-side from `/marketing/config`, `revalidate: 60`).
- `app/pricing/page.tsx` — platform host only (school host → notFound()).
- `app/owner/page.tsx` — gate: password input → `POST /auth/owner-gate` →
  setTokens(audience 'platform') → router.replace('/platform').
  `/platform/login` (email+password+TOTP) remains as fallback; links to it
  from the gate ("use email login instead").
- `app/platform/page.tsx` — redesigned dashboard per mockup (KPIs, school
  cards with metrics + actions, leads table, marketing settings form) using
  react-query patterns already in the repo. Existing detail page
  `/platform/schools/[id]` stays ("Manage" links there).
- `app/login/page.tsx` — on mount, if `?imp=` present: exchange via
  `POST /auth/impersonate` (with X-Skoolos-Host), setTokens school audience,
  redirect `/app`. Show "Owner view" banner in `/app` layout when the access
  token payload has `impersonated` (nice-to-have: banner only, no blocking).
- CSV download: authenticated fetch → blob → anchor download.

### SEO (marketing pages only)

- `metadata` in root layout branched per host is impossible (single layout) —
  instead `app/page.tsx` and `/pricing/page.tsx` export `generateMetadata()`
  keyed off host: title "Sckools — School websites, admissions & inter-school
  events network", description, canonical `https://sckools.com/`, OG/Twitter
  cards, keywords incl. "sckools".
- `app/sitemap.ts` (sckools.com/, /pricing) + `app/robots.ts` (allow /, /pricing;
  disallow /owner, /platform, /app, /login) — served host-aware (school hosts
  keep their existing behavior; robots/sitemap only emitted on platform host).
- JSON-LD: `Organization` (name Sckools, url, email) + `Product` with three
  `Offer`s (tier prices USD) embedded in the marketing page.
- Brand query "sckools" ranks primarily via exact-match domain + title/OG +
  Search Console submission (manual step for owner, documented in rollout).

### Rollout

1. Migration → local + prod DB. 2. API deploy (Vercel env: `OWNER_GATE_PASSWORD`,
   no other new env). 3. Web deploy. 4. Verify live: marketing site on
   sckools.com, /pricing toggle, callback→lead→email, /owner gate→dashboard,
   impersonation to beacon, CSV download. 5. Owner submits sckools.com to
   Google Search Console + requests indexing (manual; instructions provided).

### Error handling & security notes

- Gate: constant-time compare, throttled, never reveals whether gate is enabled
  vs wrong password (401 for both when env set).
- Leads: server-side validation; throttle per IP; no PII beyond what's typed.
- Impersonation: single-use, 15-min, hashed at rest, host-bound, no refresh
  token issued on exchange (access-token lifetime only), audit-logged.
- CSV: owner-guarded route; streams from platform client.
- Marketing page must not import anything that leaks internal hosts/creds.

### Testing

- API: unit tests for owner-gate (right/wrong/unset env), impersonation service
  (expiry/reuse/host mismatch), lead validation. Existing Jest setup.
- Web: `next build` typecheck; manual E2E on local (localhost = platform host,
  beacon.localhost = school) then prod verify per rollout list.

### Out of scope

- Payment/checkout on pricing (callback-led sales only).
- Additional owner-gate factors (user: "later will put more security").
- Real screenshots in teaser deck (hand-built CSS minis by design).
- Renaming internal `@skoolos/*` identifiers.
