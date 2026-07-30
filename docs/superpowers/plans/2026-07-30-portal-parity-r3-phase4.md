# Portal Parity Round 3 — Phase 4: The new subsystems

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Build the five subsystems the parity decisions approved but no phase has yet touched: seeing your own announcements, push-on-publish, a staff portal, assignments, and teacher↔student messaging.

**Starting point:** branch `feat/portal-parity-r3-phase4` off `main` at `13b2f1d` (Phases 1–3 shipped). Baselines: mobile 46 suites/441 · web 25/176 · api 47/446 · types 16 · db 6 · e2e 3/19 · boundary 0.

**Explicitly excluded:** invoices/payments and the `PARENT` role split — the user tied both to a future pay-module release.

## Global Constraints (unchanged from Phases 1–3, plus)

- Wire types in `@skoolos/types`, both sides wired, or it is decoration.
- Every tenant read/write through `withTenant`; RLS on every new tenant table (copy the `tenant_iso` loop pattern; explicit `WITH CHECK`).
- Ownership predicates through `internal/class-access.ts` / `myClassSections` — never a fresh copy (three holes this project came from exactly that).
- Server `message` verbatim; four fetch states; theme-aware colours; role-neutral copy (shared student/parent login).
- FOREGROUND tests; e2e alone; explicit-path staging only; commit when green; deletion-proofs on the load-bearing tests.

## Task order and why

| # | Task | Item | Size | Why here |
|---|---|---|---|---|
| 1 | List/edit/delete own announcements | T16 | S | Teachers post blind today — cannot see, fix or retract what went out. Smallest gap, immediately felt. |
| 2 | NotificationOutbox + push-on-publish | S6/S7 wiring | M | The transactional-outbox table + cron drain; results/exams push lands on phones. Foundation messaging reuses. |
| 3 | Staff portal | P4 | M | Non-teaching staff land in the admin console on web and the teacher portal on the phone — both wrong. Minimal: own attendance view + leave. |
| 4 | Assignments | T21 | L | Teacher posts with PDF/image via the existing media service, due date, per-class tracking; students see and view. Own spec section below. |
| 5 | Messaging | T17 | L | Student→subject-teacher threads per the user's note. Own spec section below. Reuses the outbox for push. |
| 6 | Phase gate + final merge | — | S | Full gate, parity sweep update, merge to main+staging. |

---

## Task 1 (full spec) — Own announcements: list, edit, delete (T16)

**Server:** `GET /manage/announcements/mine` (`@Roles('TEACHER')`) — announcements where `createdByUserId = caller`, newest first, with class names resolved. `PATCH /manage/announcements/:id` and `DELETE /manage/announcements/:id` gain a TEACHER path: allowed only on rows the caller authored (resolve authorship from the STORED row; admins keep their existing unrestricted access). Declare `AnnouncementMine` in `@skoolos/types` (id, title, body, classSectionIds+names or school-wide, createdAt).
Route order: `mine` above `:id`. Reuse `AnnouncementsService`; no new ownership predicate.
**Web:** the announcements page regains a "Your recent posts" list (the honest placeholder from Phase 2 T7 said "not listed yet" — replace it) with edit/delete (ConfirmDialog for delete).
**Mobile:** same list under the Announcements tab, edit/delete.
**Tests:** authorship enforcement (a teacher cannot edit/delete another's post — prove by deletion), admin path unchanged, both clients' list/edit/delete flows, four states.

## Task 2 (spec summary) — NotificationOutbox + push-on-publish

Prisma `NotificationOutbox` (schoolId RLS, kind, payload JSON, recipientUserIds, createdAt, sentAt nullable, attempts) written **in the same transaction** as the triggering write (exam publish, exam create). A drain job on the existing cron pattern (`exam-reminders` is the reference: `internal/cron` + `CronSecretGuard`) sends via the existing Expo push channel (`common/notifications`), marks sentAt, caps attempts. Rules: a publish is never visible without its outbox row (transactional guarantee — test it); drain is idempotent; failures retry with cap. No Kafka — decided long ago.

## Task 3 (spec summary) — Staff portal (P4)

The user's words: "non teaching staff will have a portal with minimal controls and not on the admin portal… staff can view limited features on both app & web like attendance, apply leave, currently minimal." Web `/staff` (own staff-attendance view via existing staff-attendance module + leave apply/track using the Requests components); mobile `(worker)` group with the same two screens. Login routing: web STAFF → `/staff` (today: admin console — wrong); mobile STAFF → the new group (today: teacher portal — wrong). Server: whatever `@Roles('STAFF')` read endpoints are missing for own attendance; leave already role-checks TEACHER — widen to STAFF deliberately or add a staff-leave path after reading the leave module (finding to report, not to improvise).

## Task 4 (spec summary) — Assignments (T21)

User's note: "teachers can give assignments with proper option to upload pdf/image/clear instruction and add due date directly and the assignment tracking should be proper according to the respective classes."
Models: `Assignment` (class-scoped, subjectId, title, instructions, dueDate, attachments via existing `MediaAsset`/media service — reuse the CMS upload path, scoped per school; check its ACL story first), RLS. v1 tracking = per-class visibility + student "seen/opened" marks; NO submission uploads in v1 (that is a marking workflow — flag for a later round, do not sneak it in).
Teacher (both surfaces): create with attachments + due date, list per class, see seen-counts. Student (both): list upcoming/past due, open attachments. Push on new assignment via Task 2's outbox. Ownership: teacher's own classes only (covering excluded — same rule as exams).

## Task 5 (spec summary) — Messaging (T17)

User's note: "students of that teacher are only allowed to message the teacher. Under the students tab they will see their properly assigned all subject teachers for that week; they can select the subject/teacher and message/ask query; upon teacher response they will see the response at the top."
Models: `MessageThread` (studentId, teacherId, subjectId, class-scoped, RLS) + `Message` (threadId, senderRole, body, readAt). One thread per student×teacher×subject. Authorization: student may only open threads to teachers who hold a timetable slot for their section (server-enforced, from the timetable — not client claims); teacher sees threads from their own students only. Endpoints under `/me/messages` (student) and `/manage/messages` (teacher). Web: teacher Inbox returns to the nav (the entry deleted in Phase 2 because it lied — now it can tell the truth); student portal gets "Ask a teacher". Mobile: both sides. Push on new message via outbox. Rate-limit student sends (reuse the throttler). v1: text only, no attachments.

## What Phase 4 does not do

Invoices/payments; PARENT role; submission uploads for assignments; message attachments; read receipts beyond readAt; web push (phone-only by decision).
