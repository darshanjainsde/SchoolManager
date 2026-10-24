# Support Desk — design

**Date:** 2026-10-24 · **Pitch:** https://claude.ai/artifact/49JN4fHgYXdyWRwKSWs8py · **Branch:** `feat/support-desk` (cut from `origin/staging` at `75534e8`)

## Intent

A school admin reports a problem with Sckools from inside the console: words, up to five
photos, and the diagnostics the console can capture on its own. The owner console gets a
**Support** tab that shows those tickets school-wise, oldest unanswered first. Every move the
owner makes is visible to the school on its own **Help** page, with email and the in-app bell.

Today a report arrives on WhatsApp as "fees not working", with no page, no screenshot and no
way for the school to see whether anyone picked it up. That stops scaling before anything else.

## Goals

- One door to report (reachable from any console page), structured enough to act on.
- Owner sees every school's open tickets in one place, with lateness visible at a glance.
- School tracks status and the owner's replies; reopen inside a window.
- Diagnostics captured without asking: page, plan tier, browser, app version, who.
- Consent-based look-in: the school can allow the owner to open its console for 48 hours.

## Non-goals (second cut)

Known-issue banner, canned replies, CSAT rating, teachers raising tickets, mobile entry point,
WhatsApp pings, auto-attaching a sentry-lite error id (sentry-lite keeps no per-school store).

## Anti-goals

- A school ever reading another school's ticket, or any private owner note.
- The owner opening a school's console from a ticket without live consent.
- A ticket that is lost: every status move is a timeline entry the school can read.

## Decisions (made in the pitch, confirmed 2026-10-24)

| Question | Decision |
|---|---|
| Admin nav placement | Top-level **Help** item just above Settings, no feature flag. A "Report a problem" door also sits in the sidebar footer on every page. |
| Who may raise | SCHOOL_ADMIN only in v1. |
| Auto-close | RESOLVED tickets close themselves after 7 quiet days; reopen stays possible for 14 days after resolution. |
| Look-in consent | Ships in v1. 48-hour window, revocable, every use on the timeline. |
| Ticket number | One global sequence, shown as `SK-000142`. |
| Feature gate | None. Support is owed to every tier. |

## The model

```
SupportTicket   id, schoolId, number (serial, unique), raisedById, type, module, severity,
                title, body, attachmentKeys[], context Json, status, assignedOwnerId?,
                lookInUntil?, externalRef?, acknowledgedAt?, resolvedAt?, closedAt?, reopenedAt?,
                lastActivityAt, lastSchoolActivityAt, lastOwnerActivityAt?, createdAt
SupportTicketEntry id, schoolId, ticketId, authorId?, authorKind SCHOOL|OWNER|SYSTEM, body,
                attachmentKeys[], visibleToSchool, statusFrom?, statusTo?, createdAt
```

- `type` ∈ BUG · QUESTION · DATA_FIX · BILLING · IDEA. `severity` ∈ BLOCKING · ANNOYING · SUGGESTION.
  `module` ∈ a fixed list that mirrors the admin nav (WEBSITE … SETTINGS, LOGIN, APP, OTHER).
- `status` ∈ OPEN · ACKNOWLEDGED · IN_PROGRESS · WAITING_ON_SCHOOL · RESOLVED · CLOSED.
- `context` = `{ pagePath, tier, browser, appVersion }`, filled server-side except `pagePath`/`appVersion`.
- `assignedOwnerId` is attribution, not a relation (platform user, schoolId null), like `ImpersonationToken.mintedByUserId`.
- Both tables carry `schoolId` under the `tenant_iso` RLS policy; owner reads use `getPlatformPrisma()`.
- Backup buckets: both tables are `day` data.

### Status machine

Owner moves: OPEN → ACKNOWLEDGED | IN_PROGRESS | WAITING_ON_SCHOOL | RESOLVED;
ACKNOWLEDGED → IN_PROGRESS | WAITING_ON_SCHOOL | RESOLVED; IN_PROGRESS ↔ WAITING_ON_SCHOOL,
either → RESOLVED; RESOLVED → IN_PROGRESS | CLOSED. CLOSED has no owner move.

School moves: a reply while WAITING_ON_SCHOOL flips it to IN_PROGRESS; **confirm** RESOLVED → CLOSED;
**reopen** RESOLVED | CLOSED → OPEN within 14 days of `resolvedAt` (stamps `reopenedAt`).
System: RESOLVED older than 7 days → CLOSED (lazy sweep on read, one SYSTEM entry per ticket).

"Unanswered" = not RESOLVED/CLOSED and `lastOwnerActivityAt` is null or older than `lastSchoolActivityAt`.
"Past 24 h" = unanswered for more than 24 hours. Lateness outranks status in every colour.

## Routes

| Door | Route | Does |
|---|---|---|
| SCHOOL_ADMIN | `manage/support` | GET counts · GET list `?status=OPEN|CLOSED|ALL` · POST create (multipart `files` ≤5) · GET :id · POST :id/comment (multipart) · POST :id/confirm · POST :id/reopen · POST :id/look-in `{allow}` · GET :id/file `?key=` |
| OWNER | `owner/support` | GET counts (badge) · GET board · GET tickets `?schoolId&status&type&module` · GET :id · POST :id/status · POST :id/comment `{body, visibleToSchool}` · POST :id/assign `{assign}` · PATCH :id `{externalRef}` · POST :id/open-school · GET :id/file `?key=` |
| OWNER, existing | `owner/schools/:id/impersonate` | unchanged; open-school calls the same service only while `lookInUntil` is in the future |

Everyone else: 403 for TEACHER, STUDENT, STAFF; 401 anonymous. A school admin's token opens nothing on `owner/support`.

## Files, limits, abuse

- Images only (PNG/JPEG/WebP/GIF by bytes), 5 MB each, 5 per ticket or reply. Stored under the private prefix `support/`, served by a 5-minute presigned link from a route that first finds the key on the ticket or one of its entries inside the caller's tenant.
- Creation throttled per IP (10/hour, the global throttler) and per school (20/day, service-checked → 429).
- Body ≤ 4,000 chars, title ≤ 120, externalRef ≤ 120.

## Notifications

- To the owner: an email via the platform mailbox to the marketing config's `contactEmail` on create, school reply and reopen. Fire-and-forget; never fails the write.
- To the raising admin: an in-app `Notification` (kind `SUPPORT`, linkType `support`) plus a `NotificationOutbox` row (kind `SUPPORT_UPDATE`, `targetUserId`) on acknowledge, status move, visible reply, resolve and open-school. The drain renders it through the single-reader ANNOUNCEMENT shape under the desk name "Support desk".

## Screens

- **Admin `/app/support`** ("Help"): counts (open · waiting on you · closed), one RowList of tickets, drawer thread (kit Overlay) with reply + photos, confirm, reopen, look-in switch. "Report a problem" opens a drawer with type/module/urgency segments, title, body, photos, captured-context box, look-in checkbox. The same drawer opens from the sidebar footer on every page, carrying the current path.
- **Owner `/platform/support`**: three figures (unanswered · past 24 h · in progress), school-wise board (open count, oldest unanswered, tier, late stripe), filters as labelled selects, list. `/platform/support/[id]`: timeline with private notes marked, desk card (status, assigned, look-in, GitHub ref, same-module count), reply with private toggle, status moves, Open as this school.

## Tests the repo requires

Role-to-door e2e against the booted app (right role: real payload; others 403; anon 401; second school's admin: 404), owner-host e2e pattern (school token 401 on owner host, platform token 403 on school host), route-manifest entries, RLS forge test, route-contract literal calls, FK indexes, bucket map, outbox fixtures, kind lists in `@skoolos/types` contracts spec, web page tests including the server saying no (413, 429, 500, offline), owner pure-function tone test, nav-model route list, query-states guard.

## Left to the builder

Exact copy inside letters and toasts, CSS class names (prefix `sk-sup-`), icon choices, the order of filters on the owner list.
