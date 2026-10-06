# Admissions officer — a job, a desk, and the enquiry on WhatsApp (2026-10-06)

Asked for by the owner on 2026-10-06: a staff job like LIBRARIAN / SPORTS /
ACCOUNTS that runs admissions — gets website and admission enquiries on their
own WhatsApp, can call or message the family, and marks the lead contacted,
then interested, through to enrolled.

This design rides the notification spine
(`2026-10-06-notification-spine-and-whatsapp-desk-design.md`): the enquiry is
one more event, the officer is one more desk audience, and the taps are one
more row of the actions catalogue. It adds one job and one lead pipeline; it
invents no new mechanism.

## 0. What exists (so we add, not build)

`Enquiry` already carries `status` (NEW, CONTACTED, VISITED, APPLIED,
ENROLLED, LOST), `ownerUserId`, `followUpAt`, `lostReason`, and append-only
`EnquiryNote`s with a `kind`. `/app/enquiries` is a full desk: urgency sort,
KPI tiles, stage buttons, follow-up date, owner picker, notes, tel/wa.me/mailto
links. The website form posts to `POST /public/enquiry`.

What is missing, from the audit: a lead `source`; **any notification when an
enquiry arrives** (`notifyPrefs.enquiry` exists and nothing reads it); an
authenticated create for walk-ins (the dock drawer posts to the public,
IP-throttled endpoint and the note says "from the website"); a job that is not
SCHOOL_ADMIN; a contact log; a follow-up reminder; note authorship (always
`null`); an owner picker that works on BASIC/STANDARD (it reads `/manage/staff`,
which needs MANAGEMENT); mobile screens; an INTERESTED stage.

## 1. The job

`StaffRole.ADMISSIONS` — label **"Admissions officer"**. Same recipe as
ACCOUNTS, the seven places:

| where | change |
|---|---|
| `schema.prisma` + migration | `ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMISSIONS'` |
| `management.dto.ts` | the job is a valid `role` on create/update staff |
| `AdmissionsDeskGuard` (new, `internal/admissions-desk.guard.ts`) | SCHOOL_ADMIN passes; STAFF passes when `Staff.role = 'ADMISSIONS'` and active; else 403 `NOT_ADMISSIONS_DESK`. Exposed as `isAdmissionsDesk(db, schoolId, userId)` so the inbound resolver uses the same rule. |
| `apps/web/lib/role-routes.ts` | `staffRole === 'ADMISSIONS'` → `/app/enquiries` (the console admits the job at that path, as it does ACCOUNTS at `/app/pay`) |
| `apps/web/app/app/staff/page.tsx` | job in the picker, always offered — `ENQUIRY` is in every tier |
| `apps/mobile/src/lib/worker-nav.ts` | `WorkerJob` gains `ADMISSIONS` with tabs `leads · pipeline · profile` |
| `/auth/me` | already returns `staffRole`; nothing to do |

A school may appoint several officers. The desk audience `desk: 'ADMISSIONS'`
is every active officer; when a school has none, it is every SCHOOL_ADMIN
(so the enquiry is never unheard).

The officer's WhatsApp number is set the way every staff number is set today:
the office types it on the Staff record, or the officer verifies their own
under Profile → My WhatsApp number. **Only a verified number can act**;
an unverified one still receives.

## 2. The pipeline

```
NEW → CONTACTED → INTERESTED → VISITED → APPLIED → ENROLLED
                        └──────── LOST (from any stage, with a reason) ──┘
LOST → CONTACTED  (reopen, desk only)
```

- `INTERESTED` is new, between CONTACTED and VISITED — the family said yes on
  the phone and has not come in yet.
- Stages move **forward only** (plus LOST from anywhere, plus the one reopen).
  Today any stage can be set from any other, including backwards.
- `Enquiry` gains: `source` (`WEBSITE | COURSE_CARD | WALK_IN | PHONE |
  WHATSAPP | REFERRAL`), `lastContactedAt`, `updatedAt`, `childName?`,
  `whatsappOk Boolean @default(false)` (the family ticked "you may WhatsApp me"
  on the form). `gradeInterest` stays free text.
- `EnquiryNote.kind` gains `CALL | WHATSAPP | VISIT` beside NOTE / STAGE /
  SYSTEM. A contact of any kind sets `lastContactedAt`, and the first one moves
  NEW → CONTACTED by itself.
- `authorName` is filled (today the controller passes `null`).
- **Same phone again within 90 days** while an enquiry is open → no new row:
  a SYSTEM note "asked again on <date> about <grade>" on the open one, it jumps
  to the top, the owner is told. LOST or ENROLLED → a new row, linked by phone
  in the panel ("enquired before, Mar 2026 — lost: fees").

## 3. Creating an enquiry

| source | endpoint | notes |
|---|---|---|
| Website form, course card | `POST /public/enquiry` (exists) | adds `source`, `whatsappOk`, a honeypot field, and `toE164` on the phone (a non-mobile is refused with a clear message). Throttle stays 5/min/IP. |
| Walk-in, phone | **new** `POST /site/enquiries` behind `AdmissionsDeskGuard` | `source` WALK_IN or PHONE, owner = the creator, no throttle. The dock drawer and the desk's "Add enquiry" use this. |
| WhatsApp (a family messages the school number first) | later — needs the Messages inbox | listed in §8 |

The platform-level `MarketingLead` (sckools.com) is untouched.

## 4. The enquiry on WhatsApp

### 4.1 New enquiry → the officer

Spine kind **`ENQUIRY_RECEIVED`**, audience `desk: 'ADMISSIONS'`, urgent (no
daily fold), quiet hours apply (an 11 pm enquiry arrives at 7 am; the email
goes at 11 pm). Honours `notifyPrefs.enquiry`, which finally does something.

Template `sckools_enquiry_received` (submit, Utility):

> New admission enquiry at {{1}}: {{2}} asked about {{3}} for {{4}}. Their
> number is {{5}}. Take it below, or open the admissions desk.

Buttons: **I'll take this** · **Not now**. The number in the body is tappable
in WhatsApp, which is how the officer calls or opens a chat — no template
button is needed for either, and Meta's call button cannot carry a dynamic
number anyway.

- **I'll take this** → `EnquiryService.claim(id, userId)`: `updateMany where
  ownerUserId IS NULL` — the first officer wins, the others are told "Taken by
  Sunita". The reply, inside the window the tap opened, is a text with the
  number again and three reply buttons (the existing, unused `sendButtons`):
  **Contacted** · **Interested** · **Not interested**.
- **Contacted** → `EnquiryService.logContact(id, 'CALL')` → stage CONTACTED,
  `lastContactedAt`, a CALL note by the officer. Reply: "Marked contacted.
  When should we follow up?" with buttons **Tomorrow** · **In 3 days** ·
  **Next week** → `followUpAt`.
- **Interested** → stage INTERESTED (a CALL note is written first if none
  exists today) and the same follow-up buttons.
- **Not interested** → stage LOST with reason "not interested (WhatsApp)".
- **Not now** → nothing changes; the enquiry stays unowned and appears in the
  next morning's list.

### 4.2 Follow-ups → the officer, every morning

Cron `GET /internal/cron/enquiry-followups` at 03:30 UTC (09:00 IST), one
`ENQUIRY_FOLLOWUPS` per officer with leads due today or overdue (owned by
them; unowned ones go to every officer). Template `sckools_followups_due`
(submit): "Admissions at {{1}}: {{2}} follow-ups today — {{3}}. Tap to work
through them." Button **Show me** → an interactive list of up to 9 leads
(name · grade · due) + "Open the desk" → tap a lead → the same three outcome
buttons as above. Email carries the full list. Bell gets one item.

### 4.3 The family's own WhatsApp

When the form had "you may WhatsApp me" ticked (`whatsappOk`), one
acknowledgement goes to the family: `sckools_enquiry_ack` (submit, Utility):
"Thank you for your enquiry at {{1}}. {{2}} from admissions will call you
about {{3}}. Reply STOP to opt out." Sent when an officer claims the lead (so
it can name them); if nobody claims within 2 hours, sent naming "the
admissions office". Never more than one. STOP works as in the spine.

### 4.4 Identity

`actorFor(phone, schoolId, 'ADMISSIONS')` → STAFF profile with
`Staff.role = 'ADMISSIONS'`, or ADMIN. Two eligible on one phone → AMBIGUOUS,
no action. Unverified number → NOT_ALLOWED with "verify your number under
Profile". All as the spine defines.

## 5. The desk

**Web `/app/enquiries`** (the officer's door; admins keep it too):
- Filters gain **My leads** (default for an officer) and **Unowned**; a
  **source** chip on every row.
- **Call** and **WhatsApp** become buttons that open `tel:` / `wa.me` **and**
  log a CALL / WHATSAPP note, then ask the outcome in a small sheet
  (Contacted · Interested · No answer · Lost) — the same outcomes as the
  WhatsApp buttons, so the two surfaces agree.
- Stage buttons show only the forward moves; Lost asks for a reason; Reopen
  on a lost lead.
- **Add enquiry** on the desk (walk-in / phone) → `POST /site/enquiries`.
- Owner picker reads **new** `GET /site/enquiries/owners` = the desk members
  (officers + admins), not `/manage/staff` — so it works on BASIC and
  STANDARD.
- Timeline shows who wrote each note (fixed `authorName`), and contact
  entries read "Called · Sunita · 11:02".
- **Export CSV** of the current filter, with owner, follow-up, source, lost
  reason.
- ENROLLED gets a **"Create student"** link that opens the student form
  pre-filled (name, phone, grade). No automatic conversion.

**Mobile, worker portal, job ADMISSIONS** — two tabs:
- **Leads**: due today · overdue · new & unowned, each row with Call /
  WhatsApp (logs the contact) and the outcome sheet.
- **Pipeline**: counts per stage, tap a stage to list.

Running settings, exports and the admission-steps CMS stay on the web, as
Pay runs do for the accounts officer.

## 6. Edge cases the design must pass (tests named after them)

- two officers, both tap **I'll take this** within a second → one owner; the
  other's reply names the winner; the lead has one CALL/claim note
- school with no officer → admins receive `ENQUIRY_RECEIVED`; an admin's tap
  works (ADMIN is eligible)
- officer's number unverified → receives the message; tap → "verify your
  number"; nothing changes
- officer leaves (Staff inactive) → their open leads show under **Unowned**
  on the desk and in the morning list; no message goes to the old number
- same phone enquires twice in a week → one row, one note, one nudge
- walk-in on a BASIC-plan school → created, owned, no throttle, owner picker
  works
- phone "0141-2345678" (landline) on the website → refused with "a mobile
  number, please"; the honeypot filled → silently accepted and dropped
- enquiry at 23:10 → officer's WhatsApp/push at 07:00, email at 23:10,
  family ack (if ticked) at 07:00
- **Not interested** on WhatsApp → LOST with reason; the desk shows it with
  the officer's name
- follow-up set from WhatsApp "In 3 days" lands on a holiday → moved to the
  next working day
- stage set backwards from the API → 409 `ENQUIRY_STAGE_BACKWARDS`
- a lost lead reopened → CONTACTED, reason cleared, a STAGE note says who

## 7. Tiers

| Tier | Ships | Needs | Days |
|---|---|---|---|
| A | the job (7 places) · `AdmissionsDeskGuard` on `/site/enquiries/*` · `source`, `lastContactedAt`, `updatedAt`, `childName`, `whatsappOk` · INTERESTED + forward-only · contact-kind notes + `authorName` · `POST /site/enquiries` + dock fix · owners endpoint · My leads / Unowned / source chip · Call/WhatsApp that log + outcome sheet · export | a migration | 2 |
| B | `ENQUIRY_RECEIVED` + claim/outcome/follow-up buttons · morning `ENQUIRY_FOLLOWUPS` + list · family ack + STOP · same-phone dedupe · honeypot + `toE164` on the form | spine Tier 0–1 live; templates `enquiry_received`, `followups_due`, `enquiry_ack` | 2 |
| C | mobile Leads + Pipeline tabs · Create-student link · reopen | — | 2 |

Tier A is independent of the spine and can ship first. Tier B's three
templates are submitted on day one of Tier A so they are approved by the time
B starts.

## 8. Not in this design

A family starting the conversation on WhatsApp (needs the Messages inbox) ·
automatic Student creation from ENROLLED · visit scheduling with slots ·
entrance-test / interview stages · a public application form with documents ·
lead scoring · the platform's own `MarketingLead` desk.
