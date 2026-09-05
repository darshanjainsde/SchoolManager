import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * `getPlatformPrisma()` may only be imported by files on this list.
 *
 * THE CONTROL THIS PROTECTS. `withTenant()` connects as `skoolos_app`, a role
 * with no BYPASSRLS, so every query it makes is bound by row-level security:
 * if a `where schoolId` is forgotten, the database still returns nothing from
 * another school. `getPlatformPrisma()` connects as `skoolos_platform`, which
 * holds BYPASSRLS. Inside that client there is no safety net at all — a missed
 * filter reads or writes every school's rows, and nothing below the
 * application layer will notice.
 *
 * WHY A LIST RATHER THAN A COUNT. A schema audit counted 79 call sites across
 * 35 files and could not say whether that number was getting better or worse,
 * because nothing recorded which ones were meant to be there. Reading them
 * one by one showed every current site is genuinely cross-tenant and says so
 * in a comment — the problem was never the existing 79, it was that the
 * eightieth would arrive as an ordinary-looking import and no reviewer would
 * have a reason to stop at it.
 *
 * So this test does not try to judge whether a bypass is correct; a test
 * cannot. It makes adding one a DELIBERATE act: a new file using the platform
 * client fails this spec until someone adds it here with a reason, which is
 * the moment a reviewer gets to ask "does this really need to escape RLS?".
 *
 * ADDING A FILE. Prefer not to. Ask first whether the work can run inside
 * `withTenant(schoolId, ...)` — most tenant-scoped reads can. If it genuinely
 * spans schools (a cron with no JWT, resolving a tenant before one is known,
 * the owner console), add the path below with a one-line reason, and make sure
 * the call site itself explains how it stays scoped without RLS.
 */
const ALLOWED: Record<string, string> = {
  // ── Tenant resolution: runs BEFORE a tenant is known ──────────────────────
  'modules/tenancy/internal/school-lookup.service.ts':
    'resolves host -> school; by definition has no tenant yet',
  'modules/auth/internal/school-resolve.service.ts':
    'same, on the login path',
  'modules/features/internal/feature-resolver.service.ts':
    'reads a school tier to decide feature gates, before tenant scoping',

  // ── Auth and credentials: cross-cutting identity state ────────────────────
  'modules/auth/internal/auth.service.ts': 'users/sessions are platform-wide identities',
  'modules/auth/internal/password-reset.service.ts': 'reset tokens are keyed by user, not school',
  'modules/auth/internal/accept-invite.controller.ts': 'invite acceptance precedes tenant context',
  'modules/admin-credentials/internal/account.service.ts': 'operator credential management',
  'modules/admin-credentials/internal/admin-credentials.service.ts': 'operator credential management',
  'modules/management/internal/login-invite.service.ts': 'creates the User row a login will use',

  // ── Owner/platform console: cross-tenant BY PURPOSE ───────────────────────
  'modules/owner/internal/owner-auth.service.ts': 'operator console',
  'modules/owner/internal/owner-schools.service.ts': 'operator console',
  'modules/owner/internal/owner-overview.service.ts': 'operator console',
  'modules/owner/internal/owner-domains.service.ts': 'operator console',
  'modules/owner/internal/owner-events.service.ts': 'operator console',
  'modules/owner/internal/impersonation.service.ts': 'operator console',
  'modules/press/operator-orders.service.ts':
    'the print-order desk at sckools.com/sv/orders — cross-tenant BY PURPOSE (every school\'s orders on one queue), behind OwnerHostGuard + platform JWT; writes touch one order by id and its events only',
  'common/metrics/metrics.service.ts':
    'writes MetricRollup — platform-wide request counts and latency histograms. The table has no schoolId and holds no tenant row content, only route names and numbers',
  'modules/owner/internal/ops.service.ts':
    'platform-wide health: outbox depth and DLQ across every tenant. Counts only — it reads no tenant row content',

  // ── Public, non-tenant surfaces on sckools.com ────────────────────────────
  'modules/directory/directory.service.ts': 'public directory of LIVE schools; cross-tenant by design',
  'modules/community/events.service.ts':
    'the event audience picker — you cannot invite a school you cannot see. Returns LIVE schools and only the public identity (name, city) the directory already publishes',
  'modules/marketing/marketing.service.ts': 'marketing leads belong to the platform, not a school',
  'modules/blog/internal/blog-public.service.ts': 'shared editorial library',
  'modules/blog/internal/blog-cms.service.ts': 'shared editorial library',
  'modules/blog/internal/blog-owner.service.ts': 'shared editorial library',
  'modules/blog/internal/blog-marketing.service.ts': 'shared editorial library',
  'modules/hiring/internal/jobs.service.ts':
    'public job board + stranger applications; schoolId is read from the vacancy row, never from the request',

  // ── Crons: no JWT, and the rows span every school ─────────────────────────
  'modules/management/exam-reminders.service.ts': 'daily cron across all schools',
  'modules/management/notification-outbox.service.ts': 'outbox drain across all schools',
  'modules/library/internal/library-due-soon.service.ts': 'daily cron across all schools',

  // ── Delivery: dispatched post-commit, outside any tenant transaction ──────
  'common/mail/mail.service.ts': 'mail is sent after the tenant transaction commits',
  'common/mail/mail-identity.service.ts': 'resolves brand/sender for a schoolId outside a transaction',
  'common/notifications/notification.module.ts': 'wiring for the above',
  'common/notifications/push.channel.ts': 'push tokens are per-DEVICE identities, not per-tenant',
  'common/notifications/recipients.ts': 'resolves recipients for cron-dispatched rows',

  // ── Individually reasoned exceptions ──────────────────────────────────────
  'common/audit/audit.service.ts':
    'the audit log must record attempts that a tenant scope would hide',
  'health/health.controller.ts': 'liveness probe; touches no tenant data',
  'modules/cms/internal/site-purge.interceptor.ts':
    'reads one school\'s slug and its LIVE domain hostnames to purge that school\'s cached pages. Routing metadata, not tenant row content, and it runs fire-and-forget after the request\'s tenant transaction has already committed — so there is no tenant transaction left to scope it to',
  'configure-app.ts':
    'the CORS allow-list reads Domain.hostname for LIVE domains, so a school on its own address is not refused by the browser. Runs before any request context exists, so there is no tenant to scope to; reads two columns of platform routing metadata and no tenant row content',
  'modules/management/teachers.service.ts':
    'the one-school-per-teacher rule is cross-tenant by nature, and login shutdown revokes platform-wide auth state',
  'modules/management/email-settings.service.ts':
    'writes the sender credential the post-commit mail path reads through the platform client',
  'modules/portal/portal.service.ts':
    'reassigns a push-device token that previously registered under a different school (see the comment there)',
};

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    if (!full.endsWith('.ts') || full.endsWith('.spec.ts')) return [];
    return [full];
  });
}

/** Paths are compared with forward slashes so the list reads the same on any OS. */
function posix(p: string): string {
  return p.split(sep).join('/');
}

describe('getPlatformPrisma (BYPASSRLS) usage', () => {
  const users = walk(SRC)
    .filter((f) => readFileSync(f, 'utf8').includes('getPlatformPrisma'))
    .map((f) => posix(relative(SRC, f)))
    .sort();

  it('is confined to the reviewed allow-list', () => {
    const unlisted = users.filter((f) => !(f in ALLOWED));
    expect(unlisted).toEqual([]);
  });

  /**
   * The other direction: an entry left behind after its file stopped using the
   * platform client is a stale exemption, and stale exemptions are how a list
   * like this quietly stops meaning anything.
   */
  it('has no stale entries', () => {
    const stale = Object.keys(ALLOWED).filter((f) => !users.includes(f));
    expect(stale).toEqual([]);
  });
});
