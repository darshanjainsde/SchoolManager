# Sckools Mobile App — Design Spec

**Date:** 2026-07-24
**Status:** Draft for review
**Interactive mockup (source of truth for UI):** `design/sckools-app/mobile-mockup-v2.html` (also published at claude.ai artifact `2604ee29`)

---

## 1. Purpose & goals

A single mobile app (Android first, iOS later from the same codebase) for the Sckools platform, serving **families (parents, students)** and **school staff (teachers, principals, accountants, admin staff)** across thousands of tenant schools.

Goals, in priority order:

1. **Unblock Google Play** — produce a signed `.aab`, run the mandatory closed test (12 testers / 14 days), obtain production access.
2. **The trust loop (Phase 1)** — teacher marks attendance → parents get push → seen at home. Small, complete, valuable.
3. **Scale without rework** — architecture choices must survive 1,000+ schools by adding servers horizontally, never by re-platforming.

Non-goals (v1): school-admin/owner workflows (stay web-only), iOS release (follows later from same code), offline-first sync.

## 2. Repo & stack decision

- **Same monorepo.** New workspace `apps/mobile` alongside `apps/api`, `apps/web`, `apps/worker`.
- **Expo (React Native) + EAS Build/Submit/Update.** One codebase → Android + iOS. EAS produces the `.aab`; EAS Update (OTA) ships JS-only changes to testers instantly without store review.
- **Shared contracts.** `apps/mobile` imports types + Zod schemas from `packages/` (same as web). Mobile can never send a shape the API doesn't expect.
- **App identity (permanent, never change):** package name `com.sckools.app`; Play App Signing (Google-managed key).
- Brand: **Sckools** wordmark + Tassel-S logo everywhere user-facing (`apps/web/components/brand/sckools-logo.tsx` is the source of the mark).
- Git hygiene on this machine: commit explicit paths only; never `git add -A` (iCloud conflict-copy history).

## 3. Identity, tenancy & school resolution

**Problem:** which school does the app show? A parent can have two children in two different schools.

**Model: global account + memberships.**

```
Account (phone/email + OTP, one login, global)
  └── Membership[]: { school_id, role, student_id? , capabilities }
```

- Login is phone/email + OTP. **No school picker at login**; the server resolves memberships.
- 1 membership → route straight in. 2+ → in-app switcher (child/school chips, as in mockup header).
- Memberships are **provisioned by the school** (enrolment records already carry parent phone). Fallback: one-time invite code. Never self-claimed from a public school list.
- API tenancy continues to use the existing header mechanism internally; mobile requests carry the JWT + active `school_id`, and every query is tenant-scoped. Cross-tenant isolation enforced structurally (Prisma middleware / RLS), not by convention.

## 4. Roles & capabilities (RBAC)

No hardcoded `if (isTeacher)`. **Role → capability preset**, evaluated server-side, mirrored client-side for UI gating:

| Role | Preset (examples) |
|---|---|
| Teacher | `attendance.mark`, `homework.post`, `notice.post.class`, `grades.enter`, `message.parents` |
| Principal | `*.view`, `notice.approve`, `reports.view`, `notice.post.school` |
| Accountant | `fees.collect`, `fees.reports` (no teaching features) |
| Front office | `notice.post`, `admissions.view` |
| Parent | `child.view`, `fees.pay`, `message.teacher` |
| Student | `self.view`, `homework.view`, `quiz.play` |

- New staff type at scale = one new preset. No app release required.
- Multi-role accounts (teacher who is also a parent) get an in-app role switcher; single-role accounts never see it.
- `notice.post.school` ("Whole school" chip) defaults to principal/admin; per-school setting can grant it to teachers.

## 5. App structure (two sides, one app)

Side is **derived from the logged-in membership's role** — never a user-facing picker.

- **Family side** — parent & student share screens; two conditional differences: fees (parent-only) and child-switcher (parent-only).
- **Staff side** — teachers + all staff; features appear per capability preset.

### Tab maps (from mockup v2)

- Parent: Home · Attendance · Fees · Results · More(Homework, Notices, Holidays, Messages, Calendar, Leave, Profile)
- Student: Home (animated hero, streak, quiz banner, full quick-action grid) · Results · Quiz · Homework · More(Attendance, Timetable, Holidays, Messages, Report card, Profile)
- Teacher: Today · Attendance · Marks · Post · More(Roster, Inbox, My tasks, Documents, Holidays, Feedback, Help & SOS)
- Principal: Overview · Notices · Reports · Staff · Inbox

## 6. Feature specs

### 6.1 Attendance (P1) — the trust loop

**One record per (class_id, date).** State machine:

```
not_taken → taken { by, period, time, present[], counts }  ← LOCKED school-wide
             └─ retake (explicit confirmation) → new version; prior version kept in audit log
```

- Enforced by a **DB unique constraint** on `(school_id, class_id, date)` — concurrency-safe across any number of API instances.
- Every teacher sees the same status ("Taken · P1 · by Ms. X · 26/28"). No stale "take attendance" prompts.
- Retake UI: confirmation sheet stating who/when/counts, warns overwrite, notes audit history (as mocked).
- Push: parents notified on first take; on retake only changed students are re-notified.
- Submit is fast: one write + enqueue notification job; fan-out happens in `apps/worker`.

### 6.2 Marks → Results (P2)

- Teacher enters marks per (class, assessment); **draft → publish**. Publish flips visibility; the same record renders the family Results screens. No copies, no sync jobs, no drift.
- Family Results: term summary → subject-wise list → per-test detail (marks, class average, percentile band) as mocked.

### 6.3 Notices & homework (P1)

- Compose with **multi-select class chips** (teacher's own classes) + capability-gated "Whole school" (exclusive selection).
- Delivery = feed entry + push to affected memberships (worker fan-out).

### 6.4 Weekly Quiz (P3)

- **Ranked round: MCQ only, auto-graded.** Owner portal maintains per-grade question banks; a sealed pack per grade is **pre-published to CDN** before the window. Clients unlock at start time; per-question timer; shuffled order/options.
- Submissions → queue → async scoring → leaderboards per (grade, school). The Sunday spike never touches the DB synchronously.
- **Creative round (draw/write): showcase, not ranking.** Submissions judged per school by staff (judging fans out), or centrally for top-N MCQ scorers only. Human grading never scales globally; this design keeps it bounded.
- Prizes (tee, goodies) configured per week; winners announced Monday in-app.

### 6.5 Fees (P2)

- Parent: dues, breakdown, receipts, history; online payment via gateway (checkout provider chosen at implementation; webhook → receipt + push).
- Student sees no fees. Accountant capability sees collection status (staff side).

### 6.6 Staff utilities (P2–P3)

- **My tasks**: private per-user todos/reminders (server-synced, trivial schema).
- **My documents**: attach PDF/images; files in object storage, metadata in DB; device storage/cache for offline viewing.
- **Help & SOS**: school-configured helplines (tap-to-call). SOS → immediate event → email to school admin (worker job) with sender, role, time; later escalation channels.
- **Feedback**: category + text, optional anonymous → visible in school-admin **web** portal; principal mobile shows read-only recent list.

### 6.7 Holidays (P1)

- School admin configures on web portal; both mobile sides render the list (date, day, name, type chip). Read-only in app.

### 6.8 Push notifications (P1, foundational)

- Expo Push → FCM/APNs. Device-token registry keyed by (account, device, school). All sends go through `apps/worker` queue jobs — never inline in API requests.

## 7. Scalability rules (architecture law)

1. **API instances are stateless & disposable** — JWT auth, no sticky sessions, no local state. Scaling = add instances behind the LB.
2. **State lives in exactly three places:** Postgres (truth), Redis (cache + BullMQ queues), object storage (files).
3. **Slow or bursty work goes to queues** (push fan-out, quiz scoring, emails, receipts). Workers scale independently of the API.
4. **Protect the database:** pooled connections (PgBouncer, already in place), indexes on every tenant-scoped access path, read replicas for dashboards when needed, month-partitioning for attendance/quiz tables when volume demands — all schema-compatible from day one.
5. **Tenancy:** one DB, `school_id` on every row, isolation enforced structurally. Never per-school databases.
6. **Hot reads go static:** quiz packs, holiday lists, notices feed pages cacheable/CDN-friendly.

## 8. Quality & testing strategy

- **TDD on money paths:** attendance locking (incl. concurrent-submit test), RBAC gating, fees math, quiz scoring.
- **Pyramid:** unit tests (services/pure logic) → API integration tests against real Postgres → **Maestro** E2E for critical mobile flows (login→home per role; teacher takes attendance→parent push/state).
- **CI gates:** typecheck + lint + tests on every PR; `main` always shippable; no direct pushes.
- **Sentry** in the app from the first build. **Feature flags** for dark-shipping unfinished work.
- Shared Zod schemas make request/response shape mismatches a compile-time error.

## 9. Release pipeline (Play Console)

1. **Week 0:** scaffold `apps/mobile`, package `com.sckools.app`, EAS configured, Play App Signing.
2. **First `.aab` → Internal testing** (instant, self-only) — proves the pipe.
3. **Closed testing:** Google Group with 12+ testers, opt-in link → **14-day clock starts with v0.1**, not the finished app. Console checklist in parallel: data safety, privacy policy (`sckools.com/privacy`), content rating, target audience.
4. **During the 14 days:** build P1 behind flags; ship daily via **EAS Update (OTA)** — no store review needed for JS changes.
5. **Day ~15:** apply for production access → staged rollout 10% → 50% → 100%.
6. **Steady state:** CI runs `eas build`/`eas submit`; auto-increment versionCode; OTA for fixes, store builds for native changes. iOS later from the same codebase (Apple account required, $99/yr).

## 10. Phasing

| Phase | Scope |
|---|---|
| **P1 — Trust loop** (closed-test build) | Auth + memberships + role routing, push pipeline, teacher attendance (lock/retake), notices/homework post + family feed, family attendance view, holidays, app shell per mockup |
| **P2 — Money & conversation** | Fees + payments + receipts, marks entry → results, messaging, Help/SOS, feedback, documents, tasks |
| **P3 — Delight & scale** | Weekly quiz engine + leaderboards + creative showcase, streak/XP polish, principal dashboards, report cards, leave workflows |

## 11. Error handling & edge cases

- Concurrent attendance submits: second writer gets a friendly "already taken by X" state (constraint violation mapped to UI), never a crash or silent overwrite.
- Push undeliverable (token expired): token pruned on provider feedback; no user-visible failure.
- Multi-school parent: switcher always shows school badge; all queries scoped to the active membership.
- Quiz: joining late shortens the window client-side; server rejects submissions outside the window (server time is authoritative).
- Payments: gateway webhook is the source of truth; app polls/receives push for receipt state; double-payment prevented by idempotency keys.

## 12. Open items (decided at implementation, not blockers)

- Payment gateway choice (Razorpay-class; needs merchant onboarding).
- OTP/SMS provider for login.
- Hosting target for horizontally scaled API instances + Redis + workers (current API deploy evolves; Vercel remains for web).
