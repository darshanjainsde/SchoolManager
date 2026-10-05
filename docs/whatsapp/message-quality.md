# Message quality — what to fix, and the copy to replace it with

Written 2026-09-27 against the 13 templates live on WABA `1615192556803051`,
read with `node scripts/whatsapp-verify.mjs`. Every rule quoted below is from
Meta's own documentation, linked at the bottom.

**All 13 are APPROVED and every one reads `quality_score: UNKNOWN`** — they have
not been sent enough for Meta to rate them. So nothing here is a rescue: it is
the one chance to start rated well rather than climb back.

---

## The rules this is measured against

- **Quality is other people's behaviour, not our wording.** Meta rates a
  template on *"usage, customer feedback, and engagement"*, and downgrades on
  *"negative feedback from multiple customers, or low read-rates"*.
- **A bad template dies in three steps.** Lowest rating pauses it for
  **3 hours**, then **6 hours**, and the third time it is **disabled** — not
  paused, disabled.
- **Utility must clear two bars at once**: *"non-promotional, not containing
  any promotional or persuasive intent"* **and** either *"specific to or
  requested by the user"* or *"essential or critical to the user"*. Anything
  else is Marketing, including *"templates where contents are unclear"*.
- **Opt-in is not optional.** *"You may only contact people on WhatsApp if:
  (a) they have given you their mobile phone number or username; and (b) you
  have received opt-in permission from the recipient confirming that they wish
  to receive subsequent messages."*

---

## 1. The defect that matters more than any wording — PART FIXED

`WhatsAppChannel.addressFor` resolved a phone and sent. **It never read
`Teacher.whatsappOptIn`**, although the record carries it and the teacher
onboarding sheet asks for it in as many words — *"WhatsApp messages OK
(YES/NO)"*. A teacher who declined was messaged anyway.

**Fixed.** The gate is on the person, not the phone column, because a teacher
who declined but has a verified login number was otherwise still reachable
through the first branch of the phone precedence.

**Still open, and it blocks turning WhatsApp on for families: a Student has no
opt-in field at all.** There is nowhere for a family to say no, so every
guardian phone on file is messageable. That is the wrong side of the policy
quoted above and it is the single most likely source of blocks. It needs
`Student.whatsappOptIn`, a column in the student onboarding sheet, a switch in
the family portal, and the same gate in `addressFor`. **Do this before any
school enables WhatsApp for families.**

---

## 2. Every message opens with the same five words

Four templates begin *"A message from {{1}}."* — `sckools_cover_pending`,
`sckools_leave_decided`, `sckools_absence_notice`, `sckools_test_scheduled`.
The rest open with a near-identical frame.

This was not carelessness. Meta rejects a body that **starts with a variable**,
so a phrase was bolted on the front of each. The cost is that **the first line
is what WhatsApp shows in the notification**, and a parent who gets three
notices in a week sees the same opening every time. Meta downgrades on low
read-rates; an unreadable preview is how you get them.

The rule is only that the body may not *begin* with `{{1}}` — a word then a
variable is fine. So lead with the **fact**, not the frame.

| template | first line now | first line instead |
|---|---|---|
| `sckools_absence_notice` | A message from {{1}}. | Absence at {{1}}: |
| `sckools_test_scheduled` | A message from {{1}}. | Test scheduled at {{1}}: |
| `sckools_leave_decided` | A message from {{1}}. | Leave decision at {{1}}: |
| `sckools_cover_pending` | A message from {{1}}. | Cover still needed at {{1}}: |

---

## 3. The copy, template by template

Each replacement keeps the same parameters in the same order, so the calling
code does not change — only the words around them.

### `sckools_absence_notice` — UTILITY, keep

> Now: *A message from {{1}}. {{2}} was marked absent on {{3}}. If this is a
> mistake, please tell the school office.*

> **New:** *Absence at {{1}}: {{2}} was marked absent on {{3}}. If they were
> ill or this is a mistake, please tell the school office.*

Adds the reason a parent most often has. Ends on the action, not the doubt.

### `sckools_low_attendance` — UTILITY, soften

> Now: *An attendance notice from {{1}}. {{2}} of class {{3}} has {{4}} per
> cent attendance for {{5}}, below the {{6}} per cent the school expects.
> **Please make sure they attend.***

> **New:** *Attendance at {{1}}: {{2}} of class {{3}} was present {{4}} per
> cent of {{5}}, against the {{6}} per cent the school expects. If something is
> keeping them away, please tell the office so we can help.*

"Please make sure they attend" is the line most likely to be reported by a
parent whose child has been ill. It also reads as an instruction from a
machine. "Was present {{4}} per cent" is the same number said kindly.

### `sckools_diary_remark` — UTILITY, **remove the quoted text**

> Now: *A diary note from {{1}}. {{2}} of class {{3}} has a remark from {{4}},
> dated {{5}}. **It says: "{{6}}".** Please read and sign it in the Sckools app.*

> **New:** *Diary note at {{1}}: {{4}} has written a remark about {{2}} of
> class {{3}}, dated {{5}}. Open the Sckools app to read it and sign.*

Two reasons, and the second is the important one:

1. `{{6}}` is a teacher's free text going out unreviewed over WhatsApp.
2. **A remark about a child is private.** A WhatsApp message is read by whoever
   is holding the phone, shows on a lock screen, and sits in a chat backup. The
   app is behind a login; the notification does not need to carry the content.

### `sckools_test_scheduled`, `sckools_test_reminder`, `sckools_results_published` — UTILITY, lead with the fact

> **New:** *Test scheduled at {{1}}: {{2}} has a {{3}} test, "{{4}}", on {{5}}.
> Open the Sckools app for the syllabus and the timing.*

> **New:** *Test tomorrow at {{1}}: {{2}} has the {{3}} test "{{4}}" on {{5}},
> which is {{6}}. Open the Sckools app to see what to prepare.*

> **New:** *Results at {{1}}: marks for the {{2}} test "{{3}}" are ready for
> {{4}}. Open the Sckools app to see them.*

### `sckools_leave_applied`, `sckools_leave_decided`, `sckools_cover_pending`, `sckools_cover_assigned` — UTILITY, keep, reframe the opening

These go to staff, are individually addressed, and carry an action. They are
solidly utility and the wording is fine. Only the opening frame changes, as in
§2. `sckools_cover_assigned`'s *"Tap below to confirm you have seen this"* is
good — it earns a read receipt rather than guessing at one.

### `sckools_announcement` and `sckools_school_notice` — **MARKETING, and they cannot be rescued as they stand**

> *An announcement from {{1}}, for {{2}}. The subject is {{3}}. **{{4}}** You
> can read this again in the Sckools app.*

`{{4}}` is arbitrary free text. Meta categorises *"templates where contents are
unclear"* as Marketing, and this was already proved on this account: renaming
`sckools_school_notice` did not move it. **A free-text catch-all will always be
Marketing.**

Marketing costs more per message, is the category people block, and is the one
Meta pauses hardest.

**The fix is not better words, it is narrower templates.** Replace the two
catch-alls with fixed-purpose ones, where the only variables are names and
dates and every other word is fixed:

| new template | body |
|---|---|
| `sckools_holiday_notice` | *Holiday at {{1}}: the school will be closed on {{2}} for {{3}}. Classes resume on {{4}}.* |
| `sckools_ptm_notice` | *Parents' meeting at {{1}}: the meeting for class {{2}} is on {{3}} at {{4}}. Please come to the school.* |
| `sckools_timing_change` | *Timing change at {{1}}: on {{2}} the school day will run from {{3}} to {{4}}.* |
| `sckools_fee_due` | *Fees at {{1}}: the fees for {{2}} are due on {{3}}. Open the Sckools app to pay or to see the bill.* |

Each of those is specific, essential, non-promotional — the two bars Utility
has to clear.

**Also worth one attempt, in parallel:** an APPROVED Marketing template *can*
be appealed for recategorisation. WhatsApp Manager → Message Templates → the
template → **Go to Business Support → Template Category Updates → Request
Review**. Expect a refusal for the catch-alls; it costs one click.

### `hello_world` — delete

Meta's sample. *"This message demonstrates your ability to send a WhatsApp
message notification from the Cloud API"* means nothing to a parent, and it
sits in the list looking like ours.

---

## 3b. What the rewrite is actually worth

Meta charges **per message**, by category. India, as at July 2026:

| category | per message | +18% GST |
|---|---|---|
| Marketing | **₹0.8631** | ₹1.0185 |
| Utility | **₹0.1150** | ₹0.1357 |

**Utility is 7.5× cheaper than Marketing for the identical message.**

The two catch-alls are the ones a school sends to *everybody* — a holiday, a
PTM, a timing change. That is where the whole bill lives. For one 800-family
school sending two general notices a week:

| | as Marketing (today) | as narrow Utility |
|---|---|---|
| one notice to 800 families | ₹815 | ₹109 |
| eight a month | ₹6,518 | ₹868 |
| a year | **₹78,200** | **₹10,400** |

Against a subscription of ₹18,800–30,000 a year, WhatsApp at marketing rates
costs **more than twice what the school pays us**. At utility rates it is a
line item. This is the difference between WhatsApp being a feature we can
include and one we have to charge extra for.

Two caveats, both honest:

- It assumes every general notice goes through a catch-all today. It does —
  that is what the two catch-alls are for.
- **TIER_250 caps this anyway right now**: 250 unique recipients per 24 hours,
  so an 800-family school cannot be reached in a day regardless. The tier lifts
  with quality and volume, which is the other half of why quality matters.

Utility templates delivered inside an open customer service window are free
today, but **from 1 October 2026 Meta starts charging for those too**, with
1,000 free service messages per number per month. So the gap above is the
number to plan against, not the optimistic one.

## 4. Two rules for sending, not writing

Quality is mostly a question of who gets messaged and how often.

- **One a day, at most, per family.** Absence, a diary remark and a test
  reminder on the same afternoon read as three interruptions. Where a school
  sends several in a day, the later ones belong in the app with a single
  WhatsApp line pointing at them.
- **Nothing before 07:00 or after 20:00 IST.** A notice that wakes someone is
  the one that gets the business blocked.

Neither is enforced in code today. Both are worth a look before a school with a
real roster turns this on.

---

## 5. The order to do it in

1. **Ship the Student opt-in** (§1). Nothing else matters until a family can
   say no.
2. **Submit the four narrow templates** (§3) and stop using the two
   catch-alls. They stay approved and unused; delete them once nothing calls
   them.
3. **Resubmit the seven reworded Utility templates** under `_v2` names,
   switch the code over, then delete the originals.
4. **Delete `hello_world`.**
5. Leave `quality_score` alone for a fortnight of real sending, then read it
   again with `node scripts/whatsapp-verify.mjs`.

A template name cannot be reused for 30 days after deletion, which is why the
new ones are `_v2` rather than a rewrite in place.

Submit with the existing script:

```bash
node scripts/whatsapp-templates.mjs           # lists what is there
# add the new bodies to that script's list, then submit
```

---

## Sources

- [Template quality rating](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality)
- [Template pausing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/)
- [Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/hi/policy/)

---

## 2026-10-01 — Meta moved both catch-alls, and the real rule turned out to be different

`sckools_school_notice` and `sckools_announcement` went **UTILITY → MARKETING**
(appeal window to 22 Nov 2026). The other eleven kept UTILITY.

**The explanation in §3 above was half right.** It said a free-text variable
forces Marketing. It does not — `sckools_diary_remark` quotes a teacher's own
words in `It says: "{{6}}"` and is **still UTILITY**. What actually decides it
is whether the FIXED words name a concrete, non-promotional event:

| template | fixed words say | category |
|---|---|---|
| `diary_remark` | a remark, from a named teacher, on a date, to read and sign | UTILITY |
| `results_published` | marks for a named test are ready | UTILITY |
| `announcement` | *"An announcement… The subject is {{3}}. {{4}}"* — any message at all | **MARKETING** |

So the rule is: **anchor the sentence to an event and an action; the variable
part may then be free text.** A template that describes "a message" describes a
promotion just as well, and Meta categorises accordingly.

**Proved by experiment the same day**, on this account, minutes apart:

- `sckools_notice_posted` — *"A school notice from {{1}}: "{{2}}", posted on
  {{3}} for {{4}}. Open the Sckools app to read it in full…"* → accepted
  **UTILITY**. Keeps the title, sends no body.
- A pointer with no title at all was refused for an unrelated reason —
  **"Variables can't be at the start or end of the template."**
- Four narrow ones (`holiday_notice`, `ptm_notice`, `timing_change`,
  `fee_due`) → all accepted **UTILITY**.

**Also measured:** a body too short for its variable count is refused with
**2388293** *"too many variables for its length"*. Every `{{n}}` needs a
sentence of real words around it.

**Shipped:** `TEMPLATE_NAMES.ANNOUNCEMENT` now points at `sckools_notice_posted`
and the body is no longer a parameter — the words stay in the app, which is
both the Utility rate and the privacy answer §3 already wanted for diary
remarks. `AnnouncementPayload` gained `postedOn`.

**Still owed:** route a holiday / PTM / timing / fees notice to its own narrow
template instead of the generic pointer, so those read specifically. The four
are approved and waiting.
