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

    if (opts.allowBypass) {
      log(`${message} (allowed: not production)`);
      return;
    }
    throw new Error(message);
  };
}
