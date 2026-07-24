# Multi-Tenant Blog Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Tasks ordered by dependency; each is independently reviewable.

**Goal:** DB-backed blog platform: global blog on sckools.com (seeded with 5 posts incl. 3 new interactive ones), per-school blogs gated by a `BLOG` feature flag, school-admin authoring (structured blocks) + curation of global posts + layout config, owner approval queue for global syndication. Ship to staging branch `feat/blog-platform` (Vercel preview) for user testing; prod merge only after user approval.

**Architecture:** Posts live in Postgres as JSONB block arrays (one-row content fetch, no joins). Public reads are ISR-cached (revalidate 300s) — DB is hit ~12×/hour/page regardless of traffic. Canonical URLs prevent tenant duplicate-content: school copies of global posts canonical → `sckools.com/blog/<slug>`. Feature gating reuses the existing `FeatureKey`/`FeatureOverride`/Redis-cached resolver. Interactivity = one small client component; everything else server-rendered for SEO.

**Tech:** Prisma/Postgres (Neon), NestJS API (`apps/api`), Next.js 14 (`apps/web`), Vercel previews as staging.

## Global Constraints

- **NEVER `git add -A` / `git add .` / `git commit -a`** — apps/api contains iCloud " 2" corruption. Stage by explicit path. **Before editing ANY existing api file: `git diff --quiet HEAD -- <file>` must pass (file matches HEAD). If it doesn't, STOP and report.** New files are always safe.
- All work on branch **`feat/blog-platform`** (created from main). Push branch = staging deploy. NO merge to main in this plan.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- DB migration: **additive only** (new enums/tables/columns with defaults; nothing dropped/renamed). Applied with `DIRECT_URL` env for prisma CLI (pooler doesn't support DDL — see memory).
- Follow existing patterns exactly: uuid ids `@default(uuid()) @db.Uuid`, cms module for school-admin controllers (SchoolJwtGuard), owner module for owner endpoints (owner-host guard), public/marketing modules for public reads. Verification: `pnpm --filter @skoolos/api build` (tsc), `pnpm --filter @skoolos/web typecheck` + build.
- Web fetch pattern: follow `lib/public-api.ts` (base URL resolution, X-Skoolos-Host header, `next: { revalidate }`).

## Data Model (packages/db/prisma/schema.prisma — append)

```prisma
enum BlogScope { PLATFORM SCHOOL }
enum BlogStatus { DRAFT PUBLISHED }
enum BlogGlobalStatus { NONE PENDING APPROVED REJECTED }

model BlogPost {
  id           String           @id @default(uuid()) @db.Uuid
  scope        BlogScope
  schoolId     String?          @db.Uuid
  slug         String
  title        String
  description  String
  heroImageUrl String?
  readMinutes  Int              @default(4)
  sections     Json             // BlogBlock[] — see Block Schema
  status       BlogStatus       @default(DRAFT)
  globalStatus BlogGlobalStatus @default(NONE)
  globalSlug   String?          @unique   // set on global approval; PLATFORM posts: = slug
  rejectReason String?
  publishedAt  DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  school       School?          @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  selections   SchoolBlogSelection[]

  @@unique([schoolId, slug])
  @@index([scope, globalStatus, status, publishedAt(sort: Desc)])
  @@index([schoolId, status, publishedAt(sort: Desc)])
}

model SchoolBlogSelection {
  id        String   @id @default(uuid()) @db.Uuid
  schoolId  String   @db.Uuid
  postId    String   @db.Uuid
  isHero    Boolean  @default(false)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  school    School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  post      BlogPost @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([schoolId, postId])
  @@index([schoolId, isHero, sortOrder])
}
```

Plus on `SchoolProfile`: `blogLayout String @default("HERO_GRID")` (`HERO_GRID`|`GRID`|`LIST`), `blogHeroLimit Int @default(1)` (1–2). Plus `School` relations: `blogPosts BlogPost[]`, `blogSelections SchoolBlogSelection[]`.

Feature flag (`packages/db/src/features.ts`): add `'BLOG'` to `FeatureKey` + `ALL_KEYS`; add to `STANDARD` list (Standard & Pro tiers get it by default; owner FeatureOverride checkbox grants/revokes per school — existing machinery, zero new code).

## Block Schema (shared type — packages/db/src/blog-blocks.ts, exported from @skoolos/db)

```ts
export type BlogBlock =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'img'; url: string; alt: string; caption?: string }
  | { t: 'stats'; items: { value: string; label: string; tone?: 'good' | 'bad' }[] }
  | { t: 'ranking'; items: { label: string; value: string; pct: number }[]; source?: string }
  | { t: 'quiz'; tag?: string; q: string; options: string[]; correct: number; why: string };
```

## Semantics (the rules every task follows)

- **Global blog** (`sckools.com/blog`) = posts where `status=PUBLISHED AND globalStatus=APPROVED`, ordered `publishedAt desc`, addressed by `globalSlug`.
- **School blog** (`<school>.sckools.com/blog`) = the school's `SchoolBlogSelection` rows joined to posts (own posts get a selection row auto-created on publish; global posts via explicit selection). Heroes first (`isHero`, capped `blogHeroLimit`), then `publishedAt desc`. 404 unless school has `BLOG` feature.
- **Canonicals:** PLATFORM post → self. School-authored post displayed on own site → self **unless** `globalStatus=APPROVED`, then canonical → `https://sckools.com/blog/<globalSlug>`. Global post displayed on a school site → canonical → global URL. (One canonical URL per piece of content, platform gets the authority.)
- **Approval flow:** school admin `submit-global` → `globalStatus=PENDING` → owner approves (sets `APPROVED`, assigns `globalSlug` = slug, suffixed `-<schoolSlug>` on collision) or rejects (`REJECTED` + reason). Approval/rejection never touches the school's own publish state.
- **Attribution:** global rendering of a SCHOOL-scope post shows "By {school.name}" linking to the school's site.

## API Endpoints

**marketing module** (no tenant): `GET /marketing/blog` → `{ posts: BlogCard[] }`; `GET /marketing/blog/:globalSlug` → `BlogPostFull` (with `author: {name, host} | null`). BlogCard = `{slug, title, description, heroImageUrl, readMinutes, publishedAt, authorName?}`.

**public module** (tenant host): `GET /public/blog` → `{ layout, heroLimit, posts: (BlogCard & {isHero, isOwn})[] }`; `GET /public/blog/:slug` → `BlogPostFull & { canonicalUrl }` (resolve own slug first, else selected global's globalSlug). Both 404 when feature `BLOG` disabled (use existing require-feature guard/resolver).

**cms module** (SchoolJwtGuard + BLOG feature): CRUD `GET/POST/PATCH/DELETE /cms/blog/posts[/:id]`, `POST /cms/blog/posts/:id/publish` (sets PUBLISHED + publishedAt + auto-creates selection), `POST /cms/blog/posts/:id/submit-global`; library `GET /cms/blog/library` (approved global posts, with "selected" flag); selections `POST /cms/blog/selections {postId}` / `DELETE /cms/blog/selections/:postId` / `PATCH /cms/blog/selections/:postId {isHero?, sortOrder?}` (enforce heroLimit); settings `PATCH /cms/blog/settings {blogLayout?, blogHeroLimit?}`. DTO validation: sections max 40 blocks, quiz options 2–4, `correct < options.length`, title ≤120, description ≤200, slug `[a-z0-9-]{3,80}`.

**owner module** (owner-host guard): `GET /owner/blog/pending` (PENDING posts with school name), `POST /owner/blog/:id/approve`, `POST /owner/blog/:id/reject {reason}`.

## Web (apps/web)

- `lib/blog-api.ts`: `fetchGlobalBlog()`, `fetchGlobalPost(slug)`, `fetchSchoolBlog(host)`, `fetchSchoolPost(host, slug)` — all `revalidate: 300`, null on failure (page 404s gracefully).
- `components/blog/BlogBlocks.tsx` (server): renders all block types; `components/blog/BlogQuiz.tsx` (`'use client'`): options as buttons, reveal correct/wrong + why (port the approved artifact behavior); styles appended to `marketing.css` under `.mkt` scope for platform AND a `.ps-blog` scope for tenant pages (tenant pages don't load marketing.css — use a dedicated `blog.css` imported by both, tokens via CSS vars with fallbacks).
- `app/blog/page.tsx` + `app/blog/[slug]/page.tssx` rewritten: platform host → global blog from API; school host → school blog (was: notFound). Metadata host-branched (fixes the earlier minor finding). Article JSON-LD as today; school-authored global posts get `author: {'@type':'Organization', name: school}`.
- Layout presets on school blog page: `HERO_GRID` (hero full-width tile(s) then 3-col grid), `GRID` (3-col, no hero), `LIST` (single column rows). Platform blog keeps HERO_GRID hard-coded with first post as hero.
- `lib/blog.ts` (static) deleted after seed; sitemap.ts pulls global slugs via `fetchGlobalBlog()`.
- Navbars: MarketingSite nav + PricingCards nav get `Blog` link; PublicSite tenant nav gets `Blog` link when `school.features` includes `'BLOG'` (field already in PublicSiteData).
- School admin console: `Blog` section alongside existing site-content config (implementer locates the console nav; follow its patterns): post list + block editor (form-based: add/remove/reorder blocks per Block Schema, per-type fields), publish + submit-global buttons with status chips, Global Library tab (browse/select global posts), Layout tab (preset picker + hero assignment respecting heroLimit).
- Owner console: approval queue page (pending list, preview rendered via BlogBlocks, approve/reject with reason). Feature checkbox: verify the existing owner school-features UI lists ALL_KEYS dynamically — if yes BLOG appears automatically; if hard-coded, add it.

## Hero Images (3 new posts)

SVG editorial illustrations in brand style (teal #14B8A6 → violet #6D4AFF on deep slate, path-based, no `<text>`), one per post theme: teachers=ranked bars motif, students=memory/forgetting-curve motif, parents=conversation motif. Rasterize 1600×900 PNG via a `scripts/generate-blog-art.mjs` (sharp, same pattern as generate-icons.mjs) → `apps/web/public/blog/{teaching-strategies,study-science,parents-guide}.png`. Referenced as heroImageUrl + og:image per post.

## Seed (packages/db/seed-blog.ts, run manually with DIRECT_URL)

5 PLATFORM posts (`scope=PLATFORM, status=PUBLISHED, globalStatus=APPROVED, globalSlug=slug`): the 2 existing posts converted from `apps/web/lib/blog.ts`, plus the 3 approved drafts converted from `/private/tmp/claude-501/-Users-darshanjain-Documents-SchoolManager-SchoolManager/ac206f03-3ab2-45c0-8f6c-8cf94ebdf61e/scratchpad/blog-research/drafts-review.html` (faithful conversion: article content → blocks incl. quiz/stats/ranking data & the SEO slugs/titles/descriptions in each draft's `.seo` header; hero images per Images task). Idempotent upsert by slug.

## Tasks (dependency order)

1. **DB layer**: schema append, `BLOG` feature key, blog-blocks.ts type, migration created + applied (DIRECT_URL), regenerate client. *(packages/db only)*
2. **API blog module**: new `apps/api/src/modules/blog/` (module + services + 4 controllers per endpoints spec), registered in app module (verify app.module.ts matches HEAD first). API tsc build passes.
3. **Hero art**: 3 SVGs + rasterizer script + PNGs committed.
4. **Seed**: seed-blog.ts + run against DB; verify via API endpoint locally (or direct query).
5. **Web public**: blog-api.ts, BlogBlocks/BlogQuiz + blog.css, rewritten blog routes (global + tenant + canonicals + layouts), sitemap, delete lib/blog.ts, navbar links (marketing + pricing + tenant).
6. **School admin console UI**: blog manager (list/editor/library/layout).
7. **Owner console UI**: approval queue + features checkbox verification.
8. **Staging deploy**: push branch; configure preview env (`NEXT_PUBLIC_PLATFORM_HOST` = web preview alias, web→api preview URL env) via `vercel env add ... preview` for both projects; smoke-test preview URLs; hand test-plan to user.

## Staging Notes

Vercel auto-builds branch pushes as previews for both projects (aliases `skoolos-web-git-feat-blog-platform-*` / api equivalent). Same prod DB (schema changes are additive; new tables invisible to existing code paths — safe). Tenant-host pages can't be fully exercised on preview domains (host-based routing); school-blog UI is testable via the admin console + API, tenant rendering verified on prod after merge using a sample school (`darshan`/`beacon` — excluded from sitemap).

## Backlog (explicitly out)

Owner-side platform-post CRUD UI (platform posts via seed for now); rich-text editor; per-post comments/likes; IndexNow auto-ping hook; blog categories/tags; image upload inside block editor (v1: paste URL from existing media library).
