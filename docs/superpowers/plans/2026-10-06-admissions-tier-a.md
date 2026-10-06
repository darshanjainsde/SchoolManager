# Admissions officer — Tier A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a school an ADMISSIONS staff job that opens `/app/enquiries` and nothing else in the console, and turn the enquiry desk into a forward-only pipeline with a lead source, a contact log, real note authors, walk-ins taken at the desk, a desk-member owner picker and a CSV export.

**Architecture:** The job is added the way ACCOUNTS was (`6ea6efb`): a `StaffRole` value, a desk guard that narrows `STAFF` to the job, `homeForRole` landing the login, and the `/app` layout admitting the job to its one room. The pipeline rules (`STAGE_ORDER`, `stageMove`, `contactTarget`, the source and contact lists) live once in `@skoolos/types`, so the API that enforces them and the desk that draws them cannot disagree. `EnquiryService` gains `owners`, `logContact` and `create`; `update` refuses backward moves (409) and owners who are not on the desk (400).

**Tech Stack:** NestJS 10 + Prisma 5 (api, Jest), Next 15 / React 19 (web, Vitest + Testing Library), Expo (mobile, Jest), PostgreSQL with RLS.

**Spec:** `docs/superpowers/specs/2026-10-06-admissions-officer-design.md` — §7 Tier A only (§1 the job, §2 the pipeline, §3 creating an enquiry, §5 the web desk).

**Decisions this plan makes, and why:**
- **How an officer is admitted to `/app/enquiries`.** ACCOUNTS is not admitted by an allow-list: `homeForRole('STAFF','ACCOUNTS')` returns `/app/pay`, and the `/app` layout `router.replace`s every non-admin to `homeForRole(...)` on every path. ADMISSIONS copies that exactly (`homeForRole` → `/app/enquiries`). The layout's check moves into a pure `consoleBounce(role, staffRole, pathname)` that lets a desk job stay anywhere *inside* its own room — without that, the existing rule already bounces an accounts officer from `/app/pay/month` back to `/app/pay` (every Pay tab is a sub-route). The enquiry detail is in-page state on `/app/enquiries`, not a route, so the room is one path. The sidebar draws only the desk's own room (`deskModel`), and the profile door points a desk job at `/staff/profile` (the staff layout already admits every STAFF there) — otherwise every link in the menu bounces.
- **The enum migration.** `20260904170000_enquiry_stages` put its `ADD VALUE`s in a file of their own because Prisma wraps each migration in a transaction and a new value cannot be used before commit. This plan does the same: `20261006_000000_admissions_enum_values` holds only the two `ADD VALUE` statements; `20261006_000100_enquiry_lead_fields` adds the type and columns and uses neither new value.
- **`STAGE_ORDER` lives in `packages/types/src/admissions/pipeline.ts`.** `@skoolos/types` is already a dependency of api, web and mobile (`package.json` of each), and the api jest config maps it; the sports permissions follow the same pattern.
- **Owner validation.** `PATCH ownerUserId` must be a desk member of this school (`isAdmissionsDesk` — an active ADMISSIONS staff row, or an active SCHOOL_ADMIN user) — checked only when the owner actually changes, so a PATCH of the follow-up date on a lead whose owner has since left still works.
- **Telling the course card apart.** The flip card sends `source: 'COURSE_CARD'`; `SubmitEnquiryDto.source` accepts only `WEBSITE | COURSE_CARD` (a public caller cannot claim WALK_IN). Missing = `WEBSITE`. The migration back-fills existing rows whose `parentName` is the card's fixed marker `'Course card lead'`.
- **A contact is logged with its outcome, in one request.** Tapping Call/WhatsApp opens `tel:`/`wa.me` and the outcome sheet; choosing Contacted · Interested · No answer · Lost writes the CALL/WHATSAPP note, stamps `lastContactedAt`, and moves the stage. "No answer" stamps the attempt and does NOT move a NEW lead to CONTACTED. "Not now" closes the sheet and writes nothing (the same meaning as Tier B's WhatsApp "Not now").

## Global Constraints

- Tier A only. No WhatsApp or notification send, no `ENQUIRY_RECEIVED`, no same-phone dedupe, no honeypot or `toE164`, no mobile Leads/Pipeline tabs, no Create-student link.
- Job label: **"Admissions officer"**. Copy is plain English an Indian school office reads at a glance.
- Migrations are written and committed, **never applied to staging or production by a task**. The e2e suite applies them to its own test database only. The owner runs `db-migrate` (staging) **before** the PR is merged; both migrations are expand-only, so the code currently deployed keeps working on the new schema.
- `ALTER TYPE … ADD VALUE` lives in a migration file with nothing else in it.
- Every new `Enquiry` column is nullable or has a database DEFAULT — an older writer and an older backup (`apps/api/src/modules/backups/engine/import.ts` `applyRows` refuses a NOT NULL column with no default) must both keep working. No `DROP`, no `DISABLE ROW LEVEL SECURITY`: `Enquiry` is a tenant table and keeps its policy.
- Every enquiry enum list (`ENQUIRY_STAGES`, `STAGE_ORDER`, `ENQUIRY_SOURCES`, `PUBLIC_SOURCES`, `DESK_SOURCES`, `CONTACT_KINDS`, `CONTACT_OUTCOMES`) is declared once in `packages/types/src/admissions/pipeline.ts` and imported from `@skoolos/types`.
- API: Prisma types from `@skoolos/db`; every tenant query inside `withTenant`; every list capped with `LIST_CEILING`; no import from another module's `internal/`.
- Error codes: `NOT_ADMISSIONS_DESK` (403), `ENQUIRY_STAGE_BACKWARDS` (409), `ENQUIRY_OWNER_NOT_DESK` (400).
- `POST /public/enquiry` keeps its 5/min/IP throttle and its behaviour; its only change is the optional `source`. `forbidNonWhitelisted: true` (`apps/api/src/app.module.ts:122`) means the API must be deployed with or before the web change that sends `source`.
- Web: `const host = useHost(); const api = useApi({ audience: 'school', hostHeader: host });` and `enabled: !!host` on every query. Console UI uses the `.sk-*` kit and `var(--sk-*)` tokens only; a drawer is `Overlay` from `components/ui/kit.tsx` (`sk-kit.test.ts` refuses a new `createPortal`). Before Tasks 8–9, load the `sckools-ui-taste` and `ui-mistake-ledger` skills.
- Mobile: `jobFor` treats ADMISSIONS as GENERAL until Tier C adds its tabs.
- Never `git add -A`; stage the paths each commit step names. `pnpm preflight` green before the push. PR to `staging`; the plan does not merge it.

## Review Focus

1. **The migration lands before the code, or an older backup is restored onto the new schema** — the currently deployed `POST /public/enquiry` keeps inserting, and a pre-migration `.sckools` archive keeps restoring, because every new column is nullable or defaulted and the enum file holds nothing but `ADD VALUE`. Pinned in Task 2 by `packages/db/src/admissions-migration.spec.ts`.
2. **An officer rings a NEW family and nobody answers** — the call is logged and `lastContactedAt` stamped, but the lead stays NEW (it must not read as "contacted" in the never-contacted tile). Pinned in Task 1 (`contactTarget`) and Task 5 (`logContact`).
3. **An officer leaves (Staff made inactive)** — their open leads show under **Unowned**, the owner picker shows "… — no longer on the desk" instead of silently reading "Nobody yet", and a PATCH that does not change that owner still saves. Pinned in Task 3 (`ownerOnDesk`), Task 4 (owner re-check only on change), Task 6 (`UNOWNED` filter) and Task 9 (picker).
4. **A family types `=HYPERLINK(...)`, or a message with commas, quotes and line breaks, into the public form, and the officer exports CSV** — no cell runs as a formula, no column shifts. Pinned in Task 6 (`leadsCsv`).
5. **`GET /site/enquiries/owners` is declared after `GET /site/enquiries/:id`** — `ParseUUIDPipe` would answer the owner picker with a 400 on every school. Pinned in Task 3 (declaration order) and Task 5 (e2e 200).

---

### Task 1: The pipeline rules, once, in `@skoolos/types`

**Files:**
- Create: `packages/types/src/admissions/pipeline.ts`
- Create: `packages/types/src/admissions/pipeline.spec.ts`
- Modify: `packages/types/src/index.ts:612-616` (add one export line beside the sports/payroll exports)

**Interfaces:**
- Produces (all exported from `@skoolos/types`):
  - `ENQUIRY_STAGES` = `['NEW','CONTACTED','INTERESTED','VISITED','APPLIED','ENROLLED','LOST','CLOSED'] as const`; `type EnquiryStageValue`
  - `STAGE_ORDER` = `['NEW','CONTACTED','INTERESTED','VISITED','APPLIED','ENROLLED'] as const`; `type PipelineStage`
  - `ENQUIRY_SOURCES`, `type EnquirySourceValue`; `PUBLIC_SOURCES` (`WEBSITE`,`COURSE_CARD`), `type PublicSource`; `DESK_SOURCES` (`WALK_IN`,`PHONE`), `type DeskSource`; `ENQUIRY_SOURCE_LABEL: Record<EnquirySourceValue, string>`
  - `CONTACT_KINDS` (`CALL`,`WHATSAPP`,`VISIT`), `type ContactKind`; `CONTACT_OUTCOMES` (`CONTACTED`,`INTERESTED`,`NO_ANSWER`,`LOST`), `type ContactOutcome`
  - `type StageMove = 'SAME' | 'FORWARD' | 'LOSE' | 'REOPEN' | 'BACKWARDS'`
  - `stageMove(from: EnquiryStageValue, to: EnquiryStageValue): StageMove`
  - `forwardStages(from: EnquiryStageValue): PipelineStage[]`
  - `contactTarget(from: EnquiryStageValue, outcome?: ContactOutcome): EnquiryStageValue | null`
  - `interface EnquiryDeskMember { userId: string; name: string; job: 'ADMISSIONS' | 'ADMIN' }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/types/src/admissions/pipeline.spec.ts
import {
  CONTACT_OUTCOMES, DESK_SOURCES, ENQUIRY_SOURCES, ENQUIRY_SOURCE_LABEL, PUBLIC_SOURCES, STAGE_ORDER,
  contactTarget, forwardStages, stageMove,
} from './pipeline';

/**
 * One road, walked forward. These rules are read by the API (which refuses a
 * backward move with 409) and by the desk (which only draws the moves the API
 * will take), so a test here is a test of both.
 */
describe('where a lead may go next', () => {
  it('puts INTERESTED between Contacted and Visited', () => {
    expect(STAGE_ORDER).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
  });

  it('moves forward, including a jump over a stage', () => {
    expect(stageMove('NEW', 'CONTACTED')).toBe('FORWARD');
    expect(stageMove('CONTACTED', 'VISITED')).toBe('FORWARD');
    expect(stageMove('NEW', 'ENROLLED')).toBe('FORWARD');
  });

  it('refuses every step backwards', () => {
    expect(stageMove('VISITED', 'CONTACTED')).toBe('BACKWARDS');
    expect(stageMove('ENROLLED', 'NEW')).toBe('BACKWARDS');
    expect(stageMove('INTERESTED', 'CONTACTED')).toBe('BACKWARDS');
  });

  it('lets a lead be lost from any stage — an enrolled family can still withdraw', () => {
    for (const from of [...STAGE_ORDER, 'CLOSED'] as const) expect(stageMove(from, 'LOST')).toBe('LOSE');
  });

  it('reopens a lost lead to Contacted and nowhere else', () => {
    expect(stageMove('LOST', 'CONTACTED')).toBe('REOPEN');
    expect(stageMove('CLOSED', 'CONTACTED')).toBe('REOPEN');
    expect(stageMove('LOST', 'VISITED')).toBe('BACKWARDS');
    expect(stageMove('LOST', 'NEW')).toBe('BACKWARDS');
  });

  it('never writes the retired CLOSED', () => {
    expect(stageMove('NEW', 'CLOSED')).toBe('BACKWARDS');
    expect(stageMove('LOST', 'CLOSED')).toBe('BACKWARDS');
  });

  it('calls an unchanged stage SAME, so a repeated click is not a 409', () => {
    expect(stageMove('VISITED', 'VISITED')).toBe('SAME');
  });

  it('lists only the stages ahead, and none for a lost lead', () => {
    expect(forwardStages('CONTACTED')).toEqual(['INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
    expect(forwardStages('ENROLLED')).toEqual([]);
    expect(forwardStages('LOST')).toEqual([]);
    expect(forwardStages('CLOSED')).toEqual([]);
  });
});

describe('what a logged call does to the stage', () => {
  it('a first contact moves NEW to Contacted', () => {
    expect(contactTarget('NEW')).toBe('CONTACTED');
    expect(contactTarget('NEW', 'CONTACTED')).toBe('CONTACTED');
  });

  it('a call nobody answered moves nothing — the family was not contacted', () => {
    expect(contactTarget('NEW', 'NO_ANSWER')).toBeNull();
    expect(contactTarget('CONTACTED', 'NO_ANSWER')).toBeNull();
  });

  it('Interested moves forward to Interested, never backwards', () => {
    expect(contactTarget('NEW', 'INTERESTED')).toBe('INTERESTED');
    expect(contactTarget('CONTACTED', 'INTERESTED')).toBe('INTERESTED');
    expect(contactTarget('VISITED', 'INTERESTED')).toBeNull();
  });

  it('Lost loses an open lead and leaves a lost one alone', () => {
    expect(contactTarget('INTERESTED', 'LOST')).toBe('LOST');
    expect(contactTarget('LOST', 'LOST')).toBeNull();
  });

  it('a contact on a lead already past New leaves the stage alone', () => {
    expect(contactTarget('VISITED')).toBeNull();
    expect(contactTarget('LOST', 'CONTACTED')).toBeNull();
  });

  it('offers the four answers the WhatsApp buttons will offer in Tier B', () => {
    expect(CONTACT_OUTCOMES).toEqual(['CONTACTED', 'INTERESTED', 'NO_ANSWER', 'LOST']);
  });
});

describe('where a lead came from', () => {
  it('lets the public form claim only the two website doors, and the desk only walk-in and phone', () => {
    for (const s of [...PUBLIC_SOURCES, ...DESK_SOURCES]) expect(ENQUIRY_SOURCES).toContain(s);
    expect(PUBLIC_SOURCES).toEqual(['WEBSITE', 'COURSE_CARD']);
    expect(DESK_SOURCES).toEqual(['WALK_IN', 'PHONE']);
  });

  it('names every source in plain words', () => {
    for (const s of ENQUIRY_SOURCES) expect(ENQUIRY_SOURCE_LABEL[s]).toMatch(/^[A-Z][A-Za-z -]+$/);
    expect(ENQUIRY_SOURCE_LABEL.WALK_IN).toBe('Walk-in');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @skoolos/types test -- admissions`
Expected: FAIL — `Cannot find module './pipeline'`.

- [ ] **Step 3: Write the module**

```ts
// packages/types/src/admissions/pipeline.ts
/**
 * THE ADMISSIONS PIPELINE — one set of rules for the API that enforces them
 * and the desk that draws them.
 *
 * Before this, any stage could be set from any other, backwards included, and
 * the desk drew every stage as a button. A family "Visited" last week could be
 * clicked back to "New" by a slip of the mouse, and the history would say so.
 * The road now runs one way; LOST is the only exit and CONTACTED the only way
 * back in.
 */

/** Every value `Enquiry.status` may hold. CLOSED is the retired three-state word, read as Lost and never written. */
export const ENQUIRY_STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED', 'LOST', 'CLOSED'] as const;
export type EnquiryStageValue = (typeof ENQUIRY_STAGES)[number];

/** The forward road, in the order a family walks it. LOST and CLOSED are off it. */
export const STAGE_ORDER = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED'] as const;
export type PipelineStage = (typeof STAGE_ORDER)[number];

/** Where a lead came from — `Enquiry.source`. */
export const ENQUIRY_SOURCES = ['WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE', 'WHATSAPP', 'REFERRAL'] as const;
export type EnquirySourceValue = (typeof ENQUIRY_SOURCES)[number];

/** What `POST /public/enquiry` may claim. A stranger cannot say they walked in. */
export const PUBLIC_SOURCES = ['WEBSITE', 'COURSE_CARD'] as const;
export type PublicSource = (typeof PUBLIC_SOURCES)[number];

/** What the desk's own "Add enquiry" may claim. WHATSAPP and REFERRAL wait for the inbox and a referral field. */
export const DESK_SOURCES = ['WALK_IN', 'PHONE'] as const;
export type DeskSource = (typeof DESK_SOURCES)[number];

export const ENQUIRY_SOURCE_LABEL: Record<EnquirySourceValue, string> = {
  WEBSITE: 'Website',
  COURSE_CARD: 'Course card',
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  WHATSAPP: 'WhatsApp',
  REFERRAL: 'Referral',
};

/** `EnquiryNote.kind` values that record somebody reaching the family. */
export const CONTACT_KINDS = ['CALL', 'WHATSAPP', 'VISIT'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** The answers after a contact — the desk's sheet now, the WhatsApp buttons in Tier B. */
export const CONTACT_OUTCOMES = ['CONTACTED', 'INTERESTED', 'NO_ANSWER', 'LOST'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export type StageMove = 'SAME' | 'FORWARD' | 'LOSE' | 'REOPEN' | 'BACKWARDS';

const isLost = (s: EnquiryStageValue): boolean => s === 'LOST' || s === 'CLOSED';
const rank = (s: EnquiryStageValue): number => (STAGE_ORDER as readonly string[]).indexOf(s);

/** What kind of move `from → to` is. The API refuses BACKWARDS with 409 ENQUIRY_STAGE_BACKWARDS. */
export function stageMove(from: EnquiryStageValue, to: EnquiryStageValue): StageMove {
  if (from === to) return 'SAME';
  if (to === 'CLOSED') return 'BACKWARDS';
  if (to === 'LOST') return 'LOSE';
  if (isLost(from)) return to === 'CONTACTED' ? 'REOPEN' : 'BACKWARDS';
  return rank(to) > rank(from) ? 'FORWARD' : 'BACKWARDS';
}

/** The stages a desk button may move to from here. A lost lead has none — it is reopened instead. */
export function forwardStages(from: EnquiryStageValue): PipelineStage[] {
  if (isLost(from)) return [];
  return STAGE_ORDER.filter((s) => rank(s) > rank(from));
}

/**
 * The stage a logged contact moves a lead to, or null for none.
 *
 * NO_ANSWER moves nothing: a call that rang out did not contact anybody, and a
 * NEW lead that read "Contacted" after it would drop out of the never-contacted
 * count — the one that tells the office who has not been rung.
 */
export function contactTarget(from: EnquiryStageValue, outcome?: ContactOutcome): EnquiryStageValue | null {
  if (outcome === 'NO_ANSWER') return null;
  if (outcome === 'LOST') return isLost(from) ? null : 'LOST';
  if (outcome === 'INTERESTED') return stageMove(from, 'INTERESTED') === 'FORWARD' ? 'INTERESTED' : null;
  return from === 'NEW' ? 'CONTACTED' : null;
}

/** Somebody who may own a lead: an active admissions officer, or a school admin. */
export interface EnquiryDeskMember {
  userId: string;
  name: string;
  job: 'ADMISSIONS' | 'ADMIN';
}
```

Then in `packages/types/src/index.ts`, after the line `export * from './fees/receipt';` add:

```ts
export * from './admissions/pipeline';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @skoolos/types test -- admissions && pnpm --filter @skoolos/types typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/admissions/pipeline.ts packages/types/src/admissions/pipeline.spec.ts packages/types/src/index.ts
git commit -m "feat(types): the admissions pipeline rules, once — forward-only stages, sources, contact outcomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The job and the lead fields in the database, the DTO, the job picker and the app

**Files:**
- Modify: `packages/db/prisma/schema.prisma:179-187` (enum `EnquiryStatus`), `:200-226` (enum `StaffRole`), `:2088-2117` (model `Enquiry`), `:2127` (EnquiryNote `kind` comment); add enum `EnquirySource` directly after `EnquiryStatus`
- Create: `packages/db/prisma/migrations/20261006_000000_admissions_enum_values/migration.sql`
- Create: `packages/db/prisma/migrations/20261006_000100_enquiry_lead_fields/migration.sql`
- Create: `packages/db/src/admissions-migration.spec.ts`
- Modify: `apps/api/src/modules/management/management.dto.ts:308` (`STAFF_ROLES`)
- Modify: `apps/web/app/app/staff/page.tsx:14-31` (`STAFF_ROLES`, `ROLE_LABELS`), `:108` (release sentence), `:443-447` (comment on `allowedRoles`), `:694` (job colour)
- Modify: `apps/web/app/app/staff/staff-roles.test.ts` (one new `it`)
- Modify: `apps/web/app/staff/profile/page.tsx:15-25` (`STAFF_ROLE_LABEL`)
- Modify: `apps/mobile/src/app/(worker)/(tabs)/today/index.tsx:70-80` (`STAFF_ROLE_LABEL`)
- Modify: `apps/mobile/src/lib/worker-nav.ts:19-32` (`jobFor` comment)
- Modify: `apps/mobile/src/lib/__tests__/worker-nav.test.ts` (one new `it`)

**Interfaces:**
- Consumes: nothing from Task 1 (the SQL and Prisma enums are spelled out; Task 3+ ties them to `@skoolos/types`).
- Produces: Prisma `StaffRole.ADMISSIONS`, `EnquiryStatus.INTERESTED`, enum `EnquirySource`, `Enquiry.source: EnquirySource` (default WEBSITE), `Enquiry.childName: string | null`, `Enquiry.whatsappOk: boolean` (default false), `Enquiry.lastContactedAt: Date | null`, `Enquiry.updatedAt: Date`. The API DTO accepts `role: 'ADMISSIONS'` on create/update staff.

- [ ] **Step 1: Write the failing migration guard**

```ts
// packages/db/src/admissions-migration.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ADMISSIONS MIGRATIONS ARE EXPAND-ONLY, AND THIS IS WHAT HOLDS THEM TO IT.
 *
 * They are applied by the owner through the db-migrate workflow BEFORE the code
 * that uses them is merged. Between those two moments the deployed API keeps
 * inserting website enquiries with no idea these columns exist, and any backup
 * taken before today can be restored onto the new schema — `applyRows` in the
 * backup engine refuses a NOT NULL column that has no default. So every column
 * must be optional to a writer that does not know it.
 *
 * And an enum value cannot be USED in the transaction that adds it (Prisma
 * wraps each migration in one), so the ADD VALUEs sit in a file of their own —
 * the 20260904170000_enquiry_stages precedent.
 */
const DIR = join(__dirname, '..', 'prisma', 'migrations');
const read = (name: string): string => readFileSync(join(DIR, name, 'migration.sql'), 'utf8');
/** The SQL with its `--` comment lines removed, so prose cannot satisfy or trip a check. */
const code = (src: string): string => src.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const ENUMS = '20261006_000000_admissions_enum_values';
const COLUMNS = '20261006_000100_enquiry_lead_fields';

describe('the admissions migrations', () => {
  it('adds the two enum values in a file of their own, and nothing else', () => {
    const statements = code(read(ENUMS)).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    expect(statements).toEqual([
      `ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMISSIONS'`,
      `ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'INTERESTED' BEFORE 'VISITED'`,
    ]);
  });

  it('never uses a value in the same file that adds it', () => {
    expect(code(read(COLUMNS))).not.toMatch(/INTERESTED|ADMISSIONS/);
  });

  it('adds exactly the five lead columns', () => {
    const names = [...code(read(COLUMNS)).matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(['childName', 'lastContactedAt', 'source', 'updatedAt', 'whatsappOk']);
  });

  it('every column an older writer leaves out is nullable or has a default', () => {
    const sql = code(read(COLUMNS));
    const adds = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"\s+([^,;]+)/g)];
    expect(adds.length).toBe(5);
    for (const [, name, definition] of adds) {
      const notNull = /NOT NULL/.test(definition) || new RegExp(`"${name}" SET NOT NULL`).test(sql);
      const hasDefault = /DEFAULT/.test(definition) || new RegExp(`"${name}" SET DEFAULT`).test(sql);
      expect({ name, safe: !notNull || hasDefault }).toEqual({ name, safe: true });
    }
  });

  it('drops nothing and leaves row-level security alone', () => {
    const all = code(read(ENUMS)) + code(read(COLUMNS));
    expect(all).not.toMatch(/\bDROP\b/i);
    expect(all).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(all).not.toMatch(/\bPOLICY\b/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @skoolos/db test -- admissions-migration`
Expected: FAIL — `ENOENT: no such file or directory … 20261006_000000_admissions_enum_values/migration.sql`.

- [ ] **Step 3: Write the two migrations**

```sql
-- packages/db/prisma/migrations/20261006_000000_admissions_enum_values/migration.sql
--
-- The admissions officer's two new words get a migration to themselves, on
-- purpose — the same reasoning as 20260904170000_enquiry_stages.
--
-- ALTER TYPE ... ADD VALUE succeeds inside a transaction, so it LOOKS safe to
-- bundle with the columns that follow — but a new value cannot be REFERENCED
-- until that transaction commits, and Prisma wraps each migration in one.
--
-- Nothing else belongs in this file. The first row carrying either value is
-- written by the application, long after this has committed.
--
-- INTERESTED goes BEFORE VISITED so ORDER BY status reads in pipeline order.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMISSIONS';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'INTERESTED' BEFORE 'VISITED';
```

```sql
-- packages/db/prisma/migrations/20261006_000100_enquiry_lead_fields/migration.sql
--
-- A lead learns where it came from, who it is for, whether the family may be
-- sent a WhatsApp, and when somebody last reached them.
--
-- EXPAND ONLY. Every column is nullable or carries a DEFAULT, so the API that
-- is deployed while this runs keeps inserting website enquiries untouched, and
-- a backup taken before today restores onto this schema (the backup engine
-- refuses a NOT NULL column with no default). Nothing is dropped; Enquiry keeps
-- its tenant_iso policy — adding a column never touches a policy.
--
-- RLS: no new table. Grants: none needed.

DO $$ BEGIN
  CREATE TYPE "EnquirySource" AS ENUM ('WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE', 'WHATSAPP', 'REFERRAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Enquiry"
    ADD COLUMN IF NOT EXISTS "source"          "EnquirySource" NOT NULL DEFAULT 'WEBSITE',
    ADD COLUMN IF NOT EXISTS "childName"       TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappOk"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3);

-- Back-fill before the NOT NULL, so an old lead says when it was made rather
-- than when this migration ran.
UPDATE "Enquiry" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Enquiry"
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updatedAt" SET NOT NULL;

-- The homepage course card has always posted with this fixed parent name,
-- because it asks for a phone number only. Those leads came from the card.
UPDATE "Enquiry" SET "source" = 'COURSE_CARD'
 WHERE "parentName" = 'Course card lead' AND "source" = 'WEBSITE';
```

- [ ] **Step 4: Change the schema to match**

In `packages/db/prisma/schema.prisma`, replace the `EnquiryStatus` enum body (lines 179-187) with:

```prisma
enum EnquiryStatus {
  NEW
  CONTACTED
  /// The family said yes on the phone and has not come in yet.
  INTERESTED
  VISITED
  APPLIED
  ENROLLED
  CLOSED
  LOST
}

/// Where a lead came from. WEBSITE and COURSE_CARD arrive through the public
/// form; WALK_IN and PHONE are typed at the desk; WHATSAPP and REFERRAL are
/// reserved for the Messages inbox and a referral field that do not exist yet.
enum EnquirySource {
  WEBSITE
  COURSE_CARD
  WALK_IN
  PHONE
  WHATSAPP
  REFERRAL
}
```

In `enum StaffRole`, between the `ACCOUNTS` doc block/value and `OTHER`, add:

```prisma
  /// Runs admissions (/app/enquiries) — the same door pattern as ACCOUNTS.
  /// The login stays STAFF; /auth/me's staffRole lands it on the enquiries
  /// desk and AdmissionsDeskGuard lets it through /site/enquiries/*.
  ADMISSIONS
```

In `model Enquiry`, replace the line `  createdAt     DateTime      @default(now())` with:

```prisma
  /// Who the family is asking FOR. Optional free text — a walk-in often gives
  /// the parent's name before the child's.
  childName       String?
  source          EnquirySource @default(WEBSITE)
  /// The family agreed the school may WhatsApp them. Nothing sends on it in
  /// Tier A; the acknowledgement in Tier B reads it.
  whatsappOk      Boolean       @default(false)
  /// The last CALL / WHATSAPP / VISIT note's time. An attempt counts: a call
  /// nobody answered still stamps this, and still does not move the stage.
  lastContactedAt DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @default(now()) @updatedAt
```

In `model EnquiryNote`, replace the comment `/// NOTE (a person wrote it) | STAGE (the pipeline moved) | SYSTEM (we did it)` with:

```prisma
  /// NOTE (a person wrote it) | STAGE (the pipeline moved) | SYSTEM (we did it)
  /// | CALL | WHATSAPP | VISIT (somebody reached the family — sets lastContactedAt)
```

- [ ] **Step 5: Run the guard, validate and regenerate**

Run: `pnpm --filter @skoolos/db test -- admissions-migration && pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db generate`
Expected: PASS; "The schema at prisma/schema.prisma is valid"; client generated.

- [ ] **Step 6: Watch the drift guard catch the half-added job**

Run: `pnpm --filter @skoolos/web test -- app/app/staff/staff-roles.test.ts`
Expected: FAIL — "the API accepts exactly what the database allows": the schema has `ADMISSIONS`, the DTO does not.

- [ ] **Step 7: Add the job to the API, the console and both label maps**

`apps/api/src/modules/management/management.dto.ts:308`:

```ts
const STAFF_ROLES = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'LIBRARIAN', 'SPORTS', 'ACCOUNTS', 'ADMISSIONS', 'OTHER'] as const;
```

`apps/web/app/app/staff/page.tsx` — the list and labels:

```ts
const STAFF_ROLES = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'LIBRARIAN', 'SPORTS', 'ACCOUNTS', 'ADMISSIONS', 'OTHER'] as const;
```

and in `ROLE_LABELS` after `ACCOUNTS: 'Accounts officer',` add `ADMISSIONS: 'Admissions officer',`.

The release sentence at line 108 becomes:

```tsx
            {member.role === 'LIBRARIAN' ? ', and the library counter with it' : member.role === 'SPORTS' ? ', and the sports desk with it' : member.role === 'ACCOUNTS' ? ', and their way into Pay with it' : member.role === 'ADMISSIONS' ? ', and the admissions desk with it — their open leads move to Unowned' : ''}.
```

Above `const allowedRoles = …` (line 445) add one comment line, leaving the expression itself unchanged:

```ts
  // Admissions officer is offered at every school: ENQUIRY is in every tier.
```

The job colour at line 694:

```tsx
                        color: member.role === 'LIBRARIAN' || member.role === 'SPORTS' || member.role === 'ACCOUNTS' || member.role === 'ADMISSIONS' ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
```

`apps/web/app/staff/profile/page.tsx` — in `STAFF_ROLE_LABEL` after `ACCOUNTS: 'Accounts officer',` add `ADMISSIONS: 'Admissions officer',`.

`apps/mobile/src/app/(worker)/(tabs)/today/index.tsx` — in `STAFF_ROLE_LABEL` after `ACCOUNTS: 'Accounts officer',` add `ADMISSIONS: 'Admissions officer',`.

- [ ] **Step 8: Pin "always offered" beside the drift guard**

Append inside the `describe` in `apps/web/app/app/staff/staff-roles.test.ts`:

```ts
  it('offers the admissions officer at every school — ENQUIRY is in every tier', () => {
    // LIBRARIAN, SPORTS and ACCOUNTS hide where the school lacks their module.
    // Admissions has no module to lack, so the filter must never name it.
    const at = consoleSrc.indexOf('const allowedRoles');
    expect(at).toBeGreaterThan(-1);
    expect(consoleSrc.slice(at, at + 300)).not.toContain("'ADMISSIONS'");
  });
```

- [ ] **Step 9: Say what the app does with the job until Tier C**

In `apps/mobile/src/lib/worker-nav.ts`, inside `jobFor`, directly above `return 'GENERAL';` add:

```ts
  // ADMISSIONS falls through to GENERAL on purpose: the Leads and Pipeline
  // tabs arrive in Tier C of the admissions design. Until then an officer has
  // Today and Profile here, and works the desk on the web (/app/enquiries).
```

Append to `describe('worker desks', …)` in `apps/mobile/src/lib/__tests__/worker-nav.test.ts`:

```ts
  it('an admissions officer is general staff in the app until the Leads tabs ship (Tier C)', () => {
    // Passes the moment it is written — it pins the behaviour, so the Tier C
    // change has to come here and change it on purpose.
    const s = { staffRole: 'ADMISSIONS', features: ['ENQUIRY', 'MANAGEMENT'] };
    expect(jobFor(s)).toBe('GENERAL');
    expect(tabNamesFor(s)).toEqual(['today', 'profile']);
  });
```

- [ ] **Step 10: Run everything this task touched**

Run:
```bash
pnpm --filter @skoolos/web test -- app/app/staff/staff-roles.test.ts
pnpm --filter @skoolos/mobile test -- worker-nav
pnpm --filter @skoolos/api typecheck && pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/mobile typecheck
```
Expected: all PASS, typecheck clean (`staff-attendance.service.ts` types `role` with the DTO's `StaffRoleValue`, so a missing DTO value is a compile error here too).

- [ ] **Step 11: Commit**

```bash
git add packages/db/prisma/schema.prisma \
  packages/db/prisma/migrations/20261006_000000_admissions_enum_values/migration.sql \
  packages/db/prisma/migrations/20261006_000100_enquiry_lead_fields/migration.sql \
  packages/db/src/admissions-migration.spec.ts \
  apps/api/src/modules/management/management.dto.ts \
  apps/web/app/app/staff/page.tsx apps/web/app/app/staff/staff-roles.test.ts \
  apps/web/app/staff/profile/page.tsx \
  "apps/mobile/src/app/(worker)/(tabs)/today/index.tsx" \
  apps/mobile/src/lib/worker-nav.ts apps/mobile/src/lib/__tests__/worker-nav.test.ts
git commit -m "feat(admissions): the ADMISSIONS job and the lead fields (source, child, WhatsApp ok, last contacted)

Two expand-only migrations, user-run before merge: the enum values alone,
then the columns — every one nullable or defaulted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The desk door — `AdmissionsDeskGuard`, `isAdmissionsDesk`, and `GET /site/enquiries/owners`

**Files:**
- Create: `apps/api/src/modules/public/internal/admissions-desk.guard.ts`
- Create: `apps/api/src/modules/public/internal/admissions-desk.guard.spec.ts`
- Create: `apps/api/src/modules/public/enquiry-admin.authz.spec.ts`
- Modify: `apps/api/src/modules/public/enquiry-admin.controller.ts` (guards, roles, `owners` handler)
- Modify: `apps/api/src/modules/public/enquiry.service.ts` (`deskMembers`, `owners`, `list` gains `ownerOnDesk`)
- Modify: `apps/api/src/modules/public/enquiry-desk.service.spec.ts` (txMock + a new `describe`)
- Modify: `apps/api/src/modules/public/public.module.ts` (provider)
- Modify: `apps/api/src/modules/public/index.ts` (barrel)
- Modify: `apps/api/src/common/errors/api-error.ts:288` (codes)
- Modify: `apps/api/test/route-manifest.ts` (one reviewed route)

**Interfaces:**
- Consumes: `EnquiryDeskMember` from `@skoolos/types` (Task 1); Prisma `StaffRole.ADMISSIONS` (Task 2).
- Produces:
  - `isAdmissionsDesk(db: Pick<TenantTx, 'staff' | 'user'>, schoolId: string, userId: string): Promise<boolean>` — exported from `apps/api/src/modules/public` (barrel) for Tier B's inbound resolver.
  - `class AdmissionsDeskGuard implements CanActivate` (403 `NOT_ADMISSIONS_DESK`).
  - `deskMembers(tx: Pick<TenantTx, 'staff' | 'user'>, schoolId: string): Promise<EnquiryDeskMember[]>` (module function in `enquiry.service.ts`).
  - `EnquiryService.owners(schoolId: string): Promise<EnquiryDeskMember[]>`.
  - `EnquiryService.list(schoolId)` rows gain `ownerOnDesk: boolean`.
  - `GET /site/enquiries/owners`.
  - Error codes `NOT_ADMISSIONS_DESK`, `ENQUIRY_STAGE_BACKWARDS`, `ENQUIRY_OWNER_NOT_DESK` (the last two used in Task 4).

- [ ] **Step 1: Write the failing guard spec**

```ts
// apps/api/src/modules/public/internal/admissions-desk.guard.spec.ts
import 'reflect-metadata';

const txMock = { staff: { findFirst: jest.fn() }, user: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { AdmissionsDeskGuard, isAdmissionsDesk } from './admissions-desk.guard';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ctxFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
const guard = () => new AdmissionsDeskGuard({ requireTenant: () => ({ schoolId: SCHOOL }) } as never);

beforeEach(() => {
  jest.clearAllMocks();
  txMock.staff.findFirst.mockResolvedValue(null);
  txMock.user.findFirst.mockResolvedValue(null);
});

/** THE DOOR, not the right — the same shape as LeaveDeskGuard and SportsDeskGuard. */
describe('who may open the admissions desk', () => {
  it('lets a school admin through without a lookup', async () => {
    expect(await guard().canActivate(ctxFor({ role: 'SCHOOL_ADMIN', sub: 'u1', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it('lets an active admissions officer through', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    expect(await guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u2', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, userId: 'u2', role: 'ADMISSIONS', isActive: true },
      select: { id: true },
    });
  });

  it("refuses an accounts officer — another desk's job does not open this one", async () => {
    let caught: unknown;
    try {
      await guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u3', schoolId: SCHOOL }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(403);
    expect(((caught as ApiError).getResponse() as { code: string }).code).toBe('NOT_ADMISSIONS_DESK');
  });

  it('refuses a request with no signed-in user at all', async () => {
    expect(await guard().canActivate(ctxFor(undefined))).toBe(false);
  });
});

describe('isAdmissionsDesk — one rule for the door, the owner picker and (Tier B) WhatsApp', () => {
  it('is true for an active admissions officer of this school', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u2')).toBe(true);
    expect(txMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('is true for an active admin login of this school', async () => {
    txMock.user.findFirst.mockResolvedValue({ id: 'u1' });
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u1')).toBe(true);
    expect(txMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', schoolId: SCHOOL, role: 'SCHOOL_ADMIN', isActive: true },
      select: { id: true },
    });
  });

  it('is false for anybody else — a driver, a teacher, an officer made inactive', async () => {
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u9')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing controller authz spec**

```ts
// apps/api/src/modules/public/enquiry-admin.authz.spec.ts
import 'reflect-metadata';
import { EnquiryAdminController } from './enquiry-admin.controller';
import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

/**
 * /site/enquiries hands back families' names and phone numbers. It used to be
 * SCHOOL_ADMIN-only; now an admissions officer — a STAFF login — works it too.
 * Written against guard metadata (the ops.authz.spec pattern) so it runs in the
 * unit job; admissions-desk.e2e-spec.ts proves the same against a database.
 */
describe('/site/enquiries authorization', () => {
  const guards = Reflect.getMetadata('__guards__', EnquiryAdminController) ?? [];

  it('runs the school token, the role list and the desk guard, in that order', () => {
    expect(guards).toEqual([SchoolJwtGuard, RolesGuard, AdmissionsDeskGuard]);
  });

  it('lets SCHOOL_ADMIN and STAFF reach the desk guard, which narrows STAFF to the job', () => {
    expect(Reflect.getMetadata(ROLES_KEY, EnquiryAdminController)).toEqual(['SCHOOL_ADMIN', 'STAFF']);
  });

  it('no handler replaces the class role list', () => {
    const proto = EnquiryAdminController.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || typeof proto[name] !== 'function') continue;
      expect({ name, roles: Reflect.getMetadata(ROLES_KEY, proto[name] as object) }).toEqual({ name, roles: undefined });
    }
  });

  it('declares /owners before /:id, so "owners" never reaches ParseUUIDPipe', () => {
    const order = Object.getOwnPropertyNames(EnquiryAdminController.prototype);
    expect(order.indexOf('owners')).toBeGreaterThan(-1);
    expect(order.indexOf('owners')).toBeLessThan(order.indexOf('detail'));
  });
});
```

- [ ] **Step 3: Write the failing desk-member tests**

In `apps/api/src/modules/public/enquiry-desk.service.spec.ts`, replace the `txMock` declaration (lines 3-7) with:

```ts
const txMock = {
  enquiry: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  enquiryNote: { create: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  staff: { findMany: jest.fn(), findFirst: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
};
```

Add these constants after `const USER = …`:

```ts
const OFFICER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const GONE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ADMIN = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
```

Extend the top-level `beforeEach` (after `txMock.enquiryNote.create.mockResolvedValue({ id: 'n1' });`) — `clearAllMocks` keeps implementations, so every default is re-set here:

```ts
  txMock.staff.findFirst.mockResolvedValue(null);
  txMock.staff.findMany.mockResolvedValue([]);
  txMock.user.findFirst.mockResolvedValue(null);
  txMock.user.findMany.mockResolvedValue([]);
```

Append at the end of the file:

```ts
describe('who sits at the desk', () => {
  beforeEach(() => {
    // Officers are asked for by role; owner names for the list are asked for by user id.
    txMock.staff.findMany.mockImplementation(({ where }: { where: { role?: string } }) =>
      Promise.resolve(
        where.role === 'ADMISSIONS'
          ? [{ userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' }]
          : [
              { userId: OFFICER, firstName: 'Sunita', lastName: 'Kale' },
              { userId: GONE, firstName: 'Ravi', lastName: 'Old' },
            ],
      ),
    );
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN, name: null, email: 'office@school.test' }]);
  });

  it('is the active admissions officers, then the school admins', async () => {
    expect(await service().owners(SCHOOL)).toEqual([
      { userId: OFFICER, name: 'Sunita Kale', job: 'ADMISSIONS' },
      { userId: ADMIN, name: 'office@school.test', job: 'ADMIN' },
    ]);
    expect(txMock.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, role: 'ADMISSIONS', isActive: true, userId: { not: null } },
    }));
    expect(txMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { schoolId: SCHOOL, role: 'SCHOOL_ADMIN', isActive: true },
    }));
  });

  /**
   * An officer who leaves keeps their name on the history, but their open
   * leads are nobody's now — the desk lists them under Unowned.
   */
  it("marks a lead whose owner has left the desk, and keeps that owner's name on it", async () => {
    txMock.enquiry.findMany.mockResolvedValue([
      { id: 'a', ownerUserId: OFFICER },
      { id: 'b', ownerUserId: GONE },
      { id: 'c', ownerUserId: null },
    ]);
    txMock.enquiryNote.groupBy.mockResolvedValue([]);
    const rows = await service().list(SCHOOL);
    expect(rows.map((r) => [r.id, r.ownerOnDesk, r.ownerName])).toEqual([
      ['a', true, 'Sunita Kale'],
      ['b', false, 'Ravi Old'],
      ['c', false, null],
    ]);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @skoolos/api test -- admissions-desk.guard enquiry-admin.authz enquiry-desk.service`
Expected: FAIL — `Cannot find module './admissions-desk.guard'`, `service().owners is not a function`.

- [ ] **Step 5: Add the error codes**

In `apps/api/src/common/errors/api-error.ts`, after `  | 'NOT_LEAVE_DESK'` add:

```ts
  /** Neither a school admin nor an active admissions officer. 403. */
  | 'NOT_ADMISSIONS_DESK'
  /** A stage change against the pipeline's direction (LOST and the one reopen excepted). 409. */
  | 'ENQUIRY_STAGE_BACKWARDS'
  /** A lead given to somebody who is not an admissions officer or an admin here. 400. */
  | 'ENQUIRY_OWNER_NOT_DESK'
```

- [ ] **Step 6: Write the guard**

```ts
// apps/api/src/modules/public/internal/admissions-desk.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';

/**
 * Is this login on the admissions desk of this school?
 *
 * An active Staff row whose job is ADMISSIONS, or an active SCHOOL_ADMIN user.
 * One rule, three readers: the guard below, the owner check on PATCH (a lead
 * may only be given to somebody who can open the desk), and — in Tier B — the
 * WhatsApp resolver deciding whether a tap may act.
 *
 * Read on every call, never cached: taking the job away locks the next request.
 */
export async function isAdmissionsDesk(
  db: Pick<TenantTx, 'staff' | 'user'>,
  schoolId: string,
  userId: string,
): Promise<boolean> {
  const officer = await db.staff.findFirst({
    where: { schoolId, userId, role: 'ADMISSIONS', isActive: true },
    select: { id: true },
  });
  if (officer) return true;
  const admin = await db.user.findFirst({
    where: { id: userId, schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    select: { id: true },
  });
  return !!admin;
}

/**
 * WHO WORKS ADMISSIONS — the same door the leave, library and sports desks use.
 *
 * Runs AFTER `RolesGuard` has allowed SCHOOL_ADMIN | STAFF and narrows the STAFF
 * half to the one job that owns this work. A school admin passes without a read.
 */
@Injectable()
export class AdmissionsDeskGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;

    const { schoolId } = this.tenant.requireTenant();
    const ok = await withTenant(schoolId, (tx) => isAdmissionsDesk(tx, schoolId, user.sub));
    if (!ok) {
      throw new ApiError('NOT_ADMISSIONS_DESK', 'Only a school admin or an admissions officer can open the admissions desk.', 403);
    }
    return true;
  }
}
```

- [ ] **Step 7: Add desk members, `owners` and `ownerOnDesk` to the service**

In `apps/api/src/modules/public/enquiry.service.ts` add imports:

```ts
import type { TenantTx } from '@skoolos/db';
import type { EnquiryDeskMember } from '@skoolos/types';
```

Add this module function above `@Injectable()`:

```ts
/**
 * Who sits at the admissions desk: every active admissions officer with a
 * login, then every active school admin. The owner picker reads this, and so
 * does "Unowned" — a lead whose owner is not on this list is nobody's.
 */
export async function deskMembers(
  tx: Pick<TenantTx, 'staff' | 'user'>,
  schoolId: string,
): Promise<EnquiryDeskMember[]> {
  const officers = await tx.staff.findMany({
    where: { schoolId, role: 'ADMISSIONS', isActive: true, userId: { not: null } },
    select: { userId: true, firstName: true, lastName: true },
    orderBy: { firstName: 'asc' },
    take: LIST_CEILING.STRUCTURE,
  });
  const admins = await tx.user.findMany({
    where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: 'asc' },
    take: LIST_CEILING.STRUCTURE,
  });
  return [
    ...officers.map((o) => ({
      userId: o.userId as string,
      name: `${o.firstName} ${o.lastName}`.trim(),
      job: 'ADMISSIONS' as const,
    })),
    ...admins.map((a) => ({ userId: a.id, name: a.name?.trim() || a.email, job: 'ADMIN' as const })),
  ];
}
```

Add this method to `EnquiryService` (after `list`):

```ts
  /** The owner picker. Works on every plan — it reads no MANAGEMENT route. */
  async owners(schoolId: string): Promise<EnquiryDeskMember[]> {
    return withTenant(schoolId, (tx) => deskMembers(tx, schoolId));
  }
```

In `list`, after the `noteCount` map is built and before `return rows.map(…)`, add:

```ts
      const onDesk = new Set((await deskMembers(tx, schoolId)).map((m) => m.userId));
```

and change the row mapping to:

```ts
      return rows.map((r) => ({
        ...r,
        ownerName: r.ownerUserId ? (byUser.get(r.ownerUserId) ?? null) : null,
        // False for an owner who has left the desk — the desk shows the lead
        // under Unowned, while the name above keeps the history honest.
        ownerOnDesk: r.ownerUserId ? onDesk.has(r.ownerUserId) : false,
        noteCount: noteCount.get(r.id) ?? 0,
      }));
```

- [ ] **Step 8: Put the controller behind the desk guard and add `/owners`**

In `apps/api/src/modules/public/enquiry-admin.controller.ts` add the import:

```ts
import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';
```

Replace the class decorators and the comment above them (lines 11-18) with:

```ts
@Controller('site')
// SchoolJwtGuard establishes WHICH school you belong to and reads no role.
// RolesGuard admits SCHOOL_ADMIN and STAFF; AdmissionsDeskGuard then narrows
// STAFF to an active admissions officer. A STUDENT, PARENT or TEACHER token is
// refused by RolesGuard, a driver by the desk guard — these routes hand back
// other families' names and phone numbers.
@UseGuards(SchoolJwtGuard, RolesGuard, AdmissionsDeskGuard)
@Roles('SCHOOL_ADMIN', 'STAFF')
```

Insert this handler between `list()` and `detail()` — the position is load-bearing:

```ts
  /**
   * Who a lead can be given to. Declared BEFORE `enquiries/:id`: Express
   * matches in declaration order, and `:id`'s ParseUUIDPipe would answer the
   * word "owners" with a 400.
   */
  @Get('enquiries/owners')
  owners() {
    return this.enquiry.owners(this.sid());
  }
```

- [ ] **Step 9: Register the guard and export the rule**

`apps/api/src/modules/public/public.module.ts`: add `import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';` and change `providers` to:

```ts
  providers: [AdmissionsDeskGuard, PublicSiteService, PublicBirthdaysService, PublicRecordsService, EnquiryService, TvService],
```

`apps/api/src/modules/public/index.ts`: append

```ts
export { AdmissionsDeskGuard, isAdmissionsDesk } from './internal/admissions-desk.guard';
```

`apps/api/test/route-manifest.ts`: directly after the line `  "POST /site/enquiries/:id/notes",` add

```ts
  // Admissions desk, Oct 2026 — enquiry-admin.authz.spec.ts pins the guard
  // chain and the declaration order; admissions-desk.e2e-spec.ts proves a
  // driver is refused and an officer reads the list.
  "GET /site/enquiries/owners",
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm --filter @skoolos/api test -- admissions-desk.guard enquiry-admin.authz enquiry-desk.service && pnpm --filter @skoolos/api typecheck`
Expected: PASS (the pre-existing desk tests included), typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/public/internal/admissions-desk.guard.ts \
  apps/api/src/modules/public/internal/admissions-desk.guard.spec.ts \
  apps/api/src/modules/public/enquiry-admin.authz.spec.ts \
  apps/api/src/modules/public/enquiry-admin.controller.ts \
  apps/api/src/modules/public/enquiry.service.ts \
  apps/api/src/modules/public/enquiry-desk.service.spec.ts \
  apps/api/src/modules/public/public.module.ts apps/api/src/modules/public/index.ts \
  apps/api/src/common/errors/api-error.ts apps/api/test/route-manifest.ts
git commit -m "feat(admissions): the desk door — AdmissionsDeskGuard on /site/enquiries, and the owners list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Forward-only stages, owners on the desk, and every history line signed

**Files:**
- Modify: `apps/api/src/modules/public/enquiry.service.ts` (`STAGE_LABEL`, `update`, `addNote`, new private `author`)
- Modify: `apps/api/src/modules/public/enquiry-admin.controller.ts:29-32` (`actor`)
- Modify: `apps/api/src/modules/public/public.dto.ts:27-51` (`SetEnquiryStatusDto.status`)
- Modify: `apps/api/src/modules/public/enquiry-desk.service.spec.ts` (three new `describe`s)

**Interfaces:**
- Consumes: `stageMove`, `ENQUIRY_STAGES`, `EnquiryStageValue` (Task 1); `isAdmissionsDesk` (Task 3); codes `ENQUIRY_STAGE_BACKWARDS`, `ENQUIRY_OWNER_NOT_DESK` (Task 3).
- Produces:
  - `type Actor = { userId?: string; name?: string | null }` — when `name` is absent the service resolves it.
  - `EnquiryService.update(...)` throws `ApiError ENQUIRY_STAGE_BACKWARDS` 409 and `ENQUIRY_OWNER_NOT_DESK` 400.
  - private `EnquiryService.author(tx, schoolId, actor?) => Promise<{ userId: string | null; name: string | null }>` (used again in Task 5).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `enquiry-desk.service.spec.ts`:

```ts
import { ApiError } from '../../common/errors/api-error';
```

Add after the `service()` function:

```ts
/** The code and status an ApiError carried, or {} when the call succeeded. */
async function refusal(p: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await p;
    return {};
  } catch (e) {
    const err = e as ApiError;
    return { code: (err.getResponse() as { code?: string }).code, status: err.getStatus() };
  }
}

const at = (status: string, extra: Record<string, unknown> = {}) =>
  txMock.enquiry.findFirst.mockResolvedValue({ id: LEAD, schoolId: SCHOOL, status, lostReason: null, ownerUserId: null, ...extra });
```

Append:

```ts
describe('a lead only moves forward', () => {
  it('refuses a step backwards with 409 ENQUIRY_STAGE_BACKWARDS, and writes nothing', async () => {
    at('VISITED');
    expect(await refusal(service().update(SCHOOL, LEAD, { status: 'CONTACTED' }))).toEqual({ code: 'ENQUIRY_STAGE_BACKWARDS', status: 409 });
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });

  it('takes INTERESTED between Contacted and Visited', async () => {
    at('CONTACTED');
    await service().update(SCHOOL, LEAD, { status: 'INTERESTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', body: 'Moved to Interested' }),
    }));
  });

  it('lets an enrolled family be marked lost — a family can still withdraw', async () => {
    at('ENROLLED');
    await service().update(SCHOOL, LEAD, { status: 'LOST', lostReason: 'Moved city' });
    expect(txMock.enquiry.update).toHaveBeenCalled();
  });

  it('reopens a lost lead to Contacted, clears the reason, and says who', async () => {
    at('LOST', { lostReason: 'Too far' });
    await service().update(SCHOOL, LEAD, { status: 'CONTACTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiry.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONTACTED', lostReason: null }),
    }));
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'STAGE', body: 'Reopened — back to Contacted', authorName: 'Sunita Kale' }),
    }));
  });

  it('will not reopen a lost lead straight to Visited', async () => {
    at('LOST');
    expect((await refusal(service().update(SCHOOL, LEAD, { status: 'VISITED' }))).code).toBe('ENQUIRY_STAGE_BACKWARDS');
  });

  it('never writes the retired CLOSED', async () => {
    at('NEW');
    expect((await refusal(service().update(SCHOOL, LEAD, { status: 'CLOSED' }))).status).toBe(409);
  });
});

describe('who may own a lead', () => {
  it('refuses somebody who is not on the desk, with 400 ENQUIRY_OWNER_NOT_DESK', async () => {
    at('NEW');
    expect(await refusal(service().update(SCHOOL, LEAD, { ownerUserId: OFFICER }, { userId: USER, name: 'x' })))
      .toEqual({ code: 'ENQUIRY_OWNER_NOT_DESK', status: 400 });
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
  });

  it('accepts an admissions officer of THIS school', async () => {
    at('NEW');
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    await service().update(SCHOOL, LEAD, { ownerUserId: OFFICER }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, userId: OFFICER, role: 'ADMISSIONS', isActive: true },
      select: { id: true },
    });
    expect(txMock.enquiry.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerUserId: OFFICER }),
    }));
  });

  /**
   * The owner left last month. Changing the callback date sends the whole
   * row's owner back unchanged — re-checking it would make the lead
   * uneditable until somebody reassigns it.
   */
  it('does not re-check an owner who is not being changed', async () => {
    at('CONTACTED', { ownerUserId: GONE });
    await service().update(SCHOOL, LEAD, { ownerUserId: GONE, followUpAt: '2026-10-09' }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).toHaveBeenCalled();
  });

  it('clearing the owner needs no check', async () => {
    at('CONTACTED', { ownerUserId: OFFICER });
    await service().update(SCHOOL, LEAD, { ownerUserId: null }, { userId: USER, name: 'x' });
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });
});

describe('every history line says who wrote it', () => {
  it('names a member of staff from their staff record', async () => {
    txMock.staff.findFirst.mockResolvedValue({ firstName: 'Sunita', lastName: 'Kale' });
    await service().addNote(SCHOOL, LEAD, 'Asked about the bus', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'NOTE', authorUserId: USER, authorName: 'Sunita Kale' }),
    }));
  });

  it('names an admin from the name on their profile', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: 'Mrs Rathore', role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Spoke to the father', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'Mrs Rathore' }),
    }));
  });

  it('calls an admin who never typed a name "School admin" rather than nobody', async () => {
    txMock.user.findFirst.mockResolvedValue({ name: null, role: 'SCHOOL_ADMIN' });
    await service().addNote(SCHOOL, LEAD, 'Left a message', { userId: USER });
    expect(txMock.enquiryNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorName: 'School admin' }),
    }));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @skoolos/api test -- enquiry-desk.service`
Expected: FAIL — the backwards update resolves instead of refusing; `authorName` is `null`.

- [ ] **Step 3: Implement the rules in the service**

In `apps/api/src/modules/public/enquiry.service.ts`, replace Task 3's `import type { EnquiryDeskMember } from '@skoolos/types';` (one import per module — lint flags a duplicate) and add the other two imports:

```ts
import { stageMove, type EnquiryDeskMember } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isAdmissionsDesk } from './internal/admissions-desk.guard';
```

Replace `STAGE_LABEL` with:

```ts
/** How a stage reads in a history line. */
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', INTERESTED: 'Interested', VISITED: 'Visited',
  APPLIED: 'Applied', ENROLLED: 'Enrolled', LOST: 'Lost', CLOSED: 'Closed',
};

/** Who did something. `name` absent = the service looks it up; present (even null) = use it. */
type Actor = { userId?: string; name?: string | null };
```

Add this private method to the class:

```ts
  /**
   * The name a history line is signed with, read at write time and kept on
   * the row so it survives the person leaving. Staff and officers by their
   * staff record; an admin by the name on their profile, or "School admin" —
   * a line that says nobody wrote it is the defect this replaces.
   */
  private async author(
    tx: Pick<TenantTx, 'staff' | 'user'>,
    schoolId: string,
    actor?: Actor,
  ): Promise<{ userId: string | null; name: string | null }> {
    const userId = actor?.userId ?? null;
    if (actor && actor.name !== undefined) return { userId, name: actor.name };
    if (!userId) return { userId: null, name: null };
    const staff = await tx.staff.findFirst({ where: { schoolId, userId }, select: { firstName: true, lastName: true } });
    const full = staff ? `${staff.firstName} ${staff.lastName}`.trim() : '';
    if (full) return { userId, name: full };
    const user = await tx.user.findFirst({ where: { id: userId, schoolId }, select: { name: true, role: true } });
    return { userId, name: user?.name?.trim() || (user?.role === 'SCHOOL_ADMIN' ? 'School admin' : null) };
  }
```

Change the `update` signature's `actor` parameter type to `actor?: Actor`, and replace its body with:

```ts
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');

      const move = dto.status !== undefined ? stageMove(existing.status, dto.status) : 'SAME';
      if (move === 'BACKWARDS') {
        throw new ApiError(
          'ENQUIRY_STAGE_BACKWARDS',
          `A lead only moves forward — this one is at ${STAGE_LABEL[existing.status] ?? existing.status}. Mark it lost, or reopen a lost one.`,
          409,
          'status',
        );
      }
      // A client-supplied id: FK checks bypass RLS, and this is not even an FK.
      // Checked only when it CHANGES, so a lead whose owner has left can still
      // have its callback moved.
      if (dto.ownerUserId && dto.ownerUserId !== existing.ownerUserId && !(await isAdmissionsDesk(tx, schoolId, dto.ownerUserId))) {
        throw new ApiError('ENQUIRY_OWNER_NOT_DESK', 'A lead can only be given to an admissions officer or a school admin.', 400, 'ownerUserId');
      }

      const data: Record<string, unknown> = {};
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.followUpAt !== undefined) {
        data.followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : null;
      }
      if (dto.ownerUserId !== undefined) data.ownerUserId = dto.ownerUserId;
      if (dto.lostReason !== undefined) data.lostReason = dto.lostReason;

      const terminal = dto.status === 'ENROLLED' || dto.status === 'LOST' || dto.status === 'CLOSED';
      if (terminal) data.followUpAt = null;
      // A reason belongs to being lost. Moving back out of LOST drops it rather
      // than leaving a stale explanation attached to a live lead.
      if (dto.status !== undefined && dto.status !== 'LOST' && dto.lostReason === undefined) {
        data.lostReason = null;
      }

      const updated = await tx.enquiry.update({ where: { id }, data });

      if (dto.status !== undefined && dto.status !== existing.status) {
        const by = await this.author(tx, schoolId, actor);
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: id,
            kind: 'STAGE',
            body:
              dto.status === 'LOST' && updated.lostReason
                ? `Marked Lost — ${updated.lostReason}`
                : move === 'REOPEN'
                  ? 'Reopened — back to Contacted'
                  : `Moved to ${STAGE_LABEL[dto.status] ?? dto.status}`,
            authorUserId: by.userId,
            authorName: by.name,
          },
        });
      }

      return updated;
    });
```

Replace the `addNote` method with:

```ts
  /** A note somebody typed. What makes "Contacted" checkable. */
  async addNote(schoolId: string, id: string, body: string, actor?: Actor) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');
      const by = await this.author(tx, schoolId, actor);
      return tx.enquiryNote.create({
        data: { schoolId, enquiryId: id, kind: 'NOTE', body, authorUserId: by.userId, authorName: by.name },
      });
    });
  }
```

- [ ] **Step 4: Let the controller pass the user and let the service find the name**

In `enquiry-admin.controller.ts` replace `actor`:

```ts
  /** Who is acting. The service signs the history line with their name (Actor.name left out on purpose). */
  private actor(user?: AnyJwtPayload) {
    return { userId: user && 'sub' in user ? user.sub : undefined };
  }
```

- [ ] **Step 5: Accept INTERESTED in the DTO, from the one list**

In `apps/api/src/modules/public/public.dto.ts` add `import { ENQUIRY_STAGES, type EnquiryStageValue } from '@skoolos/types';` and replace the `status` property of `SetEnquiryStatusDto` with:

```ts
  /**
   * The admissions pipeline. CLOSED is accepted by validation and refused by
   * the service (409): it is the old three-state word, never written again.
   */
  @IsOptional()
  @IsIn(ENQUIRY_STAGES)
  status?: EnquiryStageValue;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @skoolos/api test -- enquiry-desk.service enquiry-admin.authz && pnpm --filter @skoolos/api typecheck`
Expected: PASS, including every pre-existing desk test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/public/enquiry.service.ts apps/api/src/modules/public/enquiry-admin.controller.ts \
  apps/api/src/modules/public/public.dto.ts apps/api/src/modules/public/enquiry-desk.service.spec.ts
git commit -m "feat(admissions): stages move forward only (409), owners must be on the desk, history lines are signed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Calls and WhatsApps that log, walk-ins taken at the desk, and the website's source

**Files:**
- Modify: `apps/api/src/modules/public/enquiry.service.ts` (`logContact`, `create`, `submit`)
- Modify: `apps/api/src/modules/public/public.dto.ts` (`SubmitEnquiryDto.source`, new `CreateDeskEnquiryDto`, `AddEnquiryNoteDto`)
- Modify: `apps/api/src/modules/public/enquiry-admin.controller.ts` (`POST enquiries`, notes dispatch)
- Modify: `apps/api/src/modules/public/enquiry-desk.service.spec.ts`
- Create: `apps/api/test/admissions-desk.e2e-spec.ts`
- Modify: `apps/api/test/site-authoring-authz.e2e-spec.ts:56-90` (two routes)
- Modify: `apps/api/test/route-manifest.ts` (one reviewed route)

**Interfaces:**
- Consumes: `contactTarget`, `ENQUIRY_SOURCE_LABEL`, `CONTACT_KINDS`, `CONTACT_OUTCOMES`, `DESK_SOURCES`, `PUBLIC_SOURCES` and their types (Task 1); `author`, `Actor` (Task 4).
- Produces:
  - `EnquiryService.logContact(schoolId: string, id: string, kind: ContactKind, opts?: { outcome?: ContactOutcome; lostReason?: string | null; body?: string }, actor?: Actor)` → the contact note. (Tier B's WhatsApp buttons call this.)
  - `EnquiryService.create(schoolId: string, dto: CreateDeskEnquiryDto, actor?: Actor)` → the enquiry row.
  - `POST /site/enquiries` body `{ parentName, phone, source: 'WALK_IN' | 'PHONE', email?, childName?, gradeInterest?, message?, whatsappOk? }` → 201 row (owner = caller).
  - `POST /site/enquiries/:id/notes` body `{ kind?: 'NOTE' | 'CALL' | 'WHATSAPP' | 'VISIT', body?, outcome?, lostReason? }`.
  - `POST /public/enquiry` accepts optional `source: 'WEBSITE' | 'COURSE_CARD'`.

- [ ] **Step 1: Write the failing service tests**

Append to `enquiry-desk.service.spec.ts`:

```ts
const writtenNotes = () =>
  txMock.enquiryNote.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);
const updateData = () => (txMock.enquiry.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe('logging a call, a WhatsApp or a visit', () => {
  it('stamps lastContactedAt and moves a NEW lead to Contacted', async () => {
    at('NEW');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'CONTACTED' }, { userId: USER, name: 'Sunita Kale' });
    expect(writtenNotes()).toEqual([
      expect.objectContaining({ kind: 'CALL', body: 'Called', authorUserId: USER, authorName: 'Sunita Kale' }),
      expect.objectContaining({ kind: 'STAGE', body: 'Moved to Contacted', authorName: 'Sunita Kale' }),
    ]);
    expect(updateData().status).toBe('CONTACTED');
    expect(updateData().lastContactedAt).toBeInstanceOf(Date);
  });

  it('a call nobody answered is logged and stamped, and does NOT mark the family contacted', async () => {
    at('NEW');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'NO_ANSWER' });
    expect(updateData()).not.toHaveProperty('status');
    expect(updateData().lastContactedAt).toBeInstanceOf(Date);
    expect(writtenNotes()).toEqual([expect.objectContaining({ kind: 'CALL', body: 'Called — no answer' })]);
  });

  it('Interested on WhatsApp moves Contacted forward to Interested', async () => {
    at('CONTACTED');
    await service().logContact(SCHOOL, LEAD, 'WHATSAPP', { outcome: 'INTERESTED' });
    expect(updateData().status).toBe('INTERESTED');
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ kind: 'WHATSAPP', body: 'Messaged on WhatsApp — interested' }));
  });

  it('never drags a lead backwards — Interested on a Visited lead changes no stage', async () => {
    at('VISITED');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'INTERESTED' });
    expect(updateData()).not.toHaveProperty('status');
    expect(writtenNotes()).toHaveLength(1);
  });

  it('Lost from a call carries the reason and clears the callback', async () => {
    at('INTERESTED');
    await service().logContact(SCHOOL, LEAD, 'CALL', { outcome: 'LOST', lostReason: 'Fees too high' });
    expect(updateData()).toEqual(expect.objectContaining({ status: 'LOST', lostReason: 'Fees too high', followUpAt: null }));
    expect(writtenNotes()[1]).toEqual(expect.objectContaining({ kind: 'STAGE', body: 'Marked Lost — Fees too high' }));
  });

  it('a lead from another school is not found, and nothing is written', async () => {
    txMock.enquiry.findFirst.mockResolvedValue(null);
    await expect(service().logContact(SCHOOL, LEAD, 'CALL')).rejects.toBeInstanceOf(NotFoundException);
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
    expect(txMock.enquiry.update).not.toHaveBeenCalled();
  });

  it('a typed note cannot be blank', async () => {
    at('NEW');
    expect(await refusal(service().addNote(SCHOOL, LEAD, '   '))).toEqual({ code: 'VALIDATION', status: 400 });
    expect(txMock.enquiryNote.create).not.toHaveBeenCalled();
  });
});

describe('a walk-in typed at the desk', () => {
  beforeEach(() => {
    txMock.enquiry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: LEAD, ...data }));
  });

  it('is owned by whoever typed it, carries its source, and opens its own history', async () => {
    await service().create(
      SCHOOL,
      { parentName: ' Meera Purohit ', phone: '98290 11223', source: 'WALK_IN', childName: 'Aarav', gradeInterest: 'Class III', whatsappOk: true },
      { userId: USER, name: 'Sunita Kale' },
    );
    expect(txMock.enquiry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schoolId: SCHOOL, parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN',
        childName: 'Aarav', gradeInterest: 'Class III', whatsappOk: true, ownerUserId: USER, status: 'NEW',
      }),
    });
    expect(writtenNotes()).toEqual([
      expect.objectContaining({ kind: 'SYSTEM', body: 'Walk-in enquiry taken by Sunita Kale — asked about Class III', authorUserId: USER }),
    ]);
  });

  it('a phone enquiry says so, and an unticked WhatsApp box stays false', async () => {
    await service().create(SCHOOL, { parentName: 'Imran Shaikh', phone: '98290 44556', source: 'PHONE' }, { userId: USER, name: 'Sunita Kale' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'PHONE', whatsappOk: false, childName: null }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ body: 'Phone enquiry taken by Sunita Kale' }));
  });
});

describe('the website form', () => {
  const site = { get: () => ({ kind: 'tenant', schoolId: SCHOOL }), requireTenant: () => ({ schoolId: SCHOOL }) } as never;
  const withEnquiry = { getFeatures: jest.fn().mockResolvedValue(new Set(['ENQUIRY'])) } as never;

  beforeEach(() => {
    txMock.enquiry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: LEAD, ...data }));
  });

  it('records WEBSITE when the form says nothing — unchanged for every existing caller', async () => {
    await new EnquiryService(site, withEnquiry).submit({ parentName: 'Sneha Kulkarni', phone: '98123 00011', gradeInterest: 'Nursery' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'WEBSITE', status: 'NEW' }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ kind: 'SYSTEM', body: 'Enquiry received from the website — asked about Nursery' }));
  });

  it('records COURSE_CARD for a call-back asked for on a course card', async () => {
    await new EnquiryService(site, withEnquiry).submit({ parentName: 'Course card lead', phone: '98123 00011', gradeInterest: 'Nursery', source: 'COURSE_CARD' });
    expect(txMock.enquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: 'COURSE_CARD' }) });
    expect(writtenNotes()[0]).toEqual(expect.objectContaining({ body: 'Call-back requested from a course card — asked about Nursery' }));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @skoolos/api test -- enquiry-desk.service`
Expected: FAIL — `service().logContact is not a function`, `service().create is not a function`, `source` missing from the website insert.

- [ ] **Step 3: Write the DTOs**

In `apps/api/src/modules/public/public.dto.ts`, extend the class-validator import to `{ IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf }`, extend the types import to:

```ts
import {
  CONTACT_KINDS, CONTACT_OUTCOMES, DESK_SOURCES, ENQUIRY_STAGES, PUBLIC_SOURCES,
  type ContactKind, type ContactOutcome, type DeskSource, type EnquiryStageValue, type PublicSource,
} from '@skoolos/types';
```

Add to `SubmitEnquiryDto` (after `message`):

```ts
  /**
   * Which public door it came through. Only the two website doors may be
   * claimed here; a walk-in is typed at the desk, behind a login. Missing =
   * WEBSITE, so every existing form keeps working untouched.
   */
  @IsOptional()
  @IsIn(PUBLIC_SOURCES)
  source?: PublicSource;
```

Add after `SubmitEnquiryDto`:

```ts
/** A family who walked in or rang — typed at the desk, owned by whoever typed it. */
export class CreateDeskEnquiryDto {
  @IsString() @Length(1, 120) @Matches(/\S/, { message: 'parentName must not be blank' })
  parentName!: string;

  @IsString() @Length(1, 40) @Matches(/\d/, { message: 'phone must contain a number' })
  phone!: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @Length(0, 120)
  childName?: string;

  @IsOptional() @IsString() @Length(0, 120)
  gradeInterest?: string;

  @IsOptional() @IsString() @Length(0, 2000)
  message?: string;

  @IsIn(DESK_SOURCES)
  source!: DeskSource;

  /** They said the school may WhatsApp them. Nothing sends on it in Tier A. */
  @IsOptional() @IsBoolean()
  whatsappOk?: boolean;
}
```

Replace `AddEnquiryNoteDto` with:

```ts
/**
 * A typed note (kind NOTE, the default), or a contact — a call, a WhatsApp or a
 * visit — with what came of it. A contact's body is optional: the history line
 * is written from the kind and the outcome.
 */
export class AddEnquiryNoteDto {
  @IsOptional() @IsIn(['NOTE', ...CONTACT_KINDS])
  kind?: 'NOTE' | ContactKind;

  @IsOptional() @IsString() @Length(0, 2000)
  body?: string;

  @IsOptional() @IsIn(CONTACT_OUTCOMES)
  outcome?: ContactOutcome;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(0, 200)
  lostReason?: string | null;
}
```

(`SetEnquiryStatusDto` was changed in Task 4; `EnquiryStageValue` and `ENQUIRY_STAGES` stay imported for it.)

- [ ] **Step 4: Write `logContact`, `create`, and the website source**

In `enquiry.service.ts`, replace the single `@skoolos/types` import (Task 4's `import { stageMove, type EnquiryDeskMember } …`) with:

```ts
import {
  ENQUIRY_SOURCE_LABEL, contactTarget, stageMove,
  type ContactKind, type ContactOutcome, type EnquiryDeskMember,
} from '@skoolos/types';
```

and the DTO import to `import type { CreateDeskEnquiryDto, SubmitEnquiryDto } from './public.dto';`. Add above the class:

```ts
/** The first words of a contact's history line. */
const CONTACT_WORD: Record<ContactKind, string> = {
  CALL: 'Called',
  WHATSAPP: 'Messaged on WhatsApp',
  VISIT: 'Visited the school',
};
/** What came of it, appended. CONTACTED needs no words — "Called" already says it. */
const OUTCOME_WORD: Record<ContactOutcome, string> = {
  CONTACTED: '',
  INTERESTED: ' — interested',
  NO_ANSWER: ' — no answer',
  LOST: ' — not going ahead',
};
```

In `submit`, replace the `data` of `tx.enquiry.create` and the note body:

```ts
      tx.enquiry.create({
        data: {
          schoolId,
          parentName: dto.parentName,
          phone: dto.phone,
          email: dto.email,
          gradeInterest: dto.gradeInterest,
          message: dto.message,
          source: dto.source ?? 'WEBSITE',
          status: 'NEW',
        },
      }).then(async (row) => {
        // The history starts where the lead did. Without this the timeline of a
        // brand-new enquiry is empty, which reads as "nothing has happened
        // here" rather than "this has just arrived".
        const opening = dto.source === 'COURSE_CARD'
          ? 'Call-back requested from a course card'
          : 'Enquiry received from the website';
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: row.id,
            kind: 'SYSTEM',
            body: dto.gradeInterest ? `${opening} — asked about ${dto.gradeInterest}` : opening,
          },
        });
        return row;
      }),
```

Add these methods to the class (after `addNote`), and add a blank-body check as the first line inside `addNote`'s `withTenant` callback:

```ts
      if (!body.trim()) throw new ApiError('VALIDATION', 'Write something in the note first.', 400, 'body');
```

```ts
  /**
   * Somebody reached the family — or tried to.
   *
   * The contact line, the stamp and the stage move share one transaction, the
   * same rule as `update`'s STAGE note. `contactTarget` decides the stage: a
   * first contact moves NEW → CONTACTED, Interested moves forward to
   * INTERESTED, Lost loses it, and "no answer" moves nothing — a call that rang
   * out did not contact anybody. Any attempt stamps `lastContactedAt`.
   *
   * Tier B's WhatsApp buttons ("Contacted", "Interested", "Not interested")
   * call exactly this, so the desk and the phone agree.
   */
  async logContact(
    schoolId: string,
    id: string,
    kind: ContactKind,
    opts: { outcome?: ContactOutcome; lostReason?: string | null; body?: string } = {},
    actor?: Actor,
  ) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.enquiry.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Enquiry not found');
      const by = await this.author(tx, schoolId, actor);
      const extra = opts.body?.trim();

      const note = await tx.enquiryNote.create({
        data: {
          schoolId,
          enquiryId: id,
          kind,
          body: `${CONTACT_WORD[kind]}${opts.outcome ? OUTCOME_WORD[opts.outcome] : ''}${extra ? `: ${extra}` : ''}`,
          authorUserId: by.userId,
          authorName: by.name,
        },
      });

      const target = contactTarget(existing.status, opts.outcome);
      const data: Record<string, unknown> = { lastContactedAt: new Date() };
      if (target) data.status = target;
      if (target === 'LOST') {
        data.lostReason = opts.lostReason?.trim() || null;
        data.followUpAt = null;
      }
      const updated = await tx.enquiry.update({ where: { id }, data });

      if (target) {
        await tx.enquiryNote.create({
          data: {
            schoolId,
            enquiryId: id,
            kind: 'STAGE',
            body: target === 'LOST' && updated.lostReason
              ? `Marked Lost — ${updated.lostReason}`
              : `Moved to ${STAGE_LABEL[target] ?? target}`,
            authorUserId: by.userId,
            authorName: by.name,
          },
        });
      }
      return note;
    });
  }

  /**
   * A walk-in or a phone enquiry typed at the desk. Owned by whoever typed it —
   * they are the one who met the family — and never throttled: the 5-a-minute
   * limit exists for strangers on the internet, and the office is not one.
   */
  async create(schoolId: string, dto: CreateDeskEnquiryDto, actor?: Actor) {
    return withTenant(schoolId, async (tx) => {
      const by = await this.author(tx, schoolId, actor);
      const grade = dto.gradeInterest?.trim() || null;
      const row = await tx.enquiry.create({
        data: {
          schoolId,
          parentName: dto.parentName.trim(),
          phone: dto.phone.trim(),
          email: dto.email ?? null,
          childName: dto.childName?.trim() || null,
          gradeInterest: grade,
          message: dto.message?.trim() || null,
          source: dto.source,
          whatsappOk: dto.whatsappOk ?? false,
          status: 'NEW',
          ownerUserId: by.userId,
        },
      });
      await tx.enquiryNote.create({
        data: {
          schoolId,
          enquiryId: row.id,
          kind: 'SYSTEM',
          body: `${ENQUIRY_SOURCE_LABEL[dto.source]} enquiry taken by ${by.name ?? 'the office'}${grade ? ` — asked about ${grade}` : ''}`,
          authorUserId: by.userId,
          authorName: by.name,
        },
      });
      return row;
    });
  }
```

- [ ] **Step 5: Wire the routes**

In `enquiry-admin.controller.ts`, add `HttpCode` to the `@nestjs/common` import, change the DTO import to `import { AddEnquiryNoteDto, CreateDeskEnquiryDto, SetEnquiryStatusDto } from './public.dto';`, insert this handler between `owners()` and `detail()`:

```ts
  /** A walk-in or a phone enquiry, owned by the caller. The website form stays on /public/enquiry. */
  @Post('enquiries')
  @HttpCode(201)
  create(@Body() dto: CreateDeskEnquiryDto, @CurrentUser() user?: AnyJwtPayload) {
    return this.enquiry.create(this.sid(), dto, this.actor(user));
  }
```

and replace `addNote` with:

```ts
  /** A typed note, or a call / WhatsApp / visit with its outcome. */
  @Post('enquiries/:id/notes')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEnquiryNoteDto,
    @CurrentUser() user?: AnyJwtPayload,
  ) {
    const kind = dto.kind ?? 'NOTE';
    if (kind === 'NOTE') return this.enquiry.addNote(this.sid(), id, dto.body ?? '', this.actor(user));
    return this.enquiry.logContact(
      this.sid(), id, kind,
      { outcome: dto.outcome, lostReason: dto.lostReason, body: dto.body },
      this.actor(user),
    );
  }
```

In `apps/api/test/route-manifest.ts`, directly after `  "GET /site/enquiries/owners",` add `  "POST /site/enquiries",`.

In `apps/api/test/site-authoring-authz.e2e-spec.ts`, after `['read admission enquiries', 'get', '/site/enquiries'],` add:

```ts
    ['add a walk-in enquiry', 'post', '/site/enquiries'],
    ['list who can own a lead', 'get', '/site/enquiries/owners'],
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `pnpm --filter @skoolos/api test -- enquiry-desk.service enquiry-admin.authz admissions-desk.guard && pnpm --filter @skoolos/api typecheck`
Expected: PASS.

- [ ] **Step 7: Write the e2e proof**

```ts
// apps/api/test/admissions-desk.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * The admissions desk against a real database, migrations applied by the
 * suite's global setup. The guard chain and the declaration order are also
 * pinned in unit specs; this proves they hold once Nest has mounted them.
 */
describe('the admissions desk', () => {
  let app: INestApplication;
  let host: string;
  let officerId: string;
  let adminId: string;
  let driverId: string;
  let officer: string;
  let driver: string;
  let student: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    adminId = seeded.adminUserId;
    driverId = seeded.driverUserId;
    const db = getPlatformPrisma();
    const user = await db.user.create({
      data: { schoolId: seeded.schoolId, email: `admissions@${seeded.host}`, role: 'STAFF', passwordHash: 'not-used' },
    });
    await db.staff.create({
      data: { schoolId: seeded.schoolId, firstName: 'Sunita', lastName: 'Kale', role: 'ADMISSIONS', userId: user.id },
    });
    officerId = user.id;
    officer = signSchoolToken({ sub: officerId, schoolId: seeded.schoolId, role: 'STAFF' });
    driver = signSchoolToken({ sub: driverId, schoolId: seeded.schoolId, role: 'STAFF' });
    student = signSchoolToken({ sub: seeded.studentUserId, schoolId: seeded.schoolId, role: 'STUDENT' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const send = (method: 'get' | 'post' | 'patch', path: string, token: string) =>
    request(app.getHttpServer())[method](path).set('Host', host).set('Authorization', `Bearer ${token}`);

  const walkIn = async () => {
    const res = await send('post', '/site/enquiries', officer)
      .send({ parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN', gradeInterest: 'Class III' });
    expect(res.status).toBe(201);
    return res.body as { id: string; ownerUserId: string; source: string; status: string };
  };

  it('lets an admissions officer read the desk', async () => {
    expect((await send('get', '/site/enquiries', officer)).status).toBe(200);
  });

  it('refuses a driver — the job, not the login, opens this door', async () => {
    const res = await send('get', '/site/enquiries', driver);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ADMISSIONS_DESK');
  });

  it('lists the desk members, and "owners" is not swallowed by /:id', async () => {
    const res = await send('get', '/site/enquiries/owners', officer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: officerId, name: 'Sunita Kale', job: 'ADMISSIONS' }),
      expect.objectContaining({ userId: adminId, job: 'ADMIN' }),
    ]));
    expect((res.body as { userId: string }[]).map((m) => m.userId)).not.toContain(driverId);
  });

  it('takes a walk-in, owned by whoever typed it', async () => {
    const row = await walkIn();
    expect(row).toEqual(expect.objectContaining({ ownerUserId: officerId, source: 'WALK_IN', status: 'NEW' }));
  });

  it('refuses a student at the walk-in door', async () => {
    const res = await send('post', '/site/enquiries', student).send({ parentName: 'X', phone: '98290 11223', source: 'WALK_IN' });
    expect(res.status).toBe(403);
  });

  it('moves forward, and refuses a step back with 409', async () => {
    const row = await walkIn();
    expect((await send('patch', `/site/enquiries/${row.id}`, officer).send({ status: 'VISITED' })).status).toBe(200);
    const back = await send('patch', `/site/enquiries/${row.id}`, officer).send({ status: 'CONTACTED' });
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('ENQUIRY_STAGE_BACKWARDS');
  });

  it('will not hand a lead to somebody off the desk', async () => {
    const row = await walkIn();
    const res = await send('patch', `/site/enquiries/${row.id}`, officer).send({ ownerUserId: driverId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENQUIRY_OWNER_NOT_DESK');
  });

  it('a logged call moves a new lead to Contacted, stamps it, and is signed', async () => {
    const row = await walkIn();
    const logged = await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ kind: 'CALL', outcome: 'CONTACTED' });
    expect(logged.status).toBe(201);
    const detail = await send('get', `/site/enquiries/${row.id}`, officer);
    expect(detail.body.status).toBe('CONTACTED');
    expect(detail.body.lastContactedAt).toBeTruthy();
    expect(detail.body.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CALL', body: 'Called', authorName: 'Sunita Kale' }),
    ]));
  });
});
```

- [ ] **Step 8: Run the e2e suite where a test database is available**

Run (needs the local Postgres the e2e config uses; CI runs it on the PR in `ci.yml`'s e2e job):
`pnpm --filter @skoolos/api test:e2e -- admissions-desk site-authoring-authz route-coverage`
Expected: PASS. If no local test database is up, record that this step ran in CI instead, and do not skip Task 10's check of the CI result.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/public/enquiry.service.ts apps/api/src/modules/public/public.dto.ts \
  apps/api/src/modules/public/enquiry-admin.controller.ts apps/api/src/modules/public/enquiry-desk.service.spec.ts \
  apps/api/test/admissions-desk.e2e-spec.ts apps/api/test/site-authoring-authz.e2e-spec.ts apps/api/test/route-manifest.ts
git commit -m "feat(admissions): log calls and WhatsApps with their outcome, take walk-ins at the desk, record the website source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The desk's lead model — My leads, Unowned, Interested, source, forward buttons, outcomes, CSV

**Files:**
- Modify: `apps/web/app/app/enquiries/lead.ts`
- Modify: `apps/web/app/app/enquiries/lead.test.ts`

**Interfaces:**
- Consumes: `STAGE_ORDER`, `ENQUIRY_SOURCE_LABEL`, `forwardStages`, `EnquiryStageValue`, `EnquirySourceValue`, `PipelineStage`, `ContactKind`, `ContactOutcome` (Task 1).
- Produces (from `apps/web/app/app/enquiries/lead.ts`):
  - `type EnquiryStage = EnquiryStageValue`; `EnquiryNote.kind` adds `ContactKind`; `Lead` adds `childName: string | null`, `source: EnquirySourceValue`, `whatsappOk: boolean`, `lastContactedAt: string | null`, `updatedAt: string`, `ownerOnDesk: boolean`.
  - `type DeskFilter` adds `'MINE' | 'UNOWNED' | 'INTERESTED'`.
  - `matchesFilter(l: Lead, filter: DeskFilter, today?: Date, meId?: string | null): boolean`
  - `sourceLabel(l: Pick<Lead, 'source'>): string`
  - `interface StageButton { key: PipelineStage; label: string; state: 'done' | 'now' | undefined; canClick: boolean }`; `stageButtons(status: EnquiryStage): StageButton[]`
  - `OUTCOMES: { key: ContactOutcome; label: string }[]`
  - `leadsCsv(rows: Lead[]): string`
  - `PIPELINE` stays exported (now derived from `STAGE_ORDER`).

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/app/enquiries/lead.test.ts`, extend the import to:

```ts
import {
  OUTCOMES, daysUntil, deskCounts, deskOrder, dialable, dueLabel, initials, isOpen, leadsCsv,
  matchesFilter, matchesQuery, sourceLabel, stageButtons, stageTone, STAGE_LABEL,
  type Lead,
} from './lead';
```

Replace the `lead()` factory with:

```ts
function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', parentName: 'Sneha Kulkarni', childName: null, phone: '+91 98123 00011', email: null,
    gradeInterest: 'Class III', message: null, status: 'CONTACTED', followUpAt: null,
    ownerUserId: null, ownerName: null, ownerOnDesk: false, lostReason: null, noteCount: 0,
    source: 'WEBSITE', whatsappOk: false, lastContactedAt: null,
    createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z',
    ...over,
  };
}
```

Append:

```ts
describe('whose leads these are', () => {
  it('My leads is the open leads this person owns', () => {
    expect(matchesFilter(lead({ ownerUserId: 'me', ownerOnDesk: true }), 'MINE', TODAY, 'me')).toBe(true);
    expect(matchesFilter(lead({ ownerUserId: 'other', ownerOnDesk: true }), 'MINE', TODAY, 'me')).toBe(false);
    expect(matchesFilter(lead({ ownerUserId: 'me', status: 'ENROLLED' }), 'MINE', TODAY, 'me')).toBe(false);
  });

  /** Before /auth/me answers there is no "me": the filter shows nothing rather than everything. */
  it('My leads is empty, not everybody, before we know who you are', () => {
    expect(matchesFilter(lead({ ownerUserId: null }), 'MINE', TODAY, null)).toBe(false);
  });

  it('Unowned holds the open leads nobody is on — including one whose owner has left the desk', () => {
    expect(matchesFilter(lead({ ownerUserId: null }), 'UNOWNED', TODAY)).toBe(true);
    expect(matchesFilter(lead({ ownerUserId: 'gone', ownerOnDesk: false }), 'UNOWNED', TODAY)).toBe(true);
    expect(matchesFilter(lead({ ownerUserId: 'here', ownerOnDesk: true }), 'UNOWNED', TODAY)).toBe(false);
    expect(matchesFilter(lead({ ownerUserId: null, status: 'LOST' }), 'UNOWNED', TODAY)).toBe(false);
  });

  it('Interested is a stage of its own, and still open', () => {
    expect(matchesFilter(lead({ status: 'INTERESTED' }), 'INTERESTED', TODAY)).toBe(true);
    expect(isOpen(lead({ status: 'INTERESTED' }))).toBe(true);
    expect(STAGE_LABEL.INTERESTED).toBe('Interested');
  });
});

describe('where a lead came from', () => {
  it('names the source in plain words', () => {
    expect(sourceLabel(lead({ source: 'WALK_IN' }))).toBe('Walk-in');
    expect(sourceLabel(lead({ source: 'COURSE_CARD' }))).toBe('Course card');
  });

  it('reads a payload from before the source existed as the website', () => {
    expect(sourceLabel({ source: undefined } as unknown as Lead)).toBe('Website');
  });
});

describe('the stage buttons only go forward', () => {
  it('past stages are records, the current one is marked, only later ones can be pressed', () => {
    const b = stageButtons('CONTACTED');
    expect(b.map((x) => x.key)).toEqual(['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
    expect(b.map((x) => x.state)).toEqual(['done', 'now', undefined, undefined, undefined, undefined]);
    expect(b.filter((x) => x.canClick).map((x) => x.key)).toEqual(['INTERESTED', 'VISITED', 'APPLIED', 'ENROLLED']);
  });

  it('a lost lead presses nothing on the road — it is reopened instead', () => {
    expect(stageButtons('LOST').some((x) => x.canClick || x.state)).toBe(false);
    expect(stageButtons('CLOSED').some((x) => x.canClick)).toBe(false);
  });
});

describe('after a call', () => {
  it('asks the same four answers the WhatsApp buttons will', () => {
    expect(OUTCOMES.map((o) => o.label)).toEqual(['Contacted', 'Interested', 'No answer', 'Lost']);
  });
});

describe('exporting the list on screen', () => {
  it('has one header and one line per lead, in the desk’s words', () => {
    const row = lead({
      parentName: 'Sneha Kulkarni', childName: 'Ira', phone: '98123 00011', email: 'sneha@example.com',
      gradeInterest: 'Class III', source: 'WALK_IN', status: 'CONTACTED', ownerName: 'Sunita Kale',
      followUpAt: '2026-09-05T00:00:00.000Z', lastContactedAt: '2026-09-02T06:30:00.000Z',
    });
    const lines = leadsCsv([row]).trimEnd().split('\r\n');
    expect(lines).toEqual([
      'Received,Parent,Child,Phone,Email,Class,Source,Stage,Owner,Follow-up,Last contacted,Lost reason',
      '2026-08-27,Sneha Kulkarni,Ira,98123 00011,sneha@example.com,Class III,Walk-in,Contacted,Sunita Kale,2026-09-05,2026-09-02,',
    ]);
  });

  it('quotes a comma, a quote or a line break, so a message cannot shift the columns', () => {
    const csv = leadsCsv([lead({ parentName: 'Rao, "Ravi"', status: 'LOST', lostReason: 'Moved\ncity' })]);
    expect(csv).toContain('"Rao, ""Ravi"""');
    expect(csv).toContain('"Moved\ncity"');
  });

  /** The website form is public: whatever a stranger types lands in this file. */
  it('never hands a spreadsheet a formula typed into the website form', () => {
    const csv = leadsCsv([lead({ parentName: '=HYPERLINK("http://x","click")', phone: '+91 98123 00011' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csv).toContain("'+91 98123 00011");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries/lead.test.ts`
Expected: FAIL — `OUTCOMES`, `leadsCsv`, `sourceLabel`, `stageButtons` are not exported.

- [ ] **Step 3: Implement in `lead.ts`**

Replace lines 1-50 of `apps/web/app/app/enquiries/lead.ts` (header comment through `STAGE_LABEL`) with:

```ts
/**
 * What a lead is, and the handful of judgements the desk makes about one.
 *
 * A dependency-free module on purpose: both the page and its tests import it,
 * and a component module would drag the whole React graph into a unit test
 * (see `test-import-drags-next-font` in the mistake ledger). `@skoolos/types`
 * is plain TypeScript, so the pipeline rules come from there — the API refuses
 * exactly the moves this desk does not draw.
 */
import {
  ENQUIRY_SOURCE_LABEL, STAGE_ORDER, forwardStages,
  type ContactKind, type ContactOutcome, type EnquirySourceValue, type EnquiryStageValue, type PipelineStage,
} from '@skoolos/types';

export type EnquiryStage = EnquiryStageValue;

export interface EnquiryNote {
  id: string;
  kind: 'NOTE' | 'STAGE' | 'SYSTEM' | ContactKind;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export interface Lead {
  id: string;
  parentName: string;
  childName: string | null;
  phone: string;
  email: string | null;
  gradeInterest: string | null;
  message: string | null;
  status: EnquiryStage;
  source: EnquirySourceValue;
  whatsappOk: boolean;
  followUpAt: string | null;
  lastContactedAt: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  /** False when the owner has left the desk (or there is none) — the lead is then Unowned. */
  ownerOnDesk: boolean;
  lostReason: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export const STAGE_LABEL: Record<EnquiryStage, string> = {
  NEW: 'New', CONTACTED: 'Contacted', INTERESTED: 'Interested', VISITED: 'Visited', APPLIED: 'Applied',
  ENROLLED: 'Enrolled', LOST: 'Lost',
  // The old three-state model's word for a finished lead. Existing rows carry
  // it; the desk reads it as lost and never writes it.
  CLOSED: 'Lost',
};

/** The pipeline, in the order a family moves through it. */
export const PIPELINE: { key: PipelineStage; label: string }[] = STAGE_ORDER.map((key) => ({ key, label: STAGE_LABEL[key] }));
```

Replace the `DeskFilter` type and `matchesFilter` (old lines 96-111) with:

```ts
export type DeskFilter =
  | 'MINE' | 'UNOWNED' | 'OPEN' | 'ALL' | 'OVERDUE' | 'TODAY' | 'NODUE'
  | 'NEW' | 'CONTACTED' | 'INTERESTED' | 'VISITED' | 'APPLIED' | 'ENROLLED' | 'LOST';

export function matchesFilter(l: Lead, filter: DeskFilter, today = new Date(), meId: string | null = null): boolean {
  switch (filter) {
    case 'ALL': return true;
    case 'OPEN': return isOpen(l);
    // No "me" yet (the profile has not loaded) is no leads, never all of them.
    case 'MINE': return isOpen(l) && !!meId && l.ownerUserId === meId;
    // An owner who has left the desk owns nothing — those leads need taking.
    case 'UNOWNED': return isOpen(l) && (!l.ownerUserId || !l.ownerOnDesk);
    case 'OVERDUE': return isOpen(l) && !!l.followUpAt && daysUntil(l.followUpAt, today) < 0;
    case 'TODAY': return isOpen(l) && !!l.followUpAt && daysUntil(l.followUpAt, today) === 0;
    case 'NODUE': return isOpen(l) && !l.followUpAt;
    // A CLOSED row from the old model belongs under Lost, or it is invisible.
    case 'LOST': return l.status === 'LOST' || l.status === 'CLOSED';
    default: return l.status === filter;
  }
}
```

Append to the end of the file:

```ts
/** Where the lead came from, in the desk's words. A payload from before the column read as the website. */
export function sourceLabel(l: Pick<Lead, 'source'>): string {
  return ENQUIRY_SOURCE_LABEL[l.source] ?? 'Website';
}

export interface StageButton {
  key: PipelineStage;
  label: string;
  /** done = passed, now = here. A lost lead has neither. */
  state: 'done' | 'now' | undefined;
  /** Only a stage ahead can be pressed — the API refuses the rest with 409. */
  canClick: boolean;
}

export function stageButtons(status: EnquiryStage): StageButton[] {
  const lost = status === 'LOST' || status === 'CLOSED';
  const here = (STAGE_ORDER as readonly string[]).indexOf(status);
  const ahead = new Set<string>(forwardStages(status));
  return PIPELINE.map((s, i) => ({
    key: s.key,
    label: s.label,
    state: lost ? undefined : i < here ? 'done' : i === here ? 'now' : undefined,
    canClick: ahead.has(s.key),
  }));
}

/** The answers after a call or a WhatsApp — the same four the Tier B WhatsApp buttons carry. */
export const OUTCOMES: { key: ContactOutcome; label: string }[] = [
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'INTERESTED', label: 'Interested' },
  { key: 'NO_ANSWER', label: 'No answer' },
  { key: 'LOST', label: 'Lost' },
];

const CSV_HEADER = ['Received', 'Parent', 'Child', 'Phone', 'Email', 'Class', 'Source', 'Stage', 'Owner', 'Follow-up', 'Last contacted', 'Lost reason'];

/** A timestamp's calendar day in the school's timezone, YYYY-MM-DD. */
function istDay(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '';
}

/**
 * One CSV cell. A value a spreadsheet would read as a formula (= + - @, tab,
 * carriage return) gets a leading apostrophe: the website form is public, so
 * these strings come from anybody. Then the usual quoting for , " and newlines.
 */
function csvCell(v: string | null | undefined): string {
  let s = v ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The rows on screen, as the office would read them in Excel. */
export function leadsCsv(rows: Lead[]): string {
  const lines = rows.map((l) =>
    [
      istDay(l.createdAt), l.parentName, l.childName, l.phone, l.email, l.gradeInterest,
      sourceLabel(l), STAGE_LABEL[l.status], l.ownerName,
      // followUpAt is a DATE column: its day is the string's own first ten characters.
      l.followUpAt ? l.followUpAt.slice(0, 10) : '',
      istDay(l.lastContactedAt), l.lostReason,
    ].map(csvCell).join(','),
  );
  return [CSV_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Run them to verify they pass, and that the screens still compile**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries/lead.test.ts && pnpm --filter @skoolos/web typecheck`
Expected: PASS (old and new), typecheck clean — `page.tsx` and `lead-panel.tsx` still use `PIPELINE`, `matchesFilter(l, key)` and the old `Lead` fields, all of which remain.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/app/enquiries/lead.ts apps/web/app/app/enquiries/lead.test.ts
git commit -m "feat(admissions): the desk's lead model — My leads, Unowned, Interested, source, forward buttons, safe CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The console admits the officer to the desk, and only the desk

**Files:**
- Modify: `apps/web/lib/role-routes.ts`
- Modify: `apps/web/lib/role-routes.test.ts`
- Modify: `apps/web/app/app/nav-model.ts` (new `deskModel`)
- Modify: `apps/web/app/app/nav-model.test.ts`
- Modify: `apps/web/app/app/layout.tsx:19` (import), `:163-184` (`ProfileDoor`), `:253-256` (model), `:295-305` (redirect effect), `:453` and `:532` (profile door href)

**Interfaces:**
- Consumes: nothing from earlier tasks (the job is a string from `/auth/me`).
- Produces:
  - `homeForRole('STAFF', 'ADMISSIONS') === '/app/enquiries'`
  - `consoleDeskFor(role: string | undefined, staffRole?: string | null): string | null`
  - `consoleBounce(role: string | undefined, staffRole: string | null | undefined, pathname: string): string | null`
  - `deskModel(desk: string): NavEntry[]`

- [ ] **Step 1: Write the failing tests**

In `apps/web/lib/role-routes.test.ts`, change the import to `import { consoleBounce, consoleDeskFor, homeForRole } from './role-routes';`, add inside `describe('homeForRole', …)`:

```ts
  it('routes the admissions officer (STAFF + staffRole ADMISSIONS) to the enquiries desk, and no other role there', () => {
    expect(homeForRole('STAFF', 'ADMISSIONS')).toBe('/app/enquiries');
    expect(homeForRole('TEACHER', 'ADMISSIONS')).toBe('/teacher');
    expect(homeForRole('SCHOOL_ADMIN', 'ADMISSIONS')).toBe('/app');
  });
```

and append at the end of the file:

```ts
/**
 * The /app layout used to replace every non-admin to `homeForRole` on EVERY
 * path — including the desk's own sub-paths, so an accounts officer who opened
 * Pay → This month was thrown back to Pay's front page. A desk job may stand
 * anywhere inside its one room, and nowhere else in the console.
 */
describe('which console room a desk job may stand in', () => {
  it('names the one /app room of each desk job, and nothing for anyone else', () => {
    expect(consoleDeskFor('STAFF', 'ADMISSIONS')).toBe('/app/enquiries');
    expect(consoleDeskFor('STAFF', 'ACCOUNTS')).toBe('/app/pay');
    expect(consoleDeskFor('STAFF', 'LIBRARIAN')).toBeNull(); // the library lives outside /app
    expect(consoleDeskFor('STAFF', 'DRIVER')).toBeNull();
    expect(consoleDeskFor('SCHOOL_ADMIN', null)).toBeNull();
  });

  it('lets an admin stand anywhere, and says nothing before the role is known', () => {
    expect(consoleBounce('SCHOOL_ADMIN', null, '/app/students')).toBeNull();
    expect(consoleBounce(undefined, undefined, '/app/students')).toBeNull();
  });

  it('keeps the admissions officer on the enquiries desk and sends them back to it from every other room', () => {
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries')).toBeNull();
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app')).toBe('/app/enquiries');
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/students')).toBe('/app/enquiries');
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/pay')).toBe('/app/enquiries');
    // A prefix match stops at a '/': this is not inside the desk.
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiriesx')).toBe('/app/enquiries');
  });

  it('lets the accounts officer use every tab of Pay, not only its front page', () => {
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/pay')).toBeNull();
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/pay/month')).toBeNull();
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/enquiries')).toBe('/app/pay');
  });

  it('sends every other login to its own portal', () => {
    expect(consoleBounce('TEACHER', null, '/app/enquiries')).toBe('/teacher');
    expect(consoleBounce('STAFF', 'DRIVER', '/app/enquiries')).toBe('/staff');
  });
});
```

In `apps/web/app/app/nav-model.test.ts`, change the import to `import { NAV_MODEL, deskModel, groupOf, leafActive, navLeaves, visibleModel } from './nav-model';` and add inside the `describe`:

```ts
  it('a desk job sees its one room — the sidebar never offers a door that bounces', () => {
    expect(deskModel('/app/enquiries').map((e) => (e.kind === 'item' ? e.item.label : e.label))).toEqual(['Enquiries']);
    expect(deskModel('/app/pay').map((e) => (e.kind === 'item' ? e.item.href : e.key))).toEqual(['/app/pay']);
    expect(deskModel('/app/nowhere')).toEqual([]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @skoolos/web test -- lib/role-routes.test.ts app/app/nav-model.test.ts`
Expected: FAIL — `homeForRole('STAFF','ADMISSIONS')` is `/staff`; `consoleDeskFor`, `consoleBounce`, `deskModel` are not exported.

- [ ] **Step 3: Implement the routing rules**

In `apps/web/lib/role-routes.ts`, after the ACCOUNTS line inside `case 'STAFF':` add:

```ts
      // The admissions officer lands on the enquiries desk, the same way.
      if (staffRole === 'ADMISSIONS') return '/app/enquiries';
```

Append to the file:

```ts
/**
 * The one room of the admin console a staff JOB is admitted to — `/app/pay`
 * for the accounts officer, `/app/enquiries` for the admissions officer — or
 * null for everybody else. Derived from `homeForRole`, so a desk is admitted
 * exactly where its login lands and the two can never disagree.
 */
export function consoleDeskFor(role: string | undefined, staffRole?: string | null): string | null {
  if (role !== 'STAFF') return null;
  const home = homeForRole(role, staffRole);
  return home.startsWith('/app/') ? home : null;
}

/**
 * Where the /app layout must send this person from `pathname`, or null when
 * they may stay. An admin stays anywhere; a desk job stays anywhere INSIDE its
 * room (Pay's tabs are sub-paths); everyone else goes to their own portal.
 * Chrome, not authorization — the API's guards are what refuse the data.
 */
export function consoleBounce(
  role: string | undefined,
  staffRole: string | null | undefined,
  pathname: string,
): string | null {
  if (!role || role === 'SCHOOL_ADMIN') return null;
  const desk = consoleDeskFor(role, staffRole);
  if (desk && (pathname === desk || pathname.startsWith(`${desk}/`))) return null;
  return homeForRole(role, staffRole);
}
```

In `apps/web/app/app/nav-model.ts`, append:

```ts
/**
 * A desk job's whole sidebar: the one room it is admitted to. Drawn from the
 * full model, ignoring tier features — the room is the job's, and every other
 * link would only bounce back here.
 */
export function deskModel(desk: string): NavEntry[] {
  return navLeaves(NAV_MODEL)
    .filter((l) => l.href === desk)
    .map((item) => ({ kind: 'item' as const, item }));
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @skoolos/web test -- lib/role-routes.test.ts app/app/nav-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the layout**

In `apps/web/app/app/layout.tsx`:

Line 11 import becomes:

```ts
import { NAV_MODEL, deskModel, groupOf, leafActive, navLeaves, visibleModel, type NavEntry, type NavLeaf } from './nav-model';
```

Line 19 import becomes:

```ts
import { consoleBounce, consoleDeskFor } from '@/lib/role-routes';
```

Replace `ProfileDoor`'s signature and its `active`/`href` lines:

```tsx
function ProfileDoor({ name, pathname, collapsed = false, onNavigate, href = '/app/profile' }: { name: string | null; pathname: string; collapsed?: boolean; onNavigate?: () => void; href?: string }) {
  const initials = (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'ME';
  const active = pathname === href;
  return (
    <Link
      href={href}
```

(the rest of `ProfileDoor` is unchanged).

Replace lines 253-256:

```ts
  const features = me?.features;
  // A desk job (accounts, admissions) sees the one room it is admitted to;
  // everybody else sees the school's menu. Until features load, show every
  // item (avoids hiding things on a slow fetch).
  const desk = consoleDeskFor(me?.role, me?.staffRole);
  const model = desk ? deskModel(desk) : visibleModel(features ?? null);
  const leaves = navLeaves(model);
  // /app/profile would bounce a desk job; the staff profile admits every STAFF.
  const profileHref = desk ? '/staff/profile' : '/app/profile';
```

Replace the redirect effect (lines 295-305) with:

```ts
  useEffect(() => {
    // BOTH role arguments. `homeForRole` needs the staff kind to send an
    // ACCOUNTS officer to /app/pay; called with the role alone it answered
    // /staff, whose own layout knows the kind and sent them straight back here —
    // an accounts officer bounced between the two shells forever.
    //
    // And the desk's own sub-paths are inside the desk: replacing every
    // non-admin to the desk's front page on every path threw an accounts
    // officer out of Pay → This month the moment they opened it.
    const to = consoleBounce(me?.role, me?.staffRole, pathname);
    if (to) router.replace(to);
  }, [me?.role, me?.staffRole, pathname, router]);
```

At line 453 (mobile drawer) the door becomes:

```tsx
              <ProfileDoor name={me?.name ?? null} pathname={pathname} href={profileHref} onNavigate={() => setDrawerOpen(false)} />
```

and at line 532 (sidebar):

```tsx
          <ProfileDoor name={me?.name ?? null} pathname={pathname} href={profileHref} collapsed={collapsed} />
```

- [ ] **Step 6: Run the web suite and typecheck**

Run: `pnpm --filter @skoolos/web test -- lib/role-routes.test.ts app/app/nav-model.test.ts app/console-shell.test.ts lib/z-layers.test.ts && pnpm --filter @skoolos/web typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/role-routes.ts apps/web/lib/role-routes.test.ts \
  apps/web/app/app/nav-model.ts apps/web/app/app/nav-model.test.ts apps/web/app/app/layout.tsx
git commit -m "feat(admissions): the console admits the admissions officer to the enquiries desk and nowhere else

A desk job now stays anywhere inside its own room — the accounts officer
was being thrown out of every Pay tab back to Pay's front page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: "Add enquiry" posts to the desk, the dock uses it, and the course card says where it came from

**Files:**
- Create: `apps/web/app/app/enquiries/add-enquiry.tsx`
- Create: `apps/web/app/app/enquiries/add-enquiry.test.tsx`
- Modify: `apps/web/app/app/dock.tsx:147-187` (remove `EnquiryDrawer`), `:243` (render `AddEnquiryDrawer`)
- Modify: `apps/web/app/app/front-desk.test.tsx:95-111`
- Modify: `apps/web/components/public/enquiry-client.ts:10-16`
- Modify: `apps/web/components/public/sections/CoursesFeatured.tsx:46-51`
- Create: `apps/web/components/public/sections/courses-featured.test.tsx`

**Interfaces:**
- Consumes: `DESK_SOURCES`, `DeskSource`, `PublicSource` (Task 1); `POST /site/enquiries` (Task 5); `Overlay`, `Field`, `FieldRow` from `@/components/ui/kit`.
- Produces: `AddEnquiryDrawer({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void })`; `submitEnquiry(fields)` accepts `source?: PublicSource`.

Before writing UI: load the `sckools-ui-taste` and `ui-mistake-ledger` skills.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/app/app/enquiries/add-enquiry.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { AddEnquiryDrawer } from './add-enquiry';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('Add enquiry — a family who walked in or rang', () => {
  it('posts to the desk with its source, the child and the WhatsApp tick, then hands back the new lead', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({ id: 'new-1' }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    const onClose = vi.fn();
    const onSaved = vi.fn();

    renderWithProviders(<AddEnquiryDrawer onClose={onClose} onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phone call' }));
    fireEvent.change(screen.getByLabelText(/Parent/), { target: { value: ' Meera Purohit ' } });
    fireEvent.change(screen.getByLabelText(/Child/), { target: { value: 'Aarav' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/site/enquiries', {
        parentName: 'Meera Purohit', phone: '98290 11223', source: 'PHONE', whatsappOk: true, childName: 'Aarav',
      }),
    );
    expect(onSaved).toHaveBeenCalledWith('new-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts as a walk-in, and cannot be saved without a name and a number', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
    renderWithProviders(<AddEnquiryDrawer onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Walked in' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save enquiry' })).toBeDisabled();
  });
});
```

Replace the walk-in test in `apps/web/app/app/front-desk.test.tsx` (lines 95-111) with:

```tsx
  it('a walk-in is taken at the desk — owned, never throttled — not posted to the public form', async () => {
    const api = mockApi({ post: vi.fn().mockResolvedValue({ id: 'e1' }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<Dock hasFees={false} open="enquiry" setOpen={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText(/Parent/), { target: { value: 'Meera Purohit' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/site/enquiries', {
        parentName: 'Meera Purohit',
        phone: '98290 11223',
        source: 'WALK_IN',
        whatsappOk: false,
      }),
    );
    expect(api.post).not.toHaveBeenCalledWith('/public/enquiry', expect.anything());
  });
```

```tsx
// apps/web/components/public/sections/courses-featured.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PublicCourse } from '@/lib/public-api';
import CoursesFeatured from './CoursesFeatured';
import { submitEnquiry } from '../enquiry-client';

vi.mock('../enquiry-client', () => ({ submitEnquiry: vi.fn().mockResolvedValue('ok') }));

const NURSERY: PublicCourse = {
  id: 'c1', name: 'Nursery', tagline: 'Play comes first', description: null, highlights: [],
  ageRange: '3–4 years', imageUrl: null, featured: true, fee: null, hallOfFame: [],
};

describe('the course flip card', () => {
  /** The admissions desk shows where each lead came from; this one is not the contact form. */
  it('tells the desk the call-back came from a course card', async () => {
    render(<CoursesFeatured courses={[NURSERY]} />);
    fireEvent.change(screen.getByLabelText('Phone number for Nursery enquiry'), { target: { value: '98290 11223' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request a call' }));
    await waitFor(() =>
      expect(submitEnquiry).toHaveBeenCalledWith(expect.objectContaining({
        phone: '98290 11223', gradeInterest: 'Nursery', source: 'COURSE_CARD',
      })),
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries/add-enquiry.test.tsx app/app/front-desk.test.tsx components/public/sections/courses-featured.test.tsx`
Expected: FAIL — `./add-enquiry` not found; the dock still posts to `/public/enquiry`; the card sends no `source`.

- [ ] **Step 3: Write the drawer on the kit's `Overlay`**

```tsx
// apps/web/app/app/enquiries/add-enquiry.tsx
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DESK_SOURCES, type DeskSource } from '@skoolos/types';
import { Field, FieldRow, Overlay } from '@/components/ui/kit';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';

/** How they reached us, in the words the office would say it. */
const SOURCE_WORDS: Record<DeskSource, string> = { WALK_IN: 'Walked in', PHONE: 'Phone call' };

/**
 * A family who walked in or rang — typed at the desk.
 *
 * Posts to POST /site/enquiries, behind the desk guard: owned by whoever typed
 * it, never throttled. The dock's drawer used to post to the public website
 * endpoint, which throttles by IP (one busy morning at one office IP and the
 * sixth walk-in was refused) and wrote "received from the website" on a family
 * standing at the counter.
 */
export function AddEnquiryDrawer({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [source, setSource] = useState<DeskSource>('WALK_IN');
  const [parentName, setParentName] = useState('');
  const [childName, setChildName] = useState('');
  const [phone, setPhone] = useState('');
  const [gradeInterest, setGradeInterest] = useState('');
  const [message, setMessage] = useState('');
  const [whatsappOk, setWhatsappOk] = useState(false);

  const post = useMutation({
    mutationFn: () => api.post<{ id: string }>('/site/enquiries', {
      parentName: parentName.trim(),
      phone: phone.trim(),
      source,
      whatsappOk,
      ...(childName.trim() ? { childName: childName.trim() } : {}),
      ...(gradeInterest.trim() ? { gradeInterest: gradeInterest.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['site-enquiries'] });
      onClose();
      if (row?.id) onSaved?.(row.id);
      toast.success('Enquiry saved — it is yours on the Admissions desk.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'It did not save.'),
  });

  const ready = parentName.trim() !== '' && phone.trim() !== '';

  return (
    <Overlay
      title="New enquiry"
      subtitle="A family who walked in or rang. It is yours on the Admissions desk."
      onClose={onClose}
      footer={(
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={post.isPending || !ready} onClick={() => post.mutate()}>
          {post.isPending ? 'Saving…' : 'Save enquiry'}
        </button>
      )}
    >
      <div className="sk-enq-filters" role="group" aria-label="How did they reach us?">
        {DESK_SOURCES.map((s) => (
          <button key={s} type="button" className="sk-enq-chip" aria-pressed={source === s} onClick={() => setSource(s)}>
            {SOURCE_WORDS[s]}
          </button>
        ))}
      </div>
      <FieldRow>
        <Field id="enq-parent" label="Parent’s name">
          {(p) => <input {...p} className="sk-input" autoFocus maxLength={120} value={parentName} onChange={(e) => setParentName(e.target.value)} />}
        </Field>
        <Field id="enq-child" label="Child’s name (optional)">
          {(p) => <input {...p} className="sk-input" maxLength={120} value={childName} onChange={(e) => setChildName(e.target.value)} />}
        </Field>
      </FieldRow>
      <FieldRow>
        <Field id="enq-phone" label="Phone number">
          {(p) => <input {...p} className="sk-input" inputMode="tel" maxLength={20} placeholder="98xxx xxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field id="enq-grade" label="Class interested (optional)">
          {(p) => <input {...p} className="sk-input" maxLength={120} placeholder="Nursery / Class VI" value={gradeInterest} onChange={(e) => setGradeInterest(e.target.value)} />}
        </Field>
      </FieldRow>
      <Field id="enq-note" label="Notes (optional)">
        {(p) => <textarea {...p} className="sk-input" rows={3} maxLength={1000} style={{ resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" checked={whatsappOk} onChange={(e) => setWhatsappOk(e.target.checked)} />
        They are happy to get WhatsApp messages from the school
      </label>
    </Overlay>
  );
}
```

- [ ] **Step 4: Switch the dock to it**

In `apps/web/app/app/dock.tsx`: delete the whole `EnquiryDrawer` function (lines 147-187), add `import { AddEnquiryDrawer } from './enquiries/add-enquiry';` with the other imports, and replace line 243 with:

```tsx
      {hydrated && open === 'enquiry' && <AddEnquiryDrawer onClose={() => setOpen(null)} />}
```

(`Drawer`, `field`, `PaymentPicker` and `AnnounceDrawer` stay; `dock.tsx` stays on the `sk-kit.test.ts` overlay allow-list for them.)

- [ ] **Step 5: Send the card's source**

`apps/web/components/public/enquiry-client.ts` — add the import and widen `fields`:

```ts
import type { PublicSource } from '@skoolos/types';
```

```ts
export async function submitEnquiry(fields: {
  parentName: string;
  phone: string;
  email?: string;
  gradeInterest?: string;
  message?: string;
  /** Which public door — the course card says so; the contact form leaves it to default to WEBSITE. */
  source?: PublicSource;
}): Promise<EnquiryResult> {
```

`apps/web/components/public/sections/CoursesFeatured.tsx` — the call becomes:

```tsx
    const result = await submitEnquiry({
      parentName: 'Course card lead',
      phone: p,
      gradeInterest: course.name,
      message: `Requested a call back about ${course.name} from the homepage.`,
      source: 'COURSE_CARD',
    });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries/add-enquiry.test.tsx app/app/front-desk.test.tsx components/public/sections app/sk-kit.test.ts lib/z-layers.test.ts && pnpm --filter @skoolos/web typecheck`
Expected: PASS — `sk-kit.test.ts` is green because the new drawer uses `Overlay` and adds no `createPortal`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/app/enquiries/add-enquiry.tsx apps/web/app/app/enquiries/add-enquiry.test.tsx \
  apps/web/app/app/dock.tsx apps/web/app/app/front-desk.test.tsx \
  apps/web/components/public/enquiry-client.ts apps/web/components/public/sections/CoursesFeatured.tsx \
  apps/web/components/public/sections/courses-featured.test.tsx
git commit -m "feat(admissions): walk-ins go to the desk, not the public form; the course card names itself

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The desk screen — filters, source chip, Call/WhatsApp with an outcome sheet, forward-only stages, Reopen, owner picker, Add, Export

**Files:**
- Modify (full replacement): `apps/web/app/app/enquiries/page.tsx`
- Modify (full replacement): `apps/web/app/app/enquiries/lead-panel.tsx`
- Create: `apps/web/app/app/enquiries/lead-panel.test.tsx`
- Create: `apps/web/app/app/enquiries/page.test.tsx`
- Modify: `apps/web/app/sk-theme.css:2854-2866` (four rules)
- Create: `apps/web/audit/enquiries.test.tsx`
- Modify: `apps/web/.gitignore` (one line)

**Interfaces:**
- Consumes: everything from Task 6 (`OUTCOMES`, `stageButtons`, `sourceLabel`, `leadsCsv`, `matchesFilter` with `meId`, the new `Lead` fields); `EnquiryDeskMember`, `ContactKind`, `ContactOutcome` (Task 1); `GET /site/enquiries/owners` (Task 3); `POST /site/enquiries/:id/notes` with `kind`/`outcome`/`lostReason` (Task 5); `AddEnquiryDrawer` (Task 8); `saveBlob(blob, filename)` from `@/lib/save-blob`.
- Produces: the finished `/app/enquiries` desk.

Before writing UI: load the `sckools-ui-taste` and `ui-mistake-ledger` skills.

- [ ] **Step 1: Write the failing panel tests**

```tsx
// apps/web/app/app/enquiries/lead-panel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { LeadPanel } from './lead-panel';
import type { Lead } from './lead';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const BASE: Lead & { notes: [] } = {
  id: 'L1', parentName: 'Meera Purohit', childName: 'Aarav', phone: '+91 98290 11223', email: null,
  gradeInterest: 'Class III', message: null, status: 'CONTACTED', source: 'WALK_IN', whatsappOk: true,
  followUpAt: null, lastContactedAt: null, ownerUserId: 'u-gone', ownerName: 'Ravi Old', ownerOnDesk: false,
  lostReason: null, noteCount: 0, createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z',
  notes: [],
};
const OWNERS = [
  { userId: 'u-off', name: 'Sunita Kale', job: 'ADMISSIONS' },
  { userId: 'u-adm', name: 'Principal Rathore', job: 'ADMIN' },
];

function mount(detail: Partial<Lead> = {}): ApiStub {
  const api: ApiStub = {
    get: vi.fn(async (path: string) => (path === '/site/enquiries/owners' ? OWNERS : { ...BASE, ...detail })),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn().mockResolvedValue({}), del: vi.fn(),
  };
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
  renderWithProviders(<LeadPanel id="L1" />);
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the lead panel', () => {
  it('offers only the stages ahead', async () => {
    const api = mount();
    await screen.findByRole('heading', { name: 'Meera Purohit' });
    const stages = within(screen.getByRole('group', { name: 'Admissions stage' }));
    expect(stages.getByRole('button', { name: 'New' })).toBeDisabled();
    expect(stages.getByRole('button', { name: 'Contacted' })).toBeDisabled();
    fireEvent.click(stages.getByRole('button', { name: 'Interested' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { status: 'INTERESTED' }));
  });

  it('Call opens the dialler and asks how it went; "No answer" logs the call and nothing else', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    const sheet = within(screen.getByRole('group', { name: 'How did it go?' }));
    fireEvent.click(sheet.getByRole('button', { name: 'No answer' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { kind: 'CALL', outcome: 'NO_ANSWER' }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('"Lost" after a WhatsApp asks why before it logs', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'WhatsApp' }));
    const sheet = within(screen.getByRole('group', { name: 'How did it go?' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Lost' }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Why the family is not going ahead'), { target: { value: 'Fees too high' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Mark lost' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/site/enquiries/L1/notes', { kind: 'WHATSAPP', outcome: 'LOST', lostReason: 'Fees too high' }));
  });

  it('"Not now" closes the question and writes nothing', async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole('link', { name: /^Call / }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('group', { name: 'How did it go?' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a lost lead is reopened, not clicked backwards', async () => {
    const api = mount({ status: 'LOST', lostReason: 'Too far' });
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/site/enquiries/L1', { status: 'CONTACTED' }));
  });

  it('the owner picker lists the desk, and names an owner who has left rather than showing "Nobody yet"', async () => {
    const api = mount();
    const picker = await screen.findByLabelText('Whose lead this is');
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Sunita Kale · Admissions' })).toBeInTheDocument());
    expect(within(picker).getByRole('option', { name: 'Ravi Old — no longer on the desk' })).toBeInTheDocument();
    expect((picker as HTMLSelectElement).value).toBe('u-gone');
    expect(api.get).not.toHaveBeenCalledWith('/manage/staff');
  });
});
```

- [ ] **Step 2: Write the failing page tests**

```tsx
// apps/web/app/app/enquiries/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';
import EnquiriesPage from './page';
import type { Lead } from './lead';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));

const lead = (id: string, over: Partial<Lead>): Lead => ({
  id, parentName: 'Parent', childName: null, phone: '+91 98290 11223', email: null, gradeInterest: 'Class III',
  message: null, status: 'NEW', source: 'WEBSITE', whatsappOk: false, followUpAt: null, lastContactedAt: null,
  ownerUserId: null, ownerName: null, ownerOnDesk: false, lostReason: null, noteCount: 0,
  createdAt: '2026-10-01T05:00:00.000Z', updatedAt: '2026-10-01T05:00:00.000Z', ...over,
});
const MINE = lead('L1', { parentName: 'Mine Parent', ownerUserId: 'u-off', ownerName: 'Sunita Kale', ownerOnDesk: true, source: 'WALK_IN' });
const FREE = lead('L2', { parentName: 'Free Parent' });

function mount(me: Record<string, unknown>): ApiStub {
  const api: ApiStub = {
    get: vi.fn(async (path: string) => {
      if (path === '/auth/me') return me;
      if (path === '/site/enquiries') return [MINE, FREE];
      if (path === '/site/enquiries/owners') return [];
      return { ...(path.endsWith('L1') ? MINE : FREE), notes: [] };
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
  renderWithProviders(<EnquiriesPage />);
  return api;
}

const rows = () => within(screen.getByRole('listbox', { name: 'Leads' })).getAllByRole('option');

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the admissions desk', () => {
  it('opens an officer on their own leads, with each lead’s source on its row', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Mine Parent');
    expect(rows()[0]).toHaveTextContent('Walk-in');
    expect(screen.getByRole('button', { name: /^My leads/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Unowned shows the leads nobody has taken', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^Unowned/ }));
    await waitFor(() => expect(rows()[0]).toHaveTextContent('Free Parent'));
    expect(rows()).toHaveLength(1);
  });

  it('opens an admin on every open lead', async () => {
    mount({ userId: 'u-adm', role: 'SCHOOL_ADMIN', staffRole: null });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole('button', { name: /^Open/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exports what is on screen, named for the filter and the day', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^enquiries-mine-\d{4}-\d{2}-\d{2}\.csv$/));
  });

  it('Add enquiry opens the walk-in form', async () => {
    mount({ userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add enquiry' }));
    expect(await screen.findByRole('dialog', { name: 'New enquiry' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries/lead-panel.test.tsx app/app/enquiries/page.test.tsx`
Expected: FAIL — no "Admissions stage" disabled buttons for past stages, no outcome sheet, no My leads chip, no Export/Add buttons.

- [ ] **Step 4: Replace `lead-panel.tsx`**

```tsx
// apps/web/app/app/enquiries/lead-panel.tsx
'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ContactKind, ContactOutcome, EnquiryDeskMember } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  OUTCOMES, STAGE_LABEL, dialable, dueLabel, sourceLabel, stageButtons, stageTone,
  type EnquiryNote, type EnquiryStage, type Lead,
} from './lead';

interface Detail extends Lead {
  notes: EnquiryNote[];
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

/** The question the sheet asks, by what was just used. */
const ASK: Record<ContactKind, string> = {
  CALL: 'How did the call go?',
  WHATSAPP: 'How did the WhatsApp go?',
  VISIT: 'How did the visit go?',
};

/**
 * The lead you are working on.
 *
 * Everything the list does not say lives here — the message, the way to reach
 * them, where it has got to, and what was actually said. The list carries who
 * and when and nothing else, so the two halves never state the same fact twice.
 *
 * Call and WhatsApp open the phone AND ask how it went. The answer is what gets
 * logged, in one request, so a call that rang out is recorded as exactly that
 * and never moves a new family to "Contacted".
 */
export function LeadPanel({ id }: { id: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [lostWhy, setLostWhy] = useState('');
  const [askingWhy, setAskingWhy] = useState(false);
  const [contact, setContact] = useState<ContactKind | null>(null);
  const [contactLost, setContactLost] = useState(false);
  const [contactWhy, setContactWhy] = useState('');

  const detail = useQuery({
    queryKey: ['enquiry', id, host],
    enabled: !!host && !!id,
    queryFn: () => api.get<Detail>(`/site/enquiries/${id}`),
  });

  // The desk's own list — works on every plan, unlike /manage/staff.
  const owners = useQuery({
    queryKey: ['enquiry-owners', host],
    enabled: !!host,
    queryFn: () => api.get<EnquiryDeskMember[]>('/site/enquiries/owners'),
    staleTime: 5 * 60_000,
  });

  // A different lead is a different form; carrying the half-typed note — or an
  // open "how did it go?" — across would attach it to the wrong family.
  useEffect(() => {
    setNote('');
    setLostWhy('');
    setAskingWhy(false);
    setContact(null);
    setContactLost(false);
    setContactWhy('');
  }, [id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['enquiry', id] });
    void qc.invalidateQueries({ queryKey: ['site-enquiries'] });
  };

  const closeSheet = () => {
    setContact(null);
    setContactLost(false);
    setContactWhy('');
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/site/enquiries/${id}`, body),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/site/enquiries/${id}/notes`, { body }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const log = useMutation({
    mutationFn: (body: { kind: ContactKind; outcome: ContactOutcome; lostReason?: string | null }) =>
      api.post(`/site/enquiries/${id}/notes`, body),
    onSuccess: () => {
      closeSheet();
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) return <p className="sk-state">Opening the lead…</p>;
  if (detail.error || !detail.data) {
    return <p className="sk-state err">{(detail.error as Error)?.message ?? 'That enquiry could not be found.'}</p>;
  }

  const l = detail.data;
  const tel = dialable(l.phone);
  const due = dueLabel(l);
  const lost = l.status === 'LOST' || l.status === 'CLOSED';
  const members = owners.data ?? [];
  // An owner who has left the desk is still the owner on the row; without an
  // option for them the select would silently read "Nobody yet".
  const ownerMissing = !!l.ownerUserId && !members.some((m) => m.userId === l.ownerUserId);

  function moveTo(stage: EnquiryStage) {
    if (stage === 'LOST') {
      setAskingWhy(true);
      return;
    }
    patch.mutate({ status: stage });
  }

  function answer(outcome: ContactOutcome) {
    if (!contact) return;
    if (outcome === 'LOST') {
      setContactLost(true);
      return;
    }
    log.mutate({ kind: contact, outcome });
  }

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>{l.parentName}</h3>
        <span className="sk-pill" data-tone={stageTone(l.status)}>{STAGE_LABEL[l.status]}</span>
        <span className="sp" />
        <span className="sk-muted">{l.gradeInterest ?? 'No class given'}</span>
      </div>

      <div className="sk-card-b">
        <p className="sk-muted" style={{ fontSize: 12 }}>
          {sourceLabel(l)}
          {l.childName ? ` · for ${l.childName}` : ''}
          {' · '}
          {l.lastContactedAt ? `last contacted ${when(l.lastContactedAt)}` : 'not contacted yet'}
          {l.whatsappOk ? ' · happy to get WhatsApp' : ''}
        </p>

        {l.message ? <p style={{ fontSize: 13.5, color: 'var(--sk-ink-2)' }}>{l.message}</p> : null}

        <div className="sk-enq-contact">
          <a className="sk-btn" data-variant="primary" href={`tel:${tel}`} onClick={() => setContact('CALL')}>
            Call {l.phone}
          </a>
          <a
            className="sk-btn"
            href={`https://wa.me/${tel.replace(/^\+/, '')}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setContact('WHATSAPP')}
          >
            WhatsApp
          </a>
          {l.email ? (
            <a className="sk-btn" href={`mailto:${l.email}`}>Email</a>
          ) : (
            <span className="sk-btn" aria-disabled="true" style={{ color: 'var(--sk-ink-3)', cursor: 'not-allowed' }}>
              No email given
            </span>
          )}
        </div>

        {contact ? (
          <div className="sk-enq-outcome" role="group" aria-label="How did it go?">
            <p className="sk-lab">{ASK[contact]}</p>
            <div className="opts">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className="sk-btn"
                  aria-pressed={o.key === 'LOST' ? contactLost : undefined}
                  disabled={log.isPending}
                  onClick={() => answer(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {contactLost ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="sk-input"
                  style={{ flex: '1 1 180px' }}
                  value={contactWhy}
                  onChange={(e) => setContactWhy(e.target.value)}
                  placeholder="Why are they not going ahead?"
                  aria-label="Why the family is not going ahead"
                />
                <button
                  className="sk-btn"
                  data-variant="primary"
                  type="button"
                  disabled={log.isPending}
                  onClick={() => log.mutate({ kind: contact, outcome: 'LOST', lostReason: contactWhy.trim() || null })}
                >
                  Mark lost
                </button>
              </div>
            ) : null}
            <button type="button" className="sk-btn" style={{ justifySelf: 'start' }} onClick={closeSheet}>
              Not now
            </button>
          </div>
        ) : null}

        <div>
          <p className="sk-lab" style={{ marginBottom: 5 }}>Where it has got to</p>
          <div className="sk-enq-stages" role="group" aria-label="Admissions stage">
            {stageButtons(l.status).map((b) => (
              <button
                key={b.key}
                type="button"
                className="sk-enq-stage"
                data-state={b.state}
                aria-pressed={b.state === 'now'}
                disabled={!b.canClick || patch.isPending}
                onClick={() => moveTo(b.key)}
              >
                {b.label}
              </button>
            ))}
            <button
              type="button"
              className="sk-enq-stage"
              data-state={lost ? 'lost' : undefined}
              aria-pressed={lost}
              disabled={lost || patch.isPending}
              onClick={() => moveTo('LOST')}
            >
              Lost
            </button>
          </div>

          {lost ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              {l.lostReason ? <span className="sk-muted" style={{ fontSize: 11.5 }}>Reason: {l.lostReason}</span> : null}
              <button type="button" className="sk-btn" data-size="sm" disabled={patch.isPending} onClick={() => patch.mutate({ status: 'CONTACTED' })}>
                Reopen
              </button>
            </div>
          ) : null}

          {askingWhy ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="sk-input"
                style={{ flex: '1 1 180px' }}
                value={lostWhy}
                onChange={(e) => setLostWhy(e.target.value)}
                placeholder="Why did it not go ahead?"
                aria-label="Why the lead was lost"
              />
              <button
                className="sk-btn"
                data-variant="primary"
                type="button"
                onClick={() => {
                  patch.mutate({ status: 'LOST', lostReason: lostWhy.trim() || null });
                  setAskingWhy(false);
                }}
              >
                Mark lost
              </button>
              <button className="sk-btn" type="button" onClick={() => setAskingWhy(false)}>Cancel</button>
            </div>
          ) : null}
        </div>

        <div className="sk-enq-fields">
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Ring them again on</span>
            <input
              className="sk-input"
              type="date"
              value={l.followUpAt ? l.followUpAt.slice(0, 10) : ''}
              disabled={lost || l.status === 'ENROLLED'}
              onChange={(e) => patch.mutate({ followUpAt: e.target.value || null })}
            />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="sk-lab">Whose lead this is</span>
            <select
              className="sk-input"
              value={l.ownerUserId ?? ''}
              onChange={(e) => patch.mutate({ ownerUserId: e.target.value || null })}
            >
              <option value="">Nobody yet</option>
              {ownerMissing ? (
                <option value={l.ownerUserId as string}>
                  {owners.isSuccess ? `${l.ownerName ?? 'Somebody'} — no longer on the desk` : (l.ownerName ?? '…')}
                </option>
              ) : null}
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} · {m.job === 'ADMISSIONS' ? 'Admissions' : 'Admin'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {due && due.tone !== 'muted' ? (
          <span className="sk-pill" data-tone={due.tone === 'bad' ? 'bad' : 'warn'} style={{ alignSelf: 'flex-start' }}>
            {due.text}
          </span>
        ) : null}

        <div>
          <p className="sk-lab" style={{ marginBottom: 5 }}>What happened</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              className="sk-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && note.trim()) addNote.mutate(note.trim());
              }}
              placeholder="What did they say?"
              aria-label="Add a note"
            />
            <button
              className="sk-btn"
              data-variant="primary"
              type="button"
              disabled={!note.trim() || addNote.isPending}
              onClick={() => addNote.mutate(note.trim())}
            >
              {addNote.isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
          {l.notes.length ? (
            l.notes.map((n) => (
              <div key={n.id} className="sk-enq-tl" data-kind={n.kind}>
                <span className="dot" />
                <span>
                  <span className="body">{n.body}</span>
                  <br />
                  <span className="who">
                    {n.authorName ? `${n.authorName} · ` : ''}
                    {when(n.createdAt)}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <p className="sk-state">Nothing recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace `page.tsx`**

```tsx
// apps/web/app/app/enquiries/page.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { saveBlob } from '@/lib/save-blob';
import { LeadPanel } from './lead-panel';
import { AddEnquiryDrawer } from './add-enquiry';
import {
  STAGE_LABEL, avatarVar, deskCounts, deskOrder, dueLabel, initials, leadsCsv,
  matchesFilter, matchesQuery, sourceLabel, stageTone,
  type DeskFilter, type Lead,
} from './lead';

interface Me {
  userId?: string;
  role?: string;
  staffRole?: string | null;
}

const CHIPS: { key: DeskFilter; label: string }[] = [
  { key: 'MINE', label: 'My leads' },
  { key: 'UNOWNED', label: 'Unowned' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'INTERESTED', label: 'Interested' },
  { key: 'VISITED', label: 'Visited' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'ENROLLED', label: 'Enrolled' },
  { key: 'LOST', label: 'Lost' },
];

/** What an empty filter means, where "Nothing matches" would say too little. */
const EMPTY: Partial<Record<DeskFilter, string>> = {
  MINE: 'No leads are yours yet — take one from Unowned.',
  UNOWNED: 'Every open lead has somebody on it.',
};

/**
 * The admissions desk.
 *
 * The summary tiles answer the question the desk asks every morning — who do
 * I ring today — and each one filters the list. The list sorts by urgency,
 * because the bottom of a date-ordered list is where a forgotten family stays
 * forgotten. An admissions officer opens on their own leads; an admin on every
 * open one.
 */
export default function EnquiriesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const [picked, setPicked] = useState<DeskFilter | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const me = useQuery({
    queryKey: ['me', host],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });
  const meId = me.data?.userId ?? null;
  const officer = me.data?.role === 'STAFF' && me.data?.staffRole === 'ADMISSIONS';
  const home: DeskFilter = officer ? 'MINE' : 'OPEN';
  const filter: DeskFilter = picked ?? home;

  const leads = useQuery({
    queryKey: ['site-enquiries', host],
    queryFn: () => api.get<Lead[]>('/site/enquiries'),
    enabled: !!host,
    staleTime: 30_000,
  });

  const rows = useMemo(() => {
    const all = leads.data ?? [];
    return deskOrder(all.filter((l) => matchesFilter(l, filter, undefined, meId) && matchesQuery(l, query)));
  }, [leads.data, filter, query, meId]);

  const counts = useMemo(() => deskCounts(leads.data ?? []), [leads.data]);

  // Keep a lead selected as the list changes, but never one that has been
  // filtered away — a detail panel showing a family you cannot see in the list
  // is how you edit the wrong record.
  useEffect(() => {
    if (rows.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !rows.some((r) => r.id === selected)) setSelected(rows[0].id);
  }, [rows, selected]);

  function exportCsv() {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    saveBlob(new Blob([leadsCsv(rows)], { type: 'text/csv;charset=utf-8' }), `enquiries-${filter.toLowerCase()}-${day}.csv`);
  }

  const tiles: { key: DeskFilter; lab: string; n: number; tone?: string; hint: string }[] = [
    { key: 'OVERDUE', lab: 'Overdue', n: counts.overdue, tone: 'bad', hint: 'past their callback' },
    { key: 'TODAY', lab: 'Due today', n: counts.today, tone: 'warn', hint: 'ring these first' },
    { key: 'NEW', lab: 'Never contacted', n: counts.never, hint: 'nobody has called yet' },
    { key: 'NODUE', lab: 'No next step', n: counts.nodue, hint: 'open, with no callback set' },
    { key: 'ENROLLED', lab: 'Enrolled', n: counts.enrolled, tone: 'good', hint: `of ${(leads.data ?? []).length} enquiries` },
  ];

  return (
    <div className="skosx">
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Enquiries</h1>
          <p>Every family who asked about a place — and what happens next for each of them.</p>
        </div>
        <div className="sk-wrap-sm" style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sk-btn sk-press" disabled={rows.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setAdding(true)}>
            Add enquiry
          </button>
        </div>
      </header>

      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            className="sk-kpi"
            data-tone={t.tone}
            aria-pressed={filter === t.key}
            onClick={() => setPicked(filter === t.key ? home : t.key)}
          >
            <span className="lab">{t.lab}</span>
            <span className="n">{t.n}</span>
            <span className="hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="sk-enq-desk" style={{ marginTop: 16 }}>
        <div className="sk-card">
          <div className="sk-card-b" style={{ gap: 12 }}>
            <input
              className="sk-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a name or a phone number…"
              aria-label="Search leads"
            />

            <div className="sk-enq-filters" role="group" aria-label="Filter leads">
              {CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="sk-enq-chip"
                  aria-pressed={filter === c.key}
                  onClick={() => setPicked(c.key)}
                >
                  {c.label} {(leads.data ?? []).filter((l) => matchesFilter(l, c.key, undefined, meId)).length}
                </button>
              ))}
            </div>

            {leads.isLoading ? <p className="sk-state">Reading the enquiries…</p> : null}
            {leads.error ? <p className="sk-state err">{(leads.error as Error).message}</p> : null}

            {!leads.isLoading && !leads.error && rows.length === 0 ? (
              <p className="sk-state">
                {(leads.data ?? []).length === 0
                  ? 'No enquiries yet — they appear here the moment somebody submits the form on your website, or you add one.'
                  : (EMPTY[filter] ?? 'Nothing matches.')}
              </p>
            ) : null}

            {rows.length > 0 ? (
              <div className="sk-enq-list" role="listbox" aria-label="Leads">
                {rows.map((l) => {
                  const due = dueLabel(l);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="option"
                      className="sk-enq-row"
                      aria-selected={selected === l.id}
                      aria-current={selected === l.id}
                      onClick={() => setSelected(l.id)}
                    >
                      <span className="av" style={{ background: `var(${avatarVar(l.parentName)})` }}>
                        {initials(l.parentName)}
                      </span>
                      <span className="txt">
                        <span className="nm">{l.parentName}</span>
                        <span className="meta">
                          {l.gradeInterest ?? 'No class given'}
                          {l.ownerName ? ` · ${l.ownerName}` : ''}
                        </span>
                      </span>
                      <span className="side">
                        <span className="sk-pill" data-tone={stageTone(l.status)}>{STAGE_LABEL[l.status]}</span>
                        <span className="sk-enq-src">{sourceLabel(l)}</span>
                        {due ? <span className="sk-enq-due" data-tone={due.tone}>{due.text}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div>{selected ? <LeadPanel id={selected} /> : <p className="sk-state">Pick a family on the left.</p>}</div>
      </div>

      {adding ? <AddEnquiryDrawer onClose={() => setAdding(false)} onSaved={(id) => setSelected(id)} /> : null}
    </div>
  );
}
```

- [ ] **Step 6: Add the four style rules**

In `apps/web/app/sk-theme.css`, after `.sk-enq-stage[data-state="lost"] { … }` (line 2854) add:

```css
/* A stage already passed is a record, not a button. It keeps its colour: a
   faded "done" step reads as broken, not finished (opacity is never a
   disabled state here). Only an unstated stage loses its hover. */
.sk-enq-stage:disabled { cursor: default; }
.sk-enq-stage:disabled:not([data-state]):hover { border-color: var(--sk-line); }

/* The question after a call — four answers, one tap each. A card on the card,
   outlined in the brand so it reads as "answer me", not as another section. */
.sk-enq-outcome {
  display: grid; gap: 9px; padding: 12px; border-radius: 12px;
  border: 1.5px solid var(--sk-brand); background: var(--sk-card);
}
.sk-enq-outcome .opts { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 560px) { .sk-enq-outcome .opts { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

/* Where a lead came from, on its row. Outlined and grey on purpose: a source
   is a fact, not a status, and a second filled pill under the stage pill read
   as two statuses. */
.sk-enq-src {
  font-size: 10px; font-weight: 700; color: var(--sk-ink-2); white-space: nowrap;
  border: 1px solid var(--sk-line); border-radius: 6px; padding: 1px 6px;
}
```

and after `.sk-enq-tl[data-kind="SYSTEM"] .dot { … }` (line 2864) add:

```css
/* Somebody reached the family — amber, so contacts stand out from notes and stage moves. */
.sk-enq-tl[data-kind="CALL"] .dot,
.sk-enq-tl[data-kind="WHATSAPP"] .dot,
.sk-enq-tl[data-kind="VISIT"] .dot { background: var(--sk-amber-ink); }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @skoolos/web test -- app/app/enquiries app/sk-kit.test.ts lib/z-layers.test.ts && pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/web lint`
Expected: PASS, clean.

- [ ] **Step 8: Render it and measure it**

Create `apps/web/audit/enquiries.test.tsx` (the `run` harness is the one in `audit/announcements.test.tsx`; fixtures use the longest realistic values, per the ui-mistake-ledger):

```tsx
// apps/web/audit/enquiries.test.tsx
/* eslint-disable react/jsx-key -- panels are mounted one at a time, never as siblings */
import { it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appCss } from './app-css';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import EnquiriesPage from '@/app/app/enquiries/page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));

const NAMES = ['Rajeshwari Balasubramanian', 'Mohammed Irfan Qureshi', 'Aadhya Venkataraghavan', 'Priya Nair'];
const STAGES = ['NEW', 'CONTACTED', 'INTERESTED', 'VISITED', 'LOST'];
const SOURCES = ['WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE'];

const LEADS = Array.from({ length: 12 }, (_, i) => ({
  id: `L${i}`,
  parentName: NAMES[i % 4],
  childName: i % 2 ? 'Saanvi Krishnamurthy' : null,
  phone: '+91 98290 11223',
  email: i % 3 ? null : 'rajeshwari.balasubramanian@example.com',
  gradeInterest: 'Class XI — Science (PCM with Computer Science)',
  message: 'We are moving from Bengaluru in April and want to know about transport from Malviya Nagar and the hostel.',
  status: STAGES[i % 5],
  source: SOURCES[i % 4],
  whatsappOk: i % 2 === 0,
  followUpAt: i % 4 ? '2026-10-03' : null,
  lastContactedAt: i % 3 ? '2026-10-02T06:30:00.000Z' : null,
  ownerUserId: i % 2 ? 'u-off' : null,
  ownerName: i % 2 ? 'Sunita Kale' : null,
  ownerOnDesk: i % 2 === 1,
  lostReason: i % 5 === 4 ? 'Chose a school nearer home — the bus would take an hour each way' : null,
  noteCount: 2,
  createdAt: `2026-09-${String(10 + i).padStart(2, '0')}T05:00:00.000Z`,
  updatedAt: '2026-10-02T06:30:00.000Z',
}));

const NOTES = [
  { id: 'n1', kind: 'CALL', body: 'Called — interested', authorName: 'Sunita Kale', createdAt: '2026-10-02T06:30:00.000Z' },
  { id: 'n2', kind: 'STAGE', body: 'Moved to Interested', authorName: 'Sunita Kale', createdAt: '2026-10-02T06:30:01.000Z' },
  { id: 'n3', kind: 'SYSTEM', body: 'Enquiry received from the website — asked about Class XI', authorName: null, createdAt: '2026-09-10T05:00:00.000Z' },
];

beforeEach(() => {
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn(async (p: string) => {
      if (p === '/auth/me') return { userId: 'u-off', role: 'STAFF', staffRole: 'ADMISSIONS' };
      if (p === '/site/enquiries') return LEADS;
      if (p === '/site/enquiries/owners') {
        return [
          { userId: 'u-off', name: 'Sunita Kale', job: 'ADMISSIONS' },
          { userId: 'u-adm', name: 'Principal Rajeshwari Balasubramanian', job: 'ADMIN' },
        ];
      }
      return { ...LEADS[1], notes: NOTES };
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as never);
});

type Step = (host: HTMLElement) => void;

async function run(node: React.ReactNode, steps: Step[] = []): Promise<{ html: string; portal: string }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const root = createRoot(host);
  const settle = async () => {
    let prev = '';
    for (let i = 0; i < 10 && document.body.innerHTML !== prev; i += 1) {
      prev = document.body.innerHTML;
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
  };
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await settle();
  for (const step of steps) {
    await act(async () => { step(host); });
    await settle();
  }
  const portal = [...document.body.children]
    .filter((el) => el !== host && el.querySelector('.sk-panel'))
    .map((el) => el.outerHTML)
    .join('');
  const html = host.innerHTML;
  await act(async () => { root.unmount(); });
  host.remove();
  return { html, portal };
}

const press = (label: string): Step => (host) => {
  [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)?.click();
};
const call: Step = (host) => {
  [...host.querySelectorAll('a')].find((a) => (a.textContent ?? '').startsWith('Call '))?.click();
};

it('writes the real admissions desk for a browser to measure', async () => {
  const panels: [string, Step[]][] = [
    ['Enquiries — my leads', []],
    ['Enquiries — unowned', [(host) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('Unowned'))?.click()]],
    ['Enquiries — after a call', [call]],
    ['Enquiries — after a call, not going ahead', [call, press('Lost')]],
    ['Enquiries — add an enquiry', [press('Add enquiry')]],
  ];
  const parts: string[] = [];
  const portals: string[] = [];
  for (const [name, steps] of panels) {
    const { html, portal } = await run(<EnquiriesPage />, steps);
    expect(html.length, name).toBeGreaterThan(500);
    parts.push(`<section class="audit-panel" data-panel="${name}"><h2 class="audit-h">${name}</h2>${html}</section>`);
    if (portal) portals.push(`<div class="audit-panel" data-panel="${name}">${portal}</div>`);
  }
  const body = parts.join('\n');
  writeFileSync(resolve(process.cwd(), 'audit/enquiries.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${appCss()}</style>
<style>
*{animation:none!important;transition:none!important}
body{margin:0;padding:10px;background:var(--sk-bg,#fff)}
.audit-panel{margin:0 0 26px}
.audit-h{font:600 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#888;margin:0 0 7px}</style>
</head><body><main class="skosx sk-anim" style="padding:24px">${body}</main>${portals.join('')}</body></html>`);

  expect(body, 'the long name rendered').toContain('Mohammed Irfan Qureshi');
  expect(body, 'the source chip rendered').toContain('sk-enq-src');
  expect(body, 'the outcome sheet opened').toContain('How did the call go?');
  expect(body, 'Lost asked why').toContain('Why the family is not going ahead');
  expect(portals.join(''), 'the add drawer opened').toContain('sk-panel');
  console.log(`wrote audit/enquiries.html — ${body.length} bytes, ${portals.length} portals`);
});
```

Add `audit/enquiries.html` to `apps/web/.gitignore` under the "Generated by the audit renderers" block.

Run:
```bash
pnpm --filter @skoolos/web build
pnpm --filter @skoolos/web audit:screens -- audit/enquiries.test.tsx
cd apps/web/audit && python3 -m http.server 8797
```
Open `http://localhost:8797/measure.html?file=./enquiries.html` in Chrome. Expected: CLEAN at 360, 390, 414, 768, 1024 and 1280 (no OVERFLOW, CLIPPED, TAP or DIALOG findings). Then look at it at 360 and 1280: the outcome sheet's four answers sit two-by-two on a phone and in one row on a laptop; the source chip sits under the stage pill without widening the row; done stages keep their green, the current stage its brand tint, and nothing is faded. Fix any finding, re-run, and stop the server.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/app/enquiries/page.tsx apps/web/app/app/enquiries/lead-panel.tsx \
  apps/web/app/app/enquiries/lead-panel.test.tsx apps/web/app/app/enquiries/page.test.tsx \
  apps/web/app/sk-theme.css apps/web/audit/enquiries.test.tsx apps/web/.gitignore
git commit -m "feat(admissions): the desk — My leads / Unowned, source chip, calls that log their outcome, forward-only stages, Reopen, desk owners, Add and Export

Measured CLEAN at 360–1280 (audit/enquiries.html).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Gate, push, PR to staging

- [ ] **Step 1: Run the gate**

Run: `pnpm preflight`
Expected: "✅ preflight passed". A red step is fixed, never skipped, and preflight is re-run from the top.

- [ ] **Step 2: Check what is going up**

Run:
```bash
git fetch origin
git status --short
git log --oneline origin/staging..HEAD
```
Expected: a clean tree and exactly the nine commits of Tasks 1–9 on top of `origin/staging`.

- [ ] **Step 3: Push the branch**

Run: `git push -u origin feat/admissions-tier-a`

- [ ] **Step 4: Open the PR to staging (do not merge)**

```bash
gh pr create --base staging --head feat/admissions-tier-a \
  --title "feat(admissions): the admissions officer — Tier A" \
  --body "$(cat <<'EOF'
Tier A of docs/superpowers/specs/2026-10-06-admissions-officer-design.md (plan: docs/superpowers/plans/2026-10-06-admissions-tier-a.md).

## What ships
- **The job.** `StaffRole.ADMISSIONS` ("Admissions officer"), offered at every school. It lands on `/app/enquiries` and the console admits it nowhere else; the sidebar shows only its room. (The same rule now lets an accounts officer use every Pay tab — before, `/app/pay/month` bounced to `/app/pay`.)
- **The door.** `AdmissionsDeskGuard` on `/site/enquiries/*` (403 `NOT_ADMISSIONS_DESK`); `isAdmissionsDesk` exported for Tier B.
- **The pipeline.** INTERESTED between Contacted and Visited; stages move forward only (409 `ENQUIRY_STAGE_BACKWARDS`), Lost from anywhere, Reopen from Lost to Contacted. One rule set in `@skoolos/types`.
- **The lead.** `source`, `childName`, `whatsappOk`, `lastContactedAt`, `updatedAt`. CALL / WHATSAPP / VISIT notes stamp `lastContactedAt`; a first contact moves New → Contacted; "No answer" moves nothing. Every history line is signed.
- **Creating.** `POST /site/enquiries` for walk-ins and phone calls (owner = whoever typed it, no 5/min throttle); the dock and the desk's "Add enquiry" use it. The course card sends `source: COURSE_CARD`.
- **The desk.** My leads (an officer's default) / Unowned (including leads whose owner left), source chip, Call/WhatsApp with an outcome sheet, forward-only stage buttons, Reopen, owner picker from `GET /site/enquiries/owners` (works on BASIC/STANDARD), Export CSV of the current filter.
- **Not in this PR:** any WhatsApp or notification, same-phone dedupe, honeypot, mobile tabs, Create-student link (Tiers B and C).

## Before merging — owner steps
1. Run **db-migrate → staging** for `20261006_000000_admissions_enum_values` and `20261006_000100_enquiry_lead_fields`. Both are expand-only (every new column nullable or defaulted, no drops, RLS untouched), so the code deployed now keeps working on the new schema. Merging first would break `/site/enquiries` and the website form until the migration runs.
2. Merge so the **API and web deploy together**: the web's course card sends `source`, and the API rejects unknown fields (`forbidNonWhitelisted`) until it has this change.

## Verified
- `pnpm preflight` green.
- New tests: pipeline rules (types), migration guard (db), desk guard + controller authz + service (api), `admissions-desk.e2e-spec.ts` (CI e2e), lead model / panel / page / add drawer / course card / console routing (web), worker-nav (mobile).
- `audit/enquiries.html` measured CLEAN at 360–1280.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI**

Run: `gh pr checks --watch`
Expected: every check green, including the `e2e` job (`admissions-desk`, `site-authoring-authz`, `route-coverage`, `rls-coverage`). A red check is fixed on the branch, preflight re-run, and pushed — the PR is left open for the owner, unmerged.

---

## Self-review

**Spec coverage (§7 Tier A):**
- The job in its seven places — schema + migration (T2), `management.dto.ts` (T2), `AdmissionsDeskGuard` + `isAdmissionsDesk` (T3), `role-routes.ts` (T7), staff picker always offered (T2), `worker-nav.ts` as GENERAL with comment (T2), `/auth/me` unchanged (already returns `staffRole`; read by T7 and T9).
- Guard on `/site/enquiries/*` — T3 (class-level, every route).
- `source`, `lastContactedAt`, `updatedAt`, `childName`, `whatsappOk` — T2.
- INTERESTED + forward-only + LOST from anywhere + LOST→CONTACTED reopen + 409 `ENQUIRY_STAGE_BACKWARDS` — T1 rules, T4 enforcement, T6/T9 buttons.
- Contact-kind notes setting `lastContactedAt` and moving NEW→CONTACTED — T1 `contactTarget`, T5 `logContact`.
- `authorName` filled — T4 (`author`), used by T5.
- `POST /site/enquiries` (WALK_IN/PHONE, owner = creator, no 5/min throttle) + dock switched — T5, T8.
- `GET /site/enquiries/owners` replacing `/manage/staff` — T3, T9 (test asserts `/manage/staff` is never called).
- My leads / Unowned, source chip, Call/WhatsApp that log + outcome sheet, forward-only stage buttons, Reopen, Add enquiry, CSV export — T6, T8, T9.
- Public `POST /public/enquiry` unchanged except `source` — T5 (throttle decorator untouched), T8 (course card).
- Excluded items (WhatsApp, dedupe, honeypot, mobile tabs, Create-student) — absent from every task.

**Placeholder scan:** every code step carries the code; every run step names its command and expected result. The only conditional is T5 Step 8 (local e2e needs a test database) and it names the fallback (CI e2e on the PR, checked in T10 Step 5).

**Type consistency:** `stageMove`, `forwardStages`, `contactTarget`, `EnquiryDeskMember`, `ContactKind`, `ContactOutcome`, `DeskSource`, `PublicSource` are defined in T1 and used with the same names and shapes in T3–T9. `Actor` and `author` are defined in T4 and reused in T5. `deskMembers`/`owners` (T3) return `EnquiryDeskMember[]`, which the panel (T9) reads. `matchesFilter(l, filter, today?, meId?)` (T6) is called with `undefined` for `today` in T9. `consoleBounce`/`consoleDeskFor`/`deskModel` (T7) are only used in T7. The notes route body `{ kind, outcome, lostReason }` matches between T5's DTO and T9's mutation.

**Review Focus:** each of the five lines has its pin — (1) `admissions-migration.spec.ts` in T2; (2) `contactTarget` in T1 and "a call nobody answered…" in T5 and the panel's "No answer" test in T9; (3) `ownerOnDesk` in T3, "does not re-check an owner who is not being changed" in T4, `UNOWNED` in T6, the picker test in T9; (4) the three `leadsCsv` tests in T6; (5) the declaration-order test in T3 and the e2e `/owners` 200 in T5.
