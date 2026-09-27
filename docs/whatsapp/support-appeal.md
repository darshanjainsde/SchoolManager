# Appeal messages — AUTHENTICATION category on WABA 1615192556803051

Two appeals, in this order. The profile one is the root cause; the WABA one
will be refused again while the profile restriction stands.

---

## 1. FIRST — the personal profile (Transparency Center)

Facebook → **Settings & privacy → Settings → Transparency Center → Account
Status** (or facebook.com/accountquality). Find the restriction dated
**18 September 2026** and use **Request review**.

There is usually no free-text box; it is a one-click review. Do this first and
wait for it to clear.

---

## 2. THEN — WhatsApp Business Support

Send this once the profile restriction is resolved, or alongside it if you
want the case opened now. Fill in the bracketed line honestly.

> **Subject: Request to lift the integrity block and enable the Authentication
> category — WABA 1615192556803051**
>
> Hello,
>
> I am asking for the **authentication message category** to be enabled for
> WhatsApp Business Account **1615192556803051** ("Sckools"), business
> **1260910230446086**, phone **+91 95999 15010** (phone number id
> 1415040705015934).
>
> **What is happening.** Creating an AUTHENTICATION template fails with
> `code 10 / subcode 2388185 — "This WhatsApp Business account does not have
> permission to create message template"`. It fails identically in the Graph
> API and in WhatsApp Manager's own UI. Creating a UTILITY template over the
> same API with the same token succeeds, so this is specific to the
> authentication category, not to my setup or my request.
>
> **The request body is valid.** Submitting an authentication template without
> a button returns the content error `2388148` ("must have exactly one button,
> which must be of the OTP type"). Adding the required OTP COPY_CODE button
> then returns `2388185`. The payload is therefore validated and refused on
> permission alone. Reproduced on Graph v21.0 and v23.0.
>
> **A correction to my earlier case notes.** Support indicated that onboarding
> "Step 4: First Message Sent" was still outstanding. It is complete. This
> account's own analytics show, for 24 September 2026:
>
>     sent = 3, delivered = 3
>
> all through approved templates, to real recipients, with delivery receipts
> returned to my webhook.
>
> **Account standing.** `platform_type: CLOUD_API`, `account_review_status:
> APPROVED`, `business_verification_status: verified`, and
> `health_status.can_send_message: AVAILABLE` for the WABA, the business and
> the app. 13 templates are approved (11 Utility, 2 Marketing).
>
> **On the integrity block.** I understand from support that there is an
> `ml_decision: BLOCK` on this WABA, and that it is likely inherited from a
> Community Standards restriction on my personal Facebook profile dated
> 18 September 2026. [ **→ replace with one of:** "I have requested a review of
> that restriction in the Transparency Center on <date> and it is pending." /
> "That restriction has now been lifted." ]
>
> **What the templates are for.** Sckools is a school management platform. The
> authentication template carries one-time login codes to school staff and
> parents — the same six-digit code the product already sends by other means.
> It is a single template, `sckools_verify_code`, with Meta's standard
> authentication body and a copy-code button. No marketing use is intended.
>
> Could you please review the integrity block on this WABA and enable the
> authentication category, or tell me the specific step that remains?
>
> Thank you.

---

## If they offer a human agent — say yes

Support offered to connect a specialist to review the integrity block
manually. Take it. The tier-0 and ml_decision flags are not things a school
can clear by waiting.
