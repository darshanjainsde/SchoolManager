# Sports wing — design (2026-09-10)

Approved shape: the Record Book pitch (artifact 6589095e) and the Sports Desk prototype (artifact 1209fd85), refined by the user on 2026-09-10: a tournament holds several sports on shared venues; class rounds run inside one class with every section together, then the class champions meet in the band final; two sports teachers run one board; an admin Sports tab controls the sports teachers; a Rules book grouped by sport; a broad catalogue of Olympic and school sports with the scoring and match type of each.

## 0. Boundaries
- Branch `feat/sports-wing` off `origin/staging`; ship to staging first; prod migrations are user-run before the PR to main.
- Feature key `SPORTS`, override-only at launch (like ALUMNI, PRESS). The desk and everything under it need `SPORTS`; nothing here changes what a school without it sees.
- Lightweight and stateless: the desk holds nothing of its own; every action is one API call against the school's rows; two desks see the same board. Every list carries `LIST_CEILING`. All new tables carry `tenant_iso` RLS.
- Website `/records` page, the app tab and the Press certificate are Phase 2 (§9). Phase 1 is the desk, the admin tab, the portal tab, records with verify, houses and rules.

## 1. Roles
- **Sports teacher** = an ordinary STAFF login whose Staff row says `role: SPORTS` (exactly the librarian pattern). `/auth/me.staffRole = 'SPORTS'` lands them on `/sports`. `SportsDeskGuard` passes SCHOOL_ADMIN always, STAFF only with `role: SPORTS` and `isActive`.
- **Permissions** live on the Staff row (`sportsPerms String[]`): `ENTER` (results and marks), `VERIFY` (record attempts), `CREATE` (tournaments, events, venues), `PUBLISH` (to students), `HOUSES` (houses and points), `SETTINGS`. Defaults when the role is set: ENTER, VERIFY, CREATE, HOUSES. The admin edits them on Admin → Sports → Sports teachers. `@SportsPerm('ENTER')` on a handler checks the caller's list; admins pass every check.
- **Admin** sees the same desk at `/app/sports` (the library's two-host shell pattern) plus the Settings section: sports teachers and their permissions, houses, points table, bands, grouping mode.
- Class teachers keep a read-only view and, later (P2), PT-period logging. Students and families read.

## 2. Catalogue and rules (code, not DB)
`sports-catalogue.ts` lists every sport with: `key`, `name`, `group` (Athletics · Racket · Team · Combat · Water · Board · Co-curricular), `kind` (MATCH · MEASURED · JUDGED), `scoring` (games-to-N best-of-M · sets · points · goals · runs · time · distance · height · count · judged), `matchType` (KNOCKOUT · LEAGUE · both), `teamSize`, `slotMin`, `lanes`, `unit`, `lowerIsBetter`, and `rules`: an official-rules summary in sections (court/field, players, duration, scoring, service/serve, fouls, tie-break) plus a `diagram` key the web renders as an SVG (courts, pitches, the track). Olympic sports covered: athletics (track and field events), swimming, badminton, table tennis, tennis, football, basketball, volleyball, hockey, handball, boxing, judo, taekwondo, wrestling, archery, shooting, cycling, gymnastics (judged), plus Indian school staples (kho-kho, kabaddi, cricket, chess, carrom) and co-curricular (quiz, debate, elocution, art). A school can add a custom sport (name + kind) which takes the kind's default scoring.

## 3. Grouping
Two modes per school (`SportsSettings.grouping`): **BANDS** — bands of classes (Sub-junior, Junior, Senior; the classes in each are the school's, editable) — or **AGE** — official age groups "born on or after 1 January of the cut-off year, age as on 31 December, minimum class where the board sets one" (Kerala DGE 2025-26 shape). A tournament fixes the mode when created. Membership is computed from `Student.classSection.grade.order` (the class number) and `dob`.

## 4. Tournaments and events
- A **tournament** = name, dates, mode, day start, **venues** (courts, the track, the field), **events** (one sport × one band/age group × category B/G/X). Status DRAFT → LIVE (published) → DONE.
- **Entry**: everyone in the group; class-teacher nominations (P2: the request; P1 accepts a typed list); pick from the roster.
- **Structure** per event: MATCH sports — `CLASS` (one knockout per class with all its sections together, then a knockout of the class champions), `DRAW` (one knockout for the whole group), `LEAGUE` (P2); MEASURED — heats of `lanes`, then a final of the best `lanes`; JUDGED — one sitting, three scores.
- **Knockout maths** (`sports-maths.ts`): next power of two, byes to the top seeds, standard pairing (1 v last), winners advance; a bye walks through at once; a walkover is a win recorded with `walkover`.
- **Scheduling**: one timeline per venue; each event books slots on its venues; a round waits for the round before it (+10 min); class draws of one event run side by side. Played matches keep their time; only unplayed ones are (re)scheduled. A rain delay pushes the day start and reschedules the unplayed. **Clashes** (a child in two places) are computed on read after every schedule change; the desk shifts one side by a slot.
- **The day board**: every venue in time order, now/next, from every event at once — the announcer's sheet.

## 5. Results
- Scores per match: `scoreA[]`/`scoreB[]` (games), the winner derived by the sport's scoring (best-of-N to N points; single-score sports by higher; a draw is refused in a knockout). Saving a score: **version check** — the client sends the `version` it loaded; a stale version is refused 409 `MATCH_CHANGED` with who saved and what, and the board re-reads. Two desks never overwrite each other.
- MEASURED: marks per lane in heats; when every heat is in, the final is built from the best marks and scheduled 20 min after the last heat; the final's ranks award placing points; a mark better than the standing record becomes a **record attempt** (PENDING) — never a record by itself.
- House points: placing table for a final (10·7·5·3·2·1), per match won, per class round won (settings). Points are rows (`HousePoint`) so they can be corrected; standings are a sum.
- Notifications: a saved score writes a `SPORTS` bell row to both players ("Next: Court 2 at 11:20" or the result) and a `SPORTS_NOTICE` outbox row (push); publish writes one bell row per entrant with their first fixture.

## 6. Records
- A record line = `sportKey × groupKey × category`. Rows carry value, unit, holder name, holder student (when known), set on, since year; history is rows with `status: BROKEN` and `untilYear`; `VOID` with a note restores the previous. Comparison uses the sport's `lowerIsBetter`; equal never breaks (an "equalled" attempt is noted).
- Attempts: from a saved final, or typed in (`witnessed`); VERIFY moves the standing row to BROKEN, writes the new STANDING row, awards nothing to houses (points came from the placing), fires the reward: bell + push + letter to the family, the profile badge (P2 website ribbon, P2 certificate).
- Historic import: typed rows (name, year, value) with `source: 'REGISTER'`.

## 7. Rules book
A `Rules` section on the desk, grouped by the catalogue's groups; each sport shows its rules sections and diagram. Read-only, the same content for every school; a school note per sport ("our court is 20 m") is P2.

## 8. Data model
`StaffRole` + `SPORTS`; `Staff.sportsPerms String[]`; `SportsSettings` (1/school); `House`, `Student.houseId`, `HousePoint`; `SportsTournament`, `SportsVenue`, `SportsEvent`, `SportsEntry`, `SportsMatch`, `SportsHeat`, `SportsMark`, `SportsRecord`, `SportsRecordAttempt`. All tenant tables with RLS. Matches and records store student ids without FKs so a result never disappears with a roster change (history is what a record IS).

## 9. Phases
- **P1 (this branch)**: everything above except the website page, the app tab, certificates, leagues, nominations by request, PT-period logging.
- **P2**: website `/records` (three looks) + homepage section; Press certificate + Records Day sheet; app tab; leagues and groups; nominations; PT logging; school notes on rules.
- **P3**: squads and fixtures on the calendar; inter-school records; alumni holders on Homecoming.

## 10. Decisions (taken with the prototype, restated)
D1 role = STAFF + SPORTS with admin-set permissions. D2 feature `SPORTS` override-only. D3 class rounds inside a class with all sections; finals by band or age group. D4 strictly better breaks; equal is noted. D5 minors' names on the website follow the birthday wall's switches (P2). D6 verify before a record stands; void restores; history append-only. D7 rewards ticked in settings (P1: bell, push, letter, badge). D8 historic import typed. D9 three website looks (P2). D10 phases as above. D11 the version check on every match save. D12 a rain delay moves only unplayed matches.
