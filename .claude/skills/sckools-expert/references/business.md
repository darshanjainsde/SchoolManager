# Business context — product, pricing, marketing, sales

## Product in one line

Sckools is the operating system for a school: a website studio, an admissions desk, fees and receipts, the register, timetable, exams and report cards, leave and cover, diary, announcements, a family app, the reception TV, a library counter, a jobs board, alumni, and an inter-school **Events Network** — one login per person, one price per student.

## Plans and tiers

| Plan | Feature keys (`inventory/features.md`) | Pitch |
|---|---|---|
| Basic | PUBLIC_SITE, GALLERY, ENQUIRY, SOCIAL | "Be found": website studio, courses, gallery, admissions desk, hall of fame, own domain |
| Standard | + ABOUT_CONTACT, EVENTS, BLOG | "Join the network": events on every school, ticketing, blog syndicated to sckools.com |
| Pro | + MANAGEMENT, HIRING, LIBRARY, FEES | "Run the school": office, staff room, family app, TV, library, jobs |

ALUMNI and PRESS (certificates, report cards, exam hall) are override-only today ("on request"). Overrides per school live in `FeatureOverride` and are set from the owner console.

## Pricing (decided 2026-09-07)

Per student, per year, in INR and USD, set by the owner in `/platform/settings` (`MarketingConfig`); other currencies convert live from USD (`apps/web/lib/fx.ts`). The homepage hero carries a hanging price tag "Starting from ₹{basic} per student, a year" that links to `/pricing`; the pricing page has three plan cards, a student-count slider and FAQs. Staging currently holds test rates. Promotion plans follow once rates are final.

## Marketing site (sckools.com)

- Rebuilt September 2026 as one self-contained page per route: `/`, `/pricing`, `/features`, `/start` — generated from the design prototype (`scratchpad/sckools-rebuild.html` + `gen-static.py` in the session workspace) into `apps/web/public/site-preview/*.html`, served by host-gated rewrites in `apps/web/next.config.mjs` for `sckools.com` and `test.sckools.com`. Each file carries its own title, description, canonical, Open Graph and Organization JSON-LD; the sitemap lists the four routes.
- Homepage sections: hero (tag + live counters), feature flip cards, "A school day" vignettes, Pro band, family app (real home screen reproduced from `apps/mobile`), Events Network, plans, **Why switch** (8 sourced pain points as a tick-to-reveal self-check, a cost-of-staying calculator against the live plan price, a four-week switch plan, six "like Google's doodles" standout cards), shipped-recently, callback CTA.
- Leads: `POST /marketing/leads` (`{name?, phone, email?, school?, interest?, source}`) feeds the owner lead pipeline (`LeadActivity`); the callback modal and the two-step quote journey (`/start`) both post there with the modules, size and — from the switch section — the ticked pains and the maths.
- Contact: +91 95994 43324, admin@sckools.com.
- Service promises the copy makes (must be honoured): free site + data migration, keep the domain, zero downtime, two months of custom features, data handed back on exit, office training on a call.
- Honesty rules: WhatsApp/SMS are not built (email + push + in-app only) — list only as "coming" if committed; counters are honest counts.

## Go-to-market

- Jaipur first: competitor landscape and a price sheet exist as artifacts (memory `jaipur-gtm-2026-08`); three-suite packaging was pitched (₹18.8k / 25k / 30k) before per-student pricing replaced it.
- Sales decks: website + admin-console decks shipped; teacher and student/app decks owed (memory `sales-deck-series-2026-08`).
- Sample schools for demos: Raffles Primary School (prod, 300 students, 30 teachers, full CMS) and the staging trio.

## Brand

Sckools name everywhere; Tassel-S logo; indigo `#4F46E5` / amber `#F59E0B`; the school-site "daylight" palette on the marketing pages (teal `#0d9488`, violet `#6d4aff`, gold `#f5a623`, coral `#ff7a45`).
