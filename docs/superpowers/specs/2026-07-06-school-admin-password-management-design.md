# School Admin Password Management — Design Spec

**Date:** 2026-07-06
**Status:** Approved for planning
**Owner request:** Reset a school admin's password from the owner portal (shown once), and let the school admin set their own password afterward. Build it **standalone** so it does not touch working login/owner features and can be swapped for email-based flows in the future.

## Goal

Give the platform owner a way to reset a school admin's password from the owner portal (new password displayed once), and give the school admin a self-service way to change their own password while logged in. Ship it as an isolated module that adds no database migration and does not modify existing authentication or owner code.

## Scope

**In:**
- Owner portal "Admin access" card on the school detail page: view each school admin's login email + status; "Reset password" → new random password shown once.
- School admin self-service "Change password" (current + new) while logged into the admin portal.

**Out (deferred, future work):**
- Email-based self-service "Forgot password" / reset link.
- Email verification of the admin's address.
- Owner impersonation / one-click "Open admin" (dropped for security; see Security section).
- Change admin email; add/disable multiple admins.
- Force-change-on-first-login (Option B) — explicitly deferred; the standalone boundary keeps switching to it cheap later.

## Design Principles (isolation / swappability)

1. **New, self-contained module.** All new API code lives in a single module folder `apps/api/src/modules/admin-credentials/`. It depends only on already-exported pieces (`PasswordService`, `TenantContextService`, the JWT guards) and the existing `User` / `RefreshToken` tables. It never edits `auth.service.ts`, the login flow, or `owner-schools.service.ts`.
2. **No schema/migration change.** Reuses existing tables and `PasswordService` (bcrypt).
3. **Minimal additive touches to existing files** (the only edits outside the new module):
   - Register `AdminCredentialsModule` in `apps/api/src/app.module.ts`.
   - Render one new `<AdminAccessCard>` on `apps/web/app/platform/schools/[id]/page.tsx`.
   - Add one link to the new change-password page from `apps/web/app/me/profile/page.tsx`.
4. **Swap-in-future:** replacing this feature (e.g. with email flows) means deleting the module folder plus these three mount points — no risk to working features.

## Components

### API — new module `admin-credentials`

**1. `AdminCredentialsController` (owner side)** — `@Controller('owner')`, guarded by `OwnerHostGuard, PlatformJwtGuard` (owner host + platform JWT only). Backed by `AdminCredentialsService`, which uses `getPlatformPrisma()` (BYPASSRLS).

- `GET /owner/schools/:id/admins`
  Returns `{ userId, email, isActive, lastLoginAt, lockedUntil }[]` for users where `schoolId = :id AND role = 'SCHOOL_ADMIN'`.

- `POST /owner/schools/:id/admins/:userId/reset-password`
  1. Load user with strict scope `where { id: userId, schoolId: id, role: 'SCHOOL_ADMIN' }` → **404 if no match** (IDOR guard — see Security).
  2. Generate a new random password: `randomBytes(12).toString('base64url')`.
  3. `PasswordService.hash()` it; update `passwordHash`; clear `failedLoginAttempts` and `lockedUntil` (unlocks the account).
  4. Revoke all of that user's refresh tokens (`refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })` via the platform client) — kills lingering sessions.
  5. Return `{ password }` (plaintext, shown once; only the hash is persisted).

**2. `AccountController` (admin side)** — `@Controller('auth')`, guarded by `SchoolJwtGuard`. Backed by `AccountService`.

- `POST /auth/change-password { currentPassword, newPassword }` (`newPassword` min length 8, must differ from current):
  1. Load the logged-in user by `CurrentUser().sub`, scoped to the request tenant (`schoolId` from `TenantContextService`).
  2. `PasswordService.verify(currentPassword)` → **401 if wrong**.
  3. Hash `newPassword`; update `passwordHash`.
  4. Revoke **all** of the user's refresh tokens (including the current session).
  5. Return `{ ok: true }`.
  Rate-limited with an explicit `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on top of the global throttler.

### Web

- **`AdminAccessCard`** (new component) rendered on `/platform/schools/[id]`:
  - Fetches `GET /owner/schools/:id/admins`; lists each admin's email, an active/locked status badge, and last login.
  - "Reset password" button → confirm dialog → `POST …/reset-password` → shows the returned password once in a copy-to-clipboard box with a "shown once — copy it now" warning; the value is cleared on dismiss/refresh.

- **`/account/password`** (new page) — the school admin's "Change password" form (current + new + confirm). On success: toast "Password changed — please sign in again", clear the auth store, and redirect to `/login` (because step 4 revoked the current session). A one-line link to this page is added on `/me/profile`.

### Audit / logging

No database table (kept out of scope to preserve the no-migration constraint). Both mutating endpoints emit one structured server log line via the existing pino logger — reset: `{ actor: ownerId, schoolId, targetUserId, action: 'admin.password.reset' }`; change: `{ actor: userId, schoolId, action: 'admin.password.change' }`. A persistent audit table is noted as future work (recommended given this is minors' data under India's DPDP Act).

## Security

- **IDOR guard (the critical rule).** Owner endpoints run on the BYPASSRLS platform role, so there is no row-level-security safety net. Every user lookup is strictly scoped `where { id: userId, schoolId: id, role: 'SCHOOL_ADMIN' }` and 404s on mismatch — this prevents a malformed or hostile `:userId` from resetting any other account (another school's admin, a student, or an OWNER).
- **Change-password requires the current password**, so a stolen access token alone cannot silently rotate the password without also knowing the current one.
- **Session revocation** on both reset and change kills stale refresh-token families (30-day TTL) so an old/leaked session cannot outlive the credential change.
- **One-time password** is returned over TLS and shown once; pino does not log response bodies, so it is not written to logs.
- **Impersonation dropped:** the earlier "one-click Open admin" idea is intentionally excluded — it converted a 60-second link into a 30-day, unmarked admin session and is not needed for the password-reset goal.

## Testing

Unit tests on the security-critical seams:
- Reset with a `:userId` that belongs to another school (or is an OWNER) returns 404 and changes nothing.
- Reset produces a different `passwordHash` and revokes the user's refresh tokens.
- Change-password with a wrong current password returns 401 and changes nothing.
- Change-password with the correct current password updates the hash and revokes sessions.

## Future Work (enabled by the standalone boundary)

- Email-based self-service "Forgot password" / reset link.
- Email verification of the admin address.
- Force-change-on-first-login (`mustChangePassword` flag).
- Persistent audit table for credential events.
- Owner impersonation (only if revisited with short-lived, marked, access-only sessions).
