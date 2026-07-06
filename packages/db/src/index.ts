import { Prisma, PrismaClient } from '@prisma/client';

export type TenantTx = Prisma.TransactionClient;

/**
 * Two distinct Prisma clients are used at runtime:
 *
 *   * `tenantPrisma`   — connects as `skoolos_app` (non-superuser, RLS-bound).
 *                        Every query MUST be wrapped via `withTenant(...)` so
 *                        Postgres knows which tenant the row-level-security
 *                        policy should grant access to.
 *
 *   * `platformPrisma` — connects as `skoolos_platform` (BYPASSRLS). Used
 *                        ONLY by platform-owner code paths that legitimately
 *                        cross tenants (e.g. onboarding wizard, owner portal).
 *
 * Migrations run as the superuser via `DATABASE_URL`. The two runtime URLs
 * (`DATABASE_URL_APP`, `DATABASE_URL_PLATFORM`) must be set in env.
 */

type ClientOptions = ConstructorParameters<typeof PrismaClient>[0];

let tenantClient: PrismaClient | undefined;
let platformClient: PrismaClient | undefined;

function makeClient(connectionUrl: string, opts: ClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...opts,
    datasources: { db: { url: connectionUrl } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export function getTenantPrisma(): PrismaClient {
  if (!tenantClient) {
    const url = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL_APP (or DATABASE_URL) must be set');
    tenantClient = makeClient(url);
  }
  return tenantClient;
}

export function getPlatformPrisma(): PrismaClient {
  if (!platformClient) {
    const url = process.env.DATABASE_URL_PLATFORM ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL_PLATFORM (or DATABASE_URL) must be set');
    platformClient = makeClient(url);
  }
  return platformClient;
}

/**
 * Run `fn` inside a Postgres transaction with `SET LOCAL app.current_tenant`
 * set so that RLS policies grant access to exactly that tenant's rows.
 *
 * `tenantId` is treated as untrusted input → enforced as a UUID before being
 * spliced into the SET LOCAL statement.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = getTenantPrisma(),
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('withTenant: tenantId must be a UUID');
  }
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);
    return fn(tx);
  });
}

/** Useful in tests and the seed: tear down + close. */
export async function disconnectAll(): Promise<void> {
  await Promise.all([tenantClient?.$disconnect(), platformClient?.$disconnect()]);
  tenantClient = undefined;
  platformClient = undefined;
}

export { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
export * from './features';
export * from './default-content';
