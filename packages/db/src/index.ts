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
  const base = new PrismaClient({
    ...opts,
    datasources: { db: { url: connectionUrl } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // One place catches truncation everywhere, rather than 150 call sites each
  // remembering to check. `$extends` returns a new client whose type is a
  // structural superset of PrismaClient, so the cast is safe and keeps the
  // public signature unchanged.
  return base.$extends({
    query: {
      $allModels: {
        async findMany({ args, query, model }) {
          const result = await query(args);
          const take = typeof args?.take === 'number' ? args.take : null;
          if (take !== null && Array.isArray(result) && result.length === take) {
            reportOverflow(model, take);
          }
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
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


/**
 * Optional observer for tenant-transaction duration.
 *
 * This is CONNECTION-HOLD TIME: how long a request pinned a pooled connection,
 * which is the variable that multiplies into pool exhaustion (Little's Law:
 * concurrent connections = throughput x hold). The API registers a recorder;
 * packages/db stays unaware of it, so nothing here depends on Nest or Redis.
 *
 * Never allowed to throw — an observer bug must not fail a tenant query.
 */
type TxObserver = (holdMs: number) => void;
let txObserver: TxObserver | null = null;

export function setTenantTxObserver(fn: TxObserver | null): void {
  txObserver = fn;
}


/**
 * Reports a list query that came back exactly full.
 *
 * A `findMany` returning precisely its `take` is the signature of a truncated
 * read: either the ceiling is doing its job on a query that should have been
 * scoped, or a real tenant has outgrown it. Both need to be visible. Silent
 * server-side truncation is the failure this whole guard exists to avoid — an
 * unbounded query at least fails loudly when it blows the response cap, while
 * a quietly clipped list looks correct and is not.
 *
 * Wired by the API to its logger and metrics; a no-op elsewhere, so packages/db
 * keeps no opinion about how it is reported.
 */
type ListOverflowObserver = (info: { model: string; take: number }) => void;
let overflowObserver: ListOverflowObserver | null = null;

export function setListOverflowObserver(fn: ListOverflowObserver | null): void {
  overflowObserver = fn;
}

/** Internal: called by the client extension below. Never throws. */
function reportOverflow(model: string, take: number): void {
  if (!overflowObserver) return;
  try {
    overflowObserver({ model, take });
  } catch {
    /* an observer must never fail the query it is watching */
  }
}

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  client: PrismaClient = getTenantPrisma(),
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('withTenant: tenantId must be a UUID');
  }
  const startedAt = Date.now();
  const observe = (): void => {
    if (!txObserver) return;
    try {
      txObserver(Date.now() - startedAt);
    } catch {
      /* an observer must never fail the query it is measuring */
    }
  };

  return client.$transaction(
    async (tx) => {
      // `set_config(..., TRUE)` is the LOCAL form: it lasts exactly as long as
      // this transaction, which is what makes RLS safe behind a transaction-mode
      // pooler. The id is bound as a parameter rather than spliced into the
      // statement — the UUID check above is defence in depth, not the only guard.
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
      return fn(tx);
    },
    {
      // Both were previously left at Prisma's defaults, and both have bitten us.
      //
      // `timeout` (default 5s) is how long the transaction may run. A batched
      // attendance read on a large tenant exceeded it and surfaced as an opaque
      // 500 — "Transaction already closed". 10s is a safety net, not a budget:
      // a hot read path that approaches it is a bug to fix, not a limit to raise.
      //
      // `maxWait` (default 2s) is how long a request queues for a pooled
      // connection. When the pool saturates this is what fails, and it should
      // fail rather than queue indefinitely — a request that has waited 3s for a
      // connection is already a bad response. Kept deliberately tight so pool
      // exhaustion stays loud instead of turning into creeping latency.
      timeout: 10_000,
      maxWait: 3_000,
    },
  ).then(
    (v) => { observe(); return v; },
    (e) => { observe(); throw e; },
  );
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
export * from './blog-blocks';
