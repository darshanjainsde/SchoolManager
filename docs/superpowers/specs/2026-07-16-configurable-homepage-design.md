# Configurable homepage design — spec

**Date:** 2026-07-16
**Status:** Approved (pitch artifact approved by Darshan; additions: keep current design as an option, image-opacity dial wherever text sits on a photo, selectable headline-underline animation)

## Goal

School admins configure how their public homepage's first screen, navbar, and admissions
section look — from visual pickers in the Website tab — so Sckools sites stop looking
identical. The current design remains one of the options and stays the default;
**existing schools render pixel-identical until an admin changes something.**

## Non-goals

- No page-builder / arbitrary section reordering.
- No admin control over navbar link contents (links stay derived from enabled features;
  the unused `MenuItem` table stays unused).
- No new animation config for admissions — it inherits the existing Animation level.

## 1 · First-screen layouts

New `SchoolProfile.heroLayout` (string, default `ILLUSTRATION`) selects one of seven
renderers. Layouts consume 0–5 ordered hero images.

| Value | Images | Description |
|---|---|---|
| `ILLUSTRATION` | 0–1 | Today's floating-card hero, byte-for-byte unchanged. Default. |
| `FULL_BLEED` | 1 | Today's PHOTO backdrop, upgraded: overlay style + opacity + text align. Defaults reproduce today's rendering exactly. |
| `SPLIT_MOSAIC` | 3 | Big image left with headline overlaid, two stacked small images right. |
| `SPLIT_EDITORIAL` | 1 | Text on paper left, full-height photo right. |
| `COLLAGE` | 3–4 | Centered headline, photo band of 3–4 tiles below. |
| `SLIDESHOW` | 3–5 | Full-bleed crossfade with slow Ken Burns; Subtle = crossfade only, Off/reduced-motion = static first image. |
| `MINIMAL` | 0 | Today's minimal hero, unchanged. |

**Shared knobs** (SchoolProfile, apply to any layout where meaningful):

- `heroTextAlign`: `LEFT` (default) | `CENTER`
- `heroOverlayStyle`: `WASH` (paper, dark text — today's look) | `TINT` (brand color, white text) | `DARK` (near-black, white text)
- `heroOverlayOpacity`: int 10–95, default 65 — the requested opacity dial. Drives the
  overlay layer between image and text on FULL_BLEED, SPLIT_MOSAIC (big tile),
  SLIDESHOW, and COLLAGE (behind centered headline when it overlaps the band on
  small screens).
- `heroHeight`: `FULL` (default for photo layouts) | `COMPACT` (~80vh)

**Headline accent** — `SchoolProfile.headlineAccent`, replaces the hardcoded
hand-drawn underline:

- `DRAW` (default) — today's hand-drawn SVG stroke that draws itself. Unchanged.
- `MARKER` — highlighter sweep: accent-color wash animates left→right behind the last
  words of the headline.
- `GROW` — solid rounded bar scales in from the left.
- `NONE` — no accent.

**Fallback rule:** a photo layout with zero uploaded images renders `ILLUSTRATION`
(today's behavior for PHOTO-without-image is the same downgrade). SPLIT_MOSAIC with
1–2 images fills what it has and drops empty tiles; SLIDESHOW with 1 image renders
as static FULL_BLEED.

**Migration:** SQL sets `heroLayout` from existing `heroStyle`
(`PHOTO→FULL_BLEED`, `MINIMAL→MINIMAL`, else `ILLUSTRATION`). `heroStyle` column and
DTO field stay (legacy write path keeps working; writing `heroStyle=PHOTO` also sets
`heroLayout=FULL_BLEED` in the service so the old checkbox in cached admin bundles
still works).

## 2 · Hero images (multi-image)

`HomepageContent.heroImageAssetIds String[] @default([])` — ordered, max 5, all
`MediaAsset` kind `HERO`. `heroAssetId` remains and is kept in sync with slot 1 for
backward compatibility. Public payload adds `homepage.heroImages: string[]` (resolved
URLs); `heroUrl` remains = first available image.

## 3 · Navbar

`SchoolProfile.navStyle` (default `CLASSIC`), `navCtaLabel` (string ≤40, default
"Enquire"), `navShowCta` (bool, default true).

| Value | Description |
|---|---|
| `CLASSIC` | Today's bar, unchanged. Default. |
| `CENTER` | Links split around a centered logo + name. |
| `PILL` | Detached rounded blurred bar floating below the top edge. |
| `STRIP` | Slim dark ribbon (phone · email from existing contact profile) above the classic bar. |
| `GHOST` | Transparent over the hero, solid paper + shadow after scroll. Only honored when `heroLayout` is photo-based and view is home; otherwise renders CLASSIC. |

Link contents/ordering stay automatic. Mobile menu behavior identical across styles.

## 4 · Admissions animation

No config. `AdmissionsSection` gets a `variant` prop:

- `journey` (homepage): dashed accent path draws left→right behind the step row,
  number badges spring-pop onto it, cards rise staggered, lift on hover.
- `rail` (/admissions page): vertical brand-gradient rail fills as the reader scrolls;
  steps alternate sides.

Both scale with the existing `--motion` var and collapse to static under
`prefers-reduced-motion` / Animation = Off. Fee table untouched.

## 5 · Admin — new "Design" tab

New tab between Theme and Homepage in `/app/website`:

1. **First screen layout** — 7 clickable CSS-wireframe thumbnails (no dropdowns).
2. **Images for this layout** — slot row that adapts to the chosen layout's image
   count; each slot uploads (`POST /site/media?kind=HERO`), removes, and reorders;
   saves `heroImageAssetIds`.
3. **Knobs** — text alignment, overlay style, overlay opacity slider (10–95%),
   height.
4. **Headline accent** — 4 radio cards with mini previews.
5. **Navbar** — 5 thumbnails + CTA text input + show-CTA toggle.

Moves/replacements: the "Hero style" select leaves the Theme tab; the full-screen
backdrop checkbox leaves the Homepage tab (both replaced by the Design tab; a small
hint links there). Everything else on those tabs is untouched.

Saving uses the existing `PUT /site/profile` and `PUT /site/homepage` endpoints.

## 6 · Code structure

- `PublicSite.tsx` (774 lines) sheds two components:
  `components/public/sections/HeroSection.tsx` (all 7 layouts + headline accents)
  and `components/public/sections/SiteNav.tsx` (5 styles). Theme CSS vars stay in
  PublicSite; new CSS classes join the existing injected stylesheet.
- Admin Design tab lives in `apps/web/app/app/website/design-tab.tsx` (the page file
  is already 1570 lines; new tabs get their own files like courses/admissions/hof).

## 7 · Compatibility & safety

- All new columns have defaults; no data backfill besides the heroStyle mapping.
- Default values reproduce the current rendering for every existing school
  (ILLUSTRATION + DRAW + CLASSIC + WASH/65).
- Public payload changes are additive; old web builds ignore new fields.
- Legacy `heroStyle` writes still work and stay consistent with `heroLayout`.

## 8 · Verification

Per option, end-to-end: run API + web locally, set the option through the real
API (as the admin UI would), fetch the rendered homepage, and assert the layout's
distinctive markup/classes are present. Confirm an untouched school's homepage
markup is unchanged vs. main. Typecheck, API + web builds, existing test suites.
