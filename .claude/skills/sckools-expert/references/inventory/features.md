# Feature keys and tiers (packages/db/src/features.ts)

_Generated 2026-09-08 from `9be058c` (staging-site-preview → origin/staging). Do not edit by hand — run the sckools-expert-update skill._

Tier sets are cumulative (BASIC ⊂ STANDARD ⊂ PRO) and a `FeatureOverride` row can add or remove any key per school. Keys in no tier (e.g. ALUMNI, PRESS) are override-only. Resolved sets are cached in Redis for 300s (feature-resolver.service.ts).

| Key | BASIC | STANDARD | PRO | Gated controllers |
| --- | --- | --- | --- | --- |
| PUBLIC_SITE | ✅ | ✅ | ✅ |  |
| GALLERY | ✅ | ✅ | ✅ |  |
| ENQUIRY | ✅ | ✅ | ✅ |  |
| SOCIAL | ✅ | ✅ | ✅ |  |
| ABOUT_CONTACT | — | ✅ | ✅ |  |
| EVENTS | — | ✅ | ✅ | apps/api/src/modules/community/events.controller.ts<br>apps/api/src/modules/community/public-registration.controller.ts<br>apps/api/src/modules/portal/portal.controller.ts |
| MANAGEMENT | — | — | ✅ | apps/api/src/modules/management/assignments.controller.ts<br>apps/api/src/modules/management/attendance.controller.ts<br>apps/api/src/modules/management/bell.controller.ts<br>apps/api/src/modules/management/catalog.controller.ts<br>apps/api/src/modules/management/class-notes.controller.ts<br>apps/api/src/modules/management/classes.controller.ts<br>apps/api/src/modules/management/diary.controller.ts<br>apps/api/src/modules/management/email-settings.controller.ts<br>apps/api/src/modules/management/exams.controller.ts<br>apps/api/src/modules/management/front-desk.controller.ts<br>apps/api/src/modules/management/holidays.controller.ts<br>apps/api/src/modules/management/leave-policy.controller.ts<br>apps/api/src/modules/management/leave.controller.ts<br>apps/api/src/modules/management/register-change.controller.ts<br>apps/api/src/modules/management/requests.controller.ts<br>apps/api/src/modules/management/rooms.controller.ts<br>apps/api/src/modules/management/seating.controller.ts<br>apps/api/src/modules/management/staff-attendance.controller.ts<br>apps/api/src/modules/management/staff.controller.ts<br>apps/api/src/modules/management/students.controller.ts<br>apps/api/src/modules/management/teachers.controller.ts<br>apps/api/src/modules/management/timetable.controller.ts<br>apps/api/src/modules/public/tv.controller.ts |
| BLOG | — | ✅ | ✅ | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| HIRING | — | — | ✅ | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| LIBRARY | — | — | ✅ | apps/api/src/modules/library/internal/library.controller.ts |
| ALUMNI | — | — | — | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts<br>apps/api/src/modules/alumni/internal/alumni.controller.ts |
| FEES | — | — | ✅ | apps/api/src/modules/fees/fee-portal.controller.ts<br>apps/api/src/modules/fees/fees.controller.ts |
| PRESS | — | — | — | apps/api/src/modules/press/press-orders.controller.ts<br>apps/api/src/modules/press/press-portal.controller.ts<br>apps/api/src/modules/press/press.controller.ts |
