# Production release — 94 commits, 14 migrations, and WhatsApp

Written 2026-09-27. Every figure below was read from the live systems, not
assumed; the command that produced each one is given so it can be re-checked
rather than believed.

---

## 1. Where production is right now

| | |
|---|---|
| Live commit | `4ff99e3` (PR #91, 17 Sep) |
| Behind staging by | **94 commits** |
| Migrations not applied | **14** |
| Unexpected schema drift | **none** — nothing was hand-applied |
| API `/health` | 200 |
| `sckools.com` | 200 |

Read with `gh workflow run db-migrate.yml --ref staging -f environment=production -f inspect_only=true`,
which changes nothing and prints the history plus the drift.

**What the release carries:** the WhatsApp channel, email delivery receipts,
OTP login (disabled — see §5), the Salary/Pay module, leave→pay and the
ACCOUNTS role, the RLS performance fix, 78 foreign-key indexes, festive
treatments and scenes, admin onboarding, the hub pattern, Class teachers, the
Complaint Box, and this week's performance, shell and Diary work.

---

## 2. The migrations, and which ones deserve attention

All 14 have been live on staging since they merged — the oldest for a week,
the newest for hours.

| migration | on staging since | note |
|---|---|---|
| `20260920_000000_whatsapp` | 20 Sep | new tables |
| `20260920_100000_email_delivery` | 20 Sep | new tables |
| `20260920_200000_whatsapp_actions` | 20 Sep | new tables |
| `20260921_000000_otp_login` | 21 Sep | **writes existing rows** — see below |
| `20260921_000000_sargable_tenant_policies` | 21 Sep | **rewrites every RLS policy** — see below |
| `20260921_010000_fk_indexes` | 21 Sep | **58 blocking index builds** — see below |
| `20260921_020000_otp_challenge_rls` | 22 Sep | policy on a new table |
| `20260922_000000_salary` | 22 Sep | new tables + one `UPDATE "User"` |
| `20260924_000000_pay_grades` | 24 Sep | new tables |
| `20260925_000000_accounts_and_leave_pay` | 24 Sep | widens `LeaveApplication.teacherId` to nullable |
| `20260926_010000_teacher_onboarding_record` | 26 Sep | additive columns |
| `20260926_020000_festive_media_kind` | 26 Sep | enum value |
| `20260927_000000_onboarding_import_log` | 26 Sep | new table |
| `20260927_010000_class_teachers_and_concerns` | 27 Sep | new tables |

**There is no `DROP TABLE`, no `DROP COLUMN` and no `TRUNCATE` anywhere in the
set.** The only `DROP`s are policies, dropped and immediately recreated.

### The RLS rewrite — read this one before you run it

`20260921_000000_sargable_tenant_policies` replaces the tenant policy on ~130
tables. It is the highest-attention item in the release, and it is safe for
three specific reasons:

1. It is **driven off `pg_policies` matching the exact old expression**, so it
   only touches policies in the known-bad shape and leaves anything unexpected
   alone rather than guessing.
2. Prisma runs a migration file **in one transaction**, so a failure anywhere
   rolls the whole thing back and the old policies remain. There is no state
   where a table is left with no policy.
3. It **fails closed**, exactly as before: with no tenant set,
   `nullif(current_setting(...), '')::uuid` is NULL, and `schoolId = NULL` is
   NULL, so no rows are visible.

What it buys, measured on a 30-school 7.2M-row copy: an attendance read went
from 46 ms warm / 862 ms cold to 2 ms either way, and a count from 1,399 ms to
31 ms. Nothing about *which* rows a tenant may see changes.

### The phone backfill

`20260921_000000_otp_login` writes `guardianPhoneE164`, `phoneE164` for every
Student, Teacher and Staff row, deriving `+91` + the last ten digits.
**It assumes India.** That is correct for every school on the platform today,
and it is the migration that touches the most existing rows.

### The index builds

60 `CREATE INDEX`, of which 58 are **not** `CONCURRENTLY` — they cannot be,
because Prisma runs the file in a transaction. A plain `CREATE INDEX` holds a
lock that **blocks writes** to that table while it builds. On a database this
size that is seconds, but it is the reason for the window in §4.

---

## 3. Environment: nothing is missing

Every environment variable added since `main` is **optional**
(`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MSG91_AUTH_KEY`,
`MSG91_OTP_TEMPLATE_ID`), so the API boots on production without them. There
is no new required variable to set before deploying.

All four WhatsApp variables already exist on the **production** target:
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`. They are `sensitive` type, so their values
**cannot be read back** — the only way to confirm they are the live ones is the
functional check in §6.

---

## 4. The order to do it in

**Migrate first, deploy second.** The API that is live now does not call any of
the new tables, so a migrated database with old code is a no-op; the reverse —
new code against an un-migrated database — is a broken product.

Pick a low-traffic window. Indian school traffic is lowest after 21:00 IST.

1. **Take a Supabase snapshot.** The workflow does not take one. Supabase
   dashboard → Database → Backups → *Create backup*. This is the only step
   that cannot be reconstructed afterwards, and it is the reason the rest of
   this is low-risk.
2. **Re-run the inspection**, so the log records what production had at the
   moment of the change:
   ```
   gh workflow run db-migrate.yml --ref staging -f environment=production -f inspect_only=true
   ```
3. **Apply the migrations:**
   ```
   gh workflow run db-migrate.yml --ref staging -f environment=production
   ```
   `prisma migrate deploy` applies only what is missing, never resets, and is a
   no-op if re-run. Watch it finish before step 4.
4. **Confirm the database is current** — re-run the inspection from step 2. It
   should report nothing outstanding.
5. **Merge `staging` → `main`.** Both Vercel projects build from that push.
   The web deploys before the API; every read added this week tolerates an
   older API by design, so that window degrades to a sentence rather than an
   error.
6. **Run the checks in §6.**

### If something goes wrong

- A migration fails → the transaction rolls back, production is unchanged,
  and nothing has been deployed yet. Read the log, fix, re-run.
- The deploy is bad → Vercel → the project → *Instant Rollback* to the previous
  deployment. **The database stays migrated**, which is fine: every migration
  in this set is additive or a policy rewrite, so the old code runs against it
  unchanged. That asymmetry is exactly why migrating first is the safe order.

---

## 5. WhatsApp: what is true today

Read from Meta with `node scripts/whatsapp-verify.mjs` (read-only).

| | |
|---|---|
| Business account | Sckools — **APPROVED**, business **verified** |
| Number | +91 95999 15010, id `1415040705015934` — **CONNECTED** |
| Display name | Sckools — verified |
| Quality | **GREEN** |
| Messaging tier | **TIER_250** |
| Templates | **13, all APPROVED** (11 utility, 2 marketing) |
| App subscribed to the WABA | yes, app `3216485048535315` |

**Never pick the WABA by name.** Two are called "Sckools" and WhatsApp
Manager's dropdown defaults to the test one. Always `1615192556803051`.

### Three things that constrain production

**a. The webhook points at staging.** Meta allows **one callback URL per app**,
and it is currently `https://api.test.sckools.com/webhooks/whatsapp`. Measured
just now:

```
api.test.sckools.com/webhooks/whatsapp  wrong token → 403   real token → 200, echoes the challenge
api.sckools.com/webhooks/whatsapp       wrong token → 404   real token → 404
```

Production returns 404 because it is still on code that predates the webhook.
After the deploy the route will exist — but Meta will still be delivering to
staging. **This is a decision, not a step** (see §7).

**b. TIER_250.** 250 unique recipients per rolling 24 hours. A school with 800
families cannot be messaged in one day. The tier lifts on its own with quality
and volume; until it does, treat WhatsApp as a targeted channel rather than a
broadcast one.

**c. AUTHENTICATION is still blocked.** Meta refuses every
authentication-category template on this account (subcode 2388185). That is
why there is **no WhatsApp OTP login** and no "set your password" message —
both are classified as authentication. `/auth/otp/request` already answers
with the plain-language refusal. Nothing in this release changes that; only a
Meta support request can.

### What will NOT happen on deploy day

**No school starts sending WhatsApp.** `WhatsAppSettings.enabled` is per school
and the channel reads `row?.enabled ?? false`, so every school is off until
somebody switches it on in the console. Turning it on for one school is the
right first move.

---

## 6. The checks, after the deploy

Run in this order. Each one is a command or a click, and each has a right
answer.

```bash
# 1. the API is up and on the new code
curl -s -o /dev/null -w '%{http_code}\n' https://api.sckools.com/health           # 200

# 2. the webhook route now exists and its guard works
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://api.sckools.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'   # 403, not 404

# 3. and it accepts the real token — this also proves production's
#    WHATSAPP_WEBHOOK_VERIFY_TOKEN is the live one, which cannot be read back
curl -s 'https://api.sckools.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token='"$(cat ~/.sckools-whatsapp-verify-token)"'&hub.challenge=ok-42'   # ok-42

# 4. Meta still agrees about the account
node scripts/whatsapp-verify.mjs       # APPROVED / CONNECTED / GREEN / 13 templates

# 5. a school website still renders
curl -s -o /dev/null -w '%{http_code}\n' https://raffles.sckools.com/            # 200
```

Then in the console, signed in as an admin on a **real** school:

6. **Settings → WhatsApp** — the card loads and shows the number.
7. **Send the test message** to your own phone. This is the only check that
   proves production's `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are the
   live ones; they are `sensitive` in Vercel and cannot be read back.
8. **The delivery ledger** shows that send as delivered. If it stays at *sent*,
   the webhook is still pointing at staging — which is §7, not a fault.
9. Open **Diary**, **Complaint Box**, **Class teachers**, **Pay** — each loads
   rather than showing "that could not load".
10. Open the console home and confirm the setup checklist is either absent or
    all ticked; six red crosses would mean the API did not deploy.

---

## 7. The one decision you have to make

Meta allows **one callback URL per app**, and staging and production both want
it. Three ways out:

**A — point it at production.** One field in Meta → the app → WhatsApp →
Configuration → Callback URL, set to `https://api.sckools.com/webhooks/whatsapp`
with the same verify token. Delivery receipts and inbound replies then land in
production. **Staging stops receiving them** — its delivery ledger goes quiet.

**B — a second Meta app for staging** (the proper end state). Create a second
app under the same business, subscribe it to the same WABA
(`subscribed_apps` is a list, so both can be subscribed), give it the staging
URL and its own verify token. Production and staging then both work. Costs
about twenty minutes and a second app secret.

**C — leave it on staging** until a production school actually turns WhatsApp
on. Nothing breaks; production simply never learns whether a message was
delivered, and inbound replies are lost.

**Recommendation: A now, B when a second school goes live.** The reason is
that a delivery ledger that silently never updates is worse than one that is
obviously off — and today no production school has WhatsApp enabled anyway, so
there is nothing to lose by moving the URL before the first one does.

**Order matters when you move it:** set the environment variable first,
redeploy, and only then press *Verify and save* in Meta. Meta calls the URL the
instant you press it, and a stale value means a 403 and a refusal. Production's
verify token is already set, so for option A there is nothing to change — press
the button after the deploy, not before.

---

## 8. What I did not do, and why

- **Did not run the production migration.** It is the irreversible half of this
  and wants a human at the keyboard in a chosen window, after the snapshot.
- **Did not merge to `main`.**
- **Did not touch anything in Meta.** Changing a callback URL is an
  outward-facing change to your account and §7 is a decision, not a step.
- **Did not enable WhatsApp for any school.**
