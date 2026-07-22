# SkoolOS → Sckools: Master Plan (rename + remaining UX + architecture)

## 1. The rename — tiered by risk (user-visible is ALREADY done)
User-visible UI: **0 "skoolos" hits** — product already shows only "Sckools". Nothing to do.

| Tier | What | Count | Risk | When |
|---|---|---|---|---|
| A | `@skoolos/*` npm packages → `@sckools/*` | 110 import sites, 6 package.json | Mechanical; must be ATOMIC (one commit, verify build) | After feature merges |
| C | comments / log strings / doc mentions | 38 hits | Cosmetic, zero-risk | Any time (bundle w/ A) |
| B | **INFRA — dangerous** | | | Separate migration on `main` |
| B1 | `X-Skoolos-Host` header (web sends, api reads) | 6 files | Must deploy web+api together; tenancy breaks if mismatched. Transition: accept BOTH headers for one release, then drop old. | Its own PR |
| B2 | DB roles `skoolos_app`/`skoolos_platform` | in rotated conn strings (Vercel env) | New roles + new connection strings + env swap | Its own PR |
| B3 | Vercel projects `skoolos-api`/`skoolos-web` | GitHub-wired + all env + domains | Rename touches deploy pipeline | Manual, low-traffic window |
| B4 | Supabase bucket `skoolos-files` | S3 URLs | New bucket or alias | With B2 |

**Recommendation:** do NOT rename infra (Tier B) on this feature branch or before it's in prod —
you'd be compounding an unmerged feature with a deploy-breaking change. Correct order:
(1) merge current work to prod, (2) Tier A+C as one clean rename PR, (3) Tier B as a separate,
scheduled infra migration with the dual-header transition. Tier B delivers zero user value
(users already see "Sckools") so it's pure hygiene — schedule it, don't rush it.

## 2. Architecture assessment (honest — it's mostly sound)
- **Stateless:** ✓ API is stateless (JWT, no server session; Redis only for queue/cache/throttle).
  Horizontally scalable as-is. Fire-and-forget work uses Vercel `waitUntil`. 
- **ACID:** ✓ multi-row writes (attendance save, results, CSV import) run in Prisma `$transaction`
  via `withTenant`. Validate-then-write is atomic.
- **SOLID / boundaries:** ✓ NestJS feature modules, centralized `ApiError` envelope, shared
  `sk-theme`. DEBT: (a) invite modal duplicated across students/teachers pages → extract shared
  `<InviteSentModal>`; (b) a few 500+ line page components with inline forms → drawer extraction.
- **Scale gap:** students/teachers lists are unpaginated (fine to ~hundreds, breaks at 500+).
- **Security debt (flagged earlier):** new tables Attendance/Exam/Result lack RLS policies —
  app-level tenant checks protect them today (staging superuser bypasses RLS anyway), but add
  RLS before prod for defense-in-depth.

## 3. Remaining work — subagent-driven task tree
### PHASE P0 — Unblock setup (highest value, self-contained)  ◄ recommend FIRST
- T1. `/app/settings` page (backend endpoints exist): Academic Years (list/add) + Periods
      (list/add/edit/delete). Themed. → fixes the "can't create class / can't build timetable" wall.
- T2. Fix dead-end empty states (timetable "No periods", class-form "No academic years") to
      link to Settings; add-class guides to Settings when no year exists.

### PHASE P1 — Guided setup & shared UI
- T3. Dashboard setup checklist (academic year / periods / classes / teachers) with deep links.
- T4. Extract shared `<InviteSentModal>` + `<ConfirmDialog>` + `<Drawer>` primitives (DRY;
      removes duplication introduced across students/teachers).
- T5. Move students/teachers/classes add-edit inline forms into the Drawer (fixes page-jump UX).

### PHASE P2 — Scale
- T6. Server-side search + pagination API + UI (students, teachers).
- T7. Bulk actions (assign class, send invites, export CSV).
- T8. CSV import wizard (validate-then-atomic).

### PHASE P3 — Hardening & release
- T9. RLS policies on Attendance/Exam/Result (migration, model on 20260703 RLS migration).
- T10. Final whole-branch code review.
- T11. `staging → main` PR (needs migrations applied to prod first; behind Pro flag).

### PHASE R — Rename (AFTER prod merge)
- R1. Tier A+C package + comment rename (one atomic PR, verify build+tests).
- R2. Tier B infra migration (dual-header transition, roles, projects, bucket) — scheduled.

## 4. Status: DONE so far
Attendance/exam/result APIs, notifications+cron, email-invite logins (no temp pw), navbar login,
student portal, teacher portal, all 5 admin tabs themed, Classes split, delete confirms,
light/dark theme+toggle, real logo. All on `staging`, deployed. BLOCKED ON USER: SMTP_PASS.
