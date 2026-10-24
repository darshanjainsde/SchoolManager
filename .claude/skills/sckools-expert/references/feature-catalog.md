# Feature catalogue — what Sckools does, by desk

Each row: what it does for the school, where the code is, which plan carries it, and which surfaces show it
(W = web admin console `/app`, T = teacher portal `/teacher`, S = student portal `/portal`, M = mobile app,
P = public school site, O = owner console). Exact rules per feature: the behaviour spec skill
(`.claude/skills/sckools-behavior-spec/references/`). Routes: `inventory/api-routes.md`.

## Website (every plan)

| Feature | Where | Notes |
|---|---|---|
| Website studio | `apps/web/app/app/website/studio-tab.tsx`, registries `apps/web/components/public/site-variants.ts`, `studio-catalogues.ts`; renderer `apps/web/components/public/PublicSite.tsx` | Theme presets (ACADEMIC/MODERN/PLAYFUL/ELEGANT/CUSTOM), heading fonts, hero layouts/media (photo or muted video), nav styles, scroll feel (Classic/Glide/Snap/Deck), menu animation, **per-section layouts** (stats, about, programmes, admissions, gallery, hall of fame ×7, educators, contact) with per-band entrance gestures, band order, admin-built custom sections, footer layouts, custom CSS/HTML escape hatch (sanitised on write). Drafts/"looks" with a publish window (`design-drafts.service.ts`) — a festival edition reverts itself at read time. |
| Festival skins | `apps/web/components/public/sections/FestiveLayer.tsx`, `festiveTheme` on `SchoolProfile` | 15 festivals (Diwali, Holi, Eid, Onam, Republic Day …) as a doodle layer over the base design with intensity/ribbon/recolour; scheduled via a draft window. |
| Pages & content | `apps/api/src/modules/cms` (`site-content`, `media`, `staff`, `courses`, `admissions`, `hall-of-fame`), `SchoolPage` blocks | Profile, homepage copy, stats, socials, gallery (kinds LOGO/FAVICON/HERO/GALLERY/STAFF/PRINCIPAL/COURSE/HOF/ABOUT/AVATAR), featured educators, published pages at `/p/<slug>`, nav config. |
| Programmes (courses) | `courses-tab.tsx`, `Course` | Website-owned course list (not Management grades) with image, tagline, highlights, age range, featured flag; flip-card explorer and other layouts. |
| Admissions desk | `admissions-tab.tsx`, `AdmissionStep`, `CourseFee`, `AdmissionsSettings`; enquiries `apps/api/src/modules/public/enquiry*.ts` | Steps, per-course fee table (`showFeesPublicly`), enquiry form (rate-limited) → admin inbox with statuses; also CSV export for the owner. |
| Hall of Fame | `apps/api/src/modules/cms/internal/hall-of-fame.*`, `apps/web/app/app/website/hof-tab.tsx`, `apps/web/components/public/sections/HallOfFame.tsx` | Batches as academic sessions, classes by name, three places each, student link with live profile, seven layouts, landing batch + shareable `?batch=` link. Spec `docs/superpowers/specs/2026-09-07-hall-of-fame-batches-design.md`. |
| Own domain & SEO | `apps/api/src/modules/owner/internal/hosting-provider.service.ts`, `apps/web/lib/school-metadata.ts`, `apps/web/app/sitemap.ts`, `robots.ts` | Custom domain attached to the web project with www 308; per-school metadata/OG; sitemap lists every LIVE school root (samples excluded). |
| Blog (Standard+) | `apps/api/src/modules/blog`, `apps/web/app/blog` | Per-school blog with syndication and canonicals to the platform blog on sckools.com; `BLOG` feature 404s (not 403) when off. |
| Jobs board (Pro, HIRING) | `apps/api/src/modules/hiring`, `apps/web/app/jobs`, `/app/jobs` | Public listings + applications. |
| Alumni (Pro, ALUMNI) | `apps/api/src/modules/alumni`, `apps/web/app/alumni`, `/app/alumni` | Alumni portal (ALUMNUS role) with guest sessions, gifts, per-class labels ("Grade – Section"). |
| Sports wing (Pro, SPORTS) | `apps/api/src/modules/sports`, `/app/sports`, public `apps/web/app/sports` | Houses, meets, fixtures and results, record book; public sports pages on the school site. Spec `docs/superpowers/specs/2026-09-10-sports-wing-design.md`. |

## Admissions to enrolment (Standard, MANAGEMENT)

| Feature | Where | Notes |
|---|---|---|
| Students & register data | `apps/api/src/modules/management/students.*`, `/app/students` | `full` vs `roster` projections (roster hides minor PII); codes `AAA-00000`; bulk import `scripts/import-students.mjs`; profile photo (AVATAR kind) set from the app. |
| Classes & catalog | `catalog.controller.ts` (academic years, grades, subjects), `classes.*` (sections, class teacher), `/app/classes`, `/app/classes/structure` | Grade order drives every class list; `AcademicYear.isCurrent` drives "today". |
| Teachers & staff | `teachers.*`, `staff.*`, `/app/teachers`, `/app/staff`, `/app/class-teachers` | Invites (30-min tokens), roles, lockout, class-teacher assignments; onboarding import `/app/onboarding` (`management/onboarding`). STAFF logs in on mobile only. Login by one-time code (OTP, 2026-09-21) can replace the password per school. |
| Fees (Pro, FEES) | `apps/api/src/modules/fees` (`fee-billing`, `fee-query`, `fee-portal`), `/app/fees/*`, `/portal/fees`, family app | Fee plans per grade/category, terms, counter receipts, online payment setup page, proofs (uploads), late-fee rules; family sees dues and receipts. |
| Salary & pay (Pro, SALARY) | `apps/api/src/modules/payroll`, `/app/pay`, staff `me/pay` | Pay grades, salary runs and payslips, leave-to-pay, HR records; staff see their own pay. |

## Running the school day (Standard, MANAGEMENT; Pro-only desks marked)

| Feature | Where | Notes |
|---|---|---|
| Timetable | `timetable.*`, `rooms.*`, `/app/timetable`, T/S/M | Versioned, never edited in place; reading a past date returns the version active then; teacher-conflict 409; "my-day" for teachers; family app shows today. |
| Attendance / register | `attendance.*`, `register-change.*`, `/app/*`, T/M, S/M | One tap per student; past days lock for teachers; an APPROVED, unexpired change request reopens exactly one (class, date); admin bypasses; **ABSENCE_NOTICE** push to the family in minutes; low-attendance alerts; attendance bar on the family home. |
| Staff attendance | `staff-attendance.*`, `/app/staff-attendance` | Daily staff register. |
| Leave & cover | `leave.*`, `leave-policy.*`, `/app/leave`, `/app/leave/policy`, staff app | Quotas, balances, carry-forward, working-day counting, warn-not-block; approval → substitution grants for that day only (never broadcast/exam rights). |
| Exams & results | `exams.*`, S/M results | Marks and results stay in Standard. Unpublished results do not exist to students (excluded from rows and averages, computed in-DB). |
| Exam hall (Pro, EXAM_HALL) · Report cards & press (Pro, PRESS) | `apps/api/src/modules/press` (report windows, certificates, print orders, seating), `/app/exam-hall`, `/app/press/*` | Exam-hall seating + printing; report cards and certificates (`CERT_VARIANTS`) printed as batches/orders; print store. |
| Syllabus tracker (Pro, COURSE_MANAGEMENT) | `apps/api/src/modules/syllabus`, `/app/syllabus`, teacher + student portals | Chapters per subject and section, marked as taught/reached, admin view by class → section → subject → teacher. Spec `docs/superpowers/specs/2026-10-16-syllabus-tracker-design.md`. |
| Assignments, diary, class notes | `assignments.*`, `diary.*` (DiaryRecipient/Ack — "sign the diary"), `class-notes.*`, `/app/*`, T/S/M | Diary remarks with acknowledgement; assignments with "seen"; class notes and to-dos per section. |
| Messages | `student-messages.controller.ts`, `MessageThread`, S/M, T/M | Threads between families and the school; report & block (Play UGC policy, 2026-10-19). |
| Complaint box (concerns) | `apps/api/src/modules/concerns`, `/app/concerns` | Families raise concerns; the office tracks them to closure. |
| Celebrations & sessions | `/app/sessions`, `sessions.controller.ts`; birthdays on the site/TV | Academic sessions and the active roster; celebrations wall. Spec `docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md`. |
| WhatsApp (Pro, WHATSAPP) | `apps/api/src/modules/whatsapp` (settings, phone verification, webhook, inbound actions), `/app/settings` | The school's own WhatsApp number as a notification channel; families reply with actions; plan re-checked every 10 s. Spec `docs/superpowers/specs/2026-09-21-whatsapp-identity-and-actions-design.md`. |
| Announcements & notices | `announcements.*`, `/app/announcements`, P/T/S/M | Whole-school or per-section; shown on the site, the TV and the app. |
| Holidays | `holidays.*` | IST calendar; feeds the TV "no school today" and the family app. |
| Requests & front desk | `requests.*`, `front-desk.*`, `/app/requests`, staff app requests tab | Parent/teacher requests routed to the office. |
| Morning Bell / Today | `bell.*`, teacher "my-day" | The staff home: today's classes, cover, notices. |
| Reception TV | `apps/api/src/modules/public/tv.controller.ts`, `apps/web/app/tv` | Loops notices, today's events/holiday, birthdays, upcoming events on any TV with a browser (`/tv`); configured in `/app/settings` (`tv-card.tsx`). |
| Library counter (Pro, LIBRARY) | `apps/api/src/modules/library`, `/app/library/*` (books, counter, fines, hall, settings), `/library/*` | Issue/return/fines/reading hall; backed by the library microservice seam `@library/core`. |
| Email settings | `email-settings.controller.ts` | Per-school sender settings for notifications. |

## Community — Events Network (every plan: EVENTS; hosting from Standard: EVENTS_HOST)

`apps/api/src/modules/community` (events, public registration, ticket types, audiences, promo), `/app/events`, `/app/events/[id]/promo`, `/connect` on school sites, family app registration. A school's events go out to every school on the network; students register/compete; sponsors; capacity and seats-left honest by configuration.

## Notifications (every plan; scope varies)

Kinds in `inventory/notifications.md`. Channels: e-mail, Expo push, in-app (`/me/notifications`, unread badge), WhatsApp (Pro). Delivered post-commit via an outbox (`outbox-drain.yml`, `run-in-background.ts`); per-message delivery rows since `20261007_000000_notification_delivery`; an email master switch per school (`20261015_000000_email_master_switch`). Not built: SMS.

## Portals and app

| Surface | Where | Highlights |
|---|---|---|
| Admin console `/app` | `apps/web/app/app/*`, sidebar `nav-model.ts` | Feature-gated nav; every tab waits for the host. |
| Teacher `/teacher` | `apps/web/app/teacher/*` | Today, register, results entry, diary, notes, leave. |
| Student `/portal` | `apps/web/app/portal/*` | Hero "right now" state, diary sign banner, timetable, attendance, results, fees, library, messages, assignments, notifications, profile. Shared by student and guardian. |
| Mobile (family) | `apps/mobile/src/app/(family)` | Home with student hero + tool grid, attendance, results, diary, shelf (family shelf, student codes), holidays, messages, notices, notifications, profile (photo, appearance, password). |
| Mobile (staff) | `apps/mobile/src/app/(staff)` | Today, attendance, class rosters, notes, tests/results entry, requests, diary, post, messages. |
| Owner console `/platform` | `apps/web/app/platform/*`, `apps/api/src/modules/owner` | Schools (status SETUP/LIVE/SUSPENDED, tiers, feature overrides, domains, backups `/platform/backups` via `apps/api/src/modules/backups`), impersonation (audited, single-use), leads pipeline, marketing config (prices, discount, hero figures), **Referrals** (`/platform/referrals`: tasks, promoters, referrals, payouts, settings), blog queue, print orders, jobs, ops/scale/speed, owner MFA. Served on `owner.sckools.com` and on the apex (`sckools.com/owner` one-password gate → `/platform`); never on a school host. |
| Promoter portal `/promoter` + `/earn` | `apps/web/app/earn`, `apps/web/app/promoter`, `apps/api/src/modules/referrals` | Refer & Earn: sign in by code (email/WhatsApp), questionnaire, log referrals, timeline, payouts, share link. Details in `business.md`. |
| Library service | `apps/library-web` on `library.trackyour.in` | Standalone library UI for the microservice. |
