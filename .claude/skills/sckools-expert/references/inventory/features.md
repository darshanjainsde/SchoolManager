# Feature keys and tiers (packages/db/src/features.ts)

_Generated 2026-09-08 from `9be058c`; tier columns hand-updated 2026-10-22 for Plan Ladder v2 (`feat/marketing-site-fixes`). Regenerate with the sckools-expert-update skill._

Tier sets are cumulative (BASIC ⊂ STANDARD ⊂ PRO) and a `FeatureOverride` row can add or remove any key per school. Since Plan Ladder v2 (2026-10-22) every key is in a tier; a disabled override protects a live school from a module its plan newly carries. Resolved sets are cached in Redis for 300s (feature-resolver.service.ts).

| Key | BASIC | STANDARD | PRO | Gated controllers |
| --- | --- | --- | --- | --- |
| PUBLIC_SITE | ✅ | ✅ | ✅ |  |
| GALLERY | ✅ | ✅ | ✅ |  |
| ENQUIRY | ✅ | ✅ | ✅ |  |
| SOCIAL | ✅ | ✅ | ✅ |  |
| ABOUT_CONTACT | ✅ | ✅ | ✅ |  |
| EVENTS | ✅ | ✅ | ✅ | apps/api/src/modules/community/events.controller.ts<br>apps/api/src/modules/community/public-registration.controller.ts<br>apps/api/src/modules/portal/portal.controller.ts |
| MANAGEMENT | — | ✅ | ✅ | apps/api/src/modules/management/assignments.controller.ts<br>apps/api/src/modules/management/attendance.controller.ts<br>apps/api/src/modules/management/bell.controller.ts<br>apps/api/src/modules/management/catalog.controller.ts<br>apps/api/src/modules/management/class-notes.controller.ts<br>apps/api/src/modules/management/classes.controller.ts<br>apps/api/src/modules/management/diary.controller.ts<br>apps/api/src/modules/management/email-settings.controller.ts<br>apps/api/src/modules/management/exams.controller.ts<br>apps/api/src/modules/management/front-desk.controller.ts<br>apps/api/src/modules/management/holidays.controller.ts<br>apps/api/src/modules/management/leave-policy.controller.ts<br>apps/api/src/modules/management/leave.controller.ts<br>apps/api/src/modules/management/register-change.controller.ts<br>apps/api/src/modules/management/requests.controller.ts<br>apps/api/src/modules/management/rooms.controller.ts<br>apps/api/src/modules/management/seating.controller.ts<br>apps/api/src/modules/management/staff-attendance.controller.ts<br>apps/api/src/modules/management/staff.controller.ts<br>apps/api/src/modules/management/students.controller.ts<br>apps/api/src/modules/management/teachers.controller.ts<br>apps/api/src/modules/management/timetable.controller.ts<br>apps/api/src/modules/public/tv.controller.ts |
| BLOG | — | ✅ | ✅ | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| HIRING | — | — | ✅ | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| LIBRARY | — | — | ✅ | apps/api/src/modules/library/internal/library.controller.ts |
| ALUMNI | — | — | ✅ | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts<br>apps/api/src/modules/alumni/internal/alumni.controller.ts |
| FEES | — | — | ✅ | apps/api/src/modules/fees/fee-portal.controller.ts<br>apps/api/src/modules/fees/fees.controller.ts |
| PRESS | — | — | ✅ | apps/api/src/modules/press/press-orders.controller.ts<br>apps/api/src/modules/press/press-portal.controller.ts<br>apps/api/src/modules/press/press.controller.ts |
| EVENTS_HOST | — | ✅ | ✅ | apps/api/src/modules/community/events.controller.ts (hosting; registration and the portal stay on EVENTS) |
| SPORTS | — | — | ✅ | apps/api/src/modules/sports/sports.controller.ts |
| SALARY | — | — | ✅ | apps/api/src/modules/payroll/payroll.controller.ts<br>apps/api/src/modules/payroll/me-pay.controller.ts |
| COURSE_MANAGEMENT | — | — | ✅ | apps/api/src/modules/syllabus/syllabus.controller.ts<br>apps/api/src/modules/syllabus/syllabus-portal.controller.ts |
| EXAM_HALL | — | — | ✅ | apps/api/src/modules/management/seating.controller.ts (moved out of MANAGEMENT) |
| WHATSAPP | — | — | ✅ | apps/api/src/modules/whatsapp/whatsapp-settings.controller.ts<br>apps/api/src/modules/whatsapp/phone-verify.controller.ts<br>apps/api/src/common/notifications/whatsapp.channel.ts (outbound re-checks the plan) |
