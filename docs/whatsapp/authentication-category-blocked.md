# AUTHENTICATION templates are blocked on WABA 1615192556803051

What we can prove from outside Meta, so a support request cannot be answered
with the generic "you must be on the Cloud API" reply. We are.

Established 2026-09-25 against the live Graph API with a permanent system-user
token (`business_management`, `whatsapp_business_management`,
`whatsapp_business_messaging`).

## The account is healthy

| Check | Result |
|---|---|
| `platform_type` | **`CLOUD_API`** — not the WhatsApp Business App |
| `account_review_status` | `APPROVED` |
| `business_verification_status` | `verified` |
| `health_status.can_send_message` | `AVAILABLE` for the WABA, the business **and** the app |
| Phone `+91 95999 15010` | `CONNECTED`, `code_verification_status: VERIFIED`, TIER_250 |
| Templates already approved | 13, including 11 UTILITY and 2 MARKETING |
| App subscribed for webhooks | yes (app `3216485048535315`) |

## Creating templates works — except one category

```
UTILITY  template via POST /{waba}/message_templates  → CREATED (PENDING)   ✓
MARKETING already approved on the account                                   ✓
AUTHENTICATION template                                → code 10 / 2388185  ✗
    "This WhatsApp Business account does not have permission to create
     message template"
```

The same refusal appears in **WhatsApp Manager's own UI**, so it is not the
API, the token or the request body.

## The request body is valid — Meta validated it

Sending an AUTHENTICATION template **without** a button returns a content
error, not a permission one:

```
code 100 / 2388148 — "Message templates in the AUTHENTICATION category must
have exactly one button, which must be of the OTP type."
```

Adding the required OTP `COPY_CODE` button then returns `2388185`. So Meta
read and validated the payload, and refused on permission alone. Reproduced
on Graph `v21.0` and `v23.0`.

## META'S ANSWER (support, 2026-09-25) — the actual cause

Support looked inside and gave four reasons. In the order they matter:

1. **A restriction on the ADMIN'S PERSONAL FACEBOOK PROFILE**, dated
   18 Sep 2026, for Community Standards. Support's words: *"Because you are
   an admin, the integrity block on your WABA is likely a direct result of
   this profile restriction."* **This is the root cause.** Fix it in the
   Transparency Center and the rest is expected to lift by itself.
2. **An integrity block on the WABA** — `ml_decision: BLOCK`. A consequence
   of (1). This is what actually refuses the AUTHENTICATION category, while
   leaving UTILITY and MARKETING alone. It explains the otherwise baffling
   shape of the failure.
3. **Trust Tier 0** — `smb_trust_tier: TIER_0`, the tier every new account
   starts in. Authentication usually unlocks at Tier 1, reached by sending
   good-quality messages over time.
4. **Onboarding "Step 4: First Message Sent"** — support believed this was
   outstanding. **IT IS NOT.** Meta's own analytics for this WABA:

   ```
   2026-09-24   sent=3  delivered=3
   ```

   Three messages sent, three delivered, all through approved templates. If
   support asks again, that is the answer.

So the order of work is: clear the personal profile restriction, confirm the
integrity block has lifted, and build sending history to reach Tier 1. None
of it is a code change, and none of it is a setup mistake.

## What we cannot see

`primary_funding_id` and the business credit line are not readable without
Business Solution Provider status, so whether this is a billing prerequisite
cannot be confirmed from outside.

## The ask for Meta Support

> Please enable the **authentication message category** for WhatsApp Business
> Account **1615192556803051** ("Sckools", business 1260910230446086). The
> account is on the Cloud API, is verified, is APPROVED, has healthy sending
> status and 13 approved templates. Creating a UTILITY template over the API
> succeeds; creating an AUTHENTICATION template fails with error code 10 /
> subcode 2388185 both over the API and in WhatsApp Manager. We use it for
> one-time login codes to school staff and parents.

## Until then

One-time codes go by **SMS**. `SmsOtpSender` is built and switches itself on
when `MSG91_AUTH_KEY` and `MSG91_OTP_TEMPLATE_ID` are set; `OtpSenders.fanOut`
carries one code through every enabled sender, so no code changes are needed.

The moment Meta grants the category:

```
WHATSAPP_WABA_ID=1615192556803051 node scripts/whatsapp-submit-verify-code.mjs
```
