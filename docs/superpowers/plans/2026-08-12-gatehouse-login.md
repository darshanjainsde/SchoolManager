# Gatehouse Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/web/app/login` as the school-branded "Gatehouse" split-screen login with a living themed background and full motion system, preserving all auth behavior.

**Architecture:** `page.tsx` becomes an async server component that resolves the tenant theme from `fetchPublicSite(host)` and renders a `'use client'` `GatehouseLogin` component carrying all existing auth logic. A pure `gatehouse-theme.ts` module owns theme resolution and role copy so both are unit-testable without rendering. Styles live in a `login.css` file imported by the client component (Next App Router allows global CSS imports from client components; PublicSite's inline template-literal CSS is the alternative pattern but a plain CSS file avoids the backtick-in-comment trap).

**Tech Stack:** Next 15 App Router (async `headers()`), React 19, react-hook-form + zod (unchanged), vitest, plain CSS custom properties + keyframes (no new deps).

## Global Constraints

- Branch: `feat/gatehouse-login` off `origin/main`, worktree `~/skoolos-gatehouse`. Stage files by explicit path only — never `git add -A`.
- No new dependencies. No API changes.
- All motion transform/opacity only; every animation and transition disabled under `@media (prefers-reduced-motion: reduce)`.
- Nothing in a render path reads `window`/`localStorage` or calls `Math.random()`/`Date.now()`; `localStorage` role memory goes in `useEffect`.
- Fallback branding: primary `#4F46E5`, secondary `#F59E0B`, name "Sckools" — used whenever `fetchPublicSite` yields no profile.
- Student copy role-neutral (parents share the login). Keep exact identifier copy: "Student code, admission no. or email" etc.
- `pnpm preflight` green before any push.

---

### Task 1: Theme resolver + role copy module (TDD)

**Files:**
- Create: `apps/web/app/login/gatehouse-theme.ts`
- Test: `apps/web/app/login/gatehouse-theme.test.ts`

**Interfaces:**
- Consumes: `PublicSiteData` from `@/lib/public-api`, `FONT_STACK` from `@/lib/fonts`.
- Produces:
  ```ts
  export interface LoginTheme {
    schoolName: string;
    tagline: string;
    logoUrl: string | null;
    primary: string;   // hex
    secondary: string; // hex
    fontStack: string; // CSS font-family value
    hostname: string;  // bare host, no port
    branded: boolean;  // false = Sckools fallback
  }
  export function resolveLoginTheme(data: PublicSiteData | null, host: string): LoginTheme;

  export type RoleTab = 'STUDENT' | 'TEACHER' | 'ADMIN';
  export const ROLE_TABS: {
    value: RoleTab; label: string; sub: string; idLabel: string;
    submit: string; hint: string; plate: string; inputType: 'text' | 'email';
  }[];
  ```

- [ ] **Step 1: Write the failing test** — branded school maps name/colors/font/tagline; missing profile → fallback; null data → fallback; port stripped from hostname; ROLE_TABS has 3 entries, student inputType text, staff/admin email, student copy contains no "only".
- [ ] **Step 2:** `pnpm --filter @skoolos/web test -- app/login` → FAIL (module not found).
- [ ] **Step 3:** Implement `gatehouse-theme.ts` (pure, no React).
- [ ] **Step 4:** Same test command → PASS.
- [ ] **Step 5:** Commit `feat(web): gatehouse login theme resolver`.

### Task 2: Gatehouse client component + server page wiring

**Files:**
- Create: `apps/web/app/login/GatehouseLogin.tsx` (client; all auth logic moved verbatim from the old page)
- Create: `apps/web/app/login/login.css`
- Modify: `apps/web/app/login/page.tsx` → async server component: `getRequestHost()` → `fetchPublicSite` (school hosts only) → `resolveLoginTheme` → `<GatehouseLogin theme={…} />`

**Interfaces:**
- Consumes: `LoginTheme`, `ROLE_TABS` from Task 1; `useApi`, `useAuthStore`, `homeForRole`, `SckoolsLogo` as in the current page.
- Produces: default export page (server), `GatehouseLogin({ theme }: { theme: LoginTheme })`.

- [ ] **Step 1:** Move auth logic (schema, imp-exchange effect, onSubmit with homeForRole) into `GatehouseLogin` unchanged; add submit-state machine `idle | busy | open | error` for shimmer/flood/shake.
- [ ] **Step 2:** Build shell markup: background layers (blobs/lattice/rings/motes), left identity panel (crest via `logoUrl` img or Tassel-S fallback, name, tagline, entrance plate, host footer), right panel (role radiogroup rows with sliding indicator, identifier/password fields, submit, forgot link).
- [ ] **Step 3:** `login.css`: tokens from `--gh-p`/`--gh-s`, entrance choreography, role-switch springs, shimmer/flood/shake, ambient loops, mobile collapse, `prefers-reduced-motion` kill-switch, focus-visible states.
- [ ] **Step 4:** Wire `page.tsx` server component; inline `style={{ '--gh-p': …, '--gh-s': …, fontFamily setup }}` so SSR HTML is already themed.
- [ ] **Step 5:** `pnpm --filter @skoolos/web test` + typecheck → green. Commit `feat(web): gatehouse themed tenant login`.

### Task 3: Real-page verification

- [ ] **Step 1:** Start local stack (api + web) per repo scripts; open `http://beacon.localhost:3000/login` (seeded tenant) and `http://localhost:3000/login` (platform fallback).
- [ ] **Step 2:** Verify: themed colors from the tenant profile; entrance plays once; role switch springs + copy swaps; wrong password → shake + toast; correct login routes by API role; reduced-motion (emulated) shows static page; mobile viewport collapse.
- [ ] **Step 3:** Fix anything found; commit.

### Task 4: Preflight + ship

- [ ] **Step 1:** `pnpm preflight` in the worktree → green (lint, typecheck, boundary, build, tests).
- [ ] **Step 2:** Push `feat/gatehouse-login`; merge to `main`, push; merge `main` into `staging`, push.
- [ ] **Step 3:** Confirm both Vercel projects deploy for each branch (watch the known no-deploy integration lapse; empty-commit re-trigger if needed).
- [ ] **Step 4:** Verify live: `raffles.sckools.com/login` (prod) and a staging tenant host — themed page served, login works.
