# Shipping the librarian's counter — what has to happen, in order

Written 2026-08-15, at the end of the build, while the facts are checkable.
This is the handover for `feat/library-service` → staging. **Nothing here has been
run.** Every command below is proposed, not performed; the branch is unpushed by
the standing rule that the user gates every push.

## What is being shipped

The librarian's counter inside Sckools at `/library`, and with it: the LIBRARIAN
role, an admin button that mints her login, take-back/give-out/renew, undo,
damage, the library-period attendance tick, the class-teacher nudge, add-a-book,
the student's self-report of a lost book, and a daily reminder cron. Plus two
live bug fixes — `/manage/staff` was readable and deletable by any authenticated
token, and `issue` had no mutual exclusion on the member borrowing limit.

## 1. Migrations — read this before assuming "no schema change"

**This session's work added ZERO migrations and ZERO schema changes.** Verified:
`git diff --stat a38896b~1..HEAD -- packages/db/prisma/schema.prisma
packages/library-db/prisma/schema.prisma` is empty.

**But the BRANCH is another matter.** `origin/main..HEAD` carries **33
migrations** — 2 Sckools (`leave_policy`, `user_role_librarian`) and 31 library.
The library ones are the whole service's history, because staging's library
database predates P3. Deploying this branch is not "one new feature", it is
bringing two databases forward.

Trap 4 applies with force: migration folder names are the APPLY ORDER, not
documentation. A migration timestamped before one it depends on passes on every
database that applied them interactively and fails only on the first fresh
deploy. Run `migrate deploy` against a genuinely empty database before believing
the order is right.

## 2. Environment — the new hard requirement

`skoolos-api` now reads the library database DIRECTLY (four services in
`apps/api/src/modules/library/` import `@library/db`). It therefore needs:

- `LIBRARY_DATABASE_URL_APP` — the RLS-bound `library_app` role
- `LIBRARY_DATABASE_URL_PLATFORM` — `BYPASSRLS`, used by org resolution and the
  reminder cron

**These are set in no environment today** — not locally, not on staging. Without
them every library route 500s. `library-org.service.ts` already logs that cause
by name rather than letting it surface as an unplaceable error on an
unrelated-looking route; read the logs for that sentence first if the counter is
blank.

`CRON_SECRET` must already be set on `skoolos-api` (it was, on 2026-08-14) — the
new `/internal/cron/library-reminders` route shares it. It fails CLOSED: no
header can match an unset secret, which is the right way round for a route that
walks every school's library and writes into inboxes.

**Env changes need a redeploy to take effect.**

## 3. Order

1. Push the branch. Staging deploys from it; production does not.
2. Set the two `LIBRARY_DATABASE_URL_*` vars on `skoolos-api` (staging), redeploy.
3. `migrate deploy` both databases. Assert the project ref before running
   anything: the library's own project is `eocxgzcfzwmbaivobzfx` and the pooler
   host is `aws-0-`, not `aws-1-`. Never the production project
   (`oljrqinbjhpysgfwmtxw`).
4. Provision a library org for the test school, then press **Sign everyone up**
   on the counter's first-run screen.
5. Create a LIBRARIAN login from the staff console and sign in as her.

## 4. Verify on staging, in this order

The counter's first-run states are ordered so a librarian is never shown a desk
she cannot use, and they are the fastest end-to-end proof:

1. Sign in as the librarian → lands on `/library`, not `/app`.
2. With no members: "Nobody is signed up yet" and one button.
3. After enrolling, with no books: "The shelves are empty" and the add form.
4. Add a book, then take it back and give it out. Watch the receipt line.
5. Undo the issue and confirm the day list changes.
6. Check `/portal/library` as a student and `/teacher/library` as a teacher.

Then the two things only staging can answer:

- **The burst.** 40 concurrent `POST /manage/library/return`. `connection_limit=1`
  serialises them inside one Fluid instance; at ~200ms per transaction the tail
  exceeds the 5s `maxWait` and fails P2024, which reads like pool exhaustion and
  is really contention. Measure before touching either lever — see the spec's
  "Before staging: two processes, one pooler".
- **The cron.** `curl -H "x-cron-secret: …"` the reminder route and read the
  counts it returns. `unreachable` counts members with no linked Sckools login;
  a large number there is an enrolment problem, not a reminder problem.

## 5. Known-unfinished, so nobody is surprised

- **The librarian still has two passwords.** SSO is unbuilt, and the bridge as
  written cannot serve her: `exchange()` requires a `Member` with a login row,
  and `enrolSchool()` creates members for students and teachers only. Nothing in
  `apps/api` signs RS256 and `SCKOOLS_JWT_PUBLIC_KEY` is unset, so
  `/auth/sckools/exchange` answers 503 wherever it is deployed.
- **The mobile app has no library at all** — no screens, no nav entry, and no
  feature gating anywhere in the app to hang one on.
- **`classRef` is free text** and is now load-bearing twice over: the library
  period roster and the join that reaches a class teacher. `6-B` vs `6B` yields
  an empty roster, and every April every label changes meaning.
- **Fines accrue on calendar days**, so 45 days of summer vacation bills a shut
  library. That is money and it is wrong by default.
- `next build` fails locally on `apps/web` — pre-existing, reproduces on
  `origin/main`, and Vercel builds it fine. Not a deploy blocker; see the task
  notes for what has been ruled out.
