# Phase 8 — Public Site Theming & Redesign Design

**Status:** Approved for planning. Direction approved by the product owner from the interactive mockup `mockups/public-site-redesign.html` (2026-07-04). Each school admin can customize their own site.

## 1. Goal

Replace the dark "AI-aurora" public site with a warm, academic, school-relatable design, and give each **school admin** live theme controls in the Website content editor:

1. **Theme preset** — one-click looks (Academic, Modern, Playful, Elegant, Custom) that set colours + heading font.
2. **Brand colours** — primary + accent (already exist; now they drive the whole theme).
3. **Heading font** — a curated set (Fraunces academic serif, Poppins rounded, Nunito friendly, Inter neutral).
4. **Hero style** — Illustrated (animated motifs), Photo background (uses hero image), Minimal/calm.
5. **Animation intensity** — Full / Subtle / Off (Off also honours `prefers-reduced-motion`).

The public site reads these per-school and renders accordingly, driven by the school's real content (unchanged data model for content — only theme settings are added).

## 2. Aesthetic (from the approved mockup)

- Warm "paper" background, deep-ink headings derived from the primary colour, soft shadows, generous rounded corners.
- School-relatable motion instead of aurora: gentle float/sway of academic motifs (🎓 📚 ✏️ ⭐), a hand-drawn underline that draws itself under the hero headline, twinkling accents, reveal-on-scroll.
- All colour comes from the school's primary + accent (CSS variables), so a school that picks maroon/cream looks maroon/cream everywhere.
- Sections retain the existing content set: nav, hero (with stats), about, academics, events/Connect, gallery, staff, contact + enquiry, footer.

## 3. Data model changes

Add nullable-with-default columns to **`SchoolProfile`** (no new table; theme is 1:1 with the profile):

- `headingFont String @default("INTER")` — one of `INTER | FRAUNCES | POPPINS | NUNITO`.
- `heroStyle String @default("ILLUSTRATION")` — one of `ILLUSTRATION | PHOTO | MINIMAL`.
- `animationLevel String @default("FULL")` — one of `FULL | SUBTLE | NONE`.
- `themePreset String?` — UI convenience so the editor can highlight the active preset (`ACADEMIC | MODERN | PLAYFUL | ELEGANT | CUSTOM`); nullable = never chosen (treated as Custom).

`brandColorPrimary` / `brandColorSecondary` already exist. RLS is unchanged (SchoolProfile already has `tenant_iso`). No migration to RLS — just `ALTER TABLE ADD COLUMN`.

## 4. API changes

- `UpdateProfileDto` (cms) gains optional validated fields: `headingFont` (`@IsIn` the 4 values), `heroStyle` (`@IsIn` the 3), `animationLevel` (`@IsIn` the 3), `themePreset` (`@IsIn` the 5 + optional). The existing `updateProfile` upsert already spreads the DTO, so persistence is automatic once the DTO permits them.
- `PublicSiteData.profile` (public.dto + public-site.service) gains `headingFont`, `heroStyle`, `animationLevel` (public, unauthenticated — safe, they're presentational). `themePreset` is NOT needed publicly (editor-only).
- Web `PublicSiteData` interface mirrors the added fields.

**Invariants unchanged:** schoolId from `requireTenant`, all `withTenant`, no `getPlatformPrisma` in cms/public. Theme fields are presentational; no new isolation surface.

## 5. Web changes

### Public site (`PublicSite.tsx`) — redesign
Rebuild to the mockup aesthetic, reading `profile.brandColorPrimary/Secondary/headingFont/heroStyle/animationLevel`:
- CSS variables `--ps1` (primary), `--ps2` (accent, near-white falls back to a primary tint — already implemented), `--ink` (derived deep tone), `--font-head` (mapped from `headingFont`), `--motion` (1 / 0.5 / 0 from `animationLevel`, forced 0 under `prefers-reduced-motion`).
- Load the chosen heading font from Google Fonts (all four preconnected/linked).
- Hero renders one of three variants by `heroStyle`. Illustrated = animated motif cluster; Photo = `homepage.heroUrl` background with overlay (falls back to Illustrated if no hero image); Minimal = calm, low-motion.
- Motion multiplier scales every animation; `NONE` disables transforms/keyframes.
- Keep all existing sections, feature-gating, enquiry form, and URL-scheme hardening.

### Admin — Theme editor
Add a **Theme** tab to `apps/web/app/app/website/page.tsx` (alongside Branding), or extend Branding. Controls:
- Preset buttons (Academic/Modern/Playful/Elegant) that set colours + font locally, then Save.
- Primary + accent colour pickers (exist).
- Heading-font select, hero-style select, animation-level select — with a small live preview swatch/notice.
- Save via the existing `PUT /site/profile` (now accepting the new fields). Every `useApi` carries `hostHeader` (host-gated query — the pattern fixed this session).

Preset definitions live in a shared constant (web): each preset = `{ primary, secondary, headingFont }`.

## 6. Testing

- cms e2e: `PUT /site/profile` with theme fields persists and round-trips via `GET /site/content`; invalid enum value → 400.
- public e2e: `GET /public/site` returns the theme fields; defaults present when never set.
- Manual: in the admin Theme tab, pick each preset / font / hero / motion → Save → public site reflects it; set brand colours → whole site recolours; `prefers-reduced-motion` disables motion.

## 7. Out of scope (YAGNI)

Per-section layout reordering, custom CSS upload, multiple font pairings beyond the curated set, dark-mode toggle, template marketplace. Theme is per-school and limited to the controls above.
