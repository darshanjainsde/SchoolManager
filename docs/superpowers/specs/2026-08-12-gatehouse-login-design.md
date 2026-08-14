# Gatehouse Login — Design Spec

**Date:** 2026-08-12 · **Approved by:** Darshan (via the interactive "Front Gate" pitch artifact, round-two "Gatehouse, built out" direction)

## Goal

The tenant login page (`/login` on school hosts) becomes the school's own front gate: the school's name, crest and brand colors carry the whole page — background included — with a vertical role selector that feels like separate entrances and a choreographed motion system. Every existing auth behavior is preserved byte-for-byte.

## Scope

- **In:** `apps/web/app/login/` only — page becomes a themed server/client pair, plus a pure theme-resolver module, styles, and unit tests.
- **Out:** `/platform/login` (owner console), mobile app login, forgot/reset pages, any API change (none is needed — theming data is already served).

## Data & theming

- `page.tsx` becomes an async **server component**: `host = await getRequestHost()`; `data = isSchoolHost(host) ? await fetchPublicSite(host) : null`.
- A pure resolver `resolveLoginTheme(data, host)` returns `{ schoolName, tagline, logoUrl, primary, secondary, fontStack, hostname, branded }`:
  - **Branded school:** `profile.brandColorPrimary/Secondary`, `FONT_STACK[profile.headingFont]` (fallback Inter), `school.name`, `profile.logoUrl`, tagline = `homepage.subheadline` → `profile.city` → generic line.
  - **Fallback** (platform host, fetch failure, or missing profile): Sckools indigo `#4F46E5` / amber `#F59E0B`, name "Sckools", Tassel-S logo. Never a half-themed page.
- Colors land as CSS custom properties (`--gh-p`, `--gh-s`) via inline style on the **server-rendered** wrapper — no color flash, nothing client-only in the render path.

## Layout

- **Desktop (≥ 720px):** split shell. Left = identity panel (brand gradient, crest/logo, school name in the school's heading font, tagline, role "entrance plate", footer line "You're signing in to the school's own system · {host}"). Right = form panel.
- **Mobile:** identity panel collapses to a branded header block above the form; role rows stay vertical (44px+ targets).
- **Background (3 CSS layers, zero assets):** brand-tinted gradient wash; fine 45° cross-hatch lattice in the primary at low opacity, radially masked; drifting blurred color fields + slow dashed rings + rising motes.

## Roles

- Vertical radiogroup **Student / Teacher / Admin & Office** — presentational only (copy, input type, keyboard). Post-login routing stays `homeForRole(me.role)` from `/auth/me`; STAFF routes to `/staff` as on main today (the pitch-era "STAFF bounce" is obsolete).
- Per-role copy preserved from the current page, including the student-code identifier hint (RAF-00042 style).
- Last-used role remembered in `localStorage` (`sk-login-role`), read **only in `useEffect`** — never during render (hydration rule).

## Motion

All CSS, transform/opacity only; everything collapses under `prefers-reduced-motion`.

- **Entrance:** shell rises 28px and settles (.55s, `cubic-bezier(.2,.8,.25,1)`); crest pops with overshoot (`.3,1.5,.4,1`); left items cascade .3–.56s; form rows stagger 60ms apart from .34s.
- **Role switch:** indicator bar springs (`.3,1.3,.4,1`, 300ms); label/hint/button cross-fade 250ms with a 6px rise; the entrance plate flips copy (Student/Staff/Office entrance).
- **Submit:** button shimmers while the API call is in flight; on **success** (token + `/auth/me` resolved) a brand-color flood with crest + welcome line reading the **API-reported** role plays as routing happens. On **error:** shimmer ends, 4px card shake, existing toast path unchanged.
- **Ambient:** panel glow breathes 7s; watermark crest sways 12s; blobs drift 26/32s; rings rotate 55/70s; motes rise 9–14s.
- **Deliberately not ported from the pitch demo:** the typed-sample animation (it is a real input) and pointer tilt (gimmick risk on a credential form).

## Invariants

- `api.post('/auth/login', {identifier, password})` → `setTokens` → `/auth/me` → `router.replace(homeForRole(me.role))`. The selector never picks the destination.
- `/login?imp=…` owner-impersonation exchange runs exactly as today; "Opening owner view…" renders over the themed shell.
- `autocomplete="username"` / `"current-password"`; identifier input `type` = text for STUDENT, email otherwise.
- Student copy stays role-neutral (parents share the student login).
- Nothing in a render path reads `window`/`localStorage` or calls `Math.random()`/`Date.now()`.

## Testing

- Vitest unit tests for `resolveLoginTheme` (branded / fallback / missing-profile / platform host) and the role copy map (all three roles present, autocomplete + input-type mapping, role-neutral student wording).
- Full gate: `pnpm preflight` (lint, typecheck, boundary, `next build`, tests) must be green before any push.
- Visual proof on a real page (local dev against a tenant host), not just a build log.

## Ship

Branch `feat/gatehouse-login` off `origin/main` (worktree `~/skoolos-gatehouse`). Push branch → merge to `main` (prod) → merge to `staging` (test.sckools.com). Verify the Vercel production deployment actually triggered (known integration lapse — re-trigger with an empty commit if absent), then verify the themed login live on a real tenant host.
