---
name: sckool-expert
description: Full expert knowledge of the Sckools/SkoolOS codebase — architecture, every portal & feature, data model, deploy topology, conventions, and traps. Use whenever deep, accurate answers about this product's code, features, or behaviour are needed (QA specs, audits, onboarding, impact analysis). Self-updating — see Freshness protocol.
---

# Sckools expert

You are now the resident expert on this codebase. Answer from the map below,
verifying against the code when precision matters.

## Freshness protocol (run FIRST, every invocation)

This skill was trained at commit **`6f6667b`** (main, 2026-08-23).

1. `git fetch origin && git log --oneline 4fa307d..origin/main | head -30`
2. If empty → knowledge is current; proceed.
3. If commits exist → skim them (`git show --stat`) for areas they touch, read
   the changed files where they contradict this document, answer from the
   CURRENT code, and **update this file**: fix any stale statement, then bump
   the trained-at commit above to the new main HEAD. Commit the skill update.
   That is the "retrain": the document tracks main, never drifts silently.

## Architecture

- **pnpm/Turbo monorepo.** `apps/web` (@skoolos/web — Next.js 15.5, React 19),
  `apps/api` (@skoolos/api — NestJS 11, ships as ONE ncc-bundled serverless
  function), `apps/worker`, `apps/mobile` (Expo RN), `packages/db` (Prisma →
  Supabase Postgres 17 with RLS), `packages/types`, `packages/config`.
- **Separate library SERVICE** (multi-tenant SaaS product, distinct from the
  in-app school library): `apps/library-api`, `apps/library-web`,
  `packages/library-db`, `packages/library-core`. Isolation enforced both ways
  by `.dependency-cruiser.library.cjs` + `apps/api/tsconfig.json`. Never import
  across. Its traps live in `docs/superpowers/LIBRARY-TRAPS.md` — read before
  touching it.
- **Deploy topology (Vercel, team finokraft):** `skoolos-web` → sckools.com +
  *.sckools.com; `skoolos-api` → api.sckools.com. Branch `staging` → Preview
  (raffles.test.sckools.com / api.test.sckools.com); branch `main` →
  Production. `library-web`/`library-api` → library.trackyour.in. QA atlas →
  `sckools-qa` project → qa.trackyour.in (source in `qa-site/`, deployed by
  `cd qa-site && vercel deploy --prod`).
- **apps/api/api/ tracked skeleton is LOAD-BEARING**: Vercel validates the
  functions pattern against checked-in files before building. Never untrack.
- **DB migrations:** `.github/workflows/db-migrate.yml` — staging auto on
  migration push; production via workflow_dispatch (inspect_only → apply).
  Other workflows: `outbox-drain.yml` (cron '3-59/10'), `db-backup.yml`
  (gpg-encrypted; repo is PUBLIC — never plaintext artifacts).
- **Ops:** `docs/RUNBOOK.md`. sentry-lite (dependency-free store-protocol
  reporter) on both tiers. RedisThrottlerStorage (INCR+PTTL, fail-open,
  enableOfflineQueue:false, `@Optional() @Inject(REDIS_THROTTLER_CLIENT)`).

## Tenancy & auth

- One school per host; API resolves tenant from `X-Skoolos-Host` (also
  X-Forwarded-Host; the custom header wins because Vercel rewrites XFH).
- `withTenant(schoolId, tx => …)` scopes Prisma under RLS; platform-wide reads
  use `getPlatformPrisma()` deliberately (cross-tenant checks like the
  one-school-per-teacher rule).
- JWTs per audience (school/platform). Access token in memory (zustand
  `auth-store`), refresh token in an HttpOnly cookie; single-flight refresh in
  `apps/web/lib/api.ts`. Roles: SCHOOL_ADMIN, TEACHER, STUDENT, STAFF (staffRole
  OFFICE/SUPPORT/HELPER/DRIVER/SECURITY/LIBRARIAN). `homeForRole` routes after
  login; each portal layout re-enforces its own allowed roles.
- Gatehouse UI: `apps/web/app/login/` (GatehouseLogin, login.css `gh-*`
  classes, resolveLoginTheme by host). `/reset-password` wears the SAME
  gatehouse (GatehouseReset) — invite + reset emails link there.
- Feature flags per school tier: PUBLIC_SITE, GALLERY, ENQUIRY, SOCIAL,
  ABOUT_CONTACT, EVENTS, BLOG, MANAGEMENT, HIRING, LIBRARY —
  `RequireFeatureGuard` on controllers, `requiredFeature` on nav items.

## Portals (web routes → API)

- **Admin `/app`**: dashboard; website studio (`/app/website` → `site/*`
  controllers, design config in `sectionVariants` Json with reserved
  `__order`/`__custom` keys merged server-side on publish — see
  `mergeSectionVariantContent`); blog console; enquiries (`public/enquiry` POST
  is public + throttled); classes/catalog (`manage/years|grades|subjects|periods`,
  working days); teachers & staff & students (CRUD + `POST :id/login` invites,
  `POST :id/invite/resend`, teacher `release`); timetable builder
  (`manage/timetable` — AssignSlotDto, TEACHER_CONFLICT 409, effective-dated
  supersession, same-day in-place correction); availability; staff-attendance
  (PUT day marks); leave (approve/reject/coverage/substitution, types +
  allocations); requests (register-change approvals); announcements; events
  (`manage/events`, capacity); jobs (`manage/jobs`, templates + screening
  questions, submit → platform moderation); settings.
- **Teacher `/teacher`**: my-day (`manage/timetable/my-day`), timetable/mine,
  attendance (my-classes, PUT register, locks + `manage/register-changes`,
  rates, notify-low → ABSENCE emails), diary (ITEM/REMARK, ALL/SELECTED,
  CLASS_NOT_OWNED guard — only owning teachers write), assignments (≤5
  attachments via upload round-trip), tests/results (`manage/exams`, marks ≤
  maxMarks, publish → email), announcements (own classes), notes/todos
  (`manage/class-notes|class-todos`), inbox (`manage/…teacher-messages`),
  library shelf (`me/library`), leave (`manage/leave` TEACHER-only POST),
  holidays, notifications (`me/notifications`), profile (`me/photo`).
- **Student `/portal`**: profile/timetable/announcements/attendance(month)/
  diary(+sign)/assignments(+seen)/exams/results(published only)/messages
  (`me/messages` STUDENT-only)/library shelf/notifications; events RSVP on the
  public site (`public/events`, portal `events/:id/register`).
- **Library `/library`** (SCHOOL_ADMIN or LIBRARIAN staff): dashboard
  (`library/dashboard` counts + outNow list), hall (`library/hall` — current
  class = timetable slots whose SUBJECT name contains 'librar' matched to the
  current Period by IST HH:MM; register SYNCED from teacher marks or RETAKEN;
  `library/hall/visits` upsert per class+date), counter (`library/members`
  full-name-splitting search, `library/issues` issue/return/reopen/lost/unlose,
  loan-limit + already-holds 409s with `override`, per-borrower advisory lock),
  new books (`library/titles` + `:id/copies`, accession B-xxxxx), fines
  (`library/fines` grouped entries, collect/waive/reopen, remind → email+push),
  settings (`library/settings` — GET is pure, defaults until first save;
  loanDays affects only new issues). Due-soon daily cron:
  `internal/cron/library-due-soon`.
- **Staff `/staff`**: own attendance record only (`manage/staff-attendance/mine`).
- **Public site**: `components/public/PublicSite.tsx` + `ps-css.ts` (PS_CSS) +
  `site-variants.ts` (SECTION_VARIANT_DEFS, SCROLL_FEELS — HORIZONTAL retired
  but still accepted → renders Classic; FESTIVALS ×15; normalizeHomeSections /
  normalizeSectionOrder; isSafeBlockUrl). Iron rules: DEFAULT emits no class;
  `.ps-root { color-scheme: light }`; modals portal into `.ps-root` (theme vars,
  no transformed ancestor); hero renders as panel #1 under Panels (one ground,
  no nav backdrops); reveal clips end at inset(-3rem) (never inset(0) — it
  amputates shadows/overhangs).

## Email (Letterhead) — `apps/api/src/common/mail/`

- `letterhead.ts` — pure renderer. Every message is a `Letter` (title, intro,
  rows, body, quote, cta, note, tone); `renderLetter(brand, letter)` returns
  html+text. Three templates: CLASSIC | BANNER | MINIMAL. Email-safe by
  necessity (nested tables, inlined styles, 600px, bulletproof CTA).
  `safeHex` normalises any stored colour so it cannot inject CSS.
- `mail-identity.service.ts` — resolves BOTH brand and sender for a schoolId,
  through the BYPASSRLS platform client (mail is dispatched post-commit,
  outside any tenant transaction), cached 60s. THE FALLBACK RULE: a school's
  own sender is used only when senderMode CUSTOM + senderStatus VERIFIED +
  fromAddress/host/port present + the credential decrypts; anything else uses
  the platform mailbox with the school's name as the From display name and
  `showPlatformCredit: true` (the footer's "Sent for X by Sckools" line).
- `secret-box.ts` — AES-256-GCM (`v1.iv.tag.ct`) keyed by `EMAIL_SECRET_KEY`
  (32 bytes, hex or base64; set in Vercel prod+preview). Missing key = custom
  senders cannot be SAVED (503 EMAIL_SECRET_MISSING), never a silent
  plaintext downgrade. Undecryptable value → fall back, never fail the send.
- `mail.service.ts` — `sendLetter(to, schoolId, subject, letter)` is the one
  seam; all composers build letters. A failing custom sender is written back
  as FAILING + lastError so the admin sees it.
- DB: `EmailSettings` (1:1 School, additive migration 20260823090000, RLS
  tenant_iso). Admin API `manage/email-settings` (GET/PUT, PUT sender, POST
  sender/verify, sender/disable, test, GET preview) — SCHOOL_ADMIN only,
  password write-only. UI: `apps/web/app/app/settings/email-card.tsx`.
- Specs: `letterhead.spec.ts` (9), `mail-identity.service.spec.ts` (9, every
  fallback branch), `mail-di.spec.ts` (bootstrap guard).

## Custom domains

`Domain` (hostname unique, type SUBDOMAIN|CUSTOM, status PENDING|LIVE|ERROR,
isPrimary). Tenant resolution already accepts any hostname with status LIVE
(`school-lookup.service.ts`, Redis-cached). Operator flow:
`OwnerDomainsService` + `owner/schools/:id/domains` (list/add/verify/primary/
delete) with UI `apps/web/app/platform/schools/[id]/domains-card.tsx`. Verify
reads REAL DNS (CNAME to `INGRESS_CNAME_TARGET`, or A-record match for an
apex) and only then flips LIVE, invalidating the lookup cache. Attaching the
domain at the hosting provider stays a manual step, surfaced in the
instructions.

## Notifications

`apps/api/src/common/notifications/` — `NotificationService.notify(kind,
recipients, onlyChannels?)` fans out to EmailChannel + PushChannel + in-app
inbox. Current send sites: login invites & password reset (MailService direct);
ANNOUNCEMENT (email+push+inbox); TEST_SCHEDULED and RESULTS_PUBLISHED
(EMAIL_ONLY by design); exam reminders; ABSENCE_NOTICE (per-child payloads);
LOW_ATTENDANCE (teacher-triggered, prunable list); DIARY; library fine remind
(email+push) and due-soon (daily cron, email); marketing lead → owner. Known
gaps (proposed, see QA atlas Notifications tab): enquiry alert to admins, event
RSVP confirmation/reminder, assignment due reminders, leave/register-change
decisions, library overdue escalation, pending-invite digest, per-family
channel preferences.

## Conventions & standing rules

- Read `docs/superpowers/LIBRARY-TRAPS.md` and run the mistake ledger
  (`node ~/.claude/projects/-Users-darshanjain-Documents-SchoolManager-SchoolManager/mistakes/log.mjs list`)
  before implementing; log every new root cause immediately.
- Staging first; fast-forward merge `git push origin origin/staging:main` only
  on explicit request. After ANY api deploy, smoke `GET /ready` (deploy green
  means built, not booted). Never `git add -A`. Never commit `.env`,
  `apps/api/api` changes, or generated library output.
- Verify with the package scripts (`pnpm --filter @skoolos/web test`, 754+
  tests; `pnpm --filter @skoolos/api test`, 747+), `set -a && source .env`
  for env, `pnpm preflight:library` before library-service pushes.
- Every guard is proven by watching it fail (remove → red → restore → green).
- API display fields (className, labels) arrive fully formatted — render
  verbatim, never re-prefix. Every enum render goes through a label map,
  including fallbacks.
- Known operational facts: staging Preview env lacks SMTP_PASS (staging email
  dead until added — prod sends fine); login emails are immutable after invite
  (no change-email endpoint); `emailSent:true` = SMTP accepted, bounces
  invisible. `EMAIL_SECRET_KEY` is set in Vercel production and preview.
- Responsive rule learned here: a component whose width comes from its
  CONTAINER (a page column) must measure the container — a viewport media
  query never fires. Measure with a CALLBACK ref, since cards with a loading
  branch mount their box after the first effect.

## QA atlas

`qa-site/` in this repo → https://qa.trackyour.in (project `sckools-qa`).
Feature specs + edge cases per portal, notifications audit, and an audit log:
Claude findings live in `qa-site/audits.json` — **append new audit entries
there and redeploy** (`cd qa-site && vercel deploy --prod`); the QA's manual
issues live in their browser (exported as Markdown back to us).
