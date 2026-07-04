# Phase 8 — Public Site Theming & Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give each school admin live theme controls (preset, brand colours, heading font, hero style, animation intensity) and rebuild the public site to a warm, academic, school-relatable design driven by those settings.

**Architecture:** Theme is 1:1 with `SchoolProfile` — add presentational columns, expose them through the existing `PUT /site/profile` and `GET /public/site`, and render the redesigned `PublicSite.tsx` from CSS variables. Reference aesthetic: `mockups/public-site-redesign.html` (approved).

**Tech Stack:** Prisma 5, NestJS 10, Next.js 14, Tailwind, @tanstack/react-query.

## Global Constraints

- **schoolId** only from `TenantContextService.requireTenant()`; all tenant DB access via `withTenant`; NO `getPlatformPrisma` in cms/public.
- **Web host rule:** every admin `useApi` query is gated `enabled: !!host` with `hostHeader` from `useHost()` (a race fixed this session — do not regress).
- **Theme field values (exact):** `headingFont ∈ {INTER, FRAUNCES, POPPINS, NUNITO}`; `heroStyle ∈ {ILLUSTRATION, PHOTO, MINIMAL}`; `animationLevel ∈ {FULL, SUBTLE, NONE}`; `themePreset ∈ {ACADEMIC, MODERN, PLAYFUL, ELEGANT, CUSTOM}` (nullable).
- **Preset definitions (exact, shared web constant):**
  - ACADEMIC → primary `#2f6b4f`, secondary `#e8b04b`, font `FRAUNCES`
  - MODERN → primary `#3b4ee0`, secondary `#38bdf8`, font `POPPINS`
  - PLAYFUL → primary `#f2653f`, secondary `#12b3a6`, font `NUNITO`
  - ELEGANT → primary `#7a2233`, secondary `#d9c7a3`, font `FRAUNCES`
- **Migration:** `SchoolProfile` id/columns follow the repo convention (no DB default fn for uuid; but these are TEXT columns WITH string defaults — `DEFAULT 'INTER'` etc. is fine). RLS on SchoolProfile already exists — do NOT touch it.
- **Motion + a11y:** `animationLevel` maps to `--motion` = FULL→1, SUBTLE→0.5, NONE→0; additionally `@media (prefers-reduced-motion: reduce)` forces motion off.

---

### Task 1: Schema — theme columns on SchoolProfile

**Files:** `packages/db/prisma/schema.prisma`; new migration dir.

**Interfaces:** Produces `SchoolProfile.headingFont/heroStyle/animationLevel: string`, `themePreset: string | null`.

- [ ] **Step 1:** Add to `model SchoolProfile` (after `brandColorSecondary`):
```prisma
  headingFont       String  @default("INTER")
  heroStyle         String  @default("ILLUSTRATION")
  animationLevel    String  @default("FULL")
  themePreset       String?
```
- [ ] **Step 2:** Migration `packages/db/prisma/migrations/<ts>_school_profile_theme/migration.sql`:
```sql
ALTER TABLE "SchoolProfile" ADD COLUMN "headingFont" TEXT NOT NULL DEFAULT 'INTER';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroStyle" TEXT NOT NULL DEFAULT 'ILLUSTRATION';
ALTER TABLE "SchoolProfile" ADD COLUMN "animationLevel" TEXT NOT NULL DEFAULT 'FULL';
ALTER TABLE "SchoolProfile" ADD COLUMN "themePreset" TEXT;
```
- [ ] **Step 3:** `pnpm --filter @skoolos/db migrate:deploy && pnpm --filter @skoolos/db generate`; confirm no drift (`prisma migrate status`).
- [ ] **Step 4:** `pnpm --filter @skoolos/db typecheck` → 0.
- [ ] **Step 5:** Commit `feat(db): SchoolProfile theme fields (font, hero, motion, preset)`.

---

### Task 2: API — accept + expose theme fields

**Files:** `apps/api/src/modules/cms/internal/cms.dto.ts` (UpdateProfileDto), `apps/api/src/modules/public/public.dto.ts` (PublicSiteData.profile), `apps/api/src/modules/public/public-site.service.ts` (map fields), `apps/web/lib/public-api.ts` (web interface).

**Interfaces:** Consumes theme columns from Task 1. Produces theme fields on `GET /public/site` and acceptance on `PUT /site/profile`.

- [ ] **Step 1:** Extend `UpdateProfileDto` — add (mirror existing `@IsOptional()` style; import `IsIn`):
```ts
  @IsOptional() @IsIn(['INTER', 'FRAUNCES', 'POPPINS', 'NUNITO']) headingFont?: string;
  @IsOptional() @IsIn(['ILLUSTRATION', 'PHOTO', 'MINIMAL']) heroStyle?: string;
  @IsOptional() @IsIn(['FULL', 'SUBTLE', 'NONE']) animationLevel?: string;
  @IsOptional() @IsIn(['ACADEMIC', 'MODERN', 'PLAYFUL', 'ELEGANT', 'CUSTOM']) themePreset?: string;
```
(`updateProfile` already `update: dto` — persistence automatic. Verify it does not strip unknown keys.)
- [ ] **Step 2:** In `public.dto.ts`, add to the `profile` object type: `headingFont: string; heroStyle: string; animationLevel: string;`.
- [ ] **Step 3:** In `public-site.service.ts` `getSite`, add those three to the returned `profile` object (read from the `profile` row; they are non-null with defaults). Do NOT expose `themePreset` publicly.
- [ ] **Step 4:** In web `public-api.ts`, add the three fields to `PublicSiteData.profile`.
- [ ] **Step 5:** `pnpm --filter @skoolos/api typecheck` + `pnpm --filter @skoolos/web exec tsc --noEmit` → 0/0.
- [ ] **Step 6:** Commit `feat(api): theme fields on profile update + public site payload`.

---

### Task 3: Web public — redesigned, theme-driven PublicSite

**Files:** rewrite `apps/web/components/public/PublicSite.tsx` (keep the file; replace the visual layer). Keep the `EnquiryForm` subcomponent, feature gating, `safeHttpUrl/safeHttpsUrl`, brand-colour helpers (`isNearWhite/lighten`) already present.

**Interfaces:** Consumes `PublicSiteData` incl. new theme fields. Produces the rendered public site.

- [ ] **Step 1:** Port the aesthetic + interactions from `mockups/public-site-redesign.html`: paper background, `--ink` derived from primary (reuse a `mix()` helper), soft shadows, rounded cards; motion set = float/sway/rise/underline-draw/twinkle, all scaled by `--motion`. Add `@media (prefers-reduced-motion: reduce){ :root{ --motion:0 } }` and disable keyframe transforms when motion is 0.
- [ ] **Step 2:** Map fields to CSS on the root:
  - `--ps1 = brandColorPrimary`, `--ps2 = brandColor2` (existing near-white fallback), `--ink = mix(primary, #12211a, .35)`.
  - `--font-head` from `headingFont`: INTER→`'Inter'`, FRAUNCES→`'Fraunces'`, POPPINS→`'Poppins'`, NUNITO→`'Nunito'` (append serif/sans fallback). Load the chosen family via a Google Fonts `<link>` (all four families in one link href, like the mockup).
  - `--motion` from `animationLevel`: FULL 1 / SUBTLE 0.5 / NONE 0.
- [ ] **Step 3:** Hero by `heroStyle`: `PHOTO` → `homepage.heroUrl` bg + overlay (fall back to ILLUSTRATION if no heroUrl); `ILLUSTRATION` → animated motif cluster (🎓📚✏️⭐ float/sway) as in the mockup; `MINIMAL` → calm, `--motion` locally reduced, no decor cluster. Keep the hero stats (from `data.stats` if present, else the three defaults) and the drawn underline under the headline.
- [ ] **Step 4:** Keep every existing section (about, academics, events/Connect, gallery, staff, contact + enquiry, footer), each recoloured via the vars. Events/Connect section styling per mockup (brand-gradient band). Preserve feature-gating conditions and nav links exactly.
- [ ] **Step 5:** `pnpm --filter @skoolos/web exec tsc --noEmit` → 0. Boot web+api; on `beacon.localhost:3000` verify: page renders, brand colours apply (set via admin or API), switching `heroStyle`/`animationLevel`/`headingFont` (via API `PUT /site/profile`) changes the rendered site. Confirm sections + enquiry still work.
- [ ] **Step 6:** Commit `feat(web): redesigned school-themed public site (fonts, hero styles, motion)`.

---

### Task 4: Web admin — Theme editor tab

**Files:** `apps/web/app/app/website/page.tsx` (add a Theme tab + controls); a shared preset constant (inline or `apps/web/lib/theme-presets.ts`).

**Interfaces:** Consumes `data.profile` theme fields; saves via `PUT /site/profile`.

- [ ] **Step 1:** Add `theme-presets.ts`: `export const THEME_PRESETS = { ACADEMIC:{...}, MODERN:{...}, PLAYFUL:{...}, ELEGANT:{...} }` with the exact values from Global Constraints (primary, secondary, headingFont).
- [ ] **Step 2:** Add a `Theme` tab to the website editor's tab set. Controls (all seeded from `data.profile`, gated `enabled: !!host` like the rest — the content query already gates):
  - Preset buttons: clicking one sets local primary/secondary/headingFont/themePreset state (does not auto-save).
  - Primary + accent colour pickers (reuse Branding's).
  - Heading-font `<Select>` (4 options), hero-style `<Select>` (3), animation-level `<Select>` (3).
  - A "Save theme" button → `PUT /site/profile` with `{ brandColorPrimary, brandColorSecondary, headingFont, heroStyle, animationLevel, themePreset }`; on success invalidate `['site-content']` + toast. Manual colour/font edits set `themePreset='CUSTOM'`.
  - Small live preview: a mini card showing the heading font + colours applied.
- [ ] **Step 3:** `pnpm --filter @skoolos/web exec tsc --noEmit` → 0. Boot; as `admin@beacon.test` on `beacon.localhost:3000` → Website → Theme: pick Academic preset → Save → open the public site in another tab → confirm it changes. Change font/hero/motion → Save → confirm. CLEAN UP: reset beacon to sensible defaults after testing (or leave a pleasant preset).
- [ ] **Step 4:** Commit `feat(web): admin Theme editor (presets, font, hero, motion)`.

---

### Task 5: e2e + full verification

**Files:** extend `apps/api/test/cms.e2e-spec.ts` and `apps/api/test/public.e2e-spec.ts`.

- [ ] **Step 1:** cms e2e: `PUT /site/profile` with `{ headingFont:'FRAUNCES', heroStyle:'PHOTO', animationLevel:'SUBTLE', themePreset:'ACADEMIC' }` → 200; `GET /site/content` round-trips them; an invalid value (e.g. `headingFont:'COMIC'`) → 400.
- [ ] **Step 2:** public e2e: `GET /public/site` includes `profile.headingFont/heroStyle/animationLevel`; a school that never set them shows the defaults (`INTER/ILLUSTRATION/FULL`).
- [ ] **Step 3:** Run the full suite (boot API `DISABLE_THROTTLER=true`, `DATABASE_URL_TEST`=dev DB): all green (prior 63 + new).
- [ ] **Step 4:** typecheck api + web → 0/0. Manual pass: admin Theme editor → each preset/font/hero/motion reflected on the public site; brand colours recolour everything; `prefers-reduced-motion` (emulate in devtools) disables motion.
- [ ] **Step 5:** No commit (verification). Then run superpowers:finishing-a-development-branch.

---

## Self-Review (author)

- **Spec coverage:** presets (T4 constant + buttons), brand colours (existing + T3 theming), heading font (T1/2/3/4), hero style (T1/2/3/4), animation intensity + a11y (T3 `--motion` + reduced-motion). Admin-editable per school (T4, tenant-scoped). Public renders per-school (T3).
- **Isolation:** theme fields are presentational, live on the tenant-scoped SchoolProfile; no new `getPlatformPrisma`, no RLS change. Admin saves via existing tenant-guarded `PUT /site/profile`.
- **Type consistency:** the 4/3/3/5 enum value sets are identical across the DTO (`@IsIn`), the web selects, and the preset constant. `themePreset` is editor-only (never in the public payload).
- **Regression guard:** T3 must preserve feature-gating, the enquiry form, URL hardening, and the host-gated query pattern. T4 controls live under the already-host-gated content query.
- **Carry-over (opportunistic):** prior deferred minors (go-live gating, P6/P7 cosmetics) remain out of scope unless a touched file makes a fix trivial.
