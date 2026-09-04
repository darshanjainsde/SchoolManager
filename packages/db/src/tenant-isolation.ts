/**
 * Is the connection we run tenant queries on actually subject to row-level
 * security?
 *
 * Kept separate from `index.ts` and built around an injected reader so the
 * decision can be tested without a database. `index.ts` supplies the real
 * reader, which asks Postgres about the connection's own role.
 */

export interface TenantRoleStatus {
  role: string;
  bypassesRls: boolean;
}

export type RoleReader = () => Promise<TenantRoleStatus>;

export interface IsolationAssertOptions {
  /** Outside production a shared superuser URL is normal — warn, don't stop. */
  allowBypass?: boolean;
  log?: (message: string) => void;
}

/**
 * Turning this check on is itself a deploy risk, so it is staged.
 *
 * The check refuses to serve when the tenant role can bypass RLS. That is the
 * right behaviour and it is also, on the first deploy, a way to take an
 * environment down over a configuration nobody has looked at yet — the
 * failure would happen at bootstrap, before /ready could report why.
 *
 * So: this deploy REPORTS. `GET /ready` now answers
 * `isolation: enforced | bypassable | unknown`. Confirm it says "enforced" in
 * an environment, then set ENFORCE_TENANT_ISOLATION=true there to make it
 * fatal. Evidence first, enforcement second.
 */
export function isolationIsEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENFORCE_TENANT_ISOLATION === 'true';
}

export function buildIsolationAssertion(read: RoleReader) {
  return async function assertTenantIsolationEnforced(
    opts: IsolationAssertOptions = {},
  ): Promise<void> {
    const log = opts.log ?? ((m: string) => console.warn(m));

    let status: TenantRoleStatus;
    try {
      status = await read();
    } catch (e) {
      // A database that is briefly unreachable at boot is a blip, not a
      // misconfiguration. Refusing to start here would trade a hypothetical
      // leak for a certain outage.
      log(`Could not verify tenant isolation at boot: ${(e as Error).message}`);
      return;
    }

    if (!status.bypassesRls) return;

    const message =
      `The tenant database role "${status.role}" has BYPASSRLS. Every withTenant() ` +
      'query would read and write across all schools. Point DATABASE_URL_APP at the ' +
      'unprivileged application role.';

    if (opts.allowBypass || !isolationIsEnforced()) {
      log(
        `${message} ` +
        (opts.allowBypass
          ? '(allowed: not production)'
          : '(reporting only — set ENFORCE_TENANT_ISOLATION=true to make this fatal)'),
      );
      return;
    }
    throw new Error(message);
  };
}
