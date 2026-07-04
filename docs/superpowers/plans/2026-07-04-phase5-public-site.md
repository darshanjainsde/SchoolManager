# Phase 5 — Public School Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each school's public, animated marketing website at its own host (`<slug>.localhost` in dev / the school's domain in prod), driven entirely by the CMS content, tier-gated, with a working enquiry form.

**Architecture:** A new NestJS `public` module with UNAUTHENTICATED endpoints that resolve the school from the request Host (via the existing tenant middleware), read tenant content through `withTenant` (RLS), resolve `MediaAsset` ids → URLs server-side, and gate sections by the school's resolved features. Next.js detects the host in a server component: a school host renders the public site (SSR for SEO) with client-side animation islands; the platform host keeps the dev launcher. Enquiries POST to a public, rate-limited endpoint.

**Tech Stack:** NestJS 10 (unauthenticated controllers + Throttler), Prisma 5 (`withTenant`), Next.js 14 App Router (`next/headers`, server + client components), Tailwind, the animated design from `mockups/public-site.html`.

## Global Constraints

- Public endpoints live under `/public` and have NO auth guard (they are open). They resolve the tenant from the Host via `TenantContextService.get()` — if `kind !== 'tenant'` (platform/unknown host) → **404**. schoolId comes ONLY from that resolved context; all data via `withTenant`. NEVER `getPlatformPrisma` in the public module.
- Only LIVE schools serve a public site: the tenant middleware already resolves a host to a school only when a Domain is LIVE or the slug subdomain matches; a SUSPENDED school must 404 (check `School.status`).
- **Tier/feature gating (reuse Phase 1 `FeatureResolverService.getFeatures(schoolId)`):** always include hero/homepage/gallery/enquiry/social (BASIC). Include About + Contact sections only if `ABOUT_CONTACT` (STANDARD+). Include the Events section only if `EVENTS` (Phase 6 populates it — Phase 5 renders an empty-safe placeholder or omits; do NOT build event fetching here). The public payload must reflect the school's effective features so the frontend shows/hides sections.
- Media: the CMS stores `MediaAsset` ids on content; the public endpoint MUST resolve every referenced id to its `url` (join `MediaAsset`) so the frontend receives ready-to-use image URLs (never raw ids). Gallery = `MediaAsset` where kind=GALLERY; staff photos via `FeaturedStaff.photoAssetId`.
- The public menu is **class-wise by default**: derive from `Grade` (ordered) — return `menu: { label, gradeId }[]`. (Custom menu editing is out of scope.)
- Enquiry submission requires the `ENQUIRY` feature (always on for BASIC+), is rate-limited (`@Throttle`), validates input, and creates an `Enquiry` row via `withTenant`. Admin viewing of enquiries is added here too (`GET /site/enquiries`, SchoolJwtGuard) since submissions need to be visible.
- Reuse: `TenantContextService`, `withTenant`, `FeatureResolverService`, `StorageService`/`MediaAsset`, `apps/web/components/ui/*`, and the animated markup/CSS in `mockups/public-site.html`. Spec §7 (`docs/superpowers/specs/2026-07-03-skoolos-school-website-platform-design.md`).
- **Web host rule:** the public site is served from the school host, so any client fetch to the API must send the host (`useHost()` + `hostHeader`) — same Phase-3 lesson. But prefer SERVER-side fetch in the public route (see Task 4) which forwards the incoming Host header explicitly.

---

## File structure (Phase 5)

**API — new module `apps/api/src/modules/public/`:**
- `index.ts` (`PublicModule`), `internal/public.module.ts`, `internal/public.dto.ts`
- `internal/public-site.service.ts` — assembles `PublicSiteData` (content + resolved media URLs + features + menu), tenant-scoped
- `internal/public-site.controller.ts` — `GET /public/site`
- `internal/enquiry.service.ts` + `enquiry.controller.ts` — `POST /public/enquiry` (public), and a tenant-guarded `GET /site/enquiries` + `PATCH /site/enquiries/:id` (status) added to the CMS side OR here (keep here for cohesion, but guard the admin routes with SchoolJwtGuard)
- tests + `apps/api/test/public.e2e-spec.ts`

**API — modify:** `apps/api/src/app.module.ts` (register `PublicModule`).

**Web — under `apps/web/app/`:**
- `page.tsx` — MODIFY: detect host via `next/headers`; if a school host → render `<PublicSite data={...}/>` (server-fetch `/public/site`); else keep the dev launcher.
- `components/public/PublicSite.tsx` (client) + section components (`Hero`, `About`, `Academics`, `Gallery`, `Staff`, `Contact`, `EnquiryForm`) — the animated, data-driven site.
- `lib/public-api.ts` — a tiny server-side fetch helper that forwards the Host header.

---

### Task 1: Public site data endpoint (`GET /public/site`)

**Files:** create `public.module.ts`, `index.ts`, `public.dto.ts`, `public-site.service.ts`, `public-site.controller.ts`; modify `app.module.ts`.

**Interfaces:**
- Produces: `PublicSiteService.getSite(): Promise<PublicSiteData>` where it reads the current tenant from `TenantContextService` (throws `NotFoundException` if not a live school), and returns:
```ts
interface PublicSiteData {
  school: { name: string; slug: string; tier: 'BASIC'|'STANDARD'|'PRO'; features: string[] };
  profile: { logoUrl: string|null; faviconUrl: string|null; brandColorPrimary: string; brandColorSecondary: string; phone: string|null; email: string|null; addressLine1: string|null; addressLine2: string|null; city: string|null; region: string|null; postalCode: string|null; country: string|null; mapEmbedUrl: string|null } | null;
  homepage: { headline: string; subheadline: string|null; heroUrl: string|null; aboutText: string|null; principalName: string|null; principalMessage: string|null; principalPhotoUrl: string|null } | null;
  stats: { label: string; value: string }[];
  socialLinks: { platform: string; url: string }[];   // only if SOCIAL feature
  gallery: { url: string; caption: string|null }[];    // only if GALLERY feature
  staff: { name: string; role: string; photoUrl: string|null }[];
  menu: { label: string; gradeId: string }[];          // class-wise
}
```

- [ ] **Step 1: `public-site.service.ts`** — resolve tenant, load content within ONE `withTenant`, resolve media, gate by features:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';

@Injectable()
export class PublicSiteService {
  constructor(private readonly tenant: TenantContextService, private readonly features: FeatureResolverService) {}

  async getSite(): Promise<PublicSiteData> {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Site not found');
    const schoolId = ctx.schoolId;
    const feat = await this.features.getFeatures(schoolId);

    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId } });
      if (school.status === 'SUSPENDED') throw new NotFoundException('Site not found');
      const [profile, homepage, stats, socials, galleryAssets, staff, grades] = await Promise.all([
        tx.schoolProfile.findUnique({ where: { schoolId } }),
        tx.homepageContent.findUnique({ where: { schoolId } }),
        tx.statItem.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.socialLink.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.mediaAsset.findMany({ where: { schoolId, kind: 'GALLERY' }, orderBy: { order: 'asc' } }),
        tx.featuredStaff.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
      ]);
      // Resolve all asset ids referenced by profile/homepage/staff in one query.
      const ids = [profile?.logoAssetId, profile?.faviconAssetId, homepage?.heroAssetId, homepage?.principalPhotoAssetId, ...staff.map((s) => s.photoAssetId)].filter(Boolean) as string[];
      const assets = ids.length ? await tx.mediaAsset.findMany({ where: { schoolId, id: { in: ids } }, select: { id: true, url: true } }) : [];
      const urlOf = (id?: string | null) => (id ? assets.find((a) => a.id === id)?.url ?? null : null);

      const has = (k: string) => feat.has(k as never);
      return {
        school: { name: school.name, slug: school.slug, tier: school.tier, features: [...feat] },
        profile: profile ? {
          logoUrl: urlOf(profile.logoAssetId), faviconUrl: urlOf(profile.faviconAssetId),
          brandColorPrimary: profile.brandColorPrimary, brandColorSecondary: profile.brandColorSecondary,
          phone: has('ABOUT_CONTACT') ? profile.phone : null,
          email: has('ABOUT_CONTACT') ? profile.email : null,
          addressLine1: has('ABOUT_CONTACT') ? profile.addressLine1 : null,
          addressLine2: has('ABOUT_CONTACT') ? profile.addressLine2 : null,
          city: has('ABOUT_CONTACT') ? profile.city : null, region: has('ABOUT_CONTACT') ? profile.region : null,
          postalCode: has('ABOUT_CONTACT') ? profile.postalCode : null, country: has('ABOUT_CONTACT') ? profile.country : null,
          mapEmbedUrl: has('ABOUT_CONTACT') ? profile.mapEmbedUrl : null,
        } : null,
        homepage: homepage ? {
          headline: homepage.headline, subheadline: homepage.subheadline, heroUrl: urlOf(homepage.heroAssetId),
          aboutText: has('ABOUT_CONTACT') ? homepage.aboutText : null,
          principalName: has('ABOUT_CONTACT') ? homepage.principalName : null,
          principalMessage: has('ABOUT_CONTACT') ? homepage.principalMessage : null,
          principalPhotoUrl: has('ABOUT_CONTACT') ? urlOf(homepage.principalPhotoAssetId) : null,
        } : null,
        stats: stats.map((s) => ({ label: s.label, value: s.value })),
        socialLinks: has('SOCIAL') ? socials.map((s) => ({ platform: s.platform, url: s.url })) : [],
        gallery: has('GALLERY') ? galleryAssets.map((g) => ({ url: g.url, caption: g.caption })) : [],
        staff: staff.map((s) => ({ name: s.name, role: s.role, photoUrl: urlOf(s.photoAssetId) })),
        menu: grades.map((g) => ({ label: g.name, gradeId: g.id })),
      };
    });
  }
}
```
Define `PublicSiteData` in `public.dto.ts` (or a `types.ts`) and export it.

- [ ] **Step 2: `public-site.controller.ts`** — `@Controller('public')`, NO guard, `@Public()` if a global guard exists (there isn't, but harmless), `@Throttle` a generous limit. `@Get('site') site() { return this.publicSite.getSite(); }`. Register `PublicModule` (imports `FeaturesModule`; TenancyModule global) in `app.module.ts`.

- [ ] **Step 3: Typecheck + boot + curl (by host, unauthenticated)**
```bash
pnpm --filter @skoolos/api typecheck
# NO auth header — resolve by host:
curl -s http://localhost:3001/public/site -H 'X-Forwarded-Host: beacon.localhost'   # → beacon PublicSiteData (PRO: has ABOUT_CONTACT → about/contact populated)
curl -s http://localhost:3001/public/site -H 'X-Forwarded-Host: acme.localhost'      # → acme (STANDARD: has ABOUT_CONTACT too)
curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/public/site -H 'X-Forwarded-Host: owner.localhost'   # → 404 (platform host)
curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/public/site -H 'X-Forwarded-Host: nope.localhost'    # → 404 (unknown)
```
Expected: school hosts return the data with resolved image URLs; platform/unknown hosts 404. (Both seed schools have ABOUT_CONTACT since both are STANDARD+; to see gating, the reviewer/e2e can toggle acme to a lower feature — but do NOT change seed here.)

- [ ] **Step 4: Commit** `feat(api): public site data endpoint (host-resolved, media-resolved, feature-gated)`.

---

### Task 2: Public enquiry endpoint + admin enquiry views

**Files:** `enquiry.service.ts`, `enquiry.controller.ts`, DTOs; register in `public.module.ts`.

**Interfaces:**
- `EnquiryService.submit(schoolId, dto)` (public) creates an `Enquiry`; `list(schoolId)` + `setStatus(schoolId, id, status)` (admin).
- Public route `POST /public/enquiry` (no guard, `@Throttle({ default: { limit: 5, ttl: 60_000 } })`), resolves tenant from host, requires the `ENQUIRY` feature (else 404/403), creates the row.
- Admin routes `GET /site/enquiries` + `PATCH /site/enquiries/:id` guarded by `SchoolJwtGuard`, tenant-scoped.

- [ ] **Step 1: DTOs** — `SubmitEnquiryDto { parentName (1-120), phone (1-40), email? @IsEmail, gradeInterest? string, message? (0-2000) }`; `SetEnquiryStatusDto { status: 'NEW'|'CONTACTED'|'CLOSED' }`.
- [ ] **Step 2: service** — `submit`: read tenant ctx (404 if not tenant), check `features.getFeatures(schoolId).has('ENQUIRY')` (else `NotFoundException`), `withTenant` create Enquiry `{ schoolId, ...dto, status: 'NEW' }`. `list`/`setStatus` withTenant, ownership → 404, ParseUUIDPipe.
- [ ] **Step 3: controllers** — public enquiry controller (`/public/enquiry`, throttled, no guard); admin enquiry controller (`/site/enquiries`, `SchoolJwtGuard`).
- [ ] **Step 4: Boot + curl** — `POST /public/enquiry` (beacon host, no auth) `{parentName:"Test",phone:"+91..."}` → 201; login beacon admin → `GET /site/enquiries` includes it; `PATCH /site/enquiries/:id {status:"CONTACTED"}` → ok. Rate limit: 6th rapid POST → 429. Clean up. Commit `feat(api): public enquiry submission + admin enquiry management`.

---

### Task 3: Public API e2e

**Files:** `apps/api/test/public.e2e-spec.ts`.

- [ ] **Step 1: e2e (API booted)** — model on `cms.e2e-spec.ts`. Prove: (a) `GET /public/site` for beacon (no auth) returns data with `school.name`, `menu` non-empty (grades), resolved fields; (b) platform host + unknown host → 404; (c) suspended school → 404 (temporarily set a throwaway school SUSPENDED via getPlatformPrisma in setup, or assert the code path — simplest: create a throwaway LIVE school, set status SUSPENDED, assert 404, clean up); (d) `POST /public/enquiry` (no auth, beacon host) creates a row → visible via admin `GET /site/enquiries`; (e) feature gating: create a throwaway BASIC school (or toggle features via owner) and assert its `/public/site` omits about/contact (aboutText null) — OR assert the gating logic against beacon by temporarily removing ABOUT_CONTACT via a FeatureOverride, then restore. Clean up all fixtures in afterAll.
- [ ] **Step 2: run + confirm all other e2e still green; commit** `test(api): public site + enquiry e2e (host resolution, gating, 404s)`.

---

### Task 4: Next.js host detection + public site data fetch

**Files:** modify `apps/web/app/page.tsx`; create `apps/web/lib/public-api.ts`; create `apps/web/components/public/PublicSite.tsx` (stub for now).

**Interfaces:** `fetchPublicSite(host: string): Promise<PublicSiteData | null>` (server-side fetch to `${API}/public/site` forwarding `X-Forwarded-Host: host`; returns null on 404).

- [ ] **Step 1: `lib/public-api.ts`** — server fetch helper:
```ts
export async function fetchPublicSite(host: string): Promise<PublicSiteData | null> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const res = await fetch(`${base}/public/site`, { headers: { 'X-Forwarded-Host': host }, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}
```
(Declare `PublicSiteData` locally in the web app to mirror the API shape.)

- [ ] **Step 2: `app/page.tsx`** — server component: read host via `import { headers } from 'next/headers'; const host = headers().get('host') ?? ''`. Determine if it's a school host: it's a school host if it is NOT the platform host (`localhost`/`owner.localhost`) — i.e. a subdomain like `acme.localhost`. Logic: if host starts with a subdomain that isn't `owner` and isn't bare `localhost[:port]`, try `fetchPublicSite(host)`; if it returns data → render `<PublicSite data={data} />`; if null → fall through. If host IS the platform host (bare `localhost` / `owner.localhost`) → render the existing dev launcher. (Keep the launcher code; branch at the top.)

- [ ] **Step 3: `PublicSite.tsx` stub** — `'use client'` component that for now just renders `<h1>{data.school.name}</h1>` and the headline, to prove the wiring. Full sections come in Tasks 5-7.

- [ ] **Step 4: Boot web+API; verify** — `curl -s http://localhost:3000 -H 'Host: beacon.localhost' | grep -i "beacon\|<h1"` shows the school name (SSR). `curl -s http://localhost:3000 -H 'Host: localhost' | grep -i "SkoolOS\|Owner Portal"` shows the launcher. Commit `feat(web): host detection renders public site vs dev launcher`.

---

### Task 5: Public site — hero + nav + stats + about + academics

**Files:** create `apps/web/components/public/PublicSite.tsx` (full), plus section components or inline. Port CSS from `mockups/public-site.html` into a co-located `<style jsx global>` or a CSS module.

- [ ] **Step 1:** Build the animated dark hero (aurora blobs, gradient headline from `homepage.headline`/`subheadline`, hero image from `homepage.heroUrl`, CTA to enquiry), the glass nav (logo from `profile.logoUrl` or school name; menu items = `data.menu` labels + Home/About[if present]/Gallery[if present]/Contact[if present]/Enquire), the marquee, and the count-up stats from `data.stats`. Apply brand color via CSS var from `profile.brandColorPrimary`. Use the reveal-on-scroll + count-up + magnetic-button JS from the mockup (in a `useEffect`).
- [ ] **Step 2:** About section (only if `data.homepage.aboutText` present / ABOUT_CONTACT feature) with principal card; Academics bento from `data.menu` (class-wise cards).
- [ ] **Step 3:** Typecheck + boot + `curl http://localhost:3000 -H 'Host: beacon.localhost'` renders hero with the school's headline; visually load in a browser is ideal but curl for SSR content is the gate. Commit `feat(web): public site hero, nav, stats, about, academics`.

---

### Task 6: Public site — gallery + staff

**Files:** extend `PublicSite.tsx`.

- [ ] **Step 1:** Gallery grid (only if `data.gallery.length`) with hover-lift; Educators grid from `data.staff` (photo from `photoUrl` or initials, name, role).
- [ ] **Step 2:** Typecheck + boot; if beacon has no gallery images yet, upload one via the CMS/media API in verification, or assert the section hides gracefully when empty. Commit `feat(web): public site gallery + staff sections`.

---

### Task 7: Public site — contact + enquiry form

**Files:** extend `PublicSite.tsx`; `EnquiryForm` client subcomponent.

- [ ] **Step 1:** Contact section (only if ABOUT_CONTACT: phone/email/address from `profile`, map embed if present, social links from `data.socialLinks`), footer. The **EnquiryForm** posts to the API `POST /public/enquiry` from the browser — it MUST send the school Host header. Since the browser is already on `<slug>.localhost`, use `useApi`/fetch with `X-Forwarded-Host` set to `window.location.host` (mirror the school-page pattern), or a plain `fetch(`${NEXT_PUBLIC_API_URL}/public/enquiry`, { headers: { 'X-Forwarded-Host': window.location.host } })`. On success show a thank-you state; on 429 show "please try again shortly".
- [ ] **Step 2:** Boot; submit an enquiry from the browser-equivalent (curl the public endpoint with the beacon host) and confirm it appears in admin enquiries. Commit `feat(web): public site contact + working enquiry form`.

---

### Task 8: Full public-site verification

**Files:** none (verification).

- [ ] **Step 1:** Boot API + web. In a browser (or via curl for SSR + the animation JS present in the HTML): visit `http://beacon.localhost:3000` → the animated public site renders with beacon's content, brand color, stats, staff; submit the enquiry form → it lands in `beacon.localhost:3000/app` … (enquiries admin view — if not built into a page, verify via `GET /site/enquiries`). Visit `http://localhost:3000` → dev launcher still shows.
- [ ] **Step 2:** Confirm `pnpm --filter @skoolos/web typecheck` + `pnpm --filter @skoolos/api typecheck` clean; all e2e (public + management + cms + owner + tenant-isolation) pass.
- [ ] **Step 3:** Commit `feat(web): public school website complete (phase 5)`.

---

## Self-review notes (author)

- **Spec coverage (§7):** host→school resolution + SSR → Task 4; content-driven sections → Tasks 5-7; media id→URL resolution → Task 1; tier gating of sections → Task 1 (+ verified in Task 3); enquiry capture → Tasks 2,7; class-wise menu → Task 1. Caching/CDN + on-demand revalidation is NOTED as deferred (MVP uses `cache: 'no-store'` SSR; add ISR + Redis revalidation in a hardening pass) — call this out.
- **Deferred:** Connect events section (Phase 6 populates it — Phase 5 leaves the hook), full page caching/ISR + revalidation-on-edit, custom (non-class) menu editing, multi-template theming, SEO metadata polish (favicon/OG from assets is a nice add in Task 5 if cheap).
- **Isolation:** public endpoints resolve the tenant from the trusted Host (set by middleware), never from client input; all reads via `withTenant`; no `getPlatformPrisma`. A suspended/unknown host 404s. Enquiry submission is rate-limited and feature-gated.
- **Assumptions to verify during execution:** there is NO global auth guard (Phase-2 review confirmed only ThrottlerGuard is global) so `/public/*` is reachable unauthenticated; `next/headers` `headers().get('host')` returns the browser Host in dev (it does); the tenant middleware runs for `/public/*` routes (it's mounted on `*` — confirm) so `TenantContextService.get()` is populated; `FeatureResolverService.getFeatures` works outside an auth context (it only needs schoolId — yes).
