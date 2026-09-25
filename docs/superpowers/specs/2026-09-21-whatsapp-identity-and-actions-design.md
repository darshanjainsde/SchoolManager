# WhatsApp identity + actions — architecture (2026-09-21)

Decisions taken by the owner on 2026-09-21: all nine recommendations of the
"WhatsApp Rethink" (artifact TTNiRYVUgs3KEJNQFnvu3W), with OTP login first,
built for staging, promotion planned separately.

This document is the architect's review of those decisions and the design
that follows from it. The plans under `docs/superpowers/plans/2026-09-21-*`
implement it PR by PR.

## 1. Architect's review of the nine decisions

| # | Decision | Verdict | What changes because of the review |
|---|---|---|---|
| 1 | Admin profile + `User.name` | Keep | `name` goes on `User` (all roles), not a new table — the chooser and "approved by …" need one place to read a display name for any login. Teachers/students keep their record names; `User.name` is the fallback and the admin's only name. |
| 2 | Register-change on WhatsApp | Keep | Mirrors the leave flow exactly: outbox kinds + signed payloads + the same `WhatsAppActionsService`. No new mechanism. |
| 3 | Fee proof from WhatsApp | Keep, one constraint | Meta fetches the image by URL, so the proof must be reachable without auth for the minutes it takes — the public bucket already is; a private bucket would need a short-lived signed URL. Batching (N proofs/minute → one message) lives in the outbox drain, not the fee service. |
| 4 | Enquiry → admin | Keep | "I'll call" sets `assigneeUserId` on the enquiry; the console already shows an owner. |
| 5 | Welcome messages + STOP | Keep, sharpened | Opt-out is **per phone per school**, stored platform-side (a phone is not a tenant row). The channel checks it before every send. "YES from a staff number verifies it" is accepted: possession of the number is exactly what an OTP proves, and an inbound message proves it better. |
| 6 | OTP login | Keep, redesigned | See §2–§4. The OTP engine is ONE service with three purposes (login, reset, verify-phone) and a **sender fan-out** (WhatsApp now, SMS when DLT clears) so the login path never changes when SMS arrives. Admins: password only; OTP becomes their 2FA later, not their door. |
| 7 | Diary digest, default on | Keep | Cost is the school's; the switch is on `WhatsAppSettings`. Quiet hours make "default on" safe. |
| 8 | Diary corrections as new lines | Keep | `DiaryEntry.correctsId` self-relation; nothing is ever updated in place. |
| 9 | Morning summaries | Keep, last | Pure read + one template each; no new state. |

Two things the review adds that the pitch did not say:

- **Phone normalisation is a schema concern, not a query-time one.** Every
  phone the platform may log a person in with gets an indexed E.164 column
  (`Student.guardianPhoneE164`, `Teacher.phoneE164`, `Staff.phoneE164`;
  `User.phone` is already E.164 because only the verify flow writes it).
  Maintained by the services that write the raw phone, back-filled once in
  SQL. Without this, "who owns +91…" is a full scan across tenants.
- **Switching a profile is stateless.** No "linked accounts" table. Two
  logins belong to the same person when they share a phone identity *now*
  (verified `User.phone`, or the E.164 of the record behind the login). The
  server recomputes that set on every switch and every chooser. Change the
  number at the office and the link is gone the same second.

## 2. Identity model

```
phone (E.164)
  ├─ User.phone (verified)            → admin / teacher / staff login   [verified by OTP or by an inbound YES]
  ├─ Teacher.phoneE164  (office)      → that teacher's login            [trusted as the school's record]
  ├─ Staff.phoneE164    (office)      → that staff member's login       [same]
  └─ Student.guardianPhoneE164 (office) → that child's family login     [same]
```

`PhoneProfilesService.resolve(phoneE164, { schoolId? })` returns the
**profiles** behind a number: `{ userId, schoolId, schoolName, host, role,
label, avatarUrl?, kind: 'ADMIN'|'TEACHER'|'STAFF'|'FAMILY' }`, deduped by
userId, suspended schools and inactive logins excluded. On a school host the
set is filtered to that school; from the app (no host) it spans schools.

Rules:
- `SCHOOL_ADMIN` profiles are **never** returned for LOGIN. They appear in
  the switch list of a password session whose admin phone matches.
- A profile is "the same person" as another when both resolve from the same
  E.164. That is the whole authorisation rule for switching.
- Labels: family → "Ravi Sharma (5-B)"; teacher → "Priya Nair · Teacher";
  staff → "… · Staff"; admin → `User.name` or the email local part.

## 3. OTP engine

Table `OtpChallenge` (platform-side, allow-listed in the RLS coverage guard):
`id, phoneE164, purpose (LOGIN|RESET|VERIFY_PHONE), codeHash, expiresAt,
attempts, consumedAt?, sentVia text[], schoolId?, userId?, ip?, createdAt`.

- Code: 6 digits, `sha256(id + ':' + code)`, 10 minutes, 5 attempts, single
  use. Resend cooldown 60 s per (phone, purpose). Limits per phone: 3/hour,
  10/day (counted on the table). Route throttles on top.
- `OtpService.start(purpose, phoneE164, ctx)` → creates the row, fans out to
  every enabled `OtpSender`, records `sentVia`. Fails only when **no** sender
  delivered (`OTP_UNDELIVERABLE`, with the WhatsApp reason when known).
- `OtpService.check(challengeId, code)` → consumes or counts an attempt.
- Senders: `WhatsAppOtpSender` (AUTHENTICATION template, ledger under the
  profile's school or the platform), `SmsOtpSender` (MSG91 OTP API; enabled
  by `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`, otherwise reports
  `disabled`). Adding a sender is one class; nothing above it changes.
- `PhoneVerifyService` keeps its pending-number columns but sends through
  the same fan-out, so a verify code also arrives by SMS the day SMS exists.

## 4. Login, choose, switch, reset

All `@Public`, throttled, tenant-optional (school host narrows the search):

| Route | In | Out |
|---|---|---|
| `POST /auth/otp/request` | `{ phone }` | `{ challengeId, phoneMasked, sentVia, expiresIn }` — same shape whether or not the number is known (no enumeration; unknown numbers get no message) |
| `POST /auth/otp/verify` | `{ challengeId, code }` | one profile → `{ accessToken, refreshToken, expiresIn, host, profile }`; several → `{ choose: true, ticket, profiles[] }` |
| `POST /auth/otp/choose` | `{ ticket, userId }` | tokens + host for that profile. Ticket = JWT (5 min, aud `otp-choose`) carrying the phone and the allowed userIds |
| `POST /auth/forgot-password` | `{ email }` | as today + `{ codeSentVia }` when the login has a phone: a RESET challenge bound to that user |
| `POST /auth/reset-with-otp` | `{ email, challengeId, code, newPassword }` | ok; revokes every refresh token of the user |

Authenticated:

| Route | Purpose |
|---|---|
| `GET /auth/profiles` | the switchable profiles for this session (recomputed from the phone identity; `[]` when the login has none) |
| `POST /auth/switch { userId }` | tokens + host for a profile in that set; refuses otherwise. The web only offers same-host targets; the app re-homes the session |
| `GET/PATCH /me/profile` | `name`, `phone` (office record), notification switches (`notifyPrefs` JSON on User) |

Tokens are the existing school JWT + refresh row; nothing in the guards
changes. The refresh row's `familyId` stays what it is (a token family, not a
household).

## 5. Clients

**Web login (Gatehouse)**: two tabs — *Phone* (default) and *Email &
password*. Phone → code → (chooser when >1 on this host) → home for role.
Header menus (portal, teacher, console) gain *Switch profile* when
`/auth/profiles` returns more than the current one on this host; other-host
profiles are listed as links ("open ravi.sckools.com").

**App**: login is phone-first; the code screen; the chooser writes every
chosen-able profile onto the shelf. The family shelf (`family-store.ts`)
generalises from `ChildProfile` to `Profile { kind, role, label, host,
session }` and the switch UI moves from the family Profile tab to a shared
sheet reachable from every role's Profile tab. Cross-school switch = another
slot on the shelf with its own host and tokens, exactly as siblings work
today.

**Admin profile** (`/app/profile`): avatar door top-right + "My profile" in
the nav above Settings; name, login email, password, phone, WhatsApp number
(moved from Settings), "what reaches me on WhatsApp".

## 6. Edge cases the design must pass (tests named after them)

- one number → one child: straight in, no chooser
- one number → two children, same school: chooser; both on the shelf
- one number → teacher + parent, same school: chooser lists both; admin
  buttons tapped from that number still refuse ("not an admin here")
- one number → children at two schools: app chooser lists both hosts; web on
  either host lists only its own
- admin's verified number = a guardian phone: password session can switch
  to the family profile; OTP login never offers the admin profile
- number changed at the office: old sessions keep working until refresh
  expiry (they are that person's), but the switch set no longer includes the
  old profile; a new welcome goes to the new number
- unknown number: same response shape, nothing sent, rate-limited
- number not on WhatsApp (131026): `OTP_UNDELIVERABLE` names it; the record
  shows the flag; SMS takes over when enabled
- code reuse, sixth attempt, expired, wrong challenge: refused with distinct
  codes; the challenge is consumed on success
- ticket for a userId not in its list, or expired: refused
- switch to a profile whose school is suspended or login inactive: refused

## 7. Not in this design

Admin 2FA, SMS delivery itself (sender exists; the DLT template is a user
step), a second guardian number per child (the family can add it from the
app once OTP login exists — separate plan), Hindi templates.
