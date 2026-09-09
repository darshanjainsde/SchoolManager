# Client surfaces — consoles, portals, apps, public sites

## 1. School admin console — `/app` (tenant host, `SCHOOL_ADMIN`)

Nav is filtered by the `features[]` array from `GET /auth/me`. **Until features load, every item shows**
(deliberate: avoids nav items flickering away on a slow fetch).

| Page | Feature gate |
|---|---|
| `/app` Dashboard | — |
| `/app/website` Website CMS | — |
| `/app/blog` Blog | `BLOG` |
| `/app/enquiries` Enquiries | `ENQUIRY` |
| `/app/classes` (+ `/structure`) | `MANAGEMENT` |
| `/app/teachers`, `/app/staff`, `/app/students` | `MANAGEMENT` |
| `/app/staff-attendance` | `MANAGEMENT` |
| `/app/timetable`, `/app/availability` | `MANAGEMENT` |
| `/app/leave` | `MANAGEMENT` |
| `/app/settings` | `MANAGEMENT` |
| `/app/events` | `EVENTS` |
| `/app/announcements` | — |

`/app/website` is a tabbed CMS: Homepage, About, Branding, Theme, Design, Courses, Admissions,
Gallery, Hall of Fame, Staff, Contact.

## 2. Teacher portal — `/teacher` (tenant host, `TEACHER`)

`Today` · `Timetable` · `Attendance` · `Tests` · `Results` · `Announcements` · `Requests` · `Holidays`,
plus a sidebar-foot `Profile` link. `/teacher/leave` also exists.

`/teacher/results` is itself a class/exam picker — there is no standalone results screen.

Class pickers offer **only the teacher's own classes** (commit `d4a6292`).

## 3. Student portal — `/portal` (tenant host, `STUDENT`)

`Home` · `Timetable` · `Attendance` · `Results` · `Announcements` · `Profile`.

Used by both student and guardian on one shared login — keep copy role-neutral.

## 4. Mobile app (Expo, `apps/mobile`)

Two route groups, chosen by role (`lib/roles.ts#portalForRole`):

- **`(family)`** — `STUDENT`: `home`, `attendance`, `notices`, `holidays`, `more`
- **`(staff)`** — `TEACHER` / `SCHOOL_ADMIN` / `STAFF`: tabs `today`, `attendance`, `timetable`,
  `post` (Announcements), `more`; hidden routes `holidays`, `requests`, `take/[classSectionId]`,
  `tests`, `results/[examId]`, `profile`
- **`OWNER` is not routable on mobile.** `portalForRole` throws; `resolveStartRoute` catches it and falls
  back to login/connect rather than leaving the bootstrap screen rendering `null` forever. Callers must
  clear the unroutable session.

**Menu parity (T3, 2026-07-30):** the app's section list matches the web teacher nav, with the same
labels ("Today", "Announcements"). The tab bar stays at 5; Tests, Results, Requests, Holidays and
Profile live under **More**. `Results` under More intentionally routes to `/(staff)/tests` — the tests
list *is* the results entry point, mirroring the web.

**Entry:** `(auth)/connect` (school resolution — no school code needed) then `(auth)/login`.

**Offline queue (`lib/offline-queue.ts`) — attendance saves ONLY.** Not notes, todos, leave or results;
those fail loudly and the teacher retries. Attendance is the one flow where a teacher stands in a
corridor with a dead signal and a marked roster they must not lose. Safe because
`PUT /manage/attendance` is idempotent per class+date and the newly-absent email diff is computed
server-side, so replaying a queued save — even twice — is harmless.

One queue slot per `classSectionId:date`. Because expo-secure-store has a ~2048-byte per-value limit on
Android and a realistic 40-student roster exceeds it, the serialised queue is **chunked across multiple
SecureStore keys** with a manifest key holding the count.

Flush classifies each entry as `synced`, `rejected` (server message shown verbatim) or `retained`.

Also: dark mode (system/light/dark), real server-side logout, Expo push registration.

## 5. Public school site (tenant host)

`GET /public/site` returns everything in one payload. Pages: `/` (homepage), `/academics`, `/admissions`,
`/gallery`, `/connect` (events), `/contact`, `/blog`.

**Only a `LIVE` school serves a public site** — `SETUP` and `SUSPENDED` return **404**, while the admin
can still log in and build it.

Homepage sections are individually toggleable (`showAdmissions`, `showGallery`, `showEvents`,
`showContact`). Full detail always lives on the dedicated pages regardless of toggles.

The Educators band projects `FeaturedStaff` rows whose linked teacher is still `ACTIVE` (or never linked);
a teacher removed from the school never keeps a card unless the office ticked "Keep them on the website"
(`public-site.service.ts`, Active Roster).

Theming (`SchoolProfile`): brand colours, heading font, `heroLayout` / `heroTextAlign` /
`heroOverlayStyle` / `heroOverlayOpacity` / `heroHeight`, `headlineAccent`, `navStyle` / `navColor` /
`navTextColor`, nav CTA and login button labels/visibility, `animationLevel`, `themePreset`.
The legacy 3-value `heroStyle` is **kept in sync by the CMS service** (PHOTO→FULL_BLEED etc.) for old
clients — changing one should change the other.

Up to 5 ordered hero image slots (`heroImageAssetIds`); `heroAssetId` stays in sync with slot 1.

`Course` / `CourseFee` are **public CMS content for all tiers** and are entirely separate from the PRO
`Grade`/`ClassSection` operational models. Fees are **free text** ("₹ 68,000", "On request") — display
content, not billing. `AdmissionsSettings.showFeesPublicly` hides them.

Hall of Fame: up to 3 entries per course, unique on `(courseId, rank)`.

**Enquiries:** `POST /public/enquiry` is public; admins read/patch via `GET|PATCH /site/enquiries`
(`ENQUIRY` feature). Owner can export a school's enquiries as CSV.

## 6. Blog platform

Two scopes: `PLATFORM` (owner-authored, lives on `sckools.com/blog`) and `SCHOOL` (tenant-authored).

**School CMS** — `/cms/blog/*`, `SchoolJwtGuard` + `@RequireFeature('BLOG')`:
posts CRUD, `publish`, `submit-global`, `library`, `selections` (add/remove/reorder/set-hero), `settings`.

**Syndication flow:** school writes a post → publishes → `submit-global` sets `globalStatus: PENDING` →
owner approves (`/owner/blog/:id/approve`) or rejects with a reason.

- On approval a `globalSlug` is assigned: the post's own slug, or `<slug>-<schoolSlug>` on collision.
  **A second collision is a 409, not a silent loop** — platform + school sharing both forms is unlucky
  enough to be worth surfacing.
- A concurrent approval racing the same globalSlug is caught as P2002 → 409 "retry approval".
- Approving/rejecting anything not `PENDING` → 409.

**Public tenant blog** — `/public/blog`. **404s (not 403) when the school lacks `BLOG`**, so the page
looks absent rather than forbidden.

Ordering: heroes first (capped at `blogHeroLimit`, default 1), then the rest, each by
`sortOrder` then `createdAt DESC`. The admin preview and the live site use the same comparator.

**Canonical URLs** (SEO-load-bearing):
- a syndicated (not-own) post → the **platform** URL
- an own post that is globally `APPROVED` → the **platform** URL
- an own post not approved → its **own tenant** URL

A not-own post shows an `author` block (school name + host).

## 7. Owner console — `owner.sckools.com`

`/owner` is the gate page; `/platform/*` is the console: overview, schools list + detail, onboard,
blog approvals, connect, scale.

Capabilities (`/owner/*`, `OwnerHostGuard` + `PlatformJwtGuard`): overview, stats, marketing leads
(`GET`/`PATCH`), marketing config (pricing + contact), schools CRUD, tier change, feature overrides,
status change, delete, impersonate, enquiry CSV export, network events approval, admin credential reset,
blog approvals.

Feature/tier/status changes invalidate the Redis feature cache.

## 8. Marketing site — `sckools.com` (apex)

Public: `GET /marketing/config` (owner-editable prices + contact), `POST /marketing/leads`,
`GET /marketing/blog[/:globalSlug]`, `GET /directory` (school directory).

Pages: `/`, `/pricing`, `/blog`, `/connect`, `/contact`, `/privacy`, `/delete-account`,
`/school-website-builder`.

Pricing is **annual**; INR and USD are owner-set, other currencies derive from USD via live FX
(`apps/web/lib/fx.ts`). `MarketingConfig` is a singleton row (`id = "default"`).

`MarketingLead` and `MarketingConfig` are platform-level — **no tenant, no RLS**.

## 9. Events / community

`Event` has `scope` (`SCHOOL` | `NETWORK`) and `status` (`DRAFT` | `PENDING` | `APPROVED` | `REJECTED`).
School CRUD at `/manage/events` (`EVENTS` feature). A `NETWORK`-scope event needs owner approval before
appearing across the network; the owner reviews at `/owner/events`.

## 10. CSP and web security

`apps/web/middleware.ts` applies a stricter CSP to authenticated console routes only (`/app`,
`/platform`, `/me`, `/teacher`, `/portal`, `/login`, `/owner`, `/account`, `/accept-invite`,
`/reset-password`, `/forgot-password`). Public pages keep the lighter baseline from `next.config.mjs`
so they stay CDN-cacheable.

**Known and documented limitation:** `script-src 'self' 'unsafe-inline'` — not nonce + strict-dynamic.
The console shells are statically prerendered (they render `null` until the client knows whether you're
signed in), and a per-request nonce cannot be baked into build-time HTML; strict-dynamic refuses the
un-nonced tags and every console renders as dead HTML (verified in a browser: `__next_f` missing, React
never hydrated). So this CSP does **not** stop inline-script injection. It does stop everything that made
an XSS useful: off-origin script loading, exfiltration outside `connect-src`, `<object>`/`<embed>`,
`<base>` hijacking and off-origin form posts. Upgrading requires making console routes dynamic — tracked
as follow-up, deliberately not pretended-at.

`img-src` allows any `https:` because school logos/photos live on operator-supplied hosts.
`frame-src` allows Google Maps for contact pages.
