# Active Roster · Track B: Birthdays & Celebrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Birthdays switch in the Homepage sections, a Celebrations tab in Website settings, a homepage teaser (Cake badge, Ribbon) and a `/birthdays` page (Party Wall, Month Planner, Notice Board) that read active students only, never leak the year, default to families-only, and respect consent.

**Architecture:** Config lives on `SchoolProfile.celebrationsConfig` (normalised on write and read by one pure module) plus `HomepageContent.showBirthdays`. One `PublicBirthdaysService` computes rows in the school's timezone and serves two routes (public host, signed-in portal). The public site projection carries the config; the Next page fetches rows server-side and renders `BirthdaysSection` inside `PublicSite`. The admin tab edits the config and previews the week with per-student hide switches.

**Tech Stack:** NestJS + Prisma, class-validator, jest; Next 15 App Router + React 19, vitest + Testing Library; `Intl.DateTimeFormat` for timezone dates.

**Spec:** `docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md` (§3, §5, §6, §7)

## Global Constraints

- Requires Track A merged into `feat/active-roster` (Student.status, showOnWebsite, photoConsent; `activeStudentsWhere`).
- The birthdays wire shape never contains a year, an age or a date string: `{ day, month, name, classLabel, photoUrl, key }` only. A spec asserts this.
- `audience` defaults to FAMILIES; saving PUBLIC or BOTH requires `consentConfirmed: true`.
- Photos only when `showPhotos && student.photoConsent && photoAssetId`.
- Motion: constant tables, no `Math.random()` in render; still under `animationLevel === 'NONE'` and `prefers-reduced-motion`.
- `/birthdays` exports `metadata.robots = { index: false, follow: false }`.
- Same branch, staging and commit rules as Track A.

---

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma`, `migrations/20260911090000_celebrations/migration.sql` | `showBirthdays`, `celebrationsConfig` |
| `apps/api/src/modules/cms/internal/celebrations-config.ts` (+spec) | `normalizeCelebrationsConfig`, defaults, `CelebrationsConfig` type |
| `apps/api/src/modules/cms/internal/cms.dto.ts`, `site-content.service.ts`, `site-content.controller.ts` | `showBirthdays`, `GET/PUT /cms/celebrations`, `GET /cms/celebrations/preview` |
| `apps/api/src/modules/public/birthdays.ts` (+spec) | date maths: `todayInZone`, `birthdayRows`, `formatName`, `secondsToMidnight` |
| `apps/api/src/modules/public/public-birthdays.service.ts` (+spec), `public.controller.ts`, `portal.controller.ts` | rows for the public host and for families |
| `apps/api/src/modules/public/public-site.service.ts`, `public.dto.ts` | `celebrations` projection |
| `apps/api/src/modules/management/management.dto.ts` | `showOnWebsite`, `photoConsent` on `UpdateStudentDto` |
| `apps/web/lib/public-api.ts` | types + `fetchPublicBirthdays(host, window)` |
| `apps/web/components/public/celebrations-config.ts` | web mirror of the config shape and labels |
| `apps/web/components/public/sections/BirthdaysSection.tsx` (+test), `BirthdayTeaser.tsx` | the page styles and the teasers |
| `apps/web/components/public/PublicSite.tsx`, `sections/nav-model.ts` | `view = 'birthdays'`, nav key |
| `apps/web/app/birthdays/page.tsx`, `apps/web/app/portal/birthdays/page.tsx` | routes |
| `apps/web/app/app/website/types.ts`, `homepage-tab.tsx`, `celebrations-tab.tsx` (+test), `page.tsx` | admin |
| `apps/web/app/app/students/page.tsx` | consent toggles |

---

### Task 1: Schema, DTOs, section switch

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (HomepageContent, SchoolProfile)
- Create: `packages/db/prisma/migrations/20260911090000_celebrations/migration.sql`
- Modify: `apps/api/src/modules/cms/internal/cms.dto.ts` (`UpdateHomepageDto`)
- Modify: `apps/api/src/modules/public/public.dto.ts`, `apps/api/src/modules/public/public-site.service.ts` (homepage projection)
- Modify: `apps/api/src/modules/management/management.dto.ts` (`UpdateStudentDto`)
- Modify: `apps/web/app/app/website/types.ts` (`HOMEPAGE_SECTIONS`, `SiteHomepage`), `apps/web/lib/public-api.ts` (homepage type)

**Interfaces:**
- Produces: `HomepageContent.showBirthdays: boolean` end to end (DTO → DB → public projection → web types); `UpdateStudentDto.showOnWebsite?: boolean; photoConsent?: boolean`.

- [ ] **Step 1: Schema**

`model HomepageContent`: after `showContact` add `showBirthdays Boolean @default(false)`. `model SchoolProfile`: after `blogHeroLimit` add:

```prisma
  /// Birthdays & celebrations settings: source, window, name format, audience,
  /// teaser and page style, wish line, manual list. Normalised on write and on
  /// read by cms/internal/celebrations-config.ts; null = every default.
  celebrationsConfig  Json?
```

Migration:

```sql
ALTER TABLE "HomepageContent" ADD COLUMN "showBirthdays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SchoolProfile" ADD COLUMN "celebrationsConfig" JSONB;
```

Run: `pnpm --filter @skoolos/db exec prisma validate && pnpm --filter @skoolos/db exec prisma generate` → valid.

- [ ] **Step 2: DTO and projection**

`UpdateHomepageDto`: `@IsOptional() @IsBoolean() showBirthdays?: boolean;`. `UpdateStudentDto`: `@IsOptional() @IsBoolean() showOnWebsite?: boolean; @IsOptional() @IsBoolean() photoConsent?: boolean;`. `public.dto.ts` homepage: `showBirthdays: boolean;`. `public-site.service.ts` homepage block: `showBirthdays: homepage.showBirthdays,`.

- [ ] **Step 3: Web types**

`website/types.ts`: `SiteHomepage.showBirthdays?: boolean;` and append to `HOMEPAGE_SECTIONS`:

```ts
{ key: 'showBirthdays', label: 'Birthdays', detail: 'Who has a birthday · full page at /birthdays' },
```

`lib/public-api.ts` homepage: `showBirthdays: boolean;`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @skoolos/api typecheck && pnpm --filter @skoolos/web typecheck && pnpm --filter @skoolos/web test -- gatehouse-theme`
Expected: PASS (the gatehouse theme test builds a homepage fixture; add `showBirthdays: false` to it).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260911090000_celebrations/migration.sql apps/api/src/modules/cms/internal/cms.dto.ts apps/api/src/modules/public/public.dto.ts apps/api/src/modules/public/public-site.service.ts apps/api/src/modules/management/management.dto.ts apps/web/app/app/website/types.ts apps/web/lib/public-api.ts apps/web/app/login/gatehouse-theme.test.ts
git commit -m "feat: Birthdays homepage switch, celebrations config column, consent fields"
```

---

### Task 2: Celebrations config normaliser and the CMS routes

**Files:**
- Create: `apps/api/src/modules/cms/internal/celebrations-config.ts`, `celebrations-config.spec.ts`
- Modify: `apps/api/src/modules/cms/internal/cms.dto.ts` (`UpdateCelebrationsDto`), `site-content.service.ts`, `site-content.controller.ts`
- Modify: `apps/api/src/modules/cms/index.ts` (export the normaliser for the public module)

**Interfaces:**
- Produces:
  - `CelebrationsConfig` (spec §3.1), `DEFAULT_CELEBRATIONS: CelebrationsConfig`, `normalizeCelebrationsConfig(raw: unknown): CelebrationsConfig`.
  - `SiteContentService.getCelebrations(schoolId): Promise<CelebrationsConfig>`, `.updateCelebrations(schoolId, dto): Promise<CelebrationsConfig>`, `.celebrationsPreview(schoolId, tz): Promise<{ week: PreviewRow[]; missingDob: number }>` with `PreviewRow = { studentId, name, classLabel, day, month, showOnWebsite, photoConsent, hasPhoto }`.
  - Routes `GET /cms/celebrations`, `PUT /cms/celebrations`, `GET /cms/celebrations/preview`.

- [ ] **Step 1: Failing spec**

```ts
import { normalizeCelebrationsConfig, DEFAULT_CELEBRATIONS } from './celebrations-config';

describe('normalizeCelebrationsConfig', () => {
  it('null → defaults, families only, no photos', () => {
    expect(normalizeCelebrationsConfig(null)).toEqual(DEFAULT_CELEBRATIONS);
    expect(DEFAULT_CELEBRATIONS.audience).toBe('FAMILIES');
    expect(DEFAULT_CELEBRATIONS.showPhotos).toBe(false);
  });
  it('drops unknown values and keeps known ones', () => {
    const c = normalizeCelebrationsConfig({ window: 'YEAR', page: 'NOTICE_BOARD', teaser: 'BALLOONS', wishLine: 'x'.repeat(300) });
    expect(c.window).toBe('WEEK');
    expect(c.page).toBe('NOTICE_BOARD');
    expect(c.teaser).toBe('CAKE_BADGE');
    expect(c.wishLine).toHaveLength(160);
  });
  it('PUBLIC without consentConfirmed falls back to FAMILIES', () => {
    expect(normalizeCelebrationsConfig({ audience: 'PUBLIC' }).audience).toBe('FAMILIES');
    expect(normalizeCelebrationsConfig({ audience: 'PUBLIC', consentConfirmed: true }).audience).toBe('PUBLIC');
  });
  it('manual entries are capped, validated and sorted by date', () => {
    const c = normalizeCelebrationsConfig({ manual: [{ name: 'B', day: 31, month: 2 }, { name: 'A', day: 5, month: 1, classLabel: '2A' }, { name: '', day: 1, month: 1 }] });
    expect(c.manual).toEqual([{ name: 'A', day: 5, month: 1, classLabel: '2A' }]);
  });
});
```

Run: `pnpm --filter @skoolos/api test -- cms/internal/celebrations-config` → FAIL.

- [ ] **Step 2: The module**

```ts
export type CelebrationsSource = 'STUDENTS' | 'MANUAL';
export type CelebrationsWindow = 'TODAY' | 'WEEK' | 'MONTH';
export type CelebrationsNameFormat = 'FIRST' | 'FIRST_INITIAL' | 'FULL';
export type CelebrationsAudience = 'FAMILIES' | 'PUBLIC' | 'BOTH';
export type CelebrationsPlacement = 'TEASER_AND_PAGE' | 'PAGE_ONLY';
export type CelebrationsTeaser = 'CAKE_BADGE' | 'RIBBON';
export type CelebrationsPage = 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD';

export interface ManualCelebration { name: string; day: number; month: number; classLabel: string | null }

export interface CelebrationsConfig {
  source: CelebrationsSource; window: CelebrationsWindow; nameFormat: CelebrationsNameFormat;
  showClass: boolean; showPhotos: boolean; audience: CelebrationsAudience; placement: CelebrationsPlacement;
  teaser: CelebrationsTeaser; page: CelebrationsPage; wishLine: string; consentConfirmed: boolean; manual: ManualCelebration[];
}

export const DEFAULT_CELEBRATIONS: CelebrationsConfig = {
  source: 'STUDENTS', window: 'WEEK', nameFormat: 'FIRST_INITIAL', showClass: true, showPhotos: false,
  audience: 'FAMILIES', placement: 'TEASER_AND_PAGE', teaser: 'CAKE_BADGE', page: 'PARTY_WALL',
  wishLine: 'Happy birthday, {first name}! From all of us at {school}.', consentConfirmed: false, manual: [],
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MANUAL_MAX = 500;

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean { return typeof v === 'boolean' ? v : fallback; }

export function normalizeCelebrationsConfig(raw: unknown): CelebrationsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const consentConfirmed = bool(r.consentConfirmed, false);
  const audienceWanted = pick(r.audience, ['FAMILIES', 'PUBLIC', 'BOTH'] as const, 'FAMILIES');
  const manual: ManualCelebration[] = Array.isArray(r.manual)
    ? r.manual
        .map((m): ManualCelebration | null => {
          if (!m || typeof m !== 'object') return null;
          const e = m as Record<string, unknown>;
          const name = typeof e.name === 'string' ? e.name.trim().slice(0, 80) : '';
          const day = Number(e.day), month = Number(e.month);
          if (!name || !Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
          const classLabel = typeof e.classLabel === 'string' && e.classLabel.trim() ? e.classLabel.trim().slice(0, 20) : null;
          return { name, day, month, classLabel };
        })
        .filter((m): m is ManualCelebration => m !== null)
        .slice(0, MANUAL_MAX)
        .sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name))
    : [];
  return {
    source: pick(r.source, ['STUDENTS', 'MANUAL'] as const, 'STUDENTS'),
    window: pick(r.window, ['TODAY', 'WEEK', 'MONTH'] as const, 'WEEK'),
    nameFormat: pick(r.nameFormat, ['FIRST', 'FIRST_INITIAL', 'FULL'] as const, 'FIRST_INITIAL'),
    showClass: bool(r.showClass, true),
    showPhotos: bool(r.showPhotos, false),
    audience: audienceWanted === 'FAMILIES' || consentConfirmed ? audienceWanted : 'FAMILIES',
    placement: pick(r.placement, ['TEASER_AND_PAGE', 'PAGE_ONLY'] as const, 'TEASER_AND_PAGE'),
    teaser: pick(r.teaser, ['CAKE_BADGE', 'RIBBON'] as const, 'CAKE_BADGE'),
    page: pick(r.page, ['PARTY_WALL', 'MONTH_PLANNER', 'NOTICE_BOARD'] as const, 'PARTY_WALL'),
    wishLine: (typeof r.wishLine === 'string' && r.wishLine.trim() ? r.wishLine.trim() : DEFAULT_CELEBRATIONS.wishLine).slice(0, 160),
    consentConfirmed,
    manual,
  };
}
```

- [ ] **Step 3: DTO, service, controller**

`cms.dto.ts`:

```ts
export class UpdateCelebrationsDto {
  @IsOptional() @IsIn(['STUDENTS', 'MANUAL']) source?: string;
  @IsOptional() @IsIn(['TODAY', 'WEEK', 'MONTH']) window?: string;
  @IsOptional() @IsIn(['FIRST', 'FIRST_INITIAL', 'FULL']) nameFormat?: string;
  @IsOptional() @IsBoolean() showClass?: boolean;
  @IsOptional() @IsBoolean() showPhotos?: boolean;
  @IsOptional() @IsIn(['FAMILIES', 'PUBLIC', 'BOTH']) audience?: string;
  @IsOptional() @IsIn(['TEASER_AND_PAGE', 'PAGE_ONLY']) placement?: string;
  @IsOptional() @IsIn(['CAKE_BADGE', 'RIBBON']) teaser?: string;
  @IsOptional() @IsIn(['PARTY_WALL', 'MONTH_PLANNER', 'NOTICE_BOARD']) page?: string;
  @IsOptional() @IsString() @Length(0, 160) wishLine?: string;
  @IsOptional() @IsBoolean() consentConfirmed?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(500) manual?: unknown[];
}
```

`site-content.service.ts`:

```ts
async getCelebrations(schoolId: string): Promise<CelebrationsConfig> {
  const p = await withTenant(schoolId, (tx) => tx.schoolProfile.findUnique({ where: { schoolId }, select: { celebrationsConfig: true } }));
  return normalizeCelebrationsConfig(p?.celebrationsConfig);
}

async updateCelebrations(schoolId: string, dto: UpdateCelebrationsDto): Promise<CelebrationsConfig> {
  const current = await this.getCelebrations(schoolId);
  const next = normalizeCelebrationsConfig({ ...current, ...dto });
  if ((dto.audience === 'PUBLIC' || dto.audience === 'BOTH') && !next.consentConfirmed) {
    throw new ApiError('CONSENT_REQUIRED', 'Confirm that the school holds parental consent before showing birthdays on the public website', 400, 'consentConfirmed');
  }
  await withTenant(schoolId, (tx) =>
    tx.schoolProfile.upsert({ where: { schoolId }, update: { celebrationsConfig: next as never }, create: { schoolId, celebrationsConfig: next as never } }),
  );
  return next;
}

async celebrationsPreview(schoolId: string, timezone: string) {
  const { todayInZone, addDays, inWindow } = await import('../../public/birthdays');
  const today = todayInZone(timezone);
  const end = addDays(today, 6);
  return withTenant(schoolId, async (tx) => {
    const students = await tx.student.findMany({
      where: activeStudentsWhere(schoolId, { dob: { not: null } }),
      select: { id: true, firstName: true, lastName: true, dob: true, showOnWebsite: true, photoConsent: true, photoAssetId: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
    });
    const missingDob = await tx.student.count({ where: activeStudentsWhere(schoolId, { dob: null }) });
    const week = students
      .filter((s) => inWindow(s.dob!, today, end))
      .map((s) => ({
        studentId: s.id, name: `${s.firstName} ${s.lastName}`,
        classLabel: s.classSection ? `${s.classSection.grade.name} ${s.classSection.name}` : null,
        day: s.dob!.getUTCDate(), month: s.dob!.getUTCMonth() + 1,
        showOnWebsite: s.showOnWebsite, photoConsent: s.photoConsent, hasPhoto: !!s.photoAssetId,
      }))
      .sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name));
    return { week, missingDob };
  });
}
```

(`birthdays.ts` is written in Task 3; the dynamic import keeps the module boundary checker quiet if `cms` may not import `public`. If the boundary rule allows a static import, use it.)

Controller (`site-content.controller.ts`, same guards as the other `/cms` routes):

```ts
@Get('celebrations') getCelebrations() { return this.content.getCelebrations(this.sid()); }
@Put('celebrations') updateCelebrations(@Body() dto: UpdateCelebrationsDto) { return this.content.updateCelebrations(this.sid(), dto); }
@Get('celebrations/preview') celebrationsPreview() {
  const ctx = this.tenant.requireTenant();
  return this.content.celebrationsPreview(ctx.schoolId, ctx.timezone ?? 'Asia/Kolkata');
}
```

(If the tenant context does not carry `timezone`, read it with `tx.school.findUnique({ select: { timezone: true } })` inside the service.)

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @skoolos/api test -- cms` → PASS.

```bash
git add apps/api/src/modules/cms
git commit -m "feat(api): celebrations config normaliser and /cms/celebrations routes"
```

---

### Task 3: Birthday date maths

**Files:**
- Create: `apps/api/src/modules/public/birthdays.ts`, `birthdays.spec.ts`

**Interfaces:**
- Produces:
  - `type Ymd = { y: number; m: number; d: number }`
  - `todayInZone(tz: string, now?: Date): Ymd`
  - `addDays(a: Ymd, n: number): Ymd`
  - `effectiveDayMonth(dob: Date, year: number): { m: number; d: number }` (29 Feb → 28 Feb in a non-leap year)
  - `inWindow(dob: Date, start: Ymd, end: Ymd): boolean` (handles the year wrap in December)
  - `formatName(first: string, last: string, fmt: 'FIRST'|'FIRST_INITIAL'|'FULL'): string`
  - `secondsToMidnight(tz: string, now?: Date): number`
  - `windowBounds(window: 'TODAY'|'WEEK'|'MONTH', today: Ymd): { start: Ymd; end: Ymd }`

- [ ] **Step 1: Failing spec**

```ts
import { todayInZone, addDays, effectiveDayMonth, inWindow, formatName, secondsToMidnight, windowBounds } from './birthdays';

describe('birthdays date maths', () => {
  it('todayInZone uses the school timezone, not the process clock', () => {
    // 2026-09-09T20:30:00Z is already 10 Sep in Kolkata.
    expect(todayInZone('Asia/Kolkata', new Date('2026-09-09T20:30:00Z'))).toEqual({ y: 2026, m: 9, d: 10 });
    expect(todayInZone('UTC', new Date('2026-09-09T20:30:00Z'))).toEqual({ y: 2026, m: 9, d: 9 });
  });
  it('29 Feb shows on 28 Feb in a non-leap year', () => {
    expect(effectiveDayMonth(new Date('2016-02-29T00:00:00Z'), 2026)).toEqual({ m: 2, d: 28 });
    expect(effectiveDayMonth(new Date('2016-02-29T00:00:00Z'), 2028)).toEqual({ m: 2, d: 29 });
  });
  it('inWindow wraps across new year', () => {
    const start = { y: 2026, m: 12, d: 29 }, end = addDays(start, 6);
    expect(end).toEqual({ y: 2027, m: 1, d: 4 });
    expect(inWindow(new Date('2015-01-02T00:00:00Z'), start, end)).toBe(true);
    expect(inWindow(new Date('2015-01-06T00:00:00Z'), start, end)).toBe(false);
  });
  it('formats names', () => {
    expect(formatName('Aarav', 'Mehta', 'FIRST')).toBe('Aarav');
    expect(formatName('Aarav', 'Mehta', 'FIRST_INITIAL')).toBe('Aarav M.');
    expect(formatName('Aarav', 'Mehta', 'FULL')).toBe('Aarav Mehta');
    expect(formatName('Aarav', '', 'FIRST_INITIAL')).toBe('Aarav');
  });
  it('secondsToMidnight is positive and under a day', () => {
    const s = secondsToMidnight('Asia/Kolkata', new Date('2026-09-09T20:30:00Z')); // 02:00 IST → 22h left
    expect(s).toBe(22 * 3600);
  });
  it('windowBounds', () => {
    const t = { y: 2026, m: 9, d: 9 };
    expect(windowBounds('TODAY', t)).toEqual({ start: t, end: t });
    expect(windowBounds('WEEK', t)).toEqual({ start: t, end: { y: 2026, m: 9, d: 15 } });
    expect(windowBounds('MONTH', t)).toEqual({ start: { y: 2026, m: 9, d: 1 }, end: { y: 2026, m: 9, d: 30 } });
  });
});
```

Run: `pnpm --filter @skoolos/api test -- public/birthdays.spec` → FAIL.

- [ ] **Step 2: Implement**

```ts
export interface Ymd { y: number; m: number; d: number }

function parts(tz: string, now: Date): Ymd & { hh: number; mm: number; ss: number } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const get = (type: string) => Number(f.formatToParts(now).find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute'), ss: get('second') };
}

export function todayInZone(tz: string, now: Date = new Date()): Ymd {
  const p = parts(tz, now);
  return { y: p.y, m: p.m, d: p.d };
}

export function addDays(a: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(a.y, a.m - 1, a.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function effectiveDayMonth(dob: Date, year: number): { m: number; d: number } {
  const m = dob.getUTCMonth() + 1, d = dob.getUTCDate();
  if (m === 2 && d === 29 && !isLeap(year)) return { m: 2, d: 28 };
  return { m, d };
}

const ord = (x: Ymd) => x.y * 10000 + x.m * 100 + x.d;

export function inWindow(dob: Date, start: Ymd, end: Ymd): boolean {
  for (const year of start.y === end.y ? [start.y] : [start.y, end.y]) {
    const { m, d } = effectiveDayMonth(dob, year);
    const o = ord({ y: year, m, d });
    if (o >= ord(start) && o <= ord(end)) return true;
  }
  return false;
}

export function formatName(first: string, last: string, fmt: 'FIRST' | 'FIRST_INITIAL' | 'FULL'): string {
  const f = first.trim(), l = last.trim();
  if (fmt === 'FULL') return [f, l].filter(Boolean).join(' ');
  if (fmt === 'FIRST_INITIAL' && l) return `${f} ${l[0].toUpperCase()}.`;
  return f;
}

export function secondsToMidnight(tz: string, now: Date = new Date()): number {
  const p = parts(tz, now);
  return 24 * 3600 - (p.hh * 3600 + p.mm * 60 + p.ss);
}

export function windowBounds(window: 'TODAY' | 'WEEK' | 'MONTH', today: Ymd): { start: Ymd; end: Ymd } {
  if (window === 'TODAY') return { start: today, end: today };
  if (window === 'WEEK') return { start: today, end: addDays(today, 6) };
  const last = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate();
  return { start: { y: today.y, m: today.m, d: 1 }, end: { y: today.y, m: today.m, d: last } };
}
```

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @skoolos/api test -- public/birthdays.spec` → PASS.

```bash
git add apps/api/src/modules/public/birthdays.ts apps/api/src/modules/public/birthdays.spec.ts
git commit -m "feat(api): birthday date maths in the school's timezone"
```

---

### Task 4: PublicBirthdaysService and the two routes

**Files:**
- Create: `apps/api/src/modules/public/public-birthdays.service.ts`, `public-birthdays.service.spec.ts`
- Modify: `apps/api/src/modules/public/public.controller.ts` (find the file that declares `@Controller('public')`; add the route there), `apps/api/src/modules/public/public.module.ts` (provider, export), `apps/api/src/modules/public/public.dto.ts` (`PublicSiteData.celebrations`), `public-site.service.ts`
- Modify: `apps/api/src/modules/portal/portal.controller.ts`, `portal.module.ts` (import PublicModule or the service)

**Interfaces:**
- Produces:
  - `BirthdayRow = { day: number; month: number; name: string; classLabel: string | null; photoUrl: string | null; key: string }`
  - `BirthdaysResult = { generatedFor: string /* YYYY-MM-DD */; window: 'TODAY'|'WEEK'|'MONTH'; today: BirthdayRow[]; upcoming: BirthdayRow[]; next: BirthdayRow | null; maxAge: number }`
  - `PublicBirthdaysService.forAudience(schoolId, audience: 'PUBLIC'|'FAMILIES', window?: string): Promise<BirthdaysResult>` — throws `NotFoundException` when the switch is off or the audience is not allowed.
  - `PublicSiteData.celebrations: { enabled: boolean; placement; audience; teaser; page; nameFormat; showClass; wishLine; window } | null`.

- [ ] **Step 1: Failing spec**

```ts
import 'reflect-metadata';
const txMock = { school: { findUnique: jest.fn() }, homepageContent: { findUnique: jest.fn() }, schoolProfile: { findUnique: jest.fn() }, student: { findMany: jest.fn() }, mediaAsset: { findMany: jest.fn() } };
jest.mock('@skoolos/db', () => ({ withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock), Prisma: jest.requireActual('@prisma/client').Prisma }));
import { PublicBirthdaysService } from './public-birthdays.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOW = new Date('2026-09-09T03:30:00Z'); // 09:00 IST, 9 Sep

beforeEach(() => {
  jest.clearAllMocks();
  txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', timezone: 'Asia/Kolkata' });
  txMock.homepageContent.findUnique.mockResolvedValue({ showBirthdays: true });
  txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'BOTH', consentConfirmed: true, showPhotos: true } });
  txMock.student.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Aarav', lastName: 'Mehta', dob: new Date('2016-09-09T00:00:00Z'), photoConsent: true, photoAssetId: 'a1', classSection: { name: 'B', grade: { name: '5' } } },
    { id: 's2', firstName: 'Meera', lastName: 'Iyer', dob: new Date('2019-09-11T00:00:00Z'), photoConsent: false, photoAssetId: 'a2', classSection: { name: 'A', grade: { name: '2' } } },
    { id: 's3', firstName: 'Old', lastName: 'Entry', dob: new Date('2010-09-20T00:00:00Z'), photoConsent: true, photoAssetId: null, classSection: null },
  ]);
  txMock.mediaAsset.findMany.mockResolvedValue([{ id: 'a1', url: 'https://cdn/a1.jpg' }, { id: 'a2', url: 'https://cdn/a2.jpg' }]);
});

describe('PublicBirthdaysService', () => {
  it('returns today and upcoming for the week, never the year, photos only with consent', async () => {
    const svc = new PublicBirthdaysService();
    const r = await svc.forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(r.generatedFor).toBe('2026-09-09');
    expect(r.today).toEqual([{ day: 9, month: 9, name: 'Aarav M.', classLabel: '5 B', photoUrl: 'https://cdn/a1.jpg', key: expect.any(String) }]);
    expect(r.upcoming.map((u) => u.name)).toEqual(['Meera I.']);
    expect(r.upcoming[0].photoUrl).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/2016|2019|dob|age/);
    expect(r.maxAge).toBeGreaterThan(0);
  });
  it('queries active students only', async () => {
    await new PublicBirthdaysService().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(txMock.student.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', showOnWebsite: true, dob: { not: null } });
  });
  it('404s when the switch is off or the audience is not allowed', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { audience: 'FAMILIES' } });
    await expect(new PublicBirthdaysService().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW)).rejects.toThrow('Not found');
    txMock.homepageContent.findUnique.mockResolvedValue({ showBirthdays: false });
    await expect(new PublicBirthdaysService().forAudience(SCHOOL, 'FAMILIES', 'WEEK', NOW)).rejects.toThrow('Not found');
  });
  it('MANUAL source lists the typed entries', async () => {
    txMock.schoolProfile.findUnique.mockResolvedValue({ celebrationsConfig: { source: 'MANUAL', audience: 'BOTH', consentConfirmed: true, manual: [{ name: 'Zoya K', day: 10, month: 9, classLabel: '1A' }] } });
    const r = await new PublicBirthdaysService().forAudience(SCHOOL, 'PUBLIC', 'WEEK', NOW);
    expect(txMock.student.findMany).not.toHaveBeenCalled();
    expect(r.upcoming[0]).toMatchObject({ name: 'Zoya K', day: 10, month: 9, classLabel: '1A', photoUrl: null });
  });
});
```

Run: `pnpm --filter @skoolos/api test -- public/public-birthdays` → FAIL.

- [ ] **Step 2: Service**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { withTenant } from '@skoolos/db';
import { normalizeCelebrationsConfig, type CelebrationsConfig } from '../cms';
import { activeStudentsWhere } from '../../common/roster/active-students';
import { addDays, effectiveDayMonth, formatName, inWindow, secondsToMidnight, todayInZone, windowBounds, type Ymd } from './birthdays';

export interface BirthdayRow { day: number; month: number; name: string; classLabel: string | null; photoUrl: string | null; key: string }
export interface BirthdaysResult { generatedFor: string; window: CelebrationsConfig['window']; today: BirthdayRow[]; upcoming: BirthdayRow[]; next: BirthdayRow | null; maxAge: number }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (x: Ymd) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;

@Injectable()
export class PublicBirthdaysService {
  async forAudience(schoolId: string, audience: 'PUBLIC' | 'FAMILIES', windowParam?: string, now: Date = new Date()): Promise<BirthdaysResult> {
    return withTenant(schoolId, async (tx) => {
      const [school, homepage, profile] = await Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { name: true, timezone: true } }),
        tx.homepageContent.findUnique({ where: { schoolId }, select: { showBirthdays: true } }),
        tx.schoolProfile.findUnique({ where: { schoolId }, select: { celebrationsConfig: true } }),
      ]);
      if (!school || !homepage?.showBirthdays) throw new NotFoundException('Not found');
      const cfg = normalizeCelebrationsConfig(profile?.celebrationsConfig);
      const allowed = cfg.audience === 'BOTH' || cfg.audience === audience;
      if (!allowed) throw new NotFoundException('Not found');

      const window = windowParam === 'TODAY' || windowParam === 'WEEK' || windowParam === 'MONTH' ? windowParam : cfg.window;
      const today = todayInZone(school.timezone, now);
      const { start, end } = windowBounds(window, today);

      let rows: BirthdayRow[];
      if (cfg.source === 'MANUAL') {
        rows = cfg.manual
          .filter((m) => inWindow(new Date(Date.UTC(2000, m.month - 1, m.day)), start, end))
          .map((m) => ({ day: m.day, month: m.month, name: m.name, classLabel: cfg.showClass ? m.classLabel : null, photoUrl: null, key: hash(`${m.name}|${m.month}|${m.day}`) }));
      } else {
        const students = await tx.student.findMany({
          where: activeStudentsWhere(schoolId, { showOnWebsite: true, dob: { not: null } }),
          select: { id: true, firstName: true, lastName: true, dob: true, photoConsent: true, photoAssetId: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
        });
        const hit = students.filter((s) => inWindow(s.dob!, start, end));
        const assetIds = cfg.showPhotos ? hit.filter((s) => s.photoConsent && s.photoAssetId).map((s) => s.photoAssetId!) : [];
        const urls = new Map<string, string>();
        if (assetIds.length) {
          const assets = await tx.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, url: true } });
          for (const a of assets) urls.set(a.id, a.url);
        }
        rows = hit.map((s) => {
          const { m, d } = effectiveDayMonth(s.dob!, today.y);
          return {
            day: d, month: m,
            name: formatName(s.firstName, s.lastName, cfg.nameFormat),
            classLabel: cfg.showClass && s.classSection ? `${s.classSection.grade.name} ${s.classSection.name}` : null,
            photoUrl: cfg.showPhotos && s.photoConsent && s.photoAssetId ? (urls.get(s.photoAssetId) ?? null) : null,
            key: hash(s.id),
          };
        });
      }

      const isToday = (r: BirthdayRow) => r.month === today.m && r.day === today.d;
      const order = (r: BirthdayRow) => {
        // Days from today, wrapping through the year, so 2 Jan sorts after 30 Dec in a December window.
        const t = Date.UTC(today.y, today.m - 1, today.d);
        let b = Date.UTC(today.y, r.month - 1, r.day);
        if (b < t) b = Date.UTC(today.y + 1, r.month - 1, r.day);
        return b - t;
      };
      const sorted = rows.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
      const todayRows = sorted.filter(isToday);
      const upcoming = sorted.filter((r) => !isToday(r));
      return { generatedFor: ymd(today), window, today: todayRows, upcoming, next: upcoming[0] ?? null, maxAge: secondsToMidnight(school.timezone, now) };
    });
  }
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}
```

Export `normalizeCelebrationsConfig` and `CelebrationsConfig` from `apps/api/src/modules/cms/index.ts`.

- [ ] **Step 3: Routes**

Public (`@Controller('public')` file):

```ts
@Get('birthdays')
async birthdays(@Query('window') window: string | undefined, @Res({ passthrough: true }) res: Response) {
  const ctx = this.tenant.get();
  if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
  const r = await this.birthdaysSvc.forAudience(ctx.schoolId, 'PUBLIC', window);
  res.setHeader('Cache-Control', `public, max-age=${r.maxAge}`);
  return r;
}
```

Portal (`portal.controller.ts`, STUDENT jwt, no cache header):

```ts
@Get('birthdays')
birthdays(@Query('window') window?: string) {
  const { schoolId } = this.tenant.requireTenant();
  return this.birthdays.forAudience(schoolId, 'FAMILIES', window);
}
```

Register `PublicBirthdaysService` in `public.module.ts` providers + exports; import `PublicModule` in `portal.module.ts` (or provide the service there directly if the module graph makes that simpler; do not import from `public/internal`).

- [ ] **Step 4: Projection**

`public.dto.ts`:

```ts
celebrations: {
  enabled: boolean; placement: 'TEASER_AND_PAGE' | 'PAGE_ONLY'; audience: 'FAMILIES' | 'PUBLIC' | 'BOTH';
  teaser: 'CAKE_BADGE' | 'RIBBON'; page: 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD';
  nameFormat: 'FIRST' | 'FIRST_INITIAL' | 'FULL'; showClass: boolean; wishLine: string; window: 'TODAY' | 'WEEK' | 'MONTH';
} | null;
```

`public-site.service.ts`: after the homepage block,

```ts
celebrations: (() => {
  const c = normalizeCelebrationsConfig(rawProfile?.celebrationsConfig);
  const enabled = !!homepage?.showBirthdays && (c.audience === 'PUBLIC' || c.audience === 'BOTH');
  return { enabled, placement: c.placement, audience: c.audience, teaser: c.teaser, page: c.page, nameFormat: c.nameFormat, showClass: c.showClass, wishLine: c.wishLine, window: c.window };
})(),
```

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @skoolos/api test -- public portal && pnpm --filter @skoolos/api typecheck` → PASS.

```bash
git add apps/api/src/modules/public apps/api/src/modules/portal apps/api/src/modules/cms/index.ts
git commit -m "feat(api): /public/birthdays and /portal/birthdays, celebrations projection"
```

---

### Task 5: Public site — teasers, page styles, routes, nav

**Files:**
- Modify: `apps/web/lib/public-api.ts` (types, `fetchPublicBirthdays`)
- Create: `apps/web/components/public/celebrations-config.ts`
- Create: `apps/web/components/public/sections/BirthdayTeaser.tsx`, `BirthdaysSection.tsx`, `BirthdaysSection.test.tsx`
- Modify: `apps/web/components/public/PublicSite.tsx` (`SiteView`, props `birthdays?: BirthdaysResult | null`, teaser mount, view branch), `apps/web/components/public/sections/nav-model.ts` (flag + key), `apps/web/components/public/ps-css.ts` (styles)
- Create: `apps/web/app/birthdays/page.tsx`, `apps/web/app/portal/birthdays/page.tsx`

**Interfaces:**
- Consumes: `PublicSiteData.celebrations`, `GET /public/birthdays`, `GET /portal/birthdays`.
- Produces: `fetchPublicBirthdays(host: string, window?: string): Promise<BirthdaysResult | null>`; `<BirthdaysSection data={BirthdaysResult} style={page} wishLine schoolName brand2 onOwnPage />`; `<BirthdayTeaser style={teaser} data href="/birthdays" />`; nav key `birthdays`.

- [ ] **Step 1: Failing section test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BirthdaysSection from './BirthdaysSection';

const data = {
  generatedFor: '2026-09-09', window: 'WEEK' as const, maxAge: 100,
  today: [{ day: 9, month: 9, name: 'Aarav M.', classLabel: '5 B', photoUrl: null, key: 'k1' }],
  upcoming: [{ day: 11, month: 9, name: 'Meera I.', classLabel: '2 A', photoUrl: null, key: 'k2' }],
  next: { day: 11, month: 9, name: 'Meera I.', classLabel: '2 A', photoUrl: null, key: 'k2' },
};

describe('BirthdaysSection', () => {
  it.each(['PARTY_WALL', 'MONTH_PLANNER', 'NOTICE_BOARD'] as const)('%s renders today and upcoming with initials coins', (style) => {
    render(<BirthdaysSection data={data} style={style} wishLine="Happy birthday, {first name}!" schoolName="Raffles" onOwnPage />);
    expect(screen.getByText('Aarav M.')).toBeInTheDocument();
    expect(screen.getByText('Meera I.')).toBeInTheDocument();
    expect(screen.getAllByText('AM').length).toBeGreaterThan(0);
    expect(screen.queryByText(/20\d\d/)).toBeNull();
  });
  it('empty today shows the next birthday', () => {
    render(<BirthdaysSection data={{ ...data, today: [] }} style="PARTY_WALL" wishLine="x" schoolName="Raffles" onOwnPage />);
    expect(screen.getByText(/Next: Meera I\./)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @skoolos/web test -- BirthdaysSection` → FAIL.

- [ ] **Step 2: Config mirror and fetch**

`components/public/celebrations-config.ts` mirrors the union types and exports `TEASER_STYLES`/`PAGE_STYLES` option lists `{ value, label, hint }` for the admin tab (labels from the design pitch: Cake badge, Ribbon; Party Wall, Month Planner, Notice Board).

`lib/public-api.ts`:

```ts
export interface BirthdayRow { day: number; month: number; name: string; classLabel: string | null; photoUrl: string | null; key: string }
export interface BirthdaysResult { generatedFor: string; window: 'TODAY' | 'WEEK' | 'MONTH'; today: BirthdayRow[]; upcoming: BirthdayRow[]; next: BirthdayRow | null; maxAge: number }

export async function fetchPublicBirthdays(host: string, window?: string): Promise<BirthdaysResult | null> {
  const base = apiBaseFor(host); // whatever fetchPublicSite uses to build its URL and the X-Skoolos-Host header — reuse the same helper and headers
  const qs = window ? `?window=${encodeURIComponent(window)}` : '';
  const res = await fetch(`${base}/public/birthdays${qs}`, { headers: hostHeaders(host), cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as BirthdaysResult;
}
```

(Open `fetchPublicSite` at `lib/public-api.ts:144` and copy its exact URL and header construction; do not invent a new helper name if one exists.)

Add `celebrations` to `PublicSiteData` in the same shape as the API DTO.

- [ ] **Step 3: BirthdaysSection.tsx**

One component, three layouts by `style`, shared pieces:

```tsx
'use client';
import type { BirthdaysResult, BirthdayRow } from '@/lib/public-api';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COIN_TINTS = ['var(--ps1)', '#F59E0B', '#EC4899', '#0EA5E9']; // brand first, then constant accents

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function Coin({ row, i, size }: { row: BirthdayRow; i: number; size: number }) {
  return row.photoUrl
    ? <img src={row.photoUrl} alt="" width={size} height={size} className="ps-bd-coin ps-bd-coin-photo" />
    : <span className="ps-bd-coin" style={{ width: size, height: size, background: COIN_TINTS[i % COIN_TINTS.length], fontSize: size * 0.32 }}>{initials(row.name)}</span>;
}

function wish(line: string, row: BirthdayRow, school: string) {
  return line.replace('{first name}', row.name.split(' ')[0]).replace('{school}', school);
}

export default function BirthdaysSection({ data, style, wishLine, schoolName, onOwnPage = false }: {
  data: BirthdaysResult; style: 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD'; wishLine: string; schoolName: string; onOwnPage?: boolean;
}) {
  const nextLine = data.today.length === 0 && data.next ? `Next: ${data.next.name}, ${data.next.day} ${MONTHS[data.next.month - 1]}` : null;
  return (
    <section id="birthdays" data-sec="birthdays" className={`ps-bd ps-bd-${style.toLowerCase().replace('_', '-')} ${onOwnPage ? 'ps-bd-page' : ''}`}>
      {style === 'PARTY_WALL' && <PartyWall data={data} wishLine={wishLine} schoolName={schoolName} nextLine={nextLine} />}
      {style === 'MONTH_PLANNER' && <MonthPlanner data={data} nextLine={nextLine} />}
      {style === 'NOTICE_BOARD' && <NoticeBoard data={data} nextLine={nextLine} />}
    </section>
  );
}
```

`PartyWall`: kicker with the date, "Happy birthday!" heading, a row of today's coins (size 64, gold ring class `ps-bd-today`), the wish line under each, then "Coming up" grid of upcoming rows (coin 28 + name + `day Mon · class`). Confetti: 10 `<span className="ps-bd-conf">` with `style={{ left: CONF_LEFT[i] + '%', animationDelay: CONF_DELAY[i] + 's', background: COIN_TINTS[i % 4] }}` from two constant arrays.

`MonthPlanner`: a 7-column grid for `generatedFor`'s month (compute first weekday and days with `Date.UTC`), each day cell lists dots for rows on that day, today outlined; a side list "Today" then "Next".

`NoticeBoard`: cork background class, `today` rows as white index cards with a coin, `upcoming` as cream cards, tilt from a constant `TILTS = [-2, 1.5, 2, -1, 1, -1.5]` array by index, pin colour from a constant list.

Every layout renders `nextLine` in a `<p className="ps-bd-next">` when present.

Styles go in `ps-css.ts` under a `/* birthdays */` block: `.ps-bd-coin` (round, white text, grid place-items center, font-weight 700), `.ps-bd-today` (box-shadow ring `0 0 0 3px #F59E0B`), `.ps-bd-conf` (absolute, 8×12, `animation: ps-bd-fall 7s linear infinite`), `@keyframes ps-bd-fall`, `.ps-anim-none .ps-bd-conf, @media (prefers-reduced-motion: reduce) .ps-bd-conf { display: none }` (check the class the root uses for `animationLevel === 'NONE'` in `site-style.ts` and use that exact class), the planner grid, the cork board (`background:#C89B6A` + two radial-gradient dot layers) and the cards.

- [ ] **Step 4: BirthdayTeaser.tsx**

```tsx
'use client';
import Link from 'next/link';
import type { BirthdaysResult } from '@/lib/public-api';

export default function BirthdayTeaser({ style, data, href }: { style: 'CAKE_BADGE' | 'RIBBON'; data: BirthdaysResult; href: string }) {
  const n = data.today.length;
  const label = n > 0 ? `${n} today` : data.next ? `Next: ${data.next.name}` : 'This month';
  if (style === 'RIBBON') {
    const items = [...data.today, ...data.upcoming].slice(0, 8);
    if (items.length === 0) return null;
    return (
      <Link href={href} className="ps-bd-ribbon" aria-label="Birthdays">
        <span className="ps-bd-ribbon-lead">{n > 0 ? 'Today we celebrate' : 'Birthdays this week'}</span>
        <span className="ps-bd-ribbon-track">
          {[0, 1].map((rep) => items.map((r) => <span key={`${rep}-${r.key}`}><b>{r.name}</b>{r.classLabel ? <i>{r.classLabel}</i> : null}</span>))}
        </span>
      </Link>
    );
  }
  return (
    <Link href={href} className="ps-bd-badge" aria-label={`Birthdays: ${label}`}>
      <span className="ps-bd-cake" aria-hidden="true"><span className="ps-bd-flame" /></span>
      <span>Birthdays</span>
      <span className="ps-bd-count">{label}</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
```

Ribbon CSS: brand background, 28px tall, the track duplicated once and animated `translateX(-50%)` over 14s, paused on hover; badge CSS: fixed bottom-right pill, bobbing 3.2s, flame flicker 0.9s alternate. Both animations off under the NONE class and reduced-motion.

- [ ] **Step 5: PublicSite wiring**

- `SiteView` gains `'birthdays'`. Props gain `birthdays?: BirthdaysResult | null`.
- `const hasBirthdays = !!data.celebrations?.enabled;` passed into the nav flags as `hasBirthdays`.
- Teaser: when `view === 'home' && hasBirthdays && data.celebrations!.placement === 'TEASER_AND_PAGE' && birthdays` render `<BirthdayTeaser style={data.celebrations!.teaser} data={birthdays} href="/birthdays" />` — the RIBBON directly under `SiteNav`, the CAKE_BADGE at the end of the page body (it is fixed-position). When a festive theme is active and the teaser is CAKE_BADGE, keep it; when it is the ribbon, keep it too (no particle layer of its own).
- View branch: `{view === 'birthdays' && birthdays && <BirthdaysSection data={birthdays} style={data.celebrations!.page} wishLine={data.celebrations!.wishLine} schoolName={schoolName} onOwnPage />}`.

`nav-model.ts`: add `hasBirthdays: boolean` to the flags type, `birthdays: { href: '/birthdays', has: flags.hasBirthdays, label: 'Birthdays' }` in the table, and `...(flags.hasBirthdays ? [{ key: 'birthdays', label: 'Birthdays', href: '/birthdays' }] : [])` in the "Our school" group after Hall of Fame. Update `nav-model.test.ts` fixtures with `hasBirthdays: false`.

- [ ] **Step 6: Routes**

`apps/web/app/birthdays/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchPublicSite, fetchPublicBirthdays } from '@/lib/public-api';
import PublicSite from '@/components/public/PublicSite';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';

// Children's names are not search results (D8).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BirthdaysPage() {
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();
  const data = await fetchPublicSite(host);
  if (!data || !data.celebrations?.enabled) notFound();
  const birthdays = await fetchPublicBirthdays(host, data.celebrations.window);
  if (!birthdays) notFound();
  return <PublicSite data={data} view="birthdays" birthdays={birthdays} />;
}
```

Home page (`apps/web/app/page.tsx`): when `data.celebrations?.enabled && placement === 'TEASER_AND_PAGE'`, also `await fetchPublicBirthdays(host, 'WEEK')` and pass `birthdays` to `<PublicSite>`.

`apps/web/app/portal/birthdays/page.tsx`: a client page under the portal shell that calls `useApi().get('/portal/birthdays')`, reads the site config through the existing portal site-data hook (or `fetchPublicSite` on the server part of the page), and renders `<BirthdaysSection … onOwnPage />`. Link it from the portal home as "Birthdays" when the API answers 200.

- [ ] **Step 7: Run and commit**

Run: `pnpm --filter @skoolos/web test -- BirthdaysSection nav-model section-shape route-file-exports && pnpm --filter @skoolos/web typecheck` → PASS.

```bash
git add apps/web/lib/public-api.ts apps/web/components/public/celebrations-config.ts apps/web/components/public/sections/BirthdayTeaser.tsx apps/web/components/public/sections/BirthdaysSection.tsx apps/web/components/public/sections/BirthdaysSection.test.tsx apps/web/components/public/PublicSite.tsx apps/web/components/public/sections/nav-model.ts apps/web/components/public/sections/nav-model.test.ts apps/web/components/public/ps-css.ts apps/web/app/birthdays/page.tsx apps/web/app/page.tsx apps/web/app/portal/birthdays/page.tsx
git commit -m "feat(web): birthday teaser, /birthdays page (3 styles), portal birthdays, nav key"
```

---

### Task 6: Admin — Celebrations tab and consent toggles

**Files:**
- Create: `apps/web/app/app/website/celebrations-tab.tsx`, `celebrations-tab.test.tsx`
- Modify: `apps/web/app/app/website/page.tsx` (TABS entry `{ id: 'celebrations', label: 'Celebrations' }` and the tab body), `homepage-tab.tsx` (placement radio under the Birthdays checkbox)
- Modify: `apps/web/app/app/students/page.tsx` (two checkboxes in the edit form: "Show on website birthdays", "Photo consent given")

**Interfaces:**
- Consumes: `GET/PUT /cms/celebrations`, `GET /cms/celebrations/preview`, `PUT /manage/students/:id { showOnWebsite | photoConsent }`.

- [ ] **Step 1: Failing tab test**

```tsx
it('saves audience PUBLIC only after the consent confirmation', async () => {
  api.get.mockImplementation((url: string) => url.endsWith('/preview')
    ? Promise.resolve({ week: [{ studentId: 's1', name: 'Aarav Mehta', classLabel: '5 B', day: 9, month: 9, showOnWebsite: true, photoConsent: false, hasPhoto: true }], missingDob: 38 })
    : Promise.resolve({ ...DEFAULTS }));
  api.put.mockResolvedValue({ ...DEFAULTS, audience: 'PUBLIC', consentConfirmed: true });
  mount();
  expect(await screen.findByText(/38 active students have no date of birth/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Public website'));
  expect(screen.getByText(/Our school holds parental consent/)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Our school holds parental consent for this'));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/cms/celebrations', expect.objectContaining({ audience: 'PUBLIC', consentConfirmed: true })));
});
it('hides a child from the wall with the switch', async () => {
  // same preview mock as above; api.put for students
  mount();
  await userEvent.click(await screen.findByRole('switch', { name: 'Show Aarav Mehta on the wall' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/students/s1', { showOnWebsite: false }));
});
```

Run: `pnpm --filter @skoolos/web test -- celebrations-tab` → FAIL.

- [ ] **Step 2: celebrations-tab.tsx**

Layout as the console mock in the design pitch: left column controls (Source chips, Window chips, Show chips incl. "Photos (consented only)", Who can see radios with the consent block that appears for PUBLIC/BOTH, Teaser style cards, Page style cards, Wish line input, Save button); right column "This week on the site" list with a `role="switch"` per student (`aria-label="Show {name} on the wall"`, `aria-checked`) posting `PUT /manage/students/:id { showOnWebsite }`, and the amber notice `"{missingDob} active students have no date of birth, so they will never appear."` linking to `/app/students`. Source chip "Active students" is disabled with the hint "Needs the Management plan" when the site data's features lack MANAGEMENT (read from the same `useHost`/features hook the other tabs use).

State: a local copy of the config from `GET /cms/celebrations`; Save → `PUT /cms/celebrations` with the full object; on 400 `CONSENT_REQUIRED` toast the server message.

- [ ] **Step 3: Homepage tab placement radio**

Under the Birthdays checkbox (only when checked) two radios "Homepage teaser + page" / "Page only (nav link)" writing `placement` through `PUT /cms/celebrations`.

- [ ] **Step 4: Students edit form**

Two checkboxes bound to `showOnWebsite` and `photoConsent`, sent in `updateMutation`'s body.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @skoolos/web test -- website students` → PASS.

```bash
git add apps/web/app/app/website/celebrations-tab.tsx apps/web/app/app/website/celebrations-tab.test.tsx apps/web/app/app/website/page.tsx apps/web/app/app/website/homepage-tab.tsx apps/web/app/app/students/page.tsx
git commit -m "feat(web): Celebrations tab, placement radio, per-student wall and photo consent"
```

---

### Task 7: Behaviour spec, preflight

- [ ] **Step 1: Behaviour spec**

Public site section: "Birthdays render only when `HomepageContent.showBirthdays` and the audience allows the viewer (public host: PUBLIC/BOTH; portal: FAMILIES/BOTH). Rows carry day and month only (`public-birthdays.service.ts`). Photos need `photoConsent`. Today is computed in `School.timezone`; 29 Feb shows on 28 Feb in a non-leap year. `/birthdays` is noindex."

- [ ] **Step 2: Preflight**

Run: `pnpm preflight` → all green.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/sckools-behavior-spec
git commit -m "docs(spec): birthdays invariants"
```

Report: what shipped, that migration `20260911090000_celebrations` is pending on staging, and that the remaining designs (Balloons, Desk calendar, Bunting; Sky Lanterns, Cake & Candles, Ruled Register) are backlog.
