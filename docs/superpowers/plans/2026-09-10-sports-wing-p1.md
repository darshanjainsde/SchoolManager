# Sports wing P1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.

**Goal:** The Sports desk (staff and admin), the admin Sports tab with teacher permissions, tournaments with class rounds and finals scheduled on venues, a two-desk-safe results board, heats and records with verify, houses and points, the rules book, and the student's portal tab — on staging.

**Architecture:** An encapsulated `modules/sports` (guard, settings, catalogue, maths, tournaments, results, records, houses, controllers) mirroring `modules/library`; a two-host web shell (`/app/sports` for the admin, `/sports` for the sports teacher) mirroring the library; pure maths in `sports-maths.ts` with its own spec; every write one `withTenant` call; version-checked match saves.

**Spec:** `docs/superpowers/specs/2026-09-10-sports-wing-design.md`

## Global constraints
Branch off `origin/staging`; `pnpm preflight` before every push; `LIST_CEILING` on every findMany; every new `ApiError` code in the union; new tables get RLS in the migration; module barrel exports only; no `@prisma/client` imports; `.sk-*` kit for every console/desk screen; `.claude/skills/sckools-ui-taste/SKILL.md` before UI; behaviour spec updated at the end.

## Tasks
1. **DB**: schema + migration `20260913_000000_sports_wing` (enum value, Staff.sportsPerms, SportsSettings, House, Student.houseId, HousePoint, SportsTournament/Venue/Event/Entry/Match/Heat/Mark/Record/RecordAttempt, RLS loop). Feature key `SPORTS`; NotificationKind `SPORTS`; outbox kind `SPORTS_NOTICE`. Tests: rls-coverage, types contracts.
2. **Catalogue + rules** (`internal/sports-catalogue.ts`, spec): every sport with kind/scoring/matchType/slot/lanes/unit/lowerIsBetter and rules sections + diagram key. A guard test: every MATCH sport has a scoring, every MEASURED a unit and lanes.
3. **Maths** (`internal/sports-maths.ts`, spec): knockout/byes/advance, winner-from-scores, schedule per venue, heats/final/ranks, placing points, band/age membership, record comparison, clashes.
4. **Guard + settings + houses** (`sports-desk.guard.ts`, `sports-perm.decorator.ts`, `sports-settings.service.ts`, `sports-houses.service.ts`, specs).
5. **Tournaments** (`sports-tournaments.service.ts`, spec): create (wizard DTO → venues, events, entries, matches, heats, schedule), get, board, clashes, shift, rain delay, publish, walkover.
6. **Results + records** (`sports-results.service.ts`, `sports-records.service.ts`, specs): score with version check + notifications; heat marks, final build, placing points, record attempts; records list/history/verify/void/import; reward letter `sendRecordSet`.
7. **Controllers + module** (`sports.controller.ts` desk + admin-only coach routes; `sports-me.controller.ts` for students; `sports.module.ts`; barrel; register in app module; tenancy allow-list untouched).
8. **Web desk** (`app/app/sports/*` tabs + shell + nav-items; `app/sports/*` staff host + layout; `components/sports/*` Bracket, HeatSheet, DayBoard, Wizard, RulesBook + diagrams; sk-theme `.sk-sp-*`). Tests: shell doors, wizard, bracket scoring with the 409 path, rules render, route-file-exports, nav-model.
9. **Admin + portal + roles**: nav-model item, staff page role SPORTS (gated), role-routes STAFF+SPORTS→/sports (+ test), mobile roles case, portal `/portal/sports` + nav item, notification-meta SPORTS.
10. **Behaviour spec + preflight + push**: management-academics §17 Sports, designed-vs-bug rows, portals §1/§3; `pnpm preflight`; `git push origin HEAD:staging`.

## As built (2026-09-10) — deviations from the task list above
- **Catalogue, maths and permissions live in `packages/types/src/sports/`**, not under the API module: they are pure data and pure functions, and the web needs them too (the rules book ships with the app and never calls the API; the bracket, day board, clash list and mark formatting run the same code on both sides). `apps/api/src/modules/sports/internal/sports-build.ts` holds only the planner that turns a wizard event into rows.
- **Match sides are side keys, not student FKs**: `SportsMatch.aSide/bSide/winner` are `s:<studentId>` for an individual and `c:<std>-<section>` for a section team, so a team sport draws sections (9 A v 9 B) and a result outlives a roster change. Custom sports carry their preset in the key: `custom:<preset>:<teamSize>:<slug>`.
- **`SportsTournament.dayEndMin`** was added (the schedule needs a day window, not just a start); `atMin` is minutes from day 0 midnight (`dayIdx * 1440 + minuteOfDay`).
- **House points are a ledger**: a re-scored match or re-ranked final writes the per-house difference (`sports-points.ts` `diffAwards`), never an edit. Band-stage placings are paid the moment a semi is saved (joint third), not only at the final.
- **Placings for team sides pay nothing** (a section has no house) — documented on the Settings tab.
- Sports teacher notification deep link on the teacher portal is `null` (no teacher sports page in P1); the student portal has `/portal/sports`.
- League structure, doubles, relays and the archery head-to-head set system are P2, as the spec §9 says.
