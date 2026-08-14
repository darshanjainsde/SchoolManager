/**
 * Two rules:
 *   1. Library modules talk to each other only through their index.ts.
 *   2. The library imports NOTHING from Sckools — that coupling is what the
 *      whole separate-service design exists to prevent.
 *
 * Scope note: `apps/library-api/src/common/` (guards, idempotency
 * interceptor, throttler storage) and `apps/library-api/src/{config,health}`
 * are shared infrastructure, not a "module" in the `src/modules/<name>/`
 * sense — rule 1's `from`/`to` patterns are anchored to
 * `apps/library-api/src/modules/` specifically so importing from `common/`
 * (or `config/`, `health/`) is never accidentally forbidden. Verified by
 * running this rule against the real tree (see Task 12 report).
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internal-import',
      severity: 'error',
      comment:
        'Modules may only import each other through their public interface (the module folder index.ts). Reaching into another module is forbidden — it would block extracting that module into its own service later.',
      from: { path: '^apps/library-api/src/modules/([^/]+)/' },
      to: {
        path: '^apps/library-api/src/modules/([^/]+)/(?!index\\.ts$).+',
        pathNot: '^apps/library-api/src/modules/$1/',
      },
    },
    {
      name: 'no-sckools-imports',
      severity: 'error',
      comment:
        'The library service must never import Sckools code. Merging later is a routing change; a shared import makes it a rewrite.',
      // `apps/library-web` included: the console is as much "the library" as
      // the API is, and it sits beside apps/web in the same monorepo with the
      // same `@/` alias habits, so a stray `@skoolos/types` import there is if
      // anything MORE likely than in the API — and it was previously
      // unscanned, so nothing would have said so (trap 9).
      // `packages/library-core` included from the day it existed: it is the
      // one package BOTH services import (that is its whole purpose), so a
      // Sckools import landing here would be laundered straight into the
      // library through a dependency the library is required to have. The
      // package that is shared is the package that needs this rule most.
      from: { path: '^(apps/library-api|apps/library-web|packages/(library-db|library-core))/' },
      to: { path: '^(apps/api|apps/web|packages/(db|config|types))/|^@skoolos/' },
    },
  ],
  options: {
    // Scan targets are the directory roots (`apps/library-api`,
    // `packages/library-db`), not `.../src` — that used to leave
    // `apps/library-api/server.ts` (the file ncc bundles, i.e. what actually
    // runs in production) and `packages/library-db/prisma/seed.ts` unscanned,
    // so `no-sckools-imports` never covered them. Excluding these paths keeps
    // the wider scan from following generated/build output that was never the
    // point: `generated` (the Prisma client, regenerated per-checkout, never
    // hand-written), `dist` (tsc output), and `api` (the ncc bundle output).
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|generated|dist|api)(/|$)' },
    tsPreCompilationDeps: true,
  },
};
