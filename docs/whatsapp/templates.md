# WhatsApp templates to submit

Where: WhatsApp Manager → Message templates → Create template.
Category **Utility** · Language **English** (code `en`) · no header, no footer, no buttons (Phase 4 adds buttons).
Name and body must match `apps/api/src/common/notifications/whatsapp/templates.ts` exactly — the spec there counts the placeholders.

| Name | Body | Sample values (what the reviewer sees) |
|---|---|---|
| `sckools_test_scheduled` | {{1}} has scheduled a {{2}} test, "{{3}}", on {{4}} for {{5}}. Open the Sckools app for the details. | Raffles Public School · Mathematics · Unit test 2 · Mon 6 Oct 2026 · 5-B |
| `sckools_test_reminder` | Reminder from {{1}}: the {{2}} test "{{3}}" is on {{4}} — that is {{5}}. | Raffles Public School · Mathematics · Unit test 2 · Mon 6 Oct 2026 · in 3 days |
| `sckools_results_published` | {{1}} has published the results of the {{2}} test "{{3}}". Open the Sckools app to see the marks. | Raffles Public School · Mathematics · Unit test 2 |
| `sckools_absence_notice` | {{1}}: {{2}} was marked absent on {{3}}. If this is a mistake, please tell the school office. | Raffles Public School · Ravi Sharma · Thu 18 Sep 2026 |
| `sckools_announcement` | Announcement from {{1}} for {{2}} — {{3}}: {{4}} | Raffles Public School · 5-B · PTM on Saturday · Parent–teacher meeting this Saturday, 10 am to 1 pm, in the school hall. |
| `sckools_diary_remark` | {{1}}: {{2}} ({{3}}) has a remark from {{4}} dated {{5}}: "{{6}}". Please read and sign it in the Sckools app. | Raffles Public School · Ravi Sharma · 5-B · Priya Nair · Thu 18 Sep 2026 · Homework not done for three days. |
| `sckools_low_attendance` | {{1}}: {{2}} ({{3}}) has {{4}}% attendance for {{5}}, below the {{6}}% the school expects. Please make sure they attend. | Raffles Public School · Ravi Sharma · 5-B · 68 · 1 Jul 2026 – 18 Sep 2026 · 75 |

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
