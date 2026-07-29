# Portal Parity Round 1 — Phase 2: The web teacher portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web teacher portal behave the way the phone already does — same classes, same attendance state, same rules — using the endpoints Phase 1 built, so that after this phase every approved teacher item is either fully shipped on the web or is a phone-only gap that Phase 3 closes.

**Architecture:** All work is in `apps/web`. Screens read from the Phase 1 endpoints (`/manage/timetable/my-day`, `/manage/timetable/mine`, `/manage/attendance/status`, `/manage/class-notes`, `/manage/class-todos`, `/manage/register-changes`) and take their types from `@skoolos/types` rather than redeclaring them. Data fetching stays on the existing TanStack Query + `useApi` pattern. A test runner is introduced first, because `apps/web` currently has none and nothing else in this plan can be verified without it.

**Tech Stack:** Next 15.5 App Router, React 19.2, TanStack Query v5, Vitest + React Testing Library + jsdom, `sonner` toasts, CSS custom properties in `app/sk-theme.css`.

## Global Constraints

- **Palette is indigo + amber on both surfaces.** `--sk-brand: #4F46E5`, `--sk-brand-2: #6D66F0`, `--sk-amber: #F59E0B`. This is a decision already taken — the phone app and the Sckools logo already use it; the web portals are the odd one out.
- **Attendance is ONE register per class per day.** Never build UI implying a per-period register.
- **Wire types come from `@skoolos/types`.** No page may declare its own copy of a shape the server returns. This is item P7 and the whole reason `LATE` diverged in the first place.
- **Dates crossing the wire are `YYYY-MM-DD`,** built from local date parts — never `toISOString().slice(0,10)`, which reports the UTC day and rolls backwards for an IST evening.
- **Error messages come from the server verbatim.** The API returns `{ code, message }` and `message` is already written for a teacher to read. Surface it; do not rewrite it client-side.
- **Every screen handles four states explicitly:** loading, error, empty, and populated. A screen that renders nothing while loading is a defect.
- **Commit after every task**, prefixed `feat(web):`, `fix(web):` or `test(web):`, ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Where this starts

Branch `feat/portal-parity-r1`, currently at `86b3f15`, pushed, 0 behind `origin/main`. Phase 1 gate: api 47 suites / 404 tests, self-contained e2e 19, typecheck 10/10, `pnpm boundary` zero violations. All of that must still hold at the end of Phase 2.

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/vitest.config.ts` | **New.** Test runner config: jsdom, path aliases matching `tsconfig.json` |
| `apps/web/test/setup.ts` | **New.** RTL cleanup, `@testing-library/jest-dom` matchers |
| `apps/web/test/render.tsx` | **New.** `renderWithProviders` — QueryClientProvider + a stub `useApi`, so no test hits the network |
| `apps/web/app/sk-theme.css` | Repainted to the indigo/amber palette |
| `apps/web/lib/teacher-day.ts` | **New.** Pure helpers: which entry is current for a given clock time, remaining/elapsed split |
| `apps/web/app/teacher/page.tsx` | Rebuilt: current period hero, notes, to-dos, rest-of-day timeline |
| `apps/web/app/teacher/attendance/page.tsx` | Taken/pending state, retake confirmation, past-day lock, change request |
| `apps/web/app/teacher/timetable/page.tsx` | **New.** Week grid, today tinted, current period filled |
| `apps/web/app/teacher/requests/page.tsx` | **New.** Leave + register-change requests in one queue |
| `apps/web/app/teacher/announcements/page.tsx` | Rewritten against `/manage/announcements` |
| `apps/web/app/teacher/profile/page.tsx` | **New.** Read-only identity + change password |
| `apps/web/app/teacher/layout.tsx` | Nav updated to the agreed section list |

`lib/teacher-day.ts` exists so "which period am I in?" is a pure function with its own tests, rather than logic buried in a component that can only be tested by rendering it.

---

## Task 1: A test runner for `apps/web`

`apps/web` has no test tooling at all — no `test` script, no Vitest, no Jest. Every later task in this plan is unverifiable until this exists, so it comes first and ships with one real test to prove the harness works end to end.

**Files:**
- Create: `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`, `apps/web/test/render.tsx`
- Create: `apps/web/lib/teacher-day.ts`, `apps/web/lib/teacher-day.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces:
  - `renderWithProviders(ui: ReactElement, opts?: { api?: Partial<ApiStub> }): RenderResult` from `test/render.tsx`
  - `currentEntry(entries: TeacherDayEntry[], nowMinutes: number): { index: number; entry: TeacherDayEntry | null; elapsed: number; total: number }` from `lib/teacher-day.ts`
  - `minutesOfDay(hhmm: string): number`
  - npm script `test` → `vitest run`, `test:watch` → `vitest`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/teacher-day.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { TeacherDayEntry } from '@skoolos/types';
import { currentEntry, minutesOfDay } from './teacher-day';

const entry = (label: string, startTime: string, endTime: string, kind: 'CLASS' | 'BREAK' = 'CLASS'): TeacherDayEntry => ({
  periodId: `p-${label}`,
  label,
  startTime,
  endTime,
  kind,
  slot: kind === 'CLASS'
    ? { classSectionId: `sec-${label}`, className: `8-${label}`, subjectName: 'Mathematics', covering: false, coveringFor: null }
    : null,
  register: kind === 'CLASS' ? { taken: false, present: 0, total: 30, markedBy: null } : null,
});

const DAY: TeacherDayEntry[] = [
  entry('P1', '08:00', '08:45'),
  entry('Break', '08:45', '09:05', 'BREAK'),
  entry('P2', '09:05', '09:50'),
];

describe('minutesOfDay', () => {
  it('converts a wall clock string to minutes past midnight', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('09:05')).toBe(545);
    expect(minutesOfDay('23:59')).toBe(1439);
  });
});

describe('currentEntry', () => {
  it('finds the period containing the given time', () => {
    const r = currentEntry(DAY, minutesOfDay('08:20'));
    expect(r.entry?.label).toBe('P1');
    expect(r.index).toBe(0);
  });

  it('reports elapsed and total minutes for the current period', () => {
    const r = currentEntry(DAY, minutesOfDay('08:20'));
    expect(r.elapsed).toBe(20);
    expect(r.total).toBe(45);
  });

  it('treats a period as current up to but not including its end time', () => {
    expect(currentEntry(DAY, minutesOfDay('08:45')).entry?.label).toBe('Break');
  });

  it('returns a break as the current entry', () => {
    expect(currentEntry(DAY, minutesOfDay('08:50')).entry?.kind).toBe('BREAK');
  });

  it('returns null before the school day starts', () => {
    const r = currentEntry(DAY, minutesOfDay('07:00'));
    expect(r.entry).toBeNull();
    expect(r.index).toBe(-1);
  });

  it('returns null after the school day ends', () => {
    expect(currentEntry(DAY, minutesOfDay('18:00')).entry).toBeNull();
  });

  it('returns null for an empty day rather than throwing', () => {
    expect(currentEntry([], minutesOfDay('09:00')).entry).toBeNull();
  });

  it('handles a gap between periods by returning null', () => {
    const gapped = [entry('P1', '08:00', '08:45'), entry('P2', '10:00', '10:45')];
    expect(currentEntry(gapped, minutesOfDay('09:00')).entry).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && pnpm test
```

Expected: FAIL — there is no `test` script yet, so pnpm errors with "Command not found". That is the correct first failure.

- [ ] **Step 3: Install the runner and wire the scripts**

From the repo root:

```bash
pnpm --filter @skoolos/web add -D vitest@^2.1.8 @vitejs/plugin-react@^4.3.4 jsdom@^25.0.1 \
  @testing-library/react@^16.1.0 @testing-library/user-event@^14.5.2 @testing-library/jest-dom@^6.6.3
```

Add to `apps/web/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // Component tests import from app/ and lib/; exclude build output and e2e.
    include: ['{app,lib,components}/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` path in apps/web/tsconfig.json. Read that file and
      // match it exactly — a drifting alias makes tests import a different
      // module than the app does.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
```

Create `apps/web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: Implement the helper**

Create `apps/web/lib/teacher-day.ts`:

```ts
import type { TeacherDayEntry } from '@skoolos/types';

/** Minutes past midnight for a `HH:MM` wall-clock string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface CurrentEntry {
  /** Index into `entries`, or -1 when nothing is current. */
  index: number;
  entry: TeacherDayEntry | null;
  /** Minutes elapsed into the current entry; 0 when nothing is current. */
  elapsed: number;
  /** Length of the current entry in minutes; 0 when nothing is current. */
  total: number;
}

/**
 * Which entry of the teacher's day contains `nowMinutes`.
 *
 * A period owns its start minute and not its end minute, so back-to-back
 * periods never both claim the boundary. Before the first period, after the
 * last, and inside a gap between them, nothing is current — the caller shows
 * "school hasn't started" / "day finished" rather than guessing.
 */
export function currentEntry(entries: TeacherDayEntry[], nowMinutes: number): CurrentEntry {
  const index = entries.findIndex(
    (e) => nowMinutes >= minutesOfDay(e.startTime) && nowMinutes < minutesOfDay(e.endTime),
  );
  if (index === -1) return { index: -1, entry: null, elapsed: 0, total: 0 };
  const entry = entries[index];
  const start = minutesOfDay(entry.startTime);
  return {
    index,
    entry,
    elapsed: nowMinutes - start,
    total: minutesOfDay(entry.endTime) - start,
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
cd apps/web && pnpm test
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Add the render helper and prove it works**

Create `apps/web/test/render.tsx`:

```tsx
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** The subset of the real ApiClient that page components call. */
export interface ApiStub {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (path: string, body?: unknown) => Promise<unknown>;
  patch: (path: string, body?: unknown) => Promise<unknown>;
  del: (path: string) => Promise<unknown>;
}

/**
 * Renders a page with a fresh QueryClient. Retries are off and the cache is
 * per-test, so one test's error state cannot leak into the next.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
```

Read `apps/web/lib/use-api.ts` and `apps/web/components/use-host.tsx` before writing the next task's tests — page components call `useApi()` and `useHost()` directly, so component tests will need to `vi.mock` those two modules. Confirm their exact export names now and record them in your report; every later task depends on mocking them the same way.

- [ ] **Step 7: Confirm the runner does not break the build**

```bash
cd apps/web && pnpm typecheck && pnpm lint
cd ../.. && pnpm boundary
```

Expected: all clean. `vitest.config.ts` and `test/` must not be picked up by `next build` — if `pnpm --filter @skoolos/web build` complains, exclude `test/**` in `apps/web/tsconfig.json`'s `exclude` array.

- [ ] **Step 8: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/test apps/web/lib/teacher-day.ts \
        apps/web/lib/teacher-day.test.ts apps/web/package.json apps/web/tsconfig.json pnpm-lock.yaml
git commit -m "test(web): add a test runner, and the current-period helper it proves out

apps/web had no test tooling at all, so nothing in the web portal could be
verified. Vitest + Testing Library + jsdom, plus lib/teacher-day.ts as a pure
function with its own tests rather than clock logic buried in a component.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Repaint the portals indigo

The teacher portal, the student portal and the admin console all share `app/sk-theme.css`, which paints them forest green (`--sk-brand: #134d3b`). The Sckools logo and the phone app are indigo `#4F46E5` + amber `#F59E0B`. A teacher moving between laptop and phone currently sees two different products.

**Files:**
- Modify: `apps/web/app/sk-theme.css`
- Test: `apps/web/app/sk-theme.test.ts` (create)

**Interfaces:** none — CSS custom properties only. Every consumer already reads `var(--sk-brand)` and friends, so no component changes.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/sk-theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./sk-theme.css', import.meta.url)), 'utf8');

/** Reads a custom property's value from the first block that declares it. */
function tokenValue(name: string, from = css): string | null {
  const m = from.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe('sk-theme palette', () => {
  it('uses the Sckools indigo as the brand colour', () => {
    expect(tokenValue('--sk-brand')).toBe('#4f46e5');
  });

  it('uses the Sckools amber as the accent', () => {
    expect(tokenValue('--sk-amber')).toBe('#f59e0b');
  });

  it('no longer contains the old forest-green brand value', () => {
    expect(css.toLowerCase()).not.toContain('#134d3b');
    expect(css.toLowerCase()).not.toContain('#1c6c52');
  });

  it('still defines a dark-scheme override for the brand', () => {
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
    expect(tokenValue('--sk-brand', dark)).toBeTruthy();
    expect(tokenValue('--sk-brand', dark)).not.toBe(tokenValue('--sk-brand'));
  });

  it('keeps semantic colours distinct from the brand hue', () => {
    // good/bad/amber must not collapse into the accent, or state stops reading.
    expect(tokenValue('--sk-good')).not.toBe(tokenValue('--sk-brand'));
    expect(tokenValue('--sk-bad')).not.toBe(tokenValue('--sk-brand'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && pnpm test -- sk-theme
```

Expected: FAIL — `--sk-brand` is currently `#134d3b`.

- [ ] **Step 3: Repaint**

In `apps/web/app/sk-theme.css`, replace the light-scheme brand tokens:

```css
  --sk-brand: #4f46e5;
  --sk-brand-2: #6d66f0;
  --sk-brand-tint: #eef0ff;
```

and the amber tokens:

```css
  --sk-amber: #f59e0b;
  --sk-amber-tint: #fff6e6;
```

Then shift the neutrals off pure grey toward the new accent so the page reads as considered rather than inherited — the existing values are green-biased and will look muddy against indigo:

```css
  --sk-paper: #f6f5fb;
  --sk-ink: #17162f;
  --sk-ink-2: #55537a;
  --sk-ink-3: #8a88a7;
  --sk-line: #e5e4f0;
  --sk-line-2: #d4d2e6;
```

In the `@media (prefers-color-scheme: dark)` block, replace the corresponding values:

```css
    --sk-brand: #8b87ff;
    --sk-brand-2: #a29eff;
    --sk-brand-tint: #232050;
    --sk-amber: #f3b547;
    --sk-amber-tint: #3b2d11;
    --sk-paper: #0a0917;
    --sk-card: #14132a;
    --sk-ink: #efeefc;
    --sk-ink-2: #aba9ce;
    --sk-ink-3: #7a789e;
    --sk-line: #262545;
    --sk-line-2: #37355e;
```

Leave `--sk-good`, `--sk-bad`, `--sk-late` alone — semantic state colours are deliberately separate from the brand hue, and the attendance UI depends on green/red/amber reading as status rather than decoration.

- [ ] **Step 4: Run the test**

```bash
cd apps/web && pnpm test -- sk-theme
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Look at it**

```bash
cd apps/web && pnpm dev
```

Open `/teacher` and `/portal` in both light and dark, and confirm: brand chrome is indigo, the Sckools logo no longer clashes with its surroundings, present/absent/late pills still read as green/red/amber, and text contrast is legible on both grounds. Record in your report what you checked and anything that looked wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/sk-theme.css apps/web/app/sk-theme.test.ts
git commit -m "feat(web): repaint the portals in the Sckools indigo

The teacher portal, student portal and admin console were forest green while
the logo and the phone app are indigo + amber, so the same person saw two
different products depending on the device. Semantic good/bad/late colours are
deliberately untouched - they encode state, not brand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tasks 3–11 (to be expanded when Task 2 lands)

The remaining tasks are listed here with their deliverable and acceptance criteria so the shape of the phase is visible. **Each gets expanded into full step-by-step form — with real test code — immediately before it is dispatched**, not now: Tasks 1 and 2 will teach us the exact mocking pattern for `useApi`/`useHost` and the real ergonomics of testing these pages, and writing nine tasks of detailed component-test code before knowing that would be guesswork dressed up as a plan.

**Task 3 — Teacher home on `my-day` (items T1, T2, T7).** Rebuild `app/teacher/page.tsx`: current-period hero showing class, subject, room, live progress and either a Take-attendance action or a green "done — 27/28 present, taken by X"; notes and to-dos for the current period's class; rest-of-day timeline with taken/pending nodes; earlier-today collapsed beneath. Sources: `GET /manage/timetable/my-day`. Acceptance: a teacher sees only their own classes; a class marked by a colleague reads as taken without a reload; breaks and free periods render honestly rather than being hidden.

**Task 4 — Attendance parity (T7, T8, T11, T12).** Rework `app/teacher/attendance/page.tsx`: taken/pending state from `/manage/attendance/status`; a confirmation dialog before overwriting a colleague's register, naming who marked it; a closed past day rendered read-only with a "Request a change" action posting to `/manage/register-changes`; keep the existing Late support and mark-all-present. Acceptance: re-saving an already-taken class is impossible without passing the dialog; a past date shows the lock rather than a 409 toast.

**Task 5 — Requests tab (T11, T23).** New `app/teacher/requests/page.tsx` merging leave (`/manage/leave/mine`) and register changes (`/manage/register-changes/mine`) into one queue, plus apply-for-leave. Rename the nav item from "Leave" to "Requests". Acceptance: both request kinds appear with status; cancelling leave still restores classes.

**Task 6 — Teacher timetable (T22).** New `app/teacher/timetable/page.tsx` reading `GET /manage/timetable/mine`: one week grid, today tinted, current period filled, breaks drawn. Acceptance: the same component shape is reusable for the student timetable in Phase 3.

**Task 7 — Fix the announcements page (T15).** Rewrite `app/teacher/announcements/page.tsx` against `POST /manage/announcements` with `classSectionIds`, sourcing classes from `/manage/attendance/my-classes`. The current page posts to `/announcements` with `audience` fields — an endpoint and a payload that have never existed, so every submit 404s. Acceptance: posting to two classes at once works; the covered-class exclusion from Phase 1 is respected and its 403 surfaces readably.

**Task 8 — Holidays on the web (T24).** Show `GET /me/holidays` in the teacher portal. Acceptance: the same list the phone shows.

**Task 9 — Teacher profile (T6).** New `app/teacher/profile/page.tsx`: identity, classes held, change password. Acceptance: reachable from the nav; no teacher-facing dead ends.

**Task 10 — Migrate the web to `@skoolos/types` (P7).** Delete every locally-declared wire shape in `app/teacher/**` and `app/portal/**` and import from the shared package. This is the half of P7 that actually closes the `LATE` drift on the client. Acceptance: `rg "interface (AttendanceMark|Status|ClassSection|Profile)" apps/web/app` returns nothing.

**Task 11 — Nav parity and phase gate (T3).** Settle the teacher section list and apply it in `app/teacher/layout.tsx`; remove the dead Inbox item (its endpoint does not exist; messaging is Phase 4). Then run the full gate: `apps/web` tests, `apps/api` tests, e2e, typecheck, lint, boundary — and record real numbers.

## What Phase 2 deliberately does not do

- **No mobile work.** Phase 3.
- **No messaging, assignments, parent accounts or staff portal.** Phase 4 — each needs its own spec.
- **No push notifications.** Phase 4, and it needs the `NotificationOutbox` table rather than anything here.
- **Does not resolve the class-notes read-access question.** That is a product decision logged in the Phase 1 ledger and belongs to whoever owns school policy, not to this plan.
