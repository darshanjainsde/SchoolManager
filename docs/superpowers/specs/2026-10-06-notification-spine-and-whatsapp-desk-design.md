# Notification spine + WhatsApp Desk — architecture (2026-10-06)

Decisions taken by the owner on 2026-10-06 after the audit presented in the
"WhatsApp Desk" artifact (`PY8npDFQhwSKUb7DasJ2wE`): all recommended decisions
accepted, plus one addition — **email goes out alongside every notification**,
on an architecture as deliberate as WhatsApp's.

This document is the design. The plan under `docs/superpowers/plans/2026-10-06-*`
implements it tier by tier. It builds on, and does not replace,
`2026-09-21-whatsapp-identity-and-actions-design.md` (identity model, OTP
engine, the nine earlier decisions).

## 0. What the audit found, in one paragraph

Three agents read every one of the 7 `notify()` and 20 outbox write sites, the
whole leave → cover flow, and the inbound webhook. The pattern is the same
everywhere: the pieces are good and they are not joined. The login side knows
who is behind a phone (`PhoneProfilesService`) and the inbound side does not
call it. The outbox is durable and claims rows safely, and 17 of 19 writers
never ask it to drain, so messages wait for the 02:00 cron. Email composers
exist for the staff kinds and the drain never calls the email channel. Four
narrow Utility templates are approved on Meta and referenced nowhere. The
accounts officer may approve leave on the web and may not on WhatsApp. The
design below joins the pieces; it invents as little as it can.

## 1. Decisions and the architect's review

| # | Decision | Verdict | What the review adds |
|---|---|---|---|
| 1 | Families act on WhatsApp, after opt-in | Keep | Opt-in is on the **Student** (the office's record), opt-out is **per phone per school** (the person's word, platform-side). Both gate every send; either alone is not enough. |
| 2 | Leave desk on WhatsApp = web rule (admin or ACCOUNTS officer) | Keep | The rule is extracted from `LeaveDeskGuard` into one pure function both the guard and the inbound resolver call. Substitution routes adopt the same guard, so the officer can also cover what they approve. |
| 3 | Quiet hours 07:00–20:00 IST; one WhatsApp per family per day, rest folded | Keep, narrowed | Quiet hours apply to **WhatsApp and push**, not email — email is the record and does not buzz a bedside. The fold applies to **non-urgent family kinds only**; absence, a remark, a fee decision and every staff action go out at once. |
| 4 | Diary remark: never the text | Keep | Applies to WhatsApp **and push**. Email keeps the full text — it is behind a login and is the parent's copy. |
| 5 | Tier 0 first, on its own PR, to prod | Keep | Tier 0 touches only what is already live and fixes it. Nothing in it needs a new template or a migration. |
| 6 | Email alongside every notification | New | One spine. Every event is one outbox row; the drain fans out to **email + push + WhatsApp + bell** through one `NotificationDelivery` record per channel per person, each with its own retry, hold and suppression. `notify()` stays as a name and becomes sugar over the spine, so there is one delivery engine, not two. |

Three things the review adds that the pitch did not say:

- **Adding a button to an approved template is a new template.** Meta does
  not let a body or its buttons change in place; a new name is needed, and a
  deleted name cannot be reused for 30 days. Every template that gains an
  action below is submitted as `_v2` and the code switches over on approval.
  This is the long pole of Tier 2 and the plan sequences submissions first.
- **The outbox stays the only writer-facing API.** Writers call one
  `enqueue()`; nothing else may `notificationOutbox.create`. A guard test reads
  the source and fails on any other call site. That is how `drainSoon()` stops
  being optional.
- **Prod email goes through Hostinger SMTP today** (no `RESEND_API_KEY` on
  production; Hostinger's DKIM CNAMEs `hostingermail-a/b/c` are present, DMARC
  is `p=none`). The spine does not care which transport; `MailService` already
  picks. Moving prod to Resend is a one-variable change and a user decision,
  not part of this design.

## 2. The spine

```
event in a service
  └─ enqueue(tx, { kind, payload, audience })        one outbox row, in the same tx
       └─ post-commit: drainSoon()                   never optional again
            └─ drain (cron or opportunistic, SKIP LOCKED — exists)
                 ├─ recipients = resolve(audience)   user | section | school | admins | desk(ACCOUNTS|LIBRARIAN|SPORTS)
                 ├─ for each recipient × channel → NotificationDelivery row
                 │     EMAIL     always (unless the user turned email off for this topic)
                 │     PUSH      quiet hours · topic pref
                 │     WHATSAPP  school switch · Student/Teacher opt-in · per-phone opt-out · quiet hours · daily fold · suppression · Redis dedup
                 │     BELL      in-app row (exists as emitNotifications; folds in here)
                 └─ outbox.sentAt = when every delivery is terminal
```

### 2.1 `enqueue()`

```ts
enqueue(tx, {
  kind: NotificationKind,
  payload: PayloadFor<kind>,
  audience:
    | { userId }                       // one person
    | { userIds }                      // a few people, same payload
    | { classSectionId }               // every linked student of a section
    | { school: true }                 // every linked student
    | { desk: 'LEAVE' | 'ACCOUNTS' | 'LIBRARIAN' | 'SPORTS' }  // the people who run that desk
    | { perRecipient: Array<{ userId; payload }> }  // absence-style, one payload each
});
```

It writes the row(s) inside the caller's transaction and registers
`drainSoon()` to run after commit (via the existing `runInBackground`). The
seven current `notify()` callers become `enqueue()` calls; `NotificationService
.notify()` is kept as a thin wrapper for one release and then removed.

`desk: 'LEAVE'` resolves to every SCHOOL_ADMIN plus every active Staff with
`role = 'ACCOUNTS'` — the same set `LeaveDeskGuard` admits. Today
`LEAVE_APPLIED` goes to admins only; the officer who runs the desk hears
nothing.

### 2.2 `NotificationDelivery`

One row per (outbox row, recipient, channel). It is the truth about what
happened to a message on a channel; the provider ledgers (`WhatsAppDelivery`,
`EmailDelivery`) keep provider receipts and gain a nullable `deliveryId` back
to it.

```prisma
model NotificationDelivery {
  id            String   @id @default(uuid()) @db.Uuid
  schoolId      String   @db.Uuid
  outboxId      String   @db.Uuid
  userId        String   @db.Uuid
  channel       String   // EMAIL | PUSH | WHATSAPP | BELL
  /// QUEUED | HELD | SENT | DELIVERED | READ | FAILED | SUPPRESSED | SKIPPED
  status        String   @default("QUEUED")
  /// Why HELD/SUPPRESSED/SKIPPED: quiet-hours | daily-fold | opt-out | no-address | pref-off | template-paused | not-on-whatsapp
  reason        String?
  attempts      Int      @default(0)
  nextAttemptAt DateTime?
  error         String?
  providerId    String?  // waMessageId / email providerId / expo ticket
  createdAt     DateTime @default(now())
  sentAt        DateTime?
  deliveredAt   DateTime?
  readAt        DateTime?
  @@unique([outboxId, userId, channel])
  @@index([schoolId, createdAt])
  @@index([status, nextAttemptAt])
  @@index([userId, createdAt])
}
```

Rules:
- **Retry** is per channel: backoff 1 m → 5 m → 30 m → 2 h → 12 h, five
  attempts, then FAILED. Transient = network, HTTP 5xx, Meta `130429`,
  SMTP 4xx. Permanent = Meta `131026/131031/132001/132005/132007`, SMTP 5xx,
  a suppressed address.
- **HELD** rows carry `nextAttemptAt` (next 07:00 IST, or 18:30 IST for the
  fold) and are picked up by the same drain query. Nothing is dropped.
- **An outbox row is `sentAt`** when all its deliveries are terminal
  (SENT/DELIVERED/READ/FAILED/SUPPRESSED/SKIPPED). `attempts` on the outbox row
  stops meaning "sends" and means "drain passes".
- The drain query becomes two: claim unsent outbox rows (as today) and expand
  them into deliveries; then claim due deliveries (`status IN (QUEUED, HELD)
  AND nextAttemptAt <= now()`) and send. Both use `FOR UPDATE SKIP LOCKED`.

### 2.3 Gates, in order, for WhatsApp

1. Platform configured; `WhatsAppSettings.enabled` for the school.
2. Address: verified `User.phone` › `Student.guardianPhoneE164` › `Teacher.phoneE164` › `Staff.phoneE164` (exists).
3. **Person said no**: `Teacher.whatsappOptIn === false` (exists) · **new**
   `Student.whatsappOptIn === false` · **new** `WhatsAppOptOut(phone, schoolId)`
   from a STOP reply. → SKIPPED `opt-out`.
4. **Template paused** (from Meta's `message_template_status_update`) →
   SKIPPED `template-paused`; email and push still go; the owner is alerted.
5. **Suppressed phone** (`WhatsAppSuppression`, 30 days after `131026`/`131031`) → SUPPRESSED.
6. **Quiet hours**: outside 07:00–20:00 IST → HELD until 07:00. Email exempt.
7. **Daily fold** (family recipients, non-urgent kinds only): if this phone
   already received a WhatsApp from this school today → HELD until 18:30 IST,
   where all held rows for that phone become one `sckools_daily_digest`
   ("3 updates today for Ravi, Anaya — open the app"). Urgent kinds bypass:
   ABSENCE_NOTICE, DIARY_REMARK, FEE_*, every LEAVE_*/COVER_*, CONCERN_*.
8. **Dedup**: Redis `SET NX EX 60` on `sha256(phone|template|params)`.
   Replaces the in-process Map, which cannot see across serverless instances.
   Redis unavailable → fall back to the Map and log once.

Push follows 1 (its own token), 3 (topic pref), 6. Email follows 3 (topic pref)
and `EmailSuppression` (exists). Bell has no gates.

### 2.4 Preferences

`User.notifyPrefs` keeps its topic keys (`leave`, `register`, `fees`,
`enquiry`, `summary`) and gains `channels: { email, push, whatsapp }` (all
default true). A topic off = no delivery on any channel; a channel off = SKIPPED
`pref-off` on that channel. Security mail (reset, invite, codes) is not on the
spine and ignores prefs.

### 2.5 Kinds and templates

Every `NotificationKind` has, by type, an email composer, a push text and a
WhatsApp template — the `Record<NotificationKind, …>` maps already make a
missing one a compile error. The spine adds kinds and retires the overloading
of `ANNOUNCEMENT`:

| Kind | New? | WhatsApp template | Buttons (v2) | Email |
|---|---|---|---|---|
| ANNOUNCEMENT | topic added: `GENERAL \| HOLIDAY \| PTM \| TIMING \| FEE` | `notice_posted` · `holiday_notice` · `ptm_notice` · `timing_change` · `fee_due` (all approved) | PTM: Coming · Can't | full body |
| SPORTS_UPDATE | **new** (replaces the unmapped SPORTS_NOTICE) | `sckools_sports_update` (submit) | — | yes |
| FEE_PROOF_SUBMITTED | **new**, to desk ACCOUNTS | `sckools_fee_proof` (submit) | Verify · Reject · Open | yes |
| LEAVE_CANCELLED | **new**, to desk + substitutes | `sckools_cover_cancelled` (submit) | — | yes |
| COVER_UNFILLED | **new**, 18:00 IST nudge to desk | `cover_pending` (approved) | — | yes |
| DAILY_DIGEST | **new** | `sckools_daily_digest` (submit) | — | no (email never folds) |
| ABSENCE_NOTICE | buttons added | `absence_notice_v2` | He was ill · Mistake | yes (exists) |
| DIARY_REMARK | text removed, buttons added | `diary_remark_v2` | Sign · Open in app | yes, full text (exists) |
| COVER_ASSIGNED | button added | `cover_assigned_v2` | Got it · Can't | yes (composer exists, now reachable) |
| LEAVE_APPLIED, LEAVE_DECIDED | unchanged | exist | Approve · Reject | yes (composers exist, now reachable) |
| MESSAGE_RECEIVED, LIBRARY_NOTICE, CONCERN_*, FEE_VERIFIED/REJECTED, SESSION_STARTED | stop riding ANNOUNCEMENT | `sckools_app_update` (submit): "There is a new {{2}} for {{3}} at {{1}}. Open the app." | Open | yes |

`sckools_app_update` is the one generic pointer that remains, and its fixed
words say what kind of thing it points at ("a message from your teacher", "a
library notice", "a fee update"), which is what keeps it Utility.

## 3. Identity and actions

### 3.1 One resolver

```ts
InboundIdentityService.actorFor(phoneE164, schoolId, need):
  | { ok: true, profile: PhoneProfile }
  | { ok: false, why: 'NO_PROFILE' | 'NOT_ALLOWED' | 'AMBIGUOUS' | 'INACTIVE' }
```

It calls `PhoneProfilesService.resolve(phone, { schoolId })` and filters by
`need`:

| need | eligible profiles |
|---|---|
| `LEAVE_DESK` | ADMIN, or STAFF whose `Staff.role = 'ACCOUNTS'` — via `isLeaveDesk()`, the function `LeaveDeskGuard` now calls too |
| `SUBSTITUTE(subId)` | the TEACHER whose `Teacher.id = sub.substituteTeacherId` |
| `FAMILY(studentId)` | the FAMILY profile whose login is that student's |
| `ACCOUNTS` / `LIBRARIAN` / `SPORTS` | STAFF with that `Staff.role` |

Exactly one eligible profile → act as it. Zero → `NOT_ALLOWED` (reply: "This
number cannot do that at <school>. Decide in the console."). Two or more →
`AMBIGUOUS` (reply: "Two people share this number here; decide in the
console.") — this replaces today's `findFirst` with no `orderBy`.

`m.from` goes through `toE164()` first. The webhook never reads a tenant from
the request; the row the payload names supplies `schoolId` (as today).

### 3.2 Payload v2

```
v2:<action>:<id>[:<id2>]:<exp>:<sig>
exp = unix minutes, 7 days from send
sig = HMAC-SHA256(body, secret).hex.slice(0,12)
```

Verified with `WHATSAPP_ACTION_SECRET`, then with `WHATSAPP_ACTION_SECRET_PREV`
if set — rotation keeps delivered buttons alive for a week. The secret is no
longer `META_APP_SECRET` (which is Meta's, for the webhook signature) and
startup refuses the literal `'unset'`. Expired → reply "This button has
expired. Open the console/app." and record `expired`. v1 payloads are
accepted for 30 days after deploy, then refused.

### 3.3 Actions catalogue

Every action calls the service method the console calls. New service methods
are listed; everything else exists.

| actor | message | tap | runs | reply |
|---|---|---|---|---|
| LEAVE_DESK | leave applied | Approve | `LeaveService.approve` — now `updateMany where status='PENDING'`, loser told who won | "Approved. N periods need cover." + first cover list |
| LEAVE_DESK | leave applied | Reject | `LeaveService.reject` (same race rule) | "Rejected. Priya has been told." |
| LEAVE_DESK | cover list row | teacher | `LeaveService.assign` | "Ramesh covers 9-A period 3." + next gap, or "All covered." |
| LEAVE_DESK | cover list | Decide in console | nothing | "Open the console → Leave → Coverage." |
| SUBSTITUTE | cover assigned | Got it | **new** `LeaveService.acknowledge(subId)` → `Substitution.acknowledgedAt` | "Noted." |
| SUBSTITUTE | cover assigned | Can't | `LeaveService.clear` + enqueue COVER_UNFILLED to desk with list | "Okay — the office will find someone else." |
| FAMILY | absence | He was ill | **new** `AttendanceService.noteFromFamily(rowId, 'ILL')` → note on the register row, visible to class teacher | "Noted for <child>." |
| FAMILY | absence | Mistake | `ConcernsService.raise` to CLASS_TEACHER with a fixed subject | "The class teacher has been asked to check." |
| FAMILY | diary remark | Sign | `DiaryService.sign(entryId, studentId, name = WhatsApp profile name)` (exists as the app's sign) | "Signed as Meena Sharma, 7:12 pm." |
| FAMILY | PTM notice | Coming / Can't | **new** `NotificationResponse` row (`deliveryId, action, at`) + headcount on the teacher's PTM view | "See you Saturday." / "Noted." |
| ACCOUNTS | fee proof submitted | Verify / Reject | `FeePaymentService.verify/reject` (the family's existing message follows) | "Verified. The family has been told." |
| LIBRARIAN | morning summary | Remind the N | `LibraryFinesService.remind` | "Reminders sent to N families." |
| anyone | any text | `STOP` / `START` | **new** `WhatsAppOptOut` upsert/delete, per phone per school | "You will not get WhatsApp messages from <school>. Reply START to resume." |
| anyone | any other text | — | recorded 30 days, no reply (inbox is a later phase) | — |

`NotificationResponse` is the one generic table every button writes to
(which delivery, which action, when), beside its specific side effect. It is
what lets the teacher's PTM view count "12 coming", and what lets a parent's
reply be shown next to the notice that asked for it.

### 3.4 Webhook

- `@SkipThrottle()` on the controller. Meta's status callbacks are a burst
  by nature; today they can hit our 100/min/IP limit and get 429.
- Handle `message_template_status_update` → `WhatsAppTemplateState(name,
  status, since)`; a PAUSED/DISABLED template makes the channel SKIP that
  kind and enqueues an owner alert. Handle `phone_number_quality_update` the
  same way (alert only).
- Capture `conversation.id` and `pricing.category` on `sent` statuses into
  `WhatsAppDelivery` — cost per school becomes a real number.
- `WhatsAppInbound`: `schoolId` set whenever the payload or the phone resolves
  to one school; phone masked on every read; free text and media ids purged
  after 30 days by the nightly cron; `context.id` captured so a reply can be
  shown under the notice it answers.
- The 24-hour window is tracked: `WhatsAppWindow` in Redis (phone → last
  inbound, 24 h TTL) with `WhatsAppInbound` as the fallback. The actions
  service checks it before sending a list or free text and uses the template
  fallback directly, instead of failing and reading `131047`.
- `applyStatus` writes nothing when the diff is empty, and never moves a
  timestamp backwards.

## 4. The leave desk, done right

Fixes from the flow audit that the WhatsApp actions depend on. All in
`LeaveService` unless named.

**Apply-time checks** (new): no past `startDate`; no overlap with an existing
PENDING/APPROVED application of the same person; span ≤ 60 days; applicant
must be active (Teacher and Staff alike). Quota stays a warning, not a block
(owner's existing choice). Half-day: `halfDay` is `AM | PM`, and only the
periods of that half become gaps.

**Approve** creates gaps only for **working days** (`School.workingDays` and
the `Holiday` table — the same calendar `LeavePolicyService` already uses), for
slots live on that date (`effectiveFrom <= date AND (effectiveTo IS NULL OR
effectiveTo > date)`), and writes `Substitution.leaveApplicationId`.

**One free-teacher function**, `freeTeachersFor(gap)`, used by the web
dropdown, the WhatsApp list and a new `GET /manage/substitution/:id/candidates`:
excludes the on-leave teacher, anyone with a live slot that period, anyone
already covering that period, anyone ON_LEAVE that date, inactive teachers;
ranks by teaches-this-subject then fewest covers that day. The web page stops
computing its own `busySet`.

**Substitution routes** take `LeaveDeskGuard` (today SCHOOL_ADMIN only), so
the accounts officer can cover what they approve. The console's `/app/leave`
stays admin-only; the officer's desk is `/accounts/leave`, which gains a
Coverage tab.

**Acknowledgement**: `Substitution.acknowledgedAt`; shown on the Coverage tab
as "Ramesh · seen 8:10 am" / "not yet seen".

**Cancel** deletes only `WHERE leaveApplicationId = this`, and enqueues
`LEAVE_CANCELLED` to the desk and `COVER_CANCELLED` to every substitute who
had a cover on those dates. `clear` enqueues `COVER_CANCELLED` to the one
teacher. **Substitute applies for leave** → on approval, their covers on those
dates are cleared the same way and the gaps reopen.

**Unfilled nudge**: cron `GET /internal/cron/cover-nudge` at 12:30 UTC (18:00
IST): for every gap tomorrow with no substitute, one `COVER_UNFILLED` to the
desk, with the list when the window is open and `cover_pending` when not.
(Hobby plan: daily crons only — this is daily.)

## 5. Families

- `Student.whatsappOptIn Boolean @default(false)`; a column "WhatsApp messages
  OK (YES/NO)" in the student onboarding sheet; a switch in the family portal
  and app ("WhatsApp from the school"); `addressFor` returns null when false.
  Default **false** because consent must be given, not assumed.
- `WhatsAppOptOut(phone, schoolId, createdAt)` from STOP; checked before every
  send; START removes it.
- The teacher-who-is-also-a-parent: the teacher opt-out gates **teacher**
  kinds only; the children's notices follow the Student flag. Today the
  teacher flag kills both.
- Deep links: templates gain a URL button `https://sckools.com/open/{{1}}`
  which 302s to `sckools://…` with a web fallback; the app registers the
  `sckools` scheme routes (it has the scheme, no routing yet). URL buttons are
  part of template approval — hence the `_v2` submissions.
- Teacher's diary view shows **who** signed and when (today: a count).

## 6. Edge cases the design must pass (tests named after them)

Identity
- one phone, three children, remark for child 2 → Sign writes child 2's `DiaryAck` only
- one phone, teacher at A and parent at B, Approve on a leave at A → acts as A's teacher? No: `LEAVE_DESK` at A has no eligible profile → NOT_ALLOWED
- two admins verified on one phone at one school → AMBIGUOUS, no action
- admin's phone re-verified by a new person → old payloads expired or `INACTIVE`; no action
- `from` in a non-Indian format → `toE164` first; matches the stored number
- unknown number taps a valid payload → NOT_ALLOWED reply never names the row

Safety
- same wamid twice → `duplicate`, no second action (exists)
- two desks tap Approve within 100 ms → one APPROVED, the other told who approved
- payload older than 7 days → `expired`, no lookup
- secret rotated → PREV accepted for 7 days; buttons keep working
- webhook burst of 400 statuses → all 200, none 429

Timing
- event at 22:00 IST → WhatsApp/push HELD to 07:00, email sent at 22:00, bell at 22:00
- fourth family message of the day (test scheduled) → HELD to 18:30, folded into one digest; the absence at 15:00 the same day went out at once
- tap at hour 25 → no list; `cover_pending` template instead; no FAILED row
- Meta `130429` → retried with backoff, one row, not five

Delivery
- `131026` → SUPPRESSED, phone suppressed 30 days, email and push still go
- template PAUSED by Meta → that kind SKIPPED on WhatsApp, email/push unaffected, owner alerted within one drain
- school switch off → WhatsApp SKIPPED, email and push go, no ledger noise
- a FAILED email (5xx) → FAILED after one attempt; a 4xx → retried

Leave
- past date / overlap / 61 days / inactive applicant → refused at apply
- half-day PM → gaps only for PM periods, `ON_LEAVE` half mark
- Diwali inside the span → no gap, no mark that day
- cancel leave A while leave B overlaps → B's gaps untouched; A's substitutes told
- substitute approved for leave → their covers reopen; desk nudged
- accounts officer on WhatsApp → Approve works; cover list works; self-approval refused

Privacy
- parent texts "my son was ill, see photo" → stored 30 days under the school, phone masked in reads, purged by the cron
- remark text never appears in a WhatsApp or push body; email has it in full

## 7. Guard tests (what keeps this true after the PR)

- Every `notificationOutbox.create` in `apps/api/src` is inside `enqueue()`.
- Every `NotificationKind` has an email composer, a push text and a template
  (compile-time) **and** every template name in `TEMPLATE_NAMES` appears in
  Meta's live list (`scripts/whatsapp-verify.mjs --assert`, run in CI nightly).
- `toNotificationMessage` has a branch for every `NotificationOutboxKind`
  (the SPORTS_NOTICE hole becomes a compile error).
- The drain calls four channels; a unit test fails if one is removed.
- `whatsapp-webhook.controller.ts` carries `@SkipThrottle()`.
- `freeTeachersFor` is the only free-teacher computation (grep guard on
  `busySet`).

## 8. Tiers (each ships alone, each useful alone)

| Tier | Ships | Needs a template? | Needs a migration? | Days |
|---|---|---|---|---|
| 0 | `enqueue()` + drainSoon everywhere · SPORTS mapping (temporary via notice_posted) · narrow templates wired by topic · `@SkipThrottle` · Redis dedup · payload v2 (accepting v1) · `copy_code` sub_type · drain fans to email | no | no | 2 |

Tier 0 needs **one new env var on Vercel, Production and Preview, before
deploy**: `WHATSAPP_ACTION_SECRET` (32 random bytes, hex). Until it is set the
API refuses to start rather than sign buttons with a public constant — that is
deliberate, so the plan's first step is the variable, not the code.
`WHATSAPP_ACTION_SECRET_PREV` is optional and only set during a rotation.
| 1 | `NotificationDelivery` + retry/hold · `InboundIdentityService` · LEAVE_DESK on WhatsApp · `freeTeachersFor` · race-safe approve · `acknowledgedAt` + Can't · `leaveApplicationId` + cancel notifications · apply-time checks · unfilled nudge · substitution routes on LeaveDeskGuard · accounts Coverage tab | cover_assigned_v2, cover_cancelled | yes | 4 |
| 2 | `Student.whatsappOptIn` + sheet + portal switch · STOP/START · Sign · Was ill / Mistake · PTM Coming/Can't · `NotificationResponse` · who-signed on the teacher view · deep links · quiet hours · daily fold + digest | absence_v2, diary_remark_v2, ptm (button), daily_digest, app_update | yes | 4 |
| 3 | FEE_PROOF_SUBMITTED → ACCOUNTS · librarian morning summary · SPORTS_UPDATE template · marks-pending nudge | fee_proof, sports_update | small | 3 |
| 4 | WhatsApp suppression · template-paused listener · pricing on the ledger · inbound retention + masking · dual secret · DMARC `p=quarantine` (user step) | no | small | 2 |

Templates are submitted at the **start** of the tier that needs them; review
takes hours to days and the code switches over on approval (the channel reads
`WhatsAppTemplateState`, so an unapproved `_v2` falls back to v1 without a
deploy).

## 9. Not in this design

SMS / DLT (sender exists, template is a user step) · a second guardian number
per child · Hindi templates · WhatsApp Flows (forms) · admin 2FA · the
Messages inbox (free-text conversations) · moving prod mail to Resend ·
payments gateway. The nine decisions of 2026-09-21 not yet built (register
change on WhatsApp, enquiry → admin, welcome messages, morning summaries) fit
the catalogue above and are the natural Tier 5; they are listed so nothing is
lost, not promised here.
