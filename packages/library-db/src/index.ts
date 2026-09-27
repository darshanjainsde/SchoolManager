import { Prisma, PrismaClient } from '../generated/client';

export type LibraryTx = Prisma.TransactionClient;

/**
 * Two clients, mirroring the Sckools split:
 *   library_app      — non-superuser, RLS-bound. Every request path.
 *   library_platform — BYPASSRLS. Login, host lookup, org console, crons only,
 *                      each re-scoping by orgId in code.
 * Migrations run as the superuser via LIBRARY_DIRECT_URL.
 */
let tenantClient: PrismaClient | undefined;
let platformClient: PrismaClient | undefined;

function makeClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export function getLibraryTenantPrisma(): PrismaClient {
  if (!tenantClient) {
    const url = process.env.LIBRARY_DATABASE_URL_APP ?? process.env.LIBRARY_DATABASE_URL;
    if (!url) throw new Error('LIBRARY_DATABASE_URL_APP (or LIBRARY_DATABASE_URL) must be set');
    tenantClient = makeClient(url);
  }
  return tenantClient;
}

export function getLibraryPlatformPrisma(): PrismaClient {
  if (!platformClient) {
    const url = process.env.LIBRARY_DATABASE_URL_PLATFORM ?? process.env.LIBRARY_DATABASE_URL;
    if (!url) throw new Error('LIBRARY_DATABASE_URL_PLATFORM (or LIBRARY_DATABASE_URL) must be set');
    platformClient = makeClient(url);
  }
  return platformClient;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Run `fn` inside a transaction with `SET LOCAL app.current_org` set, so RLS
 * policies grant access to exactly that org's rows.
 *
 * SET LOCAL is transaction-scoped, which is why the transaction wrapper is
 * mandatory rather than stylistic: pgbouncer reuses server connections between
 * clients, and a session-scoped SET would leak the previous tenant's id.
 *
 * `orgId` is untrusted input. It is UUID-checked AND bound as a parameter —
 * the check is defence in depth, not the only guard. `packages/db` has always
 * done both; this file interpolated the id straight into the statement and
 * leaned on the regex alone, which is one careless refactor away from SQL
 * injection AT THE TENANCY BOUNDARY.
 */
export interface WithOrgOptions {
  /** Forwarded to `$transaction`'s interactive-transaction options. Prisma 5
   *  defaults `timeout` to 5000ms and `maxWait` to 2000ms — fine for the
   *  handful of round trips most call sites make, but nowhere near enough
   *  for a call site that does many sequential writes in one transaction
   *  (e.g. a bulk import). Pass an explicit `timeout` there so the failure
   *  mode, if the budget is still exceeded, is a clear Prisma error instead
   *  of a silent 5s cutoff. */
  maxWait?: number;
  timeout?: number;
}

export async function withOrg<T>(
  orgId: string,
  fn: (tx: LibraryTx) => Promise<T>,
  client: PrismaClient = getLibraryTenantPrisma(),
  options?: WithOrgOptions,
): Promise<T> {
  if (!UUID_RE.test(orgId)) throw new Error('withOrg: orgId must be a UUID');
  return client.$transaction(async (tx) => {
    // `set_config(..., TRUE)` is SET LOCAL by another name, and it takes the
    // value as a bound parameter instead of splicing it into the SQL.
    await tx.$executeRaw`SELECT set_config('app.current_org', ${orgId}, TRUE)`;
    return fn(tx);
  }, options);
}

export async function disconnectLibrary(): Promise<void> {
  await Promise.all([tenantClient?.$disconnect(), platformClient?.$disconnect()]);
  tenantClient = undefined;
  platformClient = undefined;
}

export { PrismaClient, Prisma } from '../generated/client';
export * from '../generated/client';
