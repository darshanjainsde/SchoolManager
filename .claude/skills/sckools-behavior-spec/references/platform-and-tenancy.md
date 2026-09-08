# Platform, tenancy, identity and access

Source of truth: `apps/api/src/modules/tenancy/`, `apps/api/src/common/auth/`,
`apps/api/src/modules/auth/`, `apps/api/src/modules/features/`, `packages/db/src/features.ts`,
`packages/config/src/index.ts`, `apps/web/lib/hosts.ts`.

## 1. Hosts decide everything

`tenantMiddleware` resolves the tenant from the request host, in this order:

1. `X-Skoolos-Host` header — explicit, app-controlled. **Required on Vercel**, which overwrites
   `X-Forwarded-Host` with the deployment host (every request would otherwise resolve to one tenant).
2. `req.hostname` — honours `X-Forwarded-Host` when `trust proxy` is on. Correct for real subdomains.
3. `req.headers.host` — for trust-proxy-off cases (supertest sets Host directly).

Resolution yields one of three contexts: `tenant` (schoolId + slug), `platform` (owner/apex), `unknown`.

| Host | Context | Serves |
|---|---|---|
| `<slug>.sckools.com` or a school's custom domain | `tenant` | Public school site, `/login`, `/app`, `/teacher`, `/portal`, `/blog` |
| `sckools.com` (apex) | `platform` | Marketing site, school directory, platform blog |
| `owner.sckools.com` | `platform` | Owner console (`/platform`, `/owner` gate) |

Web-side host helpers live in `apps/web/lib/hosts.ts` — `NEXT_PUBLIC_PLATFORM_HOST` and
`NEXT_PUBLIC_PLATFORM_OWNER_HOST` are the **only** places the domain is named. Local dev uses
`localhost` / `owner.localhost` / `<slug>.localhost:3000`.

**QA implication:** any API call made from a tool (curl/Postman) must send `X-Skoolos-Host`, or it will
resolve to the wrong tenant / `unknown` and 401 with "Tenant context required".

## 2. Guard stack

Guards compose; a route can carry several. Order of failure matters when reading a bug report.

| Guard | Rejects with | Rule |
|---|---|---|
| `SchoolJwtGuard` | 401 | Requires `tenant` context + a valid `aud: 'school'` access token whose `schoolId` **equals** the host's schoolId. Skipped when `@Public()`. |
| `RolesGuard` | 403 `Role not permitted` | `@Roles(...)` on the **handler replaces** the class-level list (it does not add to it). |
| `RequireFeatureGuard` | 403 `Feature X not enabled` | Resolves the school's feature set; requires the `@RequireFeature('KEY')` key. |
| `OwnerHostGuard` | 403 `Owner host required` | Context must be `platform`. |
| `PlatformJwtGuard` | 401 | Requires an `aud: 'platform'` token (OWNER). |
| `CronSecretGuard` | 401/403 | Shared secret for `/internal/cron/*`; those routes are `@Public()` because a cron has no user. |

## 3. The five roles

| Role | Has `schoolId` | Lands on (web) | Lands on (mobile) |
|---|---|---|---|
| `OWNER` | no (`null`) | `/platform` (owner console) | **not supported** — `portalForRole` throws; bootstrap falls back to login |
| `SCHOOL_ADMIN` | yes | `/app` | `(staff)/today` |
| `TEACHER` | yes | `/teacher` | `(staff)/today` |
| `STUDENT` | yes | `/portal` | `(family)/home` |
| `STAFF` | yes | **bounced** — toast "Staff sign-in is not available yet", tokens cleared | `(staff)/today` |

There is **no PARENT role**. A guardian uses the student's login. All student-portal and notification
copy must stay role-neutral.

Web login routes on the API's reported role from `GET /auth/me`, never on the role tab the user picked
("Never trust the slider").

## 4. Authentication

**Login** — `POST /auth/login { identifier, password }`, `@Public()`. `identifier` resolves in this order:

1. contains `@` → `User.email` (lower-cased) within this school
2. otherwise → `User.username` (case-insensitive)
3. otherwise → `Student.admissionNo` (case-insensitive) → its linked `User`

Every miss returns the same generic `Invalid credentials` — **no account enumeration**, by design.

| Thing | Value | Where |
|---|---|---|
| Access token TTL | 900s (15 min) | `JWT_ACCESS_TTL` |
| Refresh token TTL | 30 days | `JWT_REFRESH_TTL` |
| Failed-login lockout | 5 attempts → 900s lock | `LOCKOUT_MAX_ATTEMPTS` / `LOCKOUT_DURATION_SECONDS` |
| Password reset token | 30 min, single use, sha256 at rest | `password-reset.service.ts` |
| Login invite token | 30 min, same table/mechanism as reset | `login-invite.service.ts` |
| Impersonation token | 15 min, single use, host-bound | `impersonation.service.ts` |

**Refresh rotation with reuse detection.** Refresh tokens are stored hashed and belong to a `familyId`.
Presenting an already-revoked token **revokes the entire family** in its own committed transaction
before returning 401 — a stolen token cannot outlive its detection. Locked accounts return
403 `Account temporarily locked` (distinct from 401 invalid credentials).

**Logout** revokes the presented refresh token and clears the refresh cookie.

**`GET /auth/me`** returns `{ userId, schoolId, role, features[] }`. The admin console's nav is filtered
by this `features` array; until it loads, **all** nav items show (deliberate — avoids items flickering
away on a slow fetch).

## 5. Owner authentication (two paths)

- `POST /owner/auth/login { email, password, totp? }` — the OWNER user (`schoolId: null`, `role: OWNER`).
  **MFA is optional**: a supplied TOTP must verify (±1 step window), but omitting it is accepted.
- `POST /owner/auth/gate { password }` — a single shared console password (`OWNER_GATE_PASSWORD`),
  constant-time compared. **Returns 503 when the env var is unset**, so the gate is off by default.

Both issue identical platform tokens. Owner refresh uses a simpler rotation (revoke + reissue) than the
school path.

## 6. Impersonation (owner → school admin)

`POST /owner/schools/:id/impersonate` mints a 15-min single-use token and returns a URL on the
**school's own host from the DB** (primary LIVE domain, else `<slug>.<PLATFORM_HOST>`) — never from
request headers. The school host exchanges it via `POST /auth/impersonate`.

Designed properties:
- Token is **burned before** the session is issued, so a raced second exchange loses.
- Targets the **oldest active `SCHOOL_ADMIN`**; 409 if the school has none.
- **No refresh token is issued** — the session hard-ends at access-token expiry (15 min).
- The JWT carries `imp: true` so the UI can show an "Owner view" banner.
- Logged at `warn` level on both mint and exchange.

## 7. Row-Level Security — what is and isn't covered

`withTenant(schoolId, tx)` runs statements under an RLS-bound connection. `getPlatformPrisma()` bypasses
RLS and is used for cross-tenant work (auth lookups before tenant scope, the reminder cron, push-token
reassignment, owner console, blog).

**RLS enabled:** `School`, `Domain`, `FeatureOverride`, `User`, `RefreshToken`, `AuditLog`,
`SchoolProfile`, `HomepageContent`, `StatItem`, `SocialLink`, `MenuItem`, `MediaAsset`, `FeaturedStaff`,
`AcademicYear`, `Grade`, `ClassSection`, `Subject`, `Teacher`, `TeacherSubject`, `Student`, `Period`,
`TimetableSlot`, `Enquiry`, `Announcement`, `Event`, `Holiday`, `PushToken`, `Result`.

**No RLS — explicit `schoolId` filters are load-bearing:** `Attendance`, `Exam`, `Substitution`, `Staff`,
`StaffAttendance`, `LeaveApplication`, `ClassNote`, `ClassTodo`, `RegisterChangeRequest`, `Course`,
`CourseFee`, `AdmissionStep`, `AdmissionsSettings`, `HallOfFameEntry`, `BlogPost`,
`SchoolBlogSelection`, `PasswordResetToken`, `ImpersonationToken`, `MarketingLead`, `MarketingConfig`.

The pattern the code uses to close this gap: **validate ids against an RLS-protected parent first.**
E.g. attendance marks are checked against `tx.student.findMany({ classSectionId })` — a foreign-school
studentId cannot appear in that result set at all.

## 8. Feature resolution

`resolveFeatures(tier, overrides)` = tier's set, then each override adds or removes a key. Unknown keys
in overrides are ignored. Cached in Redis under `feat:<schoolId>` for **300s**; `invalidate()` is called
on tier/feature/school changes. Redis being down falls through to the DB silently.

**QA implication:** after an owner changes a tier or toggles a feature, expect up to a 5-minute lag on
any node that already cached it — unless the owner action invalidated it. Test both immediately and
after 5 minutes.

## 9. Accounts, invites and passwords

- `POST /manage/{students|teachers|staff}/:id/login` — admin creates a login. Requires an email.
  Creates the `User` with a **long random placeholder hash nobody is ever shown** (the account exists but
  is unusable), links it to the person row, then emails a 30-min set-password link pointing at
  `/reset-password?token=…` on the school's own host.
- `POST .../invite/resend` — mints a fresh token and re-sends.
- Mail failure is **best-effort**: the account and token still exist, the response reports
  `emailSent: false`, and the admin can resend. This is deliberate, not a swallowed error.
- Students already holding a login → 409 `Student already has a login`.
- `POST /auth/change-password` (self-serve, requires session), `POST /auth/forgot-password`,
  `POST /auth/reset-password`, `POST /auth/accept-invite`.
- Owner can list a school's admins and force-reset their password:
  `GET|POST /owner/schools/:id/admins[/:userId/reset-password]`.

## 10. School lifecycle

`SETUP` → `LIVE` → `SUSPENDED` → (deleted).

- A `SETUP` school **resolves** (its admin can log in and build the site) but its public site **404s**.
- Only `LIVE` serves the public site.
- **Deletion requires `SUSPENDED` first** (409 otherwise) — a deliberate two-step. Deletion cascades DB
  rows from `School`, removes uploaded files best-effort, and invalidates the feature cache. The
  tenant-lookup cache expires on its own TTL.

School creation (`POST /owner/schools`) seeds: the school, a PENDING primary CUSTOM domain, a
`SCHOOL_ADMIN` user with a returned temp password, a `SchoolProfile`, a `HomepageContent`
("Welcome to <name>"), default grades (Nursery, Grade 1–3) and default courses.

## 11. Audit

`AuditInterceptor` writes a generic `AuditLog` row for mutating requests. Two hand-written entries add
detail the generic row cannot carry:

- `ATTENDANCE_RETAKE` — fired only when a save **overwrote** existing rows; records previous vs current
  status counts and markers, because `save` deletes-and-recreates and leaves no other trace.
- `REGISTER_CHANGE_APPROVED` / `REGISTER_CHANGE_REJECTED` — records class, date and `expiresAt`.
