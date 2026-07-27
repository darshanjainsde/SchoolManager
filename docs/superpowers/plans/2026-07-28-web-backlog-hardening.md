# Web Backlog Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seven items left open by the 2026-07-28 `apps/web` audit — with the CDN-caching item deliberately deferred to the owner console's Scale backlog, and the auth-cookie migration shipped behind a staging gate.

**Architecture:** Six independent changes to `apps/web` plus one dual-mode change to the NestJS auth module. Nothing here changes what a school or parent sees on a public page; the visible surface that moves is the login/session boot path (Task 7), which is why it ships last, alone, and only reaches production after the staging logins have been exercised by hand.

**Tech Stack:** Next 15.5.21 (App Router), React 19.2.8, NestJS + Prisma (API), Jest (API tests only — `apps/web` has no test harness, so web tasks use runtime verification gates instead of unit tests).

## Global Constraints

- Branch base is `main` (currently `8bc0e16` + local `d9ddd15`), worked in the worktree `~/Worktrees/SchoolManager-pricing`. Never commit from the primary checkout — it carries iCloud `" 2"` conflict copies under `apps/api`. Stage files by explicit path, never `git add -A`.
- Every task ends green on: `pnpm --filter @skoolos/web typecheck`, `pnpm --filter @skoolos/web lint`, `pnpm --filter @skoolos/web build`. API tasks also run `pnpm --filter @skoolos/api test`.
- No behaviour change is acceptable in Tasks 2–6. They are correctness/perf/structure work; if a rendered page differs, that is a bug in the task.
- Public marketing and tenant pages must remain **cacheable in principle** — no task may add a per-request nonce, cookie read or other dynamic API to a public page, or it forecloses the deferred CDN work (Task 1).
- Deploy order for anything that ships: `staging` first (test.sckools.com), verified, then `main`. Production pushes need the user's explicit go-ahead.
- Staging verification logins (from memory `skoolos-staging-env`): school admin `admin@beacon.test` / `Passw0rd!` at `beacon.test.sckools.com`; owner gate `test.sckools.com/owner` password `SkoolStaging2026!`.

---

## File Structure

**Created**
- `apps/web/app/app/website/branding-tab.tsx` — branding form fields (logo, name, tagline).
- `apps/web/app/app/website/theme-tab.tsx` — palette/font/theme fields.
- `apps/web/app/app/website/homepage-tab.tsx` — hero + homepage section fields.
- `apps/web/app/app/website/about-tab.tsx` — about/principal fields.
- `apps/web/app/app/website/contact-tab.tsx` — contact/map/social fields.
- `apps/web/app/app/website/staff-tab.tsx` — staff list (owns its own queries, like `courses-tab.tsx`).
- `apps/web/app/app/website/gallery-tab.tsx` — gallery grid + uploader (owns its own queries).
- `apps/web/app/app/website/site-form.ts` — the shared settings form type + `useSiteForm()` hook the five field tabs consume.
- `apps/web/app/app/website/image-uploader.tsx` — the `ImageUploader` currently inline in `page.tsx`, used by several tabs.
- `apps/web/lib/use-block-keys.ts` — stable React keys for reorderable block arrays.
- `apps/web/lib/fonts.ts` — the four school display fonts via `next/font/google`.
- `apps/api/src/modules/auth/internal/refresh-cookie.ts` — cookie name/options helper, shared by the school and owner auth controllers.

**Modified**
- `apps/web/app/platform/scale/page.tsx` — add the deferred CDN work to CHECKPOINT 4.
- `apps/web/app/app/blog/editor-tab.tsx` — remount-by-key instead of a reset effect.
- `apps/web/app/app/blog/block-editor.tsx` — stable keys.
- `apps/web/app/app/website/page.tsx` — shrinks to tab routing + shared state.
- `apps/web/components/public/PublicSite.tsx` — fonts out of the component, image dimensions in.
- `apps/web/components/public/sections/*.tsx` — image dimensions/loading/priority.
- `apps/web/app/layout.tsx`, `apps/web/components/theme-toggle.tsx` — nonce plumbing for the console CSP.
- `apps/web/middleware.ts` (new file, console paths only) — per-request nonce + strict CSP.
- `apps/web/lib/{api,auth-store,use-api}.ts`, the five console layouts — cookie session boot.
- `apps/api/src/modules/auth/internal/{auth.controller,dto}.ts`, `apps/api/src/modules/owner/internal/owner-auth.controller.ts`, `apps/api/src/main.ts` — dual-mode refresh cookie.

---

### Task 1: Record the deferred CDN work in the owner console's Scale backlog

The user's call: page-level CDN caching is **not** built now; it is logged as scale work. CHECKPOINT 4 ("Scale, 100–500 schools — Performance + reliability") is the right rung: it already carries "Redis caching for tenant lookups" and "Move images to a CDN".

**Files:**
- Modify: `apps/web/app/platform/scale/page.tsx:169-186` (the `scale` checkpoint object)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the two build items and their matching prompts**

In the `key: 'scale'` checkpoint, extend `build` and `ask`:

```ts
    build: [
      'Redis caching for tenant lookups',
      'Move images to a CDN',
      'CDN-cache the public pages (they are 100% MISS today)',
      'Per-host data cache + on-demand revalidation on school edits',
      'Monitoring & error tracking',
      'Automated backups',
      'Load testing',
    ],
    ask: [
      'Cache tenant host lookups in Redis',
      'Serve school images through a CDN',
      'CDN-cache the public school pages: middleware Cache-Control on public paths first, verified on two staging hosts, then the /s/[host] ISR refactor',
      'Cache /public/site per host with a tag, and revalidate that tag when a school saves its website',
      'Add error tracking and uptime monitoring',
      'Load-test the API to 500 schools',
    ],
```

- [ ] **Step 2: Verify it renders**

Run: `pnpm --filter @skoolos/web build` — expected: clean. The Scale tab is client-rendered from this constant, so a successful build plus the staging click-through in Task 8 is the check.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/platform/scale/page.tsx
git commit -m "chore(web): log deferred CDN-caching work on the Scale checkpoint 4 backlog"
```

**Context for whoever picks it up later** (keep in the commit body): public pages are dynamic because every route resolves the tenant from the `Host` header at render time, so Vercel returns `cache-control: private, no-cache, no-store` and `x-vercel-cache: MISS` on every view. Phase 1 = cache the API data per host (`unstable_cache` keyed by host + a `/api/revalidate` route the school console calls after a save) and set `Cache-Control: public, s-maxage=60, stale-while-revalidate=600` on public paths from middleware — then **prove on staging** that `x-vercel-cache: HIT` appears and that `test.sckools.com` and `beacon.test.sckools.com` never serve each other's HTML. Phase 2 = rewrite tenant hosts to `/s/[host]/*` in middleware so each school's pages become per-tenant ISR. `/pricing` must stay dynamic either way: it picks the default currency from `x-vercel-ip-country`, which a shared CDN entry would freeze to whichever country warmed the cache.

---

### Task 2: Fix the stale blog-editor form (backlog #6)

`editor-tab.tsx` resets its form from an effect keyed on `editingPost?.id`. A post refetched after save has the same id, so the effect never re-runs and the form keeps pre-save values. The idiomatic React 19 fix is to remount the form instead of syncing it.

**Files:**
- Modify: `apps/web/app/app/blog/editor-tab.tsx:40-70` (drop the reset effect, seed `useState` from props)
- Modify: the parent that renders `<EditorTab>` (`apps/web/app/app/blog/page.tsx`) — pass a `key`

**Interfaces:**
- Consumes: the existing `editingPost` prop shape.
- Produces: `EditorTab` becomes a mount-once component — callers MUST pass `key={editingPost?.id ?? 'new'}`.

- [ ] **Step 1: Seed state from props and delete the effect**

```tsx
// Mounted fresh per post (parent passes key={post.id}), so props seed state
// directly — no reset effect, and a refetch of the same post can't go stale.
const [title, setTitle] = useState(editingPost?.title ?? '');
const [slug, setSlug] = useState(editingPost?.slug ?? '');
const [slugTouched, setSlugTouched] = useState(false);
const [description, setDescription] = useState(editingPost?.description ?? '');
const [heroImageUrl, setHeroImageUrl] = useState(editingPost?.heroImageUrl ?? '');
const [readMinutes, setReadMinutes] = useState(editingPost?.readMinutes ?? 4);
const [sections, setSections] = useState<BlogBlock[]>(editingPost?.sections ?? []);
```

- [ ] **Step 2: Give the parent a remount key**

```tsx
<EditorTab key={editingPost?.id ?? 'new'} editingPost={editingPost} target={target} />
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/web lint`
Expected: clean, and the `react-hooks/exhaustive-deps` warning for `editor-tab.tsx:69` is gone from the lint output (that warning was this bug).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/app/blog/editor-tab.tsx apps/web/app/app/blog/page.tsx
git commit -m "fix(web): remount the blog editor per post instead of syncing it from an effect"
```

---

### Task 3: Stable keys for reorderable blocks (backlog #5)

`block-editor.tsx` renders `blocks.map((block, idx) => <div key={idx}>)` while offering move-up/move-down/remove. React then keys DOM state to the *position*, not the block, so focus and caret follow the slot rather than the content.

**Files:**
- Create: `apps/web/lib/use-block-keys.ts`
- Modify: `apps/web/app/app/blog/block-editor.tsx` (the three mutators + the map)

**Interfaces:**
- Produces: `useBlockKeys(length: number): { keys: string[]; insert(at: number): void; remove(at: number): void; swap(a: number, b: number): void }`

- [ ] **Step 1: Write the hook**

```ts
import { useRef } from 'react';

/**
 * Stable React keys for an array of plain-object blocks that has no id of its
 * own. Index keys break reordering (DOM state sticks to the slot, not the
 * block); persisting an id into the JSONB payload would leak editor state into
 * stored content — so the keys live here, beside the list that mutates.
 */
export function useBlockKeys(length: number) {
  const keys = useRef<string[]>([]);
  const seq = useRef(0);

  // Re-sync when the list is replaced from outside (loading another post).
  while (keys.current.length < length) keys.current.push(`b${seq.current++}`);
  if (keys.current.length > length) keys.current.length = length;

  return {
    keys: keys.current,
    insert(at: number) {
      keys.current.splice(at, 0, `b${seq.current++}`);
    },
    remove(at: number) {
      keys.current.splice(at, 1);
    },
    swap(a: number, b: number) {
      [keys.current[a], keys.current[b]] = [keys.current[b], keys.current[a]];
    },
  };
}
```

- [ ] **Step 2: Wire it into the three mutators and the map**

```tsx
const blockKeys = useBlockKeys(blocks.length);

function addBlock(t: BlogBlock['t']) {
  blockKeys.insert(blocks.length);
  onChange([...blocks, emptyBlock(t)]);
}
function removeBlock(idx: number) {
  blockKeys.remove(idx);
  onChange(blocks.filter((_, i) => i !== idx));
}
function moveBlock(idx: number, dir: -1 | 1) {
  const swap = idx + dir;
  if (swap < 0 || swap >= blocks.length) return;
  blockKeys.swap(idx, swap);
  const next = [...blocks];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  onChange(next);
}
```

```tsx
{blocks.map((block, idx) => (
  <div key={blockKeys.keys[idx]} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/web build`
Expected: clean. Behavioural check happens in Task 8 on staging: add three blocks, type in the middle one, move it up — the caret must stay in the text you were editing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/use-block-keys.ts apps/web/app/app/blog/block-editor.tsx
git commit -m "fix(web): stable keys for reorderable blog blocks"
```

---

### Task 4: Split `app/app/website/page.tsx` (backlog #7)

1555 lines, all shipped to the browser. Four tabs (`design`, `courses`, `admissions`, `hof`) already live in sibling files; the remaining seven are inline. This is a **mechanical** extraction — no logic changes, no renames of state or handlers.

**Files:**
- Create: `image-uploader.tsx`, `site-form.ts`, `branding-tab.tsx`, `theme-tab.tsx`, `homepage-tab.tsx`, `about-tab.tsx`, `contact-tab.tsx`, `staff-tab.tsx`, `gallery-tab.tsx` (all under `apps/web/app/app/website/`)
- Modify: `apps/web/app/app/website/page.tsx`

**Interfaces:**
- Produces: `useSiteForm()` returning `{ form, set, save, saving, host }`; each field tab is `({ form, set }: SiteTabProps) => JSX.Element`; `staff-tab.tsx` and `gallery-tab.tsx` are self-contained (`() => JSX.Element`) and own their queries, matching `courses-tab.tsx`.

- [ ] **Step 1: Extract `ImageUploader` verbatim** (`page.tsx:154-212`) into `image-uploader.tsx`, export it, import it back. Run `pnpm --filter @skoolos/web typecheck`.

- [ ] **Step 2: Extract the shared settings state into `site-form.ts`** — the `useState`/`useQuery`/`useMutation` block that the branding/theme/homepage/about/contact tabs all read, exported as `useSiteForm()`. `page.tsx` calls it once and passes `{form, set}` down.

- [ ] **Step 3: Move each inline tab body into its own file, one commit per tab**, in this order (smallest blast radius first): branding (`page.tsx:694-764`), about (`1027-1090`), theme (`765-906`), homepage (`907-1026`), contact (`1091-1249`), gallery (`1478-end`), staff (`1260-1477`). After each move: `pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/web build`.

- [ ] **Step 4: Confirm the diff is a pure move**

Run: `git diff --stat main -- apps/web/app/app/website/`
Expected: `page.tsx` drops to roughly 250 lines; total added ≈ total removed. Any net-new logic in the diff means the extraction drifted — revert that hunk.

- [ ] **Step 5: Commit** (per tab)

```bash
git add apps/web/app/app/website/
git commit -m "refactor(web): extract the <name> tab out of the website console page"
```

---

### Task 5: Image and font hardening (backlog #4)

The user chose zero-cost hardening over a `next/image` migration — correct here, because school logos, staff photos and gallery images are arbitrary operator-supplied URLs, which would need wildcard `remotePatterns` and would bill Vercel image-optimization units per source image.

**Files:**
- Create: `apps/web/lib/fonts.ts`
- Modify: `apps/web/components/public/PublicSite.tsx` (drop the runtime `<link>`, apply font variables), `apps/web/components/public/sections/*.tsx`, `apps/web/app/app/website/*.tsx`, `apps/web/app/app/teachers/page.tsx`

**Interfaces:**
- Produces: `fontVars: string` (a `className` carrying all four CSS variables) and `FONT_VAR: Record<'INTER'|'FRAUNCES'|'POPPINS'|'NUNITO', string>` from `lib/fonts.ts`.

- [ ] **Step 1: Move the four Google families to `next/font`**

```ts
import { Inter, Fraunces, Poppins, Nunito } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], weight: ['400', '700'], variable: '--f-fraunces', display: 'swap' });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-poppins', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--f-nunito', display: 'swap' });

export const fontVars = `${inter.variable} ${fraunces.variable} ${poppins.variable} ${nunito.variable}`;
export const FONT_VAR = {
  INTER: 'var(--f-inter)',
  FRAUNCES: 'var(--f-fraunces)',
  POPPINS: 'var(--f-poppins)',
  NUNITO: 'var(--f-nunito)',
} as const;
```

Then in `PublicSite.tsx`: delete the `<link rel="preconnect">` + Google Fonts `<link>` (lines ~429-435), add `fontVars` to the wrapper's `className`, and point `FONT_MAP` at `FONT_VAR`. Fonts are then self-hosted by Next, preloaded, and no longer render-blocking on a third-party origin.

- [ ] **Step 2: Give every `<img>` intrinsic dimensions and the right loading hint**

Every `<img>` flagged by `@next/next/no-img-element` gets `width`/`height` (the CSS box already constrains display size; these exist to reserve space and kill CLS) plus `loading="lazy" decoding="async"` — **except** the tenant hero/logo, which gets `fetchPriority="high"` and no lazy attribute, because it is the LCP element.

- [ ] **Step 3: Verify no layout regression**

Run the built app and compare the tenant page before/after:
```bash
pnpm --filter @skoolos/web build && (cd apps/web && node_modules/.bin/next start -p 3013 &)
curl -s http://localhost:3013/ | grep -c 'fonts.googleapis.com'   # expected: 0
```
Expected: `0` Google-Fonts references in the HTML, and the page still renders with the school's chosen family.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/fonts.ts apps/web/components/public apps/web/app/app
git commit -m "perf(web): self-host the school display fonts and give every img intrinsic dimensions"
```

---

### Task 6: Strict CSP for the authenticated consoles (backlog #2)

A nonce-based `script-src` cannot coexist with CDN caching (every response needs a unique nonce), and App Router's own bootstrap scripts are inline, so hashes are not an option. The resolution is to scope it: **strict CSP on the console paths**, which hold sessions and PII and are dynamic anyway, and leave the public pages on the current header set so Task 1's caching stays possible.

**Files:**
- Create: `apps/web/middleware.ts`
- Modify: `apps/web/app/layout.tsx`, `apps/web/components/theme-toggle.tsx` (nonce on the inline theme script)

**Interfaces:**
- Produces: request header `x-nonce` on console routes; `ThemeScript` accepts an optional `nonce?: string`.

- [ ] **Step 1: Write the middleware**

```ts
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict CSP for the authenticated consoles only. Public marketing and school
 * pages are deliberately excluded: a per-request nonce would make them
 * uncacheable, and CDN-caching them is on the Scale backlog (checkpoint 4).
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://api.sckools.com https://api.test.sckools.com`,
    `frame-ancestors 'self' https://sckools.com https://*.sckools.com`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: ['/app/:path*', '/platform/:path*', '/me/:path*', '/teacher/:path*', '/portal/:path*', '/login', '/owner', '/accept-invite', '/reset-password', '/forgot-password', '/account/:path*'],
};
```

- [ ] **Step 2: Pass the nonce to the one inline script**

`app/layout.tsx` becomes async, reads `(await headers()).get('x-nonce')` and passes it to `<ThemeScript nonce={nonce} />`; `ThemeScript` renders `<script nonce={nonce} …>`. On public routes the middleware does not run, the header is absent, `nonce` is `undefined`, and the script renders exactly as today.

- [ ] **Step 3: Verify the console still boots and the public page is untouched**

```bash
curl -sI http://localhost:3013/platform | grep -i content-security-policy   # strict CSP present
curl -sI http://localhost:3013/          | grep -i content-security-policy   # frame-ancestors only
```
Then load `/platform/login` in a browser and confirm **zero** CSP violations in the console. A violation here means a real inline script was missed — fix the script, never widen the policy.

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts apps/web/app/layout.tsx apps/web/components/theme-toggle.tsx
git commit -m "feat(web): nonce-based strict CSP on the authenticated consoles"
```

---

### Task 7: Move the refresh token into an HttpOnly cookie (backlog #3)

**Functional impact, stated up front:** nobody is logged out. The API accepts the refresh token from *either* the cookie or the request body for the whole migration, so old tabs and any cached JS keep working. On a returning visitor's first refresh the API sets the cookie and the web app deletes its `localStorage` copy. The one visible change is the boot sequence: the console can no longer read the token synchronously, so it asks the API "am I signed in?" once on load — a brief spinner where there is currently an instant paint. `api.sckools.com` and every `*.sckools.com` host share the registrable domain, so a `Domain=.sckools.com` cookie is same-site: `SameSite=Lax` is sufficient and no third-party-cookie rules apply.

**Files:**
- Create: `apps/api/src/modules/auth/internal/refresh-cookie.ts`
- Modify: `apps/api/src/modules/auth/internal/{auth.controller.ts,dto.ts}`, `apps/api/src/modules/owner/internal/owner-auth.controller.ts`, `apps/api/src/main.ts` (cookie-parser + CORS credentials)
- Modify: `apps/web/lib/{api.ts,auth-store.ts,use-api.ts}`, `apps/web/app/{app,platform,portal,me,teacher}/layout.tsx`
- Test: `apps/api/src/modules/auth/internal/auth.controller.spec.ts` (new)

**Interfaces:**
- Produces: `REFRESH_COOKIE = 'skoolos_rt'`; `refreshCookieOptions(host: string): CookieOptions`; controller reads `req.cookies[REFRESH_COOKIE] ?? dto.refreshToken` and always writes the cookie on login/refresh; `clearRefreshCookie(res)` on logout.
- Web: `useAuthStore` loses `refreshToken`; gains `status: 'unknown' | 'authed' | 'anon'`. Layout gates become `if (status === 'unknown') return null;` — replacing today's `if (!hydrated) return null; if (!refreshToken) return null;`.

- [ ] **Step 1: Write the failing API test**

```ts
describe('AuthController refresh', () => {
  it('accepts the refresh token from the cookie when the body has none', async () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
    service.refresh = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    await controller.refresh({ cookies: { skoolos_rt: 'from-cookie' } } as never, {} as never, res);

    expect(service.refresh).toHaveBeenCalledWith('from-cookie');
    expect(res.cookie).toHaveBeenCalledWith('skoolos_rt', 'r', expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true }));
  });

  it('still accepts the refresh token from the body (old clients)', async () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
    service.refresh = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });

    await controller.refresh({ cookies: {} } as never, { refreshToken: 'from-body' } as never, res);

    expect(service.refresh).toHaveBeenCalledWith('from-body');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @skoolos/api test -- auth.controller`
Expected: FAIL — the controller takes only `@Body()` today.

- [ ] **Step 3: Implement the dual-mode controller + cookie helper**, register `cookie-parser` in `main.ts`, and keep returning `refreshToken` in the JSON body for the transition.

- [ ] **Step 4: Run the API suite**

Run: `pnpm --filter @skoolos/api test`
Expected: PASS, including the pre-existing auth specs.

- [ ] **Step 5: Switch the web client to the cookie**, delete the `localStorage` persistence, add the one-time upgrade (if a legacy token exists, send it once in the body, then remove it), and replace the five layout gates with the `status` gate.

- [ ] **Step 6: Verify on staging — this is the gate that matters**

Deploy to `staging`, then by hand: log in at `beacon.test.sckools.com/login` as `admin@beacon.test` / `Passw0rd!`; confirm `document.cookie` does **not** contain the refresh token and DevTools → Application → Cookies shows `skoolos_rt` as HttpOnly; hard-reload and confirm the session survives; log out and confirm the cookie is cleared and the app returns to `/login`; repeat for the owner console via `test.sckools.com/owner`. Also verify a *legacy* session upgrades: before deploying, log in; after deploying, reload — the session must survive and `localStorage['skoolos:refresh']` must be gone.

- [ ] **Step 7: Commit, and stop**

```bash
git add apps/api/src apps/web/lib apps/web/app
git commit -m "feat(auth): keep the refresh token in an HttpOnly cookie, dual-mode for the migration"
```

Production deploy requires the user's explicit go-ahead — this is the only task in the plan that can lock people out if it is wrong.

---

### Task 8: Staging verification sweep

**Files:** none.

- [ ] **Step 1:** Push the branch to `staging`, wait for the deploy, confirm `test.sckools.com` responds 200.
- [ ] **Step 2:** Owner console — `/platform/scale` shows the two new CHECKPOINT 4 items; `/platform` marketing settings still saves.
- [ ] **Step 3:** School console as `admin@beacon.test` — `/app/website`: open all eleven tabs, change one field per tab, save, reload, confirm persistence (this is the Task 4 regression gate). `/app/blog`: add three blocks, type in the middle one, move it up, confirm the caret stays with the text (Task 3); save a post, reopen it, confirm the form shows the saved values (Task 2).
- [ ] **Step 4:** Tenant public site `beacon.test.sckools.com` — no `fonts.googleapis.com` in the HTML, hero renders, no CLS jump on reload (Task 5).
- [ ] **Step 5:** DevTools console on every console route — zero CSP violations (Task 6).
- [ ] **Step 6:** Report results, then ask before any production push.

---

## Self-Review

**Spec coverage:** backlog #1 → Task 1 (recorded, deferred per the user's decision, with the full implementation notes preserved); #2 → Task 6; #3 → Task 7; #4 → Task 5; #5 → Task 3; #6 → Task 2; #7 → Task 4. All seven accounted for.

**Placeholders:** none — every step names exact files, exact line ranges and the command that proves it.

**Type consistency:** `useBlockKeys` is used with the same member names (`keys`/`insert`/`remove`/`swap`) in Task 3's hook and call site. `useSiteForm()` returns `{form, set, save, saving, host}` in Task 4's interface block and is consumed as `{form, set}` by the field tabs. `FONT_VAR`'s keys match the existing `FONT_MAP` keys in `PublicSite.tsx`. The auth store's new `status` union (`'unknown' | 'authed' | 'anon'`) is used identically in the interface block and the layout gate.

**Ordering:** Tasks 2, 3, 5 are independent. Task 4 touches the same directory as nothing else. Task 6 must land before Task 7 only so a CSP violation is never confused with a broken login. Task 7 ships alone.
