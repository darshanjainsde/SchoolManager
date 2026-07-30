# Portal Parity Round 1 — Phase 3: The mobile app

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Android app to the same teacher capability set the web now has, so a teacher moving between laptop and phone sees one product with one set of controls — and close the data-loss bug that started this whole project.

**Architecture:** All work is in `apps/mobile` (Expo Router, React Native). Screens read from the endpoints Phases 1 and 2.5 built, and take their types from `@skoolos/types` rather than the hand-copied declarations in `apps/mobile/src/lib/*.ts`. No API work is expected; if a task needs a server change, that is a finding to report, not a licence to widen scope.

**Tech Stack:** Expo SDK with expo-router, React Native, Jest + jest-expo + React Native Testing Library, Maestro for device E2E.

## Starting point

Branch `feat/portal-parity-r2-mobile` off `main` at `544d8e7` (Phases 1 + 2 + 2.5 merged).
Baseline: `apps/mobile` **19 suites / 67 tests** green. `apps/api` 47 / 431. `apps/web` 23 / 163.

## Global Constraints

- **Wire types come from `@skoolos/types`.** `apps/mobile/src/lib/attendance.ts` and `lib/portal.ts` currently hand-mirror the server's shapes with comments saying "Mirrors AttendanceService…". Those comments are the bug: a mirror does not fail when the original changes.
- **Attendance is ONE register per class per day.** Never build UI implying per-period registers.
- **Dates sent to the server are `YYYY-MM-DD` built from device-local parts.** `lib/attendance.ts:todayISO()` already does this correctly — do not replace it with `toISOString()`, which reports the UTC day.
- **Server `message` is surfaced verbatim.** The API writes those strings for a teacher to read.
- **Every screen handles loading, error, empty and populated.** A blank screen while loading tells a teacher "there is nothing", which is a different and wrong statement.
- **No hard-coded colours.** `src/theme/tokens.ts` owns the palette. Dark mode (task 8) depends on nothing bypassing it.
- **Commit after every task**, prefixed `fix(mobile):` or `feat(mobile):`, ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Task order and why

The order is deliberate: the data-loss bug first because it is actively corrupting records; then the roster details that make the attendance screen trustworthy; then the screens that do not exist yet.

| # | Task | Items | Why here |
|---|---|---|---|
| 1 | Shared types + `LATE` | P7, T9 | The original bug. Fixing it via the shared contract makes the class of bug structural, not incidental. |
| 2 | Roster parity | T12, T13, T14 | Small, high-trust: roll numbers, mark-all-present, a save confirmation. |
| 3 | Date picker + past-day lock + change requests | T11 | The app has **no** lock UI at all. Without it the server's 409 is a dead end on a phone. |
| 4 | Today screen: current period, notes, to-dos | T1, T2 | Needs `subjectId`, which Phase 2.5 added to the contract. |
| 5 | Teacher timetable | T22 | The week grid the web built; same data, native layout. |
| 6 | Requests + leave | T23, T11 | Leave exists only on the web — the thing you apply for when you are ill and not at a desk. |
| 7 | Tests + results entry | T19, T20 | The highest-stakes teacher action, web-only today. |
| 8 | Dark mode + server-side logout | T4, T5 | Logout currently leaves the refresh token alive server-side. |
| 9 | Offline save queue | T5, P6 | Your note: a save must survive a dead signal and sync when it returns. |
| 10 | Menu parity + phase gate | T3 | Agree one section list across both surfaces; run everything. |

**Student-side items (S1–S9) are deliberately excluded.** They are gated on the parent-account decision (P1): there is no `PARENT` role, and the app's family portal signs in as a student while calling itself "Your child". Building the student screens before that is decided means building them twice.

---

## Task 1: Shared types, and `LATE` stops being destroyed

**The bug.** `apps/mobile/src/app/(staff)/take/[classSectionId].tsx:61` loads a roster with `present: byId.get(s.id) !== 'ABSENT'` — so a student marked `LATE` on the web loads as *present*. `lib/attendance.ts:buildMarksPayload` then writes `present ? 'PRESENT' : 'ABSENT'`. The next save from the phone silently rewrites that `LATE` to `PRESENT`. Work done on the web is destroyed by the app.

The server has always accepted three states. The web offers three. The app offers two, because it declared its own two-state notion of a mark.

**Files:**
- Modify: `apps/mobile/src/lib/attendance.ts` — delete the local `ClassDayStatus`, `MyClassSection`, `SaveAttendancePayload`; import from `@skoolos/types`
- Modify: `apps/mobile/src/lib/portal.ts` — same for `Announcement`, `AttendanceDay`, `AttendanceSummary`, `Holiday`, `StudentProfile`
- Modify: `apps/mobile/src/app/(staff)/take/[classSectionId].tsx` — three-state roster
- Modify: `apps/mobile/src/lib/__tests__/attendance.test.ts`
- Modify: `apps/mobile/src/app/(staff)/take/__tests__/take.test.tsx`
- Modify: `apps/mobile/package.json` and `tsconfig.json` if `@skoolos/types` does not resolve yet
- Modify: `apps/mobile/jest.config` (in `package.json`) — moduleNameMapper for `@skoolos/types`

**Interfaces:**
- Consumes from `@skoolos/types`: `ATTENDANCE_STATUSES`, `AttendanceStatusValue`, `AttendanceMark`, `SaveAttendanceRequest`, `MyClassSection`, `ClassDayStatus`, `Announcement`, `AttendanceSummary`, `AttendanceDay`, `Holiday`, `StudentProfile` (promote any that are missing, wiring the API side too).
- Produces: `buildMarksPayload(classSectionId: string, date: string, roster: Array<{ studentId: string; status: AttendanceStatusValue }>): SaveAttendanceRequest` — note the roster now carries a **status**, not a boolean.

- [ ] **Step 1: Make `@skoolos/types` resolve from `apps/mobile`**

Check whether it already does. `apps/mobile` is in the pnpm workspace but may not depend on the package. Add `"@skoolos/types": "workspace:*"` to its dependencies, add the path to `tsconfig.json`, and add a `moduleNameMapper` entry to the jest config in `package.json` mirroring what `apps/api/jest.config.js` does. Run `pnpm install` from the repo root.

Prove it resolves before writing anything else: a one-line temporary import in an existing test, `pnpm test`, then remove it. Report what you did.

- [ ] **Step 2: Write the failing tests**

In `apps/mobile/src/lib/__tests__/attendance.test.ts`, replace the boolean-roster tests with:

```ts
import { ATTENDANCE_STATUSES } from '@skoolos/types';
import { buildMarksPayload, todayISO } from '../attendance';

describe('buildMarksPayload', () => {
  it('preserves every one of the three states the server accepts', () => {
    const payload = buildMarksPayload('sec-1', '2026-08-03', [
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
      { studentId: 's3', status: 'LATE' },
    ]);
    expect(payload.marks).toEqual([
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
      { studentId: 's3', status: 'LATE' },
    ]);
  });

  it('never collapses a status to a boolean and back', () => {
    // The regression guard. The old implementation took `present: boolean`,
    // so LATE could not survive a round-trip through it by construction.
    for (const status of ATTENDANCE_STATUSES) {
      const [mark] = buildMarksPayload('sec-1', '2026-08-03', [{ studentId: 's1', status }]).marks;
      expect(mark.status).toBe(status);
    }
  });

  it('passes the class and date through unchanged', () => {
    const payload = buildMarksPayload('sec-9', '2026-01-31', []);
    expect(payload.classSectionId).toBe('sec-9');
    expect(payload.date).toBe('2026-01-31');
    expect(payload.marks).toEqual([]);
  });
});
```

Keep the existing `todayISO` tests untouched — they guard the device-local date and must not regress.

In `apps/mobile/src/app/(staff)/take/__tests__/take.test.tsx`, add:

```ts
it('loads a LATE student as LATE, not as present', async () => {
  // The bug: `present: status !== 'ABSENT'` rendered LATE as Present, and the
  // next save rewrote it to PRESENT — destroying a mark made on the web.
  // Mock GET /manage/attendance to return a LATE mark and assert the row
  // shows Late selected.
});

it('submitting a roster with a LATE student sends LATE', async () => {
  // Assert on the PUT body, not on the UI.
});
```

Fill those in following the file's existing mocking conventions — read it first.

- [ ] **Step 3: Run them and watch them fail**

```bash
cd apps/mobile && pnpm test
```

Expected: the new `buildMarksPayload` tests fail on the signature change; the take-screen tests fail because a LATE mark renders as Present.

- [ ] **Step 4: Implement**

`lib/attendance.ts` — delete the local interfaces, import the shared ones, and change the payload builder to carry status:

```ts
import type { AttendanceStatusValue, SaveAttendanceRequest } from '@skoolos/types';
export type { ClassDayStatus, MyClassSection } from '@skoolos/types';

export interface RosterMark {
  studentId: string;
  status: AttendanceStatusValue;
}

/** Shapes the take-attendance screen's roster into the PUT /manage/attendance contract. */
export function buildMarksPayload(
  classSectionId: string,
  date: string,
  roster: RosterMark[],
): SaveAttendanceRequest {
  return { classSectionId, date, marks: roster.map((r) => ({ studentId: r.studentId, status: r.status })) };
}
```

`take/[classSectionId].tsx` — the roster row holds a status, not a boolean:

```ts
interface RosterRow {
  studentId: string;
  name: string;
  rollNo: string | null;   // task 2 uses this; select it now so the join happens once
  status: AttendanceStatusValue;
}
```

Load it as `byId.get(s.id) ?? 'PRESENT'` — an unmarked student defaults to present, which is what the server does. Render a three-way control driven by `ATTENDANCE_STATUSES` rather than a hard-coded pair, so adding a fourth state server-side surfaces here instead of being silently dropped. Use the existing `tokens.color.green` / `red` / `amber`.

- [ ] **Step 5: Run until green, then prove the guard**

```bash
cd apps/mobile && pnpm test && pnpm typecheck
```

Then revert `status` to a boolean in `buildMarksPayload` and confirm the round-trip test fails. Restore it. Report both observations — a test that passes either way has not caught this bug.

- [ ] **Step 6: Confirm nothing else regressed**

```bash
cd ../api && pnpm test
cd ../../packages/types && pnpm test
cd ../.. && pnpm boundary
```

`apps/api` must stay 47 suites / 431 tests. If promoting a type to `@skoolos/types` required an API edit, say which and why.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile packages/types pnpm-lock.yaml
git commit -m "fix(mobile): stop the app destroying LATE attendance marks

take/[classSectionId] loaded a roster as \`present: status !== 'ABSENT'\`, so a
student marked LATE on the web rendered as Present — and buildMarksPayload,
which took a boolean, then wrote that back as PRESENT. Any LATE mark was
silently destroyed by the next save from a phone.

The roster now carries the status itself, and the three states come from
ATTENDANCE_STATUSES in @skoolos/types rather than a hand-copied pair, so the
app can no longer disagree with the server about what a mark can be.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tasks 2–10

Each is expanded to step level with real test code immediately before dispatch, once the preceding task has established the patterns it depends on. Writing ten tasks of React Native test code up front — before knowing how `@skoolos/types` resolves under `jest-expo`, or what the roster component ends up looking like — produces confident fiction. Phase 2 proved the point: every task found a genuine error in its brief, including one where the plan's own timezone arithmetic was wrong.

**Task 2 — Roster parity (T12, T13, T14).** Roll numbers beside names; mark-all-present; a save confirmation naming the counts and that guardians of absentees are being emailed. Acceptance: the roster reads the same as the web's, and a teacher knows the save reached the server.

**Task 3 — Date picker and the past-day lock (T11).** A date picker defaulting to today; a past day rendered read-only with a "Request a change" action posting to `/manage/register-changes`. The app has **no** lock UI today, so the server's `REGISTER_LOCKED` 409 is currently a dead end. Acceptance: a teacher never discovers the lock by submitting.

**Task 4 — Today screen (T1, T2).** Current period from `/manage/timetable/my-day`, its class's notes and to-dos (now subject-scoped), rest-of-day timeline. Acceptance: matches the web's information architecture; the app's "Today" stops meaning "all my classes".

**Task 5 — Teacher timetable (T22).** Week view from `/manage/timetable/mine`, today emphasised. Acceptance: the same two-level emphasis the web grid uses, laid out natively rather than ported.

**Task 6 — Requests and leave (T23, T11).** Apply for leave, track and cancel; register-change requests in the same queue.

**Task 7 — Tests and results (T19, T20).** Schedule a test; enter and publish marks, keeping the confirmation step before publishing.

**Task 8 — Dark mode and real logout (T4, T5).** A dark palette in `tokens.ts` plus a switch; logout calls `POST /auth/logout` before clearing local state — today it only wipes the device, leaving the refresh token valid server-side.

**Task 9 — Offline save queue (T5, P6).** Your note: *"if teacher saves and no internet it should save too and when network available it syncs properly."* Write the roster locally on save, replay when connectivity returns. Safe because re-saving the same class and date is already idempotent server-side. Acceptance: airplane mode → save → reconnect → the register is on the server, and the teacher was told what was happening at each step.

**Task 10 — Menu parity and the gate (T3).** One agreed section list across web and app. Then the full gate with real numbers, plus a Maestro flow covering the `LATE` round-trip on a device.

## What Phase 3 deliberately does not do

- **The student and family screens (S1–S9).** Blocked on the parent-account decision.
- **Messaging, assignments, parent accounts, the staff portal, push-on-publish.** Phase 4, each with its own spec.
- **Any new API surface.** If a task needs one, that is a finding to report.
