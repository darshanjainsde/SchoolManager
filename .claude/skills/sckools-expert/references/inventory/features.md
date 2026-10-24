# Feature keys and tiers (packages/db/src/features.ts)

_Generated 2026-10-24 from `e8b337a` (docs/skills-refresh → origin/main). Do not edit by hand — run the sckools-expert-update skill._

Tier sets are cumulative (BASIC ⊂ STANDARD ⊂ PRO) and a `FeatureOverride` row can add or remove any key per school. Since Plan Ladder v2 (2026-10-22) every key is in a tier; a disabled override protects a live school from a module its plan newly carries, an enabled one is a trial above the plan. Resolved sets are cached in Redis for 300s (feature-resolver.service.ts).

| Key | BASIC | STANDARD | PRO | Gated controllers |
| --- | --- | --- | --- | --- |
| PUBLIC_SITE | ✅ | ✅ | ✅ |  |
| GALLERY | ✅ | ✅ | ✅ |  |
| ENQUIRY | ✅ | ✅ | ✅ |  |
| SOCIAL | ✅ | ✅ | ✅ |  |
| ABOUT_CONTACT | ✅ | ✅ | ✅ |  |
| EVENTS | ✅ | ✅ | ✅ | apps/api/src/modules/community/public-registration.controller.ts<br>apps/api/src/modules/portal/portal.controller.ts |
| EVENTS_HOST | — | ✅ | ✅ | apps/api/src/modules/community/events.controller.ts |
| MANAGEMENT | — | ✅ | ✅ | apps/api/src/modules/management/assignments.controller.ts<br>apps/api/src/modules/management/attendance.controller.ts<br>apps/api/src/modules/management/bell.controller.ts<br>apps/api/src/modules/management/catalog.controller.ts<br>apps/api/src/modules/management/class-notes.controller.ts<br>apps/api/src/modules/management/class-teachers.controller.ts<br>apps/api/src/modules/management/classes.controller.ts<br>apps/api/src/modules/management/diary.controller.ts<br>apps/api/src/modules/management/email-settings.controller.ts<br>apps/api/src/modules/management/exams.controller.ts<br>apps/api/src/modules/management/front-desk.controller.ts<br>apps/api/src/modules/management/holidays.controller.ts<br>apps/api/src/modules/management/leave-policy.controller.ts<br>apps/api/src/modules/management/leave.controller.ts<br>apps/api/src/modules/management/onboarding/onboarding.controller.ts<br>apps/api/src/modules/management/register-change.controller.ts<br>apps/api/src/modules/management/requests.controller.ts<br>apps/api/src/modules/management/rooms.controller.ts<br>apps/api/src/modules/management/sessions.controller.ts<br>apps/api/src/modules/management/staff-attendance.controller.ts<br>apps/api/src/modules/management/staff.controller.ts<br>apps/api/src/modules/management/students.controller.ts<br>apps/api/src/modules/management/teachers.controller.ts<br>apps/api/src/modules/management/timetable.controller.ts<br>apps/api/src/modules/public/tv.controller.ts |
| BLOG | — | ✅ | ✅ | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| HIRING | — | — | ✅ | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| LIBRARY | — | — | ✅ | apps/api/src/modules/library/internal/library.controller.ts |
| ALUMNI | — | — | ✅ | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts<br>apps/api/src/modules/alumni/internal/alumni.controller.ts |
| FEES | — | — | ✅ | apps/api/src/modules/fees/fee-portal.controller.ts<br>apps/api/src/modules/fees/fees.controller.ts |
| PRESS | — | — | ✅ | apps/api/src/modules/press/press-orders.controller.ts<br>apps/api/src/modules/press/press-portal.controller.ts<br>apps/api/src/modules/press/press.controller.ts |
| SPORTS | — | — | ✅ | apps/api/src/modules/sports/internal/sports.controller.ts |
| SALARY | — | — | ✅ | apps/api/src/modules/payroll/internal/me-pay.controller.ts<br>apps/api/src/modules/payroll/internal/payroll.controller.ts |
| COURSE_MANAGEMENT | — | — | ✅ | apps/api/src/modules/syllabus/syllabus-portal.controller.ts<br>apps/api/src/modules/syllabus/syllabus.controller.ts |
| EXAM_HALL | — | — | ✅ | apps/api/src/modules/management/seating.controller.ts |
| WHATSAPP | — | — | ✅ | apps/api/src/modules/whatsapp/phone-verify.controller.ts<br>apps/api/src/modules/whatsapp/whatsapp-settings.controller.ts |
