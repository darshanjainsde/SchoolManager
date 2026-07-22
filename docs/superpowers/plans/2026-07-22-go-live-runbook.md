# Go-Live Runbook — School-Day release (prepared 2026-07-22, DO NOT push until approved)

## Backup (done)
- `prod-backup-2026-07-22` branch + `prod-backup-2026-07-22-preschoolday` tag = current prod (`main` @ d2647b0).
- Also `phase-1-stable` (older). Rollback = point Vercel prod branch at the backup, or `git push origin prod-backup-2026-07-22:main --force-with-lease`, then redeploy.

## What ships: 54 commits (staging → main)
School-day subsystem (bell schedule + breaks, Mon-Sat timetable w/ immutable versioned past + dates/today/week-nav, staff mgmt+attendance+monthly cards, leave apply→approve→coverage→cancel), email-invite logins (no temp pw), light/dark theme, Settings page, dashboard checklist, owner Scale tab, + perf (batched attendance write, cached owner overview) + RLS on 7 new tables.

## GO-LIVE ORDER (critical — migrate BEFORE deploy)
1. **Apply 7 migrations to PROD DB, in order** (via Supabase Management API — established flow; write query to scratchpad, user runs `curl`). Order:
   `20260721_010000_attendance_exams_results` → `20260721_020000_nav_login` → `20260722_000000_login_invites` → `20260722_010000_school_day` → `20260722_020000_staff_user_role` → `20260722_030000_leave_cancelled` → `20260722_040000_rls_new_tables`
   Each also needs its `_prisma_migrations` row (checksum = sha256 of migration.sql).
2. **Prod env:** set `SMTP_PASS` (Hostinger admin@sckools.com) so invite/reminder emails send. (School-day features are under the existing `MANAGEMENT` feature — beacon/PRO already has it; no new flag.)
3. **Merge `staging → main`** (git push → triggers both Vercel prod deploys). Web + API build ~1-2 min each.
4. **Verify prod:** `api.sckools.com/ready` = {db:ok,redis:ok}; log in to a real school admin; **RLS smoke test** (below).

## ⚠️ HIGHEST-RISK on prod: RLS enforcement
Prod runs as `skoolos_app` (RLS-ENFORCED); staging runs as superuser (RLS bypassed) so RLS could NOT be fully tested on staging. The 7 new tables now have `tenant_iso` policies. All tenant code writes via `withTenant` (sets `app.current_tenant`) — audited — and this is the SAME proven pattern the existing prod tables use. Smoke test after deploy: as a school admin, mark attendance, build a timetable slot, add staff, mark staff attendance, apply+approve a leave. If any 500s with a permission/RLS error → a code path missed `withTenant`; rollback via backup and fix. (Low risk, but this is the one thing to watch.)

## Rollback
Flip Vercel prod branch to `prod-backup-2026-07-22` → redeploy (instant), OR revert the merge commit. Migrations are additive (new tables/columns) so old code ignores them — a code rollback needs no DB rollback.

## Deferred to POST-LAUNCH (not go-live blockers at pilot scale; see 2026-07-22-scale-audit.md)
- Redis-cache the recurring timetable + static data (periods/subjects/workingDays).
- Denormalized per-school counters for owner overview (Redis cache already mitigates).
- Server-side pagination on students/teachers lists.
- Dedup the double `/auth/me` on login.
- Batch exam-results write (needs publishedAt-preserving logic).
