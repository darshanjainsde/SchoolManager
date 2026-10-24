# Changelog of the knowledge base

Newest first. Each entry is what an update run recorded — what shipped, where, and what the expert now knows.

## 2026-10-24 — production release `e8b337a` (PR #182, `feat/marketing-site-fixes` → main)

- **Live on sckools.com and the production API**: the rebuilt marketing site (hero scene with real device screens, plan cards as categories, `/#/features` with 54 categorised tiles, owner-run discount + hero figures), **Plan Ladder v2** (Basic / Standard / Pro as `packages/db/src/features.ts`; every key in a tier), **Refer & Earn** (`/earn`, `/promoter`, owner `/platform/referrals`, `apps/api/src/modules/referrals`), and the owner Referrals page measured 360–1920 (`apps/web/audit/referrals.test.tsx`).
- Production migrations applied first, from the `staging` ref: `20261022_120000_marketing_hero_discount`, `20261023_090000_refer_and_earn`, `20261023_130000_referral_task_referral_idx`. Order rule recorded in `operations.md`.
- The plan-ladder protect script (`apps/api/scripts/plan-ladder-protect.ts`) was skipped on Darshan's call: production holds dummy data. Prices still placeholders (₹30/45/60) until set in `/platform/settings`.
- CI had been red since Plan Ladder v2: nine e2e failures (five feature-gate fixtures assuming PRO lacks SALARY/COURSE_MANAGEMENT/PRESS/ALUMNI; route-manifest, rls-coverage, fk-indexes and tenant-aggregates guards not told about Refer & Earn). Fixed in `c71e2f9`; rules in `conventions.md`.
- Decision 2026-10-24: keep `owner.sckools.com` (its own browser origin) even though the apex `/owner` door works.
- Narrative refreshed for everything since the 2026-09-08 stamp (441 commits): sports wing, salary & pay, syllabus tracker, WhatsApp channel, OTP login, backups, concerns, celebrations/sessions, message report & block. Inventories regenerated.
- Mistake-ledger ids: `pushed-onto-a-red-pr-without-the-full-e2e`, `ui-shipped-without-the-audit-harness`, `shipped-ui-below-the-product-standard` (bumped); UI ledger `pill-carries-a-sentence`, `tested-only-with-short-values` (4×), `figure-row-orphans-a-tile-on-a-phone` (4×).

## 2026-09-08 — production release `9784853` (PR #86, staging → main)

- Everything from the 2026-09-07/08 entries is live on sckools.com and the production API: rebuilt marketing site (per-route static pages, indexable, sitemap), per-student pricing tag, why-switch section, student-profile class label, Hall of Fame code.
- **Production migrations still pending until the owner runs `db-migrate.yml` with `environment=production`:** `20260907_000000_hall_of_fame_batches`, `20260907_010000_hall_of_fame_year_repair`. Until then every school's Hall of Fame section is hidden and the admin tab shows the "being upgraded" notice (designed degrade path).
- Production `MarketingConfig` still held per-school amounts at release (₹18,800 / 25,000 / 30,000) — the hero tag reads them as per-student figures until the owner updates `/platform/settings`.
- Later staging fixes included in the release: Hall of Fame band carries `data-sec="hof"` (Deck/Snap), class chips always shown, batches printed as sessions, studio preview follows the band being edited.

## 2026-09-08 — stamp `9be058c` (staging)

- **Hall of Fame rebuilt** (`docs/superpowers/specs/2026-09-07-hall-of-fame-batches-design.md`): batches are academic sessions ("2025-26", start year stored); classes by name (API groups keep `COURSE`/`GRADES`/`CUSTOM` kinds; the admin screen only creates `CUSTOM`); a place may link a register student whose current name and profile photo are read at render time; seven studio layouts (`sectionVariants.hof.layout`); every reader tolerates the missing migration. Migrations `20260907_000000_hall_of_fame_batches` (+ `_010000` year repair).
- **Student portal profile** returns the grade-qualified class ("Nursery-A", not "A") — `apps/api/src/modules/portal/portal.service.ts`.
- **Marketing site to production wiring**: per-route static pages, canonicals/OG/JSON-LD, staging noindex header, sitemap entries, footer links (`apps/web/next.config.mjs`, `apps/web/public/site-preview/`). PR #86 (staging → main) awaits merge.
- **Why-switch section** rebuilt with sourced pain points, calculator, four-week plan, standout cards.
- **Pricing** per student per year; owner-console labels; hero price tag; `/pricing` page.
- Mistake-ledger additions: `bare-section-name-as-class-label`, `pg-substring-pattern-returns-first-group`; repeats of `ui-copy-prefix-breaks-assertion`, `new-page-skipped-repo-wide-ui-guards`.
