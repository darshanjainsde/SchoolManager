# Business context — product, pricing, marketing, sales

## Product in one line

Sckools is the operating system for a school: a website studio, an admissions desk, fees and receipts, the register, timetable, exams and report cards, leave and cover, diary, announcements, a family app, the reception TV, a library counter, a jobs board, alumni, and an inter-school **Events Network** — one login per person, one price per student.

## Plans and tiers

Plan Ladder v2, decided 2026-10-22 (`packages/db/src/features.ts`):

| Plan | Feature keys (`inventory/features.md`) | Pitch |
|---|---|---|
| Basic | PUBLIC_SITE, GALLERY, ENQUIRY, SOCIAL, ABOUT_CONTACT, EVENTS | "Be found": website studio with about/contact, gallery, admissions desk, network events on your site (families register there), own domain |
| Standard | + EVENTS_HOST, MANAGEMENT, BLOG | "Run the day": the whole ERP — people, sessions, register, leave & cover, timetable & availability, tests & results, diary, messages, announcements, TV, both apps; host your own events; blog |
| Pro | + FEES, SALARY, EXAM_HALL, PRESS, LIBRARY, SPORTS, HIRING, ALUMNI, COURSE_MANAGEMENT, WHATSAPP | "Run everything": fees, pay & salaries, exam hall, report cards & print store, library, sports, jobs, alumni, syllabus tracker, the school on WhatsApp |

Every key is in a tier now; nothing is "on request". Overrides per school live in `FeatureOverride` and are set from the owner console: a disabled override protects a live Pro school from a module its plan newly carries (`apps/api/scripts/plan-ladder-protect.ts`, run before the production migration), an enabled one is a trial above the plan. Marks and results stay in Standard (MANAGEMENT); only the seating desk moved to EXAM_HALL. WhatsApp is gated three ways: the settings and phone-verification routes (WHATSAPP), and the outbound channel re-checks the plan every 10 s.

## Pricing (decided 2026-09-07)

Per student, per year, in INR and USD, set by the owner in `/platform/settings` (`MarketingConfig`); other currencies convert live from USD (`apps/web/lib/fx.ts`). The homepage hero carries a hanging price tag "Starting from ₹{basic} per student, a year" that links to `/pricing`; the pricing page has three plan cards, a student-count slider and FAQs. Production rates on 2026-10-24: ₹30 / ₹45 / ₹60 per student per year (USD 1 / 2 / 3) — placeholders until the owner sets the real ones (production currently holds dummy data). Migration `20261022_120000_marketing_hero_discount` added the owner-run **launch discount** (`discountEnabled/Percent/Label/EndsAt`, countdown on the site) and editable **hero figures** (`heroStats`); both are edited in `/platform/settings` and read by `GET /marketing/config`.

## Marketing site (sckools.com)

- Rebuilt September 2026 as one self-contained page per route: `/`, `/pricing`, `/features`, `/start` — generated from the design prototype (`scratchpad/sckools-rebuild.html` + `gen-static.py` in the session workspace) into `apps/web/public/site-preview/*.html`, served by host-gated rewrites in `apps/web/next.config.mjs` for `sckools.com` and `test.sckools.com`. Each file carries its own title, description, canonical, Open Graph and Organization JSON-LD; the sitemap lists the four routes.
- Homepage sections: hero (tag + live counters), feature flip cards, "A school day" vignettes, Pro band, family app (real home screen reproduced from `apps/mobile`), Events Network, plans, **Why switch** (8 sourced pain points as a tick-to-reveal self-check, a cost-of-staying calculator against the live plan price, a four-week switch plan, six "like Google's doodles" standout cards), shipped-recently, callback CTA.
- Leads: `POST /marketing/leads` (`{name?, phone, email?, school?, interest?, source}`) feeds the owner lead pipeline (`LeadActivity`); the callback modal and the two-step quote journey (`/start`) both post there with the modules, size and — from the switch section — the ticked pains and the maths.
- Contact: +91 95994 43324, admin@sckools.com.
- Service promises the copy makes (must be honoured): free site + data migration, keep the domain, zero downtime, two months of custom features, data handed back on exit, office training on a call.
- Honesty rules: WhatsApp IS built (Pro, `WHATSAPP`, since 2026-09-20: outbound channel, phone verification, inbound actions); SMS is not — never list SMS; counters are honest counts.
- **Plan cards** (home + `/pricing`, 2026-10-22): three equal-height cards, each a list of categories with short feature names ("Fee counter", "Exam hall seating"), no prose. **Features page** (`/#/features`, 2026-10-22): 54 tiles in four desks (front office, teachers, families, website), every tile categorised and renamed in plain English, filter by desk and plan.

## Go-to-market

- Jaipur first: competitor landscape and a price sheet exist as artifacts (memory `jaipur-gtm-2026-08`); three-suite packaging was pitched (₹18.8k / 25k / 30k) before per-student pricing replaced it.
- Sales decks: website + admin-console decks shipped; teacher and student/app decks owed (memory `sales-deck-series-2026-08`).
- Sample schools for demos: Raffles Primary School (prod, 300 students, 30 teachers, full CMS) and the staging trio.

## Brand

Sckools name everywhere; Tassel-S logo; indigo `#4F46E5` / amber `#F59E0B`; the school-site "daylight" palette on the marketing pages (teal `#0d9488`, violet `#6d4aff`, gold `#f5a623`, coral `#ff7a45`).

## Refer & Earn (built 2026-10-23, live on production 2026-10-24)

A promoter (any adult: teacher, parent, tuition owner, supplier, consultant) introduces schools and is paid a share of the school's first-year payment once it is live and has paid. Nothing is paid for a lead.

- **Public page** `sckools.com/earn` (apps/web/app/earn, components/earn). Says NO rates: the rate is set per person by the owner.
- **Sign in / sign up**: one door, a six-digit code by email (MailService) or WhatsApp (the platform's OTP senders, `OtpPurpose 'PROMOTER'`, challenge `schoolId` null). No password. First-timer gives a name and the questionnaire (who, how many schools in six months, areas, how they know schools, GST). Token: audience `promoter`, 30 days, signed with an HMAC-derived secret (`promoterSecret()`), `ver` = `Promoter.tokenVersion`; kept in localStorage `sk_promoter_session`; /earn and /promoter are in the middleware CSP matcher.
- **Promoter portal** `sckools.com/promoter` (`.sk-*` look): dashboard with the commission card (not set → "Get my commission %" → pending → set), figures, referrals; log a referral (required: school, city, contact, phone, consent; instant duplicate check); timeline per referral; payouts (PAN + bank or UPI, statement with gross/TDS/net); share link `/start?ref=CODE` (the static site stores `sk-ref` 90 days and sends `ref` with every lead; `MarketingService.createLead` → `ReferralsService.attributeLead`).
- **Owner console** `owner.sckools.com/platform/referrals` (also `sckools.com/platform/referrals`; measured 360–1920 by `apps/web/audit/referrals.test.tsx`): Tasks (commission requests with the questionnaire beside a rate box pre-filled from the ladder; new referrals with accept/reject; payout details to verify), Promoters (filters, set rate, pause/restore with a reason, send login link, add by hand), Referrals (filters by promoter/city/stage, stage moves that also move the lead, mark live with the invoice → payout), Payouts (mark paid with UTR, CSV), Settings (ladder, cap, payout days, attribution days, TDS %). Sidebar badge = open tasks (`attention.referralTasks`).
- **Rules in code** (`apps/api/src/modules/referrals/referral-rules.ts`): first accepted referral holds a school for `referralAttributionDays` (default 90); schools already in the lead pipeline (180 days) or already live are refused with the reason; stages move forward only; LIVE needs the rate and the invoice and creates the ONE payout (`rewardMinor` = pct of invoice capped by the promoter's cap or the platform cap; TDS `referralTdsPct`); PAYOUT_DUE → PAID on mark paid; suspension bumps `tokenVersion`.
- **Data**: `Promoter`, `Referral` (→ `MarketingLead` on accept, source `referral:CODE`), `ReferralEvent`, `ReferralPayout`, `ReferralTask`; settings on `MarketingConfig.referral*`. Platform tables: RLS on, `platform_only` deny-all policy, read through the BYPASSRLS client only. Migration `20261023_090000_refer_and_earn`.
- **Tests**: `referral-rules.spec`, `referrals.dto.spec`, `referrals.service.spec`, `promoter-auth.spec` (unit); `test/promoter-contract.e2e-spec.ts` (booted app: audiences, masking, suspended, required fields, owner host); web `lib/promoter-session.test.ts`; `console-segments.test.ts` covers the new sessions.
