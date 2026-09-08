# Migrations (packages/db/prisma/migrations)

_Generated 2026-09-08 from `9be058c` (staging-site-preview → origin/staging). Do not edit by hand — run the sckools-expert-update skill._

82 migrations. Staging applies them on push to `staging` (db-migrate.yml, path-filtered); production is a manual `workflow_dispatch` with `environment=production`.

| Migration | First comment |
| --- | --- |
| 20260703_000000_baseline | CreateEnum |
| 20260703_000100_rls_and_roles | Roles ------------------------------------------------------------------ |
| 20260704_000000_event_denormalized_display |  |
| 20260704_010000_student_login_and_announcements | Student login linkage |
| 20260704_020000_school_profile_theme |  |
| 20260706_000000_cms_courses_admissions_hof | New MediaAsset kinds for course images and hall-of-fame photos |
| 20260710_000000_homepage_section_toggles | Per-school control of which sections render on the homepage; full details |
| 20260710_010000_about_image | Wide About-section image (campus/community photo), separate from the |
| 20260710_020000_password_reset_tokens | Single-use, short-lived tokens for the self-serve "forgot password" flow. |
| 20260711_000000_marketing_and_impersonation | Platform-level marketing tables + owner→admin impersonation tokens. |
| 20260716_000000_hero_layout_system | First-screen layout system: per-school hero layout, overlay dial, headline |
| 20260717_000000_nav_color | Admin-selectable navbar bar colour (PAPER \| WHITE \| DARK \| BRAND). |
| 20260717_010000_nav_text_color | Text colour for the transparent (GHOST) navbar before scroll. |
| 20260721_010000_attendance_exams_results | CreateEnum |
| 20260721_020000_nav_login | AlterTable |
| 20260722_000000_login_invites | AlterTable |
| 20260722_010000_school_day | CreateEnum |
| 20260722_020000_staff_user_role | AlterEnum |
| 20260722_030000_leave_cancelled | AlterEnum |
| 20260722_040000_rls_new_tables | RLS for the 7 tables added since 20260703_000100_rls_and_roles: |
| 20260722_050000_push_tokens | CreateTable |
| 20260722_060000_holidays | CreateTable |
| 20260724165303_blog_platform | CreateEnum |
| 20260729011846_class_notes_todos_register_changes | CreateEnum |
| 20260730034229_class_notes_subject_visibility | CreateEnum |
| 20260730050000_notification_outbox | Note: prisma migrate diff also proposed dropping the DB-level |
| 20260730060000_assignments | Note: `prisma migrate diff` also proposed dropping the DB-level |
| 20260731000000_messaging | Messaging (Phase 4 Task 5 / item T17): student <-> subject-teacher threads. |
| 20260801000000_notifications | In-app notification inbox (the bell + unread count) for both portals. |
| 20260802000000_avatar_photos | Phase 5·0d: self-uploaded profile photos ("paste a photo in the diary"). |
| 20260802010000_student_codes | Phase 5·1: human-friendly student codes (RAF-00042) + the school's stable |
| 20260802020000_daily_diary | Phase 5·3: the Daily Diary (teacher-written items + red-ink remarks a parent |
| 20260804000000_event_registrations | Event registrations, ticket types, and a payment record with no gateway |
| 20260805000000_section_shape | Section shape: one control for how every band below the fold is drawn. |
| 20260805010000_motion_and_texture | The rest of the customisation increment: a motion GESTURE (what a section |
| 20260805020000_nav_config | A school's own arrangement of its navigation. |
| 20260805030000_hiring | Hiring: a vacancy, the questions it screens on, and applications against it. |
| 20260805040000_backfill_event_tickets | Every event needs a ticket type, including the ones that predate the rule. |
| 20260805050000_nav_login_style | How the sign-in control is drawn. |
| 20260806180000_notification_clear | Soft clear ("dismiss") for in-app notifications: a cleared row disappears |
| 20260809040000_leave_policy | Leave policy: a school's own leave vocabulary (LeaveTypeDef) and per-teacher |
| 20260814120000_user_role_librarian | Adds LIBRARIAN to UserRole. |
| 20260815060000_staff_role_librarian | The librarian is a JOB, not a special kind of login. |
| 20260816090000_library_wing | The Library Wing: titles, copies, loans, fines, hall attendance, and the |
| 20260819100000_website_studio | Website Studio: scroll feel, nav menu animation, hero video, per-section |
| 20260819200000_page_footer_only | A custom page can be footer-only: reachable from the footer's link list but |
| 20260823090000_email_letterhead | Letterhead: per-school email identity. |
| 20260824090000_rls_coverage_gap | Close the RLS coverage gap Supabase's security scanner flagged |
| 20260825090000_result_tenancy_and_fk_indexes | Schema audit remediation — tenancy consistency + the foreign keys that had |
| 20260826090000_exam_hall | Exam Hall — the two tables the seating screen needs, and nothing else. |
| 20260826140000_seating_room_snapshot | A saved seating plan must remember the room it was made for. |
| 20260827090000_homecoming | Homecoming — the alumni wing. |
| 20260827140000_alumni_door | The alumnus's door. |
| 20260827160000_alumni_identity_and_link_requests | Two facts a school can CHECK, and a queue for "send me my link". |
| 20260827170000_alumnus_role | `ALUMNUS` gets a migration to itself, on purpose. |
| 20260827200000_gift_status_values | The three new GiftStatus values, ALONE in their own migration. |
| 20260827201000_gift_journey | The gift journey: what a donor can watch, and what the school can show. |
| 20260828_010000_teacher_user_id_index | Teacher.userId had no index at all, yet resolving "which teacher is this |
| 20260828_020000_outbox_claim | Let a drain take ownership of a row. |
| 20260828_030000_event_audience | Give events an audience instead of an all-or-nothing network flag. |
| 20260829090000_fees_module | The fees module: what a school is owed, what arrived, and the ledger that |
| 20260829140000_fee_late_fee_settings | Let a school set its own late-fee rule. |
| 20260829_000000_seat_count_index | The seat count behind "is there a place left?" filters on ticketTypeId and |
| 20260829_001000_metric_rollup | History for the ops dashboard. |
| 20260829_002000_relation_count_indexes | Indexes for the tenant-scoped relation counts that replace Prisma's |
| 20260829_003000_metric_rollup_rls | MetricRollup was created without row-level security. |
| 20260902090000_press | The Press: printed documents with a register — report cards, certificates. |
| 20260902150000_school_tv_key | Sckools TV: one revocable display token per school. Null = the /tv page |
| 20260903090000_press_orders | Press Orders: print fulfilment. Request -> quote (price + promised date) -> |
| 20260903120000_press_register_departures | The register is append-only — but a school that is deleted outright |
| 20260903150000_press_statutory_fields | The admission-register facts a statutory Transfer Certificate prints |
| 20260904090000_result_room | The Result Room: report-card generation gets a cockpit. |
| 20260904140000_ledger_school_cascade | The fee ledger is append-only — and, exactly like the Press register before |
| 20260904150000_event_cover_art | Which archetype an event's cover art draws. |
| 20260904160000_event_cover_focus | Which band of a tall cover photo the 16:9 tile keeps. |
| 20260904170000_enquiry_stages | The four new admissions stages get a migration to themselves, on purpose. |
| 20260904170100_enquiry_desk | The admissions desk: a next step, an owner, and a history. |
| 20260904180000_impersonation_attribution | Who minted an impersonation link. |
| 20260905_000000_lead_pipeline | Marketing leads become a sales pipeline: more stages, follow-up scheduling, |
| 20260905_010000_lead_activity_rls | LeadActivity shipped without row-level security. |
| 20260907_000000_hall_of_fame_batches | Hall of Fame: batches (year is a dimension), groups (course / grades / custom), settings. |
| 20260907_010000_hall_of_fame_year_repair | Repair for databases that ran the first cut of 20260907_000000 before its |
