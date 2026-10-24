# API surface (apps/api/src/**/*.controller.ts)

_Generated 2026-10-24 from `e8b337a` (docs/skills-refresh → origin/main). Do not edit by hand — run the sckools-expert-update skill._

726 routes across 90 controllers. Roles column shows the handler's @Roles (which REPLACES the class list) or "public". Feature = @RequireFeature gate.

## health

| Method | Path | Roles | Feature | Guards (class) | File |
| --- | --- | --- | --- | --- | --- |
| GET | /health |  |  |  | apps/api/src/health/health.controller.ts |
| GET | /ready |  |  |  | apps/api/src/health/health.controller.ts |

## modules

| Method | Path | Roles | Feature | Guards (class) | File |
| --- | --- | --- | --- | --- | --- |
| GET | /alumni |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| PUT | /alumni |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/:id/decide |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/batches | public | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/batches/:year | public | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/claim |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/claims |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/directory |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/gift-groups |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/gift-items |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/giving |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/link-request |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/login |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| PUT | /alumni/password |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/pledges |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/pledges |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/pledges/:id/picked-up |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/pledges/:id/request-pickup |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /alumni/sign-out |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| GET | /alumni/slots |  | ALUMNI | RequireFeatureGuard | apps/api/src/modules/alumni/internal/alumni-portal.controller.ts |
| POST | /auth/accept-invite | public |  |  | apps/api/src/modules/auth/internal/accept-invite.controller.ts |
| POST | /auth/change-password |  |  |  | apps/api/src/modules/admin-credentials/internal/account.controller.ts |
| POST | /auth/forgot-password | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/impersonate | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/login | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/logout |  |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| GET | /auth/me |  |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/otp/choose | public |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| GET | /auth/otp/ready | public |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| POST | /auth/otp/request | public |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| POST | /auth/otp/verify | public |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| GET | /auth/profiles |  |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| POST | /auth/refresh | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/reset-by-code | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/reset-password | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/reset-with-otp | public |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| POST | /auth/resolve-school | public |  |  | apps/api/src/modules/auth/internal/auth.controller.ts |
| POST | /auth/switch |  |  |  | apps/api/src/modules/auth/internal/otp-auth.controller.ts |
| GET | /cms/blog/library | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| GET | /cms/blog/posts | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| POST | /cms/blog/posts | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| DELETE | /cms/blog/posts/:id | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| GET | /cms/blog/posts/:id | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| PATCH | /cms/blog/posts/:id | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| POST | /cms/blog/posts/:id/publish | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| POST | /cms/blog/posts/:id/submit-global | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| GET | /cms/blog/selections | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| POST | /cms/blog/selections | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| DELETE | /cms/blog/selections/:postId | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| PATCH | /cms/blog/selections/:postId | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| GET | /cms/blog/settings | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| PATCH | /cms/blog/settings | SCHOOL_ADMIN | BLOG | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/blog/internal/blog-cms.controller.ts |
| GET | /directory | public |  |  | apps/api/src/modules/directory/directory.controller.ts |
| GET | /internal/cron/cover-nudge |  |  | CronSecretGuard | apps/api/src/modules/management/cover-nudge.controller.ts |
| POST | /internal/cron/cover-nudge |  |  | CronSecretGuard | apps/api/src/modules/management/cover-nudge.controller.ts |
| GET | /internal/cron/exam-reminders |  |  | CronSecretGuard | apps/api/src/modules/management/exam-reminders.controller.ts |
| POST | /internal/cron/exam-reminders |  |  | CronSecretGuard | apps/api/src/modules/management/exam-reminders.controller.ts |
| GET | /internal/cron/fee-due-soon |  |  | CronSecretGuard | apps/api/src/modules/fees/fee-due-soon.controller.ts |
| POST | /internal/cron/fee-due-soon |  |  | CronSecretGuard | apps/api/src/modules/fees/fee-due-soon.controller.ts |
| GET | /internal/cron/notification-outbox |  |  | CronSecretGuard | apps/api/src/modules/management/notification-outbox.controller.ts |
| POST | /internal/cron/notification-outbox |  |  | CronSecretGuard | apps/api/src/modules/management/notification-outbox.controller.ts |
| GET | /internal/cron/session-start |  |  | CronSecretGuard | apps/api/src/modules/management/sessions-cron.controller.ts |
| POST | /internal/cron/session-start |  |  | CronSecretGuard | apps/api/src/modules/management/sessions-cron.controller.ts |
| GET | /library | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/dashboard | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/fines | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/fines/:id/collect | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/fines/:id/reopen | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/fines/:id/waive | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/fines/remind | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/hall | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/hall/visits | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/issues | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| DELETE | /library/issues/:id | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/issues/:id/lost | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/issues/:id/reopen | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/issues/:id/return | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/issues/:id/unlose | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/members | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/members/:kind/:id | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/settings | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| PATCH | /library/settings | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/titles | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/titles | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /library/titles/:id | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| POST | /library/titles/:id/copies | STAFF,SCHOOL_ADMIN | LIBRARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,LibrarianGuard | apps/api/src/modules/library/internal/library.controller.ts |
| GET | /manage/alumni | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/:id/account | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/:id/claim-link | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| PUT | /manage/alumni/:id/trusted | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/claims | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/claims/:id/decide | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/gift-groups | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/gift-items | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/gift-items | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| PUT | /manage/alumni/gift-items/:id | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/graduate | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/link-requests | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/link-requests/:id/dismiss | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/link-requests/:id/sent | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/pledges | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/attachments | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| DELETE | /manage/alumni/pledges/:id/attachments/:attachmentId | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/decide | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/distribute | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/picked-up | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/purchase | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/receive | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/report | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/request-pickup | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/pledges/:id/thank-you | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/roll-call | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| PUT | /manage/alumni/roll-call | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/sessions | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/sessions | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/sessions/:id/conflicts | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/sessions/:id/decide | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| POST | /manage/alumni/sessions/:id/decide-as-host | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/slots | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/alumni/summary | SCHOOL_ADMIN | ALUMNI | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/alumni/internal/alumni.controller.ts |
| GET | /manage/announcements | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| POST | /manage/announcements | SCHOOL_ADMIN,TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| DELETE | /manage/announcements/:id | SCHOOL_ADMIN,TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| GET | /manage/announcements/:id |  |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| PATCH | /manage/announcements/:id | SCHOOL_ADMIN,TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| GET | /manage/announcements/mine | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/announcements.controller.ts |
| GET | /manage/assignments | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/assignments.controller.ts |
| POST | /manage/assignments | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/assignments.controller.ts |
| DELETE | /manage/assignments/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/assignments.controller.ts |
| POST | /manage/assignments/upload | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/assignments.controller.ts |
| GET | /manage/attendance | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| PUT | /manage/attendance | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance/my-classes | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| POST | /manage/attendance/notify-low | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance/rates | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/attendance/status | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/attendance.controller.ts |
| GET | /manage/availability | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /manage/bell | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/bell.controller.ts |
| GET | /manage/class-log | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| GET | /manage/class-notes | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| POST | /manage/class-notes | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| DELETE | /manage/class-notes/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| GET | /manage/class-teachers | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/class-teachers.controller.ts |
| PUT | /manage/class-teachers/:classSectionId | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/class-teachers.controller.ts |
| POST | /manage/class-teachers/copy | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/class-teachers.controller.ts |
| POST | /manage/class-todos | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| DELETE | /manage/class-todos/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| PATCH | /manage/class-todos/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| GET | /manage/classes | SCHOOL_ADMIN,TEACHER | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/classes.controller.ts |
| POST | /manage/classes | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/classes.controller.ts |
| DELETE | /manage/classes/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/classes.controller.ts |
| PUT | /manage/classes/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/classes.controller.ts |
| GET | /manage/concerns | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/comment | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/comment | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/comment | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/escalate | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/reopen | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/status | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| POST | /manage/concerns/:id/status | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns/counts | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/concerns/counts | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/concerns/concerns.controller.ts |
| GET | /manage/diary | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/diary.controller.ts |
| POST | /manage/diary | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/diary.controller.ts |
| DELETE | /manage/diary/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/diary.controller.ts |
| PATCH | /manage/diary/:id | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/diary.controller.ts |
| POST | /manage/email-check | SCHOOL_ADMIN,TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/mail-webhooks/email-check.controller.ts |
| GET | /manage/email-settings | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| PUT | /manage/email-settings | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| GET | /manage/email-settings/preview | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| PUT | /manage/email-settings/sender | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| POST | /manage/email-settings/sender/disable | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| POST | /manage/email-settings/sender/verify | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| POST | /manage/email-settings/test | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| POST | /manage/email-settings/unsuppress | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/email-settings.controller.ts |
| GET | /manage/events | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| POST | /manage/events | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| DELETE | /manage/events/:id | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| PATCH | /manage/events/:id | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| GET | /manage/events/:id/registrations | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| POST | /manage/events/:id/registrations | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| GET | /manage/events/audience-candidates | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| PATCH | /manage/events/registrations/:registrationId | SCHOOL_ADMIN | EVENTS_HOST | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/community/events.controller.ts |
| GET | /manage/exams | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| POST | /manage/exams | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| POST | /manage/exams/:id/publish | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| GET | /manage/exams/:id/results | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| PUT | /manage/exams/:id/results | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| GET | /manage/exams/result-days | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/exams.controller.ts |
| POST | /manage/fees/billing/generate | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/billing/preview | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/categories | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/categories | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| DELETE | /manage/fees/categories/:id | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/categories/seed | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/concessions | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/concessions | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| DELETE | /manage/fees/concessions/:id | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/grid | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/grid | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/payment-setup | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/payment-setup/bank | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/payment-setup/bank/qr | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/payment-setup/provider | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/payments | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/payments/:id/reject | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/payments/:id/reverse | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/payments/:id/verify | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/payments/recent | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| POST | /manage/fees/payments/record | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/settings | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/settings | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/students | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/students/:id | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/summary | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/fees/terms | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| PUT | /manage/fees/terms | SCHOOL_ADMIN,STAFF | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/fees/fees.controller.ts |
| GET | /manage/grades | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| POST | /manage/grades | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| DELETE | /manage/grades/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| PUT | /manage/grades/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /manage/holidays | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/holidays.controller.ts |
| POST | /manage/holidays | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/holidays.controller.ts |
| DELETE | /manage/holidays/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/holidays.controller.ts |
| GET | /manage/jobs | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| GET | /manage/jobs | public | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| POST | /manage/jobs | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| GET | /manage/jobs/:id | public | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| PATCH | /manage/jobs/:id | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| GET | /manage/jobs/:id/applications | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| POST | /manage/jobs/:id/apply | public | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| POST | /manage/jobs/:id/close | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| POST | /manage/jobs/:id/submit | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| PATCH | /manage/jobs/applications/:id | SCHOOL_ADMIN | HIRING | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/hiring/internal/jobs.controller.ts |
| GET | /manage/leave |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave-policy/allocations |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| PUT | /manage/leave-policy/allocations |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| POST | /manage/leave-policy/allocations/apply-defaults |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| POST | /manage/leave-policy/close-year |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| GET | /manage/leave-policy/my-balance |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| GET | /manage/leave-policy/pending-context |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| GET | /manage/leave-policy/types |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| POST | /manage/leave-policy/types |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| PATCH | /manage/leave-policy/types/:id |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave-policy.controller.ts |
| POST | /manage/leave/:id/approve |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave/:id/assign |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave/:id/cancel |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave/:id/candidates |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave/:id/clear |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave/:id/cover-batch |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave/:id/cover-fit |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave/:id/cover-preview |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| POST | /manage/leave/:id/reject |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave/coverage |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/leave/mine |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/leave.controller.ts |
| GET | /manage/messages | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| GET | /manage/messages/:threadId | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| POST | /manage/messages/:threadId | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| POST | /manage/messages/:threadId/block | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| POST | /manage/messages/:threadId/report | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| GET | /manage/messages/unread-count | TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/teacher-messages.controller.ts |
| GET | /manage/note-classes | TEACHER,SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/class-notes.controller.ts |
| GET | /manage/onboarding/export/:kind | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| GET | /manage/onboarding/export/all | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| POST | /manage/onboarding/import/:kind | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| POST | /manage/onboarding/preview/:kind | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| GET | /manage/onboarding/status | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| GET | /manage/onboarding/template/:kind | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/onboarding/onboarding.controller.ts |
| GET | /manage/periods | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| POST | /manage/periods | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| DELETE | /manage/periods/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| PUT | /manage/periods/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| POST | /manage/press/certificates/bulk | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| POST | /manage/press/certificates/issue | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/certificates/prepare/:studentId | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/classes | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/orders | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| GET | /manage/press/orders/:id | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| POST | /manage/press/orders/:id/cancel | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| POST | /manage/press/orders/:id/confirm | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| GET | /manage/press/orders/:id/file | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| POST | /manage/press/orders/report-cards | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| POST | /manage/press/orders/upload | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-orders.controller.ts |
| GET | /manage/press/overview | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/register | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/register/:id | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| POST | /manage/press/register/:id/void | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| PUT | /manage/press/remarks | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/report-cards/:windowId/:classSectionId | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| POST | /manage/press/report-cards/issue | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/results | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| POST | /manage/press/results/generate | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| POST | /manage/press/results/nudge | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/students | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/windows | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| PUT | /manage/press/windows | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/press/years | SCHOOL_ADMIN,STAFF | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,StaffScopeGuard | apps/api/src/modules/press/press.controller.ts |
| GET | /manage/pulse | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/front-desk.controller.ts |
| GET | /manage/register-changes |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| GET | /manage/register-changes |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| GET | /manage/register-changes |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| POST | /manage/register-changes |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| POST | /manage/register-changes/:id/approve |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| POST | /manage/register-changes/:id/reject |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| GET | /manage/register-changes/mine |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| GET | /manage/register-changes/mine |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/register-change.controller.ts |
| GET | /manage/requests/pending-count |  | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/requests.controller.ts |
| GET | /manage/rooms | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/rooms.controller.ts |
| POST | /manage/rooms | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/rooms.controller.ts |
| DELETE | /manage/rooms/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/rooms.controller.ts |
| PUT | /manage/rooms/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/rooms.controller.ts |
| POST | /manage/rooms/:id/duplicate | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/rooms.controller.ts |
| GET | /manage/school/class-note-visibility | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| PUT | /manage/school/class-note-visibility | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /manage/school/working-days | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| PUT | /manage/school/working-days | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /manage/search | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/front-desk.controller.ts |
| GET | /manage/seating | SCHOOL_ADMIN | EXAM_HALL | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/seating.controller.ts |
| POST | /manage/seating | SCHOOL_ADMIN | EXAM_HALL | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/seating.controller.ts |
| DELETE | /manage/seating/:id | SCHOOL_ADMIN | EXAM_HALL | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/seating.controller.ts |
| GET | /manage/seating/:id | SCHOOL_ADMIN | EXAM_HALL | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/seating.controller.ts |
| POST | /manage/seating/preview | SCHOOL_ADMIN | EXAM_HALL | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/seating.controller.ts |
| GET | /manage/sessions | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/sessions/:yearId/register | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/sessions/plan | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| PATCH | /manage/sessions/plan | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/cancel | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| PUT | /manage/sessions/plan/decisions | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/decisions/defaults | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/sessions/plan/library | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/library/last-due | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/library/remind | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/sessions/plan/review | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/start | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/structure/copy | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/sessions/plan/students | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| POST | /manage/sessions/plan/timetable/copy | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/sessions.controller.ts |
| GET | /manage/staff | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| POST | /manage/staff | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| GET | /manage/staff-attendance | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| GET | /manage/staff-attendance | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| PUT | /manage/staff-attendance | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| GET | /manage/staff-attendance/mine | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| GET | /manage/staff-attendance/person | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| GET | /manage/staff-attendance/person | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff-attendance.controller.ts |
| DELETE | /manage/staff/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| PUT | /manage/staff/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| POST | /manage/staff/:id/invite/resend | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| POST | /manage/staff/:id/login | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| POST | /manage/staff/:id/reactivate | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| POST | /manage/staff/:id/release | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/staff.controller.ts |
| GET | /manage/students | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| POST | /manage/students | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| DELETE | /manage/students/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| PUT | /manage/students/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| GET | /manage/students/:id/clearance | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| POST | /manage/students/:id/invite/resend | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| POST | /manage/students/:id/leave | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| POST | /manage/students/:id/login | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| POST | /manage/students/:id/readmit | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| GET | /manage/students/:id/report | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/students.controller.ts |
| GET | /manage/subjects | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| POST | /manage/subjects | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| DELETE | /manage/subjects/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| PUT | /manage/subjects/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /manage/syllabus/chapters | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| POST | /manage/syllabus/chapters | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| DELETE | /manage/syllabus/chapters/:id | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| PATCH | /manage/syllabus/chapters/:id | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| GET | /manage/syllabus/mine | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| GET | /manage/syllabus/overview | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| GET | /manage/syllabus/tracks/:classSectionId/:subjectId | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| PUT | /manage/syllabus/tracks/:classSectionId/:subjectId/progress/:chapterId | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| POST | /manage/syllabus/tracks/:classSectionId/:subjectId/reach/:chapterId | TEACHER,SCHOOL_ADMIN | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus.controller.ts |
| GET | /manage/teachers | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| POST | /manage/teachers | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| DELETE | /manage/teachers/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| GET | /manage/teachers/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| PUT | /manage/teachers/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| POST | /manage/teachers/:id/invite/resend | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| POST | /manage/teachers/:id/login | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| POST | /manage/teachers/:id/reactivate | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| POST | /manage/teachers/:id/release | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| GET | /manage/teachers/:id/release-impact | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| GET | /manage/teachers/identity-check | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| GET | /manage/teachers/me | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/teachers.controller.ts |
| GET | /manage/timetable | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| GET | /manage/timetable | SCHOOL_ADMIN,TEACHER | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| POST | /manage/timetable | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| DELETE | /manage/timetable/:id | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| GET | /manage/timetable/mine | SCHOOL_ADMIN,TEACHER | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| GET | /manage/timetable/my-day | SCHOOL_ADMIN,TEACHER | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| POST | /manage/timetable/subject-teacher | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| POST | /manage/timetable/subject-teacher/preview | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/timetable.controller.ts |
| GET | /manage/whatsapp-settings | SCHOOL_ADMIN | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/whatsapp-settings.controller.ts |
| PUT | /manage/whatsapp-settings | SCHOOL_ADMIN | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/whatsapp-settings.controller.ts |
| POST | /manage/whatsapp-settings/test | SCHOOL_ADMIN | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/whatsapp-settings.controller.ts |
| GET | /manage/years | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| POST | /manage/years | SCHOOL_ADMIN | MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/management/catalog.controller.ts |
| GET | /marketing/blog | public |  |  | apps/api/src/modules/blog/internal/blog-marketing.controller.ts |
| GET | /marketing/blog/:globalSlug | public |  |  | apps/api/src/modules/blog/internal/blog-marketing.controller.ts |
| GET | /marketing/config | public |  |  | apps/api/src/modules/marketing/marketing.controller.ts |
| POST | /marketing/leads | public |  |  | apps/api/src/modules/marketing/marketing.controller.ts |
| GET | /me/account | SCHOOL_ADMIN,TEACHER,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/auth/internal/me-profile.controller.ts |
| PATCH | /me/account | SCHOOL_ADMIN,TEACHER,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/auth/internal/me-profile.controller.ts |
| GET | /me/announcements | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/assignments | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| POST | /me/assignments/:id/seen | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/attendance | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/birthdays | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/diary | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| POST | /me/diary/:id/sign | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| POST | /me/events/:id/register | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/exams | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/fees | STUDENT | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/fees/fee-portal.controller.ts |
| GET | /me/fees/bank-instructions | STUDENT | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/fees/fee-portal.controller.ts |
| GET | /me/fees/how-to-pay | STUDENT | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/fees/fee-portal.controller.ts |
| GET | /me/fees/receipts/:paymentId | STUDENT | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/fees/fee-portal.controller.ts |
| POST | /me/fees/submit | STUDENT | FEES | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/fees/fee-portal.controller.ts |
| GET | /me/holidays | STUDENT,TEACHER,STAFF,SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/home | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/messages | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| POST | /me/messages | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| GET | /me/messages/:threadId | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| POST | /me/messages/:threadId/block | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| POST | /me/messages/:threadId/report | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| GET | /me/messages/teachers | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| GET | /me/messages/unread-count | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/student-messages.controller.ts |
| GET | /me/notifications | STUDENT,TEACHER,SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/notifications.controller.ts |
| POST | /me/notifications/clear | STUDENT,TEACHER,SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/notifications.controller.ts |
| POST | /me/notifications/read | STUDENT,TEACHER,SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/notifications.controller.ts |
| GET | /me/notifications/unread-count | STUDENT,TEACHER,SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/notifications.controller.ts |
| GET | /me/pay | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| POST | /me/pay/declaration | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| GET | /me/pay/details | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| POST | /me/pay/details | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| GET | /me/pay/payslips/:id | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| GET | /me/pay/payslips/:id/document | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| GET | /me/pay/statement | TEACHER,STAFF,SCHOOL_ADMIN | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/payroll/internal/me-pay.controller.ts |
| DELETE | /me/phone | SCHOOL_ADMIN,TEACHER,STAFF | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/phone-verify.controller.ts |
| GET | /me/phone | SCHOOL_ADMIN,TEACHER,STAFF | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/phone-verify.controller.ts |
| POST | /me/phone/request | SCHOOL_ADMIN,TEACHER,STAFF | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/phone-verify.controller.ts |
| POST | /me/phone/verify | SCHOOL_ADMIN,TEACHER,STAFF | WHATSAPP | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/whatsapp/phone-verify.controller.ts |
| POST | /me/photo | STUDENT,TEACHER,STAFF |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/management/photo.controller.ts |
| GET | /me/profile | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| POST | /me/push-token | STUDENT,TEACHER,STAFF,SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/report-cards | STUDENT | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-portal.controller.ts |
| GET | /me/report-cards/:id | STUDENT | PRESS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/press/press-portal.controller.ts |
| GET | /me/results | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /me/syllabus | STUDENT | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus-portal.controller.ts |
| PUT | /me/syllabus/notes/:chapterId | STUDENT | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus-portal.controller.ts |
| GET | /me/syllabus/subjects/:subjectId | STUDENT | COURSE_MANAGEMENT | SchoolJwtGuard,RequireFeatureGuard,RolesGuard | apps/api/src/modules/syllabus/syllabus-portal.controller.ts |
| GET | /me/timetable | STUDENT |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/portal/portal.controller.ts |
| GET | /owner |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/auth/gate | public |  | OwnerHostGuard | apps/api/src/modules/owner/internal/owner-auth.controller.ts |
| POST | /owner/auth/login | public |  | OwnerHostGuard | apps/api/src/modules/owner/internal/owner-auth.controller.ts |
| POST | /owner/auth/logout | public |  | OwnerHostGuard | apps/api/src/modules/owner/internal/owner-auth.controller.ts |
| POST | /owner/auth/refresh | public |  | OwnerHostGuard | apps/api/src/modules/owner/internal/owner-auth.controller.ts |
| GET | /owner/backups/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/backups/:id/download |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/backups/:id/step |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/backups/upload-url |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/backups/uploaded |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/blog/:id/approve |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/blog/internal/blog-owner.controller.ts |
| POST | /owner/blog/:id/reject |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/blog/internal/blog-owner.controller.ts |
| GET | /owner/blog/pending |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/blog/internal/blog-owner.controller.ts |
| GET | /owner/bucket-restores/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/bucket-restores/:id/step |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/deleted-schools |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/events |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/events |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/events/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/jobs |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/jobs/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/leads |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/leads/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/leads/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/leads/:id/activities |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/marketing-config |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PUT | /owner/marketing-config |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/ops |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/overview |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/print-orders |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| GET | /owner/print-orders/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| GET | /owner/print-orders/:id/artifact |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| POST | /owner/print-orders/:id/decline |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| POST | /owner/print-orders/:id/delivered |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| POST | /owner/print-orders/:id/dispatch |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| POST | /owner/print-orders/:id/printing |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| POST | /owner/print-orders/:id/quote |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| GET | /owner/print-orders/counts |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/press/operator-orders.controller.ts |
| GET | /owner/referrals |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/referrals/:id/accept |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/referrals/:id/reject |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| PATCH | /owner/referrals/:id/stage |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| GET | /owner/referrals/payouts |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| PATCH | /owner/referrals/payouts/:id/paid |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| GET | /owner/referrals/promoters |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/referrals/promoters |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| PATCH | /owner/referrals/promoters/:id/commission |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/referrals/promoters/:id/kyc-verified |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/referrals/promoters/:id/login-link |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| PATCH | /owner/referrals/promoters/:id/status |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| GET | /owner/referrals/settings |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| PUT | /owner/referrals/settings |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| GET | /owner/referrals/tasks |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/referrals/owner-referrals.controller.ts |
| POST | /owner/restores |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/restores/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/restores/:id/step |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/sample-packs |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/sample-packs |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| DELETE | /owner/sample-packs/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/sample-packs/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| PATCH | /owner/sample-packs/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/sample-packs/:id/download |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/sample-packs/:id/step |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/sample-packs/excluded |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/sample-packs/upload-url |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/sample-packs/uploaded |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/schools |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/schools |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| DELETE | /owner/schools/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/schools/:id |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/schools/:id/admins |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts |
| POST | /owner/schools/:id/admins/:userId/reset-password |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/admin-credentials/internal/admin-credentials.controller.ts |
| GET | /owner/schools/:id/backups |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/backups |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/schools/:id/bucket-restores |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/schools/:id/buckets |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/schools/:id/buckets/:bucket/versions |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/buckets/preflight |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/buckets/reset |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/buckets/restore |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/buckets/save |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/schools/:id/delete |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/schools/:id/domains |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/schools/:id/domains |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| DELETE | /owner/schools/:id/domains/:domainId |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/schools/:id/domains/:domainId/primary |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/schools/:id/domains/:domainId/verify |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/schools/:id/enquiries.csv |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/schools/:id/features |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| POST | /owner/schools/:id/impersonate |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/schools/:id/snapshot.json |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/schools/:id/status |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| PATCH | /owner/schools/:id/tier |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/snapshots |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| POST | /owner/snapshots |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /owner/speed |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/stats |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/owner/internal/owner.controller.ts |
| GET | /owner/weekly |  |  | OwnerHostGuard,PlatformJwtGuard | apps/api/src/modules/backups/backups.controller.ts |
| GET | /payroll/access | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/access | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/adjustments | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/adjustments | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/components | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/components | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/grades | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/grades | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/grades/:id/remove | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/grades/assign | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/grades/preview | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/grades/raise | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/grades/suggest | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/leave | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/leave/apply | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/leave/policy | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/overview | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/payslips/:id/document | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/people | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/people/:kind/:id | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/people/:kind/:id/details | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/people/:kind/:id/details | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/people/preview | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/people/structure | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/runs | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/runs | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/runs/:id | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/runs/:id/approve | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/runs/:id/calculate | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/runs/:id/files/:what | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/runs/:id/lock | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/runs/:id/paid | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/settings | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| POST | /payroll/settings | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/statement/:kind/:id | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /payroll/statutory/calendar | SCHOOL_ADMIN,STAFF | SALARY | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SalaryGuard | apps/api/src/modules/payroll/internal/payroll.controller.ts |
| GET | /promoter/auth/channels |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/commission-request |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| GET | /promoter/auth/me |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| PATCH | /promoter/auth/me |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| PUT | /promoter/auth/payout-details |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| GET | /promoter/auth/payouts |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| GET | /promoter/auth/referrals |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/referrals |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| GET | /promoter/auth/referrals/:id |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/referrals/:id/notes |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/sign-out-all |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/start |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| POST | /promoter/auth/verify |  |  |  | apps/api/src/modules/referrals/promoter.controller.ts |
| GET | /public |  |  |  | apps/api/src/modules/public/tv.controller.ts |
| GET | /public/birthdays | public |  |  | apps/api/src/modules/public/public-site.controller.ts |
| GET | /public/blog | public |  |  | apps/api/src/modules/blog/internal/blog-public.controller.ts |
| GET | /public/blog/:slug | public |  |  | apps/api/src/modules/blog/internal/blog-public.controller.ts |
| GET | /public/disable |  |  |  | apps/api/src/modules/public/tv.controller.ts |
| POST | /public/disable |  |  |  | apps/api/src/modules/public/tv.controller.ts |
| POST | /public/enquiry | public |  |  | apps/api/src/modules/public/enquiry.controller.ts |
| POST | /public/events/:id/register | public | EVENTS | RequireFeatureGuard | apps/api/src/modules/community/public-registration.controller.ts |
| GET | /public/records | public |  |  | apps/api/src/modules/public/public-site.controller.ts |
| GET | /public/rotate |  |  |  | apps/api/src/modules/public/tv.controller.ts |
| POST | /public/rotate |  |  |  | apps/api/src/modules/public/tv.controller.ts |
| GET | /public/site | public |  |  | apps/api/src/modules/public/public-site.controller.ts |
| GET | /public/tv | public |  |  | apps/api/src/modules/public/tv.controller.ts |
| GET | /site/admissions | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/admissions.controller.ts |
| PUT | /site/admissions/settings | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/admissions.controller.ts |
| PUT | /site/admissions/steps | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/admissions.controller.ts |
| GET | /site/celebrations | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| PUT | /site/celebrations | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/celebrations/preview | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/content | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/courses | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/courses.controller.ts |
| POST | /site/courses | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/courses.controller.ts |
| DELETE | /site/courses/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/courses.controller.ts |
| PUT | /site/courses/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/courses.controller.ts |
| PUT | /site/courses/:id/fee | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/courses.controller.ts |
| GET | /site/design-drafts | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/design-drafts.controller.ts |
| POST | /site/design-drafts | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/design-drafts.controller.ts |
| DELETE | /site/design-drafts/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/design-drafts.controller.ts |
| PUT | /site/design-drafts/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/design-drafts.controller.ts |
| POST | /site/design-drafts/:id/publish | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/design-drafts.controller.ts |
| GET | /site/enquiries | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| POST | /site/enquiries | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| GET | /site/enquiries/:id | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| PATCH | /site/enquiries/:id | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| POST | /site/enquiries/:id/notes | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| GET | /site/enquiries/owners | SCHOOL_ADMIN,STAFF |  | SchoolJwtGuard,RolesGuard,AdmissionsDeskGuard | apps/api/src/modules/public/enquiry-admin.controller.ts |
| GET | /site/hall-of-fame | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/hall-of-fame.controller.ts |
| PUT | /site/hall-of-fame/groups | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/hall-of-fame.controller.ts |
| PUT | /site/hall-of-fame/groups/:groupId/:year | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/hall-of-fame.controller.ts |
| PUT | /site/hall-of-fame/settings | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/hall-of-fame.controller.ts |
| PUT | /site/homepage | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/media | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/media.controller.ts |
| POST | /site/media | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/media.controller.ts |
| DELETE | /site/media/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/media.controller.ts |
| GET | /site/pages | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/school-pages.controller.ts |
| POST | /site/pages | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/school-pages.controller.ts |
| DELETE | /site/pages/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/school-pages.controller.ts |
| PUT | /site/pages/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/school-pages.controller.ts |
| PUT | /site/profile | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/records | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| PUT | /site/records | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/records/lines | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| PUT | /site/social | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /site/staff | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/staff.controller.ts |
| POST | /site/staff | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/staff.controller.ts |
| DELETE | /site/staff/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/staff.controller.ts |
| PUT | /site/staff/:id | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/staff.controller.ts |
| PUT | /site/stats | SCHOOL_ADMIN |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/cms/internal/site-content.controller.ts |
| GET | /sports | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/coaches | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/coaches/:staffId | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/heats/:id/marks | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/houses | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/houses | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| DELETE | /sports/houses/:id | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/houses/:id | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/houses/:id/members | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/houses/:id/points | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/houses/assign | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/houses/ledger | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/matches/:id/score | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/me | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/records | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/records | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/records/:id/void | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/records/attempts | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/records/attempts | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/records/attempts/:id/decide | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/records/history | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/roster | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/settings | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/settings | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/tournaments | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| DELETE | /sports/tournaments/:id | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /sports/tournaments/:id | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/tournaments/:id | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/tournaments/:id/events/:eventId/day | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/tournaments/:id/events/day | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/finish | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/tournaments/:id/heats/:heatId/slot | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| PATCH | /sports/tournaments/:id/matches/:matchId/slot | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/move-group | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/publish | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/refit | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/shift | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/venues | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| DELETE | /sports/tournaments/:id/venues/:venueId | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| POST | /sports/tournaments/:id/venues/:venueId/clear | STAFF,SCHOOL_ADMIN | SPORTS | SchoolJwtGuard,RequireFeatureGuard,RolesGuard,SportsDeskGuard | apps/api/src/modules/sports/internal/sports.controller.ts |
| GET | /students | UserRole.SCHOOL_ADMIN,UserRole.TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/tenancy/internal/users.controller.ts |
| GET | /students/:id |  |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/tenancy/internal/users.controller.ts |
| GET | /teachers/:id |  |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/tenancy/internal/users.controller.ts |
| GET | /users | UserRole.SCHOOL_ADMIN,UserRole.TEACHER |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/tenancy/internal/users.controller.ts |
| GET | /users/:id |  |  | SchoolJwtGuard,RolesGuard | apps/api/src/modules/tenancy/internal/users.controller.ts |
| POST | /webhooks/resend |  |  |  | apps/api/src/modules/mail-webhooks/resend-webhook.controller.ts |
| GET | /webhooks/whatsapp |  |  |  | apps/api/src/modules/whatsapp/whatsapp-webhook.controller.ts |
| POST | /webhooks/whatsapp |  |  |  | apps/api/src/modules/whatsapp/whatsapp-webhook.controller.ts |
