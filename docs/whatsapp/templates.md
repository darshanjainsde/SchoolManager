# WhatsApp templates to submit

Where: WhatsApp Manager → Message templates → Create template.
Category **Utility** · Language **English** (code `en`) · no header, no footer, no buttons (Phase 4 adds buttons).
Name and body must match `apps/api/src/common/notifications/whatsapp/templates.ts` exactly — the spec there counts the placeholders.

| Name | Body | Sample values (what the reviewer sees) |
|---|---|---|
| `sckools_test_scheduled` | {{1}}: {{2}} has a {{3}} test, "{{4}}", on {{5}}. Open the Sckools app for the details. | Raffles Public School · Ravi Sharma (5-B) · Mathematics · Unit test 2 · Mon 6 Oct 2026 |
| `sckools_test_reminder` | Reminder from {{1}}: {{2}} has the {{3}} test "{{4}}" on {{5}} — that is {{6}}. | Raffles Public School · Ravi Sharma (5-B) · Mathematics · Unit test 2 · Mon 6 Oct 2026 · in 3 days |
| `sckools_results_published` | {{1}} has published the results of the {{2}} test "{{3}}" for {{4}}. Open the Sckools app to see the marks. | Raffles Public School · Mathematics · Unit test 2 · Ravi Sharma (5-B) |
| `sckools_absence_notice` | {{1}}: {{2}} was marked absent on {{3}}. If this is a mistake, please tell the school office. | Raffles Public School · Ravi Sharma · Thu 18 Sep 2026 |
| `sckools_announcement` | Announcement from {{1}} for {{2}} — {{3}}: {{4}} | Raffles Public School · Ravi Sharma (5-B) · PTM on Saturday · Parent–teacher meeting this Saturday, 10 am to 1 pm, in the school hall. |
| `sckools_diary_remark` | {{1}}: {{2}} ({{3}}) has a remark from {{4}} dated {{5}}: "{{6}}". Please read and sign it in the Sckools app. | Raffles Public School · Ravi Sharma · 5-B · Priya Nair · Thu 18 Sep 2026 · Homework not done for three days. |
| `sckools_low_attendance` | {{1}}: {{2}} ({{3}}) has {{4}}% attendance for {{5}}, below the {{6}}% the school expects. Please make sure they attend. | Raffles Public School · Ravi Sharma · 5-B · 68 · 1 Jul 2026 – 18 Sep 2026 · 75 |

### One phone, several children

A guardian's number is often shared by two or three children, so every notice ABOUT a child names the child — "Ravi Sharma (5-B)" — in the tests, reminder, results, absence, remark and attendance templates. The channel fills the name in from the student record at send time (`WhatsAppChannel.addressFor` → `childLabel`). A class announcement names the child in that class; a school-wide one keeps the same words for every child, so siblings on one phone get ONE copy (identical text within a minute is sent once). Plain diary lines (homework) stay on the app bell and email — a WhatsApp message per family per day is a cost the school should switch on knowingly, not a default.

## Profile: logo, name, blue tick

| What a family sees | Where it is set | Notes |
|---|---|---|
| **Photo** (the Tassel-S) | `node scripts/whatsapp-profile.mjs docs/whatsapp/profile-photo.png` with `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_ID` in the shell — or WhatsApp Manager → Phone numbers → the number → Profile | Works on the test number today. 640×640 PNG in `docs/whatsapp/profile-photo.png`. Also sets the about line, description, website, email. |
| **Name** "Sckools" | WhatsApp Manager → Phone numbers → the number → Display name | Only on a real number; the test number keeps Meta's name. Meta reviews it against the business — "Sckools" is the GST trade name, so it matches. A display name that does not match the verified business is refused. |
| **Blue tick** | WhatsApp Manager → the number → "Request Official Business Account" (free, rarely granted) — or Meta Verified for business on WhatsApp (paid subscription, India) | Needs business verification first. Not a prerequisite for anything above: templates, buttons and the name work without it. |

## Actions and identity (the second batch)

| Name | Category | Body | Buttons | Samples |
|---|---|---|---|---|
| `sckools_verify_code` | **Authentication** | *(Meta fixes the body for this category — choose "Copy code" button, code expiry 10 minutes)* | Copy code | 482911 |
| `sckools_leave_applied` | Utility | {{1}}: {{2}} has applied for leave on {{3}} ({{4}} days). Reason: {{5}}. {{6}} periods would need cover. Approve or reject below; you can also do this in the console. | Quick reply **Approve**, Quick reply **Reject** (in that order) | Raffles Public School · Priya Nair · Mon 22 – Tue 23 Sep 2026 · 2 · Family function · 5 |
| `sckools_leave_decided` | Utility | {{1}}: your leave for {{3}} has been {{2}} by {{4}}. Open the Sckools app for the details. | — | Raffles Public School · approved · Mon 22 – Tue 23 Sep 2026 · Darshan Jain |
| `sckools_cover_assigned` | Utility | {{1}}: you are covering {{3}} ({{4}}) on {{2}}, for {{5}}. Tap below to confirm you have seen this. | Quick reply **Got it** | Raffles Public School · Mon 22 Sep, period 3 (10:15–11:00) · 9-A · Mathematics · Priya Nair |
| `sckools_cover_pending` | Utility | {{1}}: {{2}} periods still need cover after the leave you approved. Open the console to assign teachers. | — | Raffles Public School · 3 |

Quick-reply buttons carry a payload we sign at send time; the tap comes back on the webhook and runs the same approve / reject / assign the console runs. The cover picker itself is not a template — it is an interactive list sent inside the 24-hour window the tap opens; after that window `sckools_cover_pending` is sent instead.

Until a template is approved, sends of that kind fail with Meta code 132001 and appear as **failed** in the school's WhatsApp card with that reason — nothing else is affected.

## Environment (Vercel → skoolos-api → Production + Preview)

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | temporary token today; the permanent system-user token after verification |
| `WHATSAPP_PHONE_NUMBER_ID` | `1357286177463978` (test number) today; the production number's id later |
| `WHATSAPP_WABA_ID` | `2126847704608094` |
| `META_APP_ID` | `3216485048535315` |
| `META_APP_SECRET` | App settings → Basic → Show |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | any long random string; paste the same in Meta's webhook screen |
| `WHATSAPP_GRAPH_VERSION` | optional, default `v21.0` |

Webhook: `https://api.sckools.com/webhooks/whatsapp` (staging: `https://api.test.sckools.com/webhooks/whatsapp`), subscribe to `messages`.

## Who receives what, and how a number is proven

| Person | Number used | How it gets there |
|---|---|---|
| **Admin** (SCHOOL_ADMIN) | their own, verified | Settings → *My WhatsApp number* → Send code → type the 6 digits. Only verified numbers receive anything; only a verified admin's tap acts. |
| **Teacher** | their own verified number if they set one (teacher portal → My profile), else the phone the office typed on their record | same card on the profile page; the app has the same screen under Profile |
| **Family** | `guardianPhone` on the student record, as the office typed it | no verification; one number shared by siblings gets ONE copy of a broadcast (same words within a minute are sent once) and one copy per child of per-child notices (absence, remark) |

Every tap is recorded (`WhatsAppInbound`, keyed by Meta's message id — a retried webhook is a no-op), and every send in the ledger (`WhatsAppDelivery`).
