# Phase 0: Staging Environment + Phase-1 Rollback Safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `test.sckools.com` (non-prod) deploying from the `staging` branch, with a frozen Phase-1 rollback ref, so the Admin Pro console can be tested end-to-end before touching prod.

**Architecture:** Reuse the existing two Vercel projects (skoolos-web, skoolos-api, team `finokraft`, GitHub git-integration). Add branch domains pinned to `staging`, a separate Supabase project for staging data, and branch-scoped env vars. Prod remains driven only by `main`.

**Tech Stack:** Vercel branch domains, Supabase (ap-south-1), GitHub branch protection, existing `db:seed`.

## Global Constraints

- NEVER run `git add -A` or push the local working tree wholesale — local tree contains iCloud " 2" conflict copies. Add files by explicit path only.
- Prod deploys ONLY from GitHub `main` via git integration — never local `vercel --prod`.
- Rollback ref: branch `phase-1-stable` + tag `phase-1-backup-2026-07-21` (both already pushed, pointing at `d2647b0`).
- Staging and prod must never share: `DATABASE_URL*`, S3 bucket, or unprefixed email identity.

---

## Already done (this session)

- [x] `phase-1-stable` branch pushed to origin at `d2647b0` (current prod).
- [x] Tag `phase-1-backup-2026-07-21` pushed at same commit.
- [x] `staging` branch created from `origin/main` and pushed (contains these plan docs).

**Rollback recipe (if Phase 2 must be abandoned):** in Vercel → each project → Settings → Git → change Production Branch from `main` to `phase-1-stable`, then "Redeploy". Zero code changes. Alternatively `git push origin phase-1-stable:main --force-with-lease` restores main itself.

---

## USER ACTIONS (dashboard/credentials only you can do)

These cannot be automated from this repo. Each is ~5 minutes.

- [ ] **U1 — Supabase:** create project `skoolos-staging`, region `ap-south-1` (Mumbai), free tier. Note the project ref, DB password, and create public bucket `skoolos-files` (Storage) + S3 access keys (Dashboard → Storage → S3 access keys).
- [ ] **U2 — Vercel domains (both projects):** skoolos-web → Domains → add `test.sckools.com` and `*.test.sckools.com`, assign to branch `staging`. skoolos-api → add `api.test.sckools.com`, assign to branch `staging`. (DNS is already on Vercel nameservers; the prod wildcard `*.sckools.com` matches one level only, so there is no overlap.)
- [ ] **U3 — Vercel env vars, scoped to Preview → branch `staging`:**
  - skoolos-api: `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`, `DIRECT_URL` (staging Supabase poolers: runtime `:6543?pgbouncer=true`, direct `:5432`), `PLATFORM_HOST=test.sckools.com`, `PLATFORM_OWNER_HOST=owner.test.sckools.com`, `S3_ENDPOINT/S3_REGION/S3_FORCE_PATH_STYLE/S3_PUBLIC_URL_BASE/S3_*_KEY` (staging bucket), `SMTP_*` same as prod but `SMTP_SUBJECT_PREFIX=[TEST] ` (new var, Task 2), `APP_ENV=staging`.
  - skoolos-web: `NEXT_PUBLIC_PLATFORM_HOST=test.sckools.com`, `NEXT_PUBLIC_PLATFORM_OWNER_HOST=owner.test.sckools.com`, `NEXT_PUBLIC_API_URL=https://api.test.sckools.com`.
- [ ] **U4 — GitHub branch protection on `main`:** require PR, require status checks, block force-push. (Settings → Branches → Add rule for `main`.)

---

### Task 1: Staging DB schema + seed

**Files:**
- No code changes — uses existing `packages/db` scripts.

**Interfaces:**
- Consumes: staging Supabase creds from U1.
- Produces: seeded staging DB (owner + acme/STANDARD + beacon/PRO), Domain rows on `<slug>.test.sckools.com`.

- [ ] **Step 1:** With staging creds in a local `.env` override (NOT committed), run:
```bash
DIRECT_URL="postgresql://postgres.<staging-ref>:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" \
  pnpm --filter @skoolos/db exec prisma migrate deploy
```
Expected: all existing migrations applied, `No pending migrations`.

- [ ] **Step 2:** Seed: same env, `pnpm db:seed`. Expected output lists created owner + 2 schools.

- [ ] **Step 3:** Rewrite Domain rows for staging hosts (psql or Supabase SQL editor):
```sql
UPDATE "Domain" SET host = regexp_replace(host, '\.sckools\.com$', '.test.sckools.com'), status = 'LIVE';
```

- [ ] **Step 4:** Verify: `curl -s https://api.test.sckools.com/ready` → `{"db":"ok","redis":"ok"}` (after U2/U3 and a staging deploy exist). Then `https://acme.test.sckools.com` renders the public site; admin login `admin@acme.test` / `Passw0rd!` returns 201.

### Task 2: `[TEST]` email subject prefix

**Files:**
- Modify: `apps/api/src/common/mail/mail.service.ts` (the `send()` method, currently line ~27)
- Modify: `apps/api/src/config/env.validation.ts` (or wherever `SMTP_FROM` is declared — add optional `SMTP_SUBJECT_PREFIX`)

**Interfaces:**
- Produces: every outgoing mail subject prefixed by `env.SMTP_SUBJECT_PREFIX ?? ''`. Prod leaves the var unset → zero behavior change.

- [ ] **Step 1:** Write failing unit test `apps/api/src/common/mail/mail.service.spec.ts`: construct service with fake env `{ SMTP_SUBJECT_PREFIX: '[TEST] ' }` and a mocked transporter; assert `sendMail` called with `subject: '[TEST] Hello'`.
- [ ] **Step 2:** Run `pnpm --filter @skoolos/api test -- mail.service` → FAIL.
- [ ] **Step 3:** Implement: `subject: (this.env.SMTP_SUBJECT_PREFIX ?? '') + subject` in `send()`; add optional env field.
- [ ] **Step 4:** Test passes; `pnpm typecheck`.
- [ ] **Step 5:** Commit on a feature branch off `staging`:
```bash
git add apps/api/src/common/mail/mail.service.ts apps/api/src/common/mail/mail.service.spec.ts apps/api/src/config/env.validation.ts
git commit -m "feat(api): optional SMTP_SUBJECT_PREFIX for non-prod email safety"
```

### Task 3: Staging smoke checklist (gate before any Phase-2 merge)

- [ ] `GET https://api.test.sckools.com/ready` → db+redis ok
- [ ] `acme.test.sckools.com` public site renders; `beacon.test.sckools.com` renders
- [ ] Admin login works on staging; tenant isolation: acme admin token against beacon host → 401
- [ ] Invite email arrives with `[TEST]` prefix (after Phase 2 Task 5) to a team inbox
- [ ] Prod untouched: `sckools.com` still serves `main` build (check deployment ID in Vercel)
