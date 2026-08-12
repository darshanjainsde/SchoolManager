#!/usr/bin/env node
/**
 * Copies the Prisma query engine next to the ncc bundle.
 *
 * ncc inlines JavaScript. It cannot inline a native `.node` binary, so the
 * bundle ships without the query engine and every database call fails at
 * RUNTIME with:
 *
 *   Prisma Client could not locate the Query Engine for runtime
 *   "rhel-openssl-3.0.x"
 *
 * Nothing local catches this. `binaryTargets` already lists the Linux target,
 * the engine is generated, the bundle builds clean, and the preflight passes —
 * because on this machine Prisma finds the darwin engine in the package's own
 * generated/client. It only breaks once the bundle is somewhere that directory
 * is not, which is exactly Vercel. The first deploy 500'd on every route.
 *
 * The engine is copied rather than symlinked because the deployment artifact is
 * a tarball of this directory; a symlink to ../../packages/... resolves to
 * nothing inside /var/task.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const generated = join(here, '../../../packages/library-db/generated/client');
const outDir = join(here, '../api');

if (!existsSync(generated)) {
  console.error(`✗ prisma engine: ${generated} does not exist — run \`prisma generate\` first.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// ONLY the Linux engine. Each engine is ~15-16MB, and a darwin binary is dead
// weight inside a Linux function — the first cut of this copied both and put
// 16MB of unusable Mach-O into every deployment.
const LINUX = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const engines = readdirSync(generated).filter((f) => f === LINUX);

// Its absence is a broken deploy, so fail the build here rather than at the
// first request in production.
if (!engines.includes(LINUX)) {
  console.error(
    `✗ prisma engine: ${LINUX} was not generated.\n` +
      `  Add "rhel-openssl-3.0.x" to binaryTargets in packages/library-db/prisma/schema.prisma.\n` +
      `  Found: ${engines.join(', ') || '(none)'}`,
  );
  process.exit(1);
}

for (const engine of engines) {
  copyFileSync(join(generated, engine), join(outDir, engine));
}

// Prisma also reads the schema at client init to resolve the datamodel.
copyFileSync(join(here, '../../../packages/library-db/prisma/schema.prisma'), join(outDir, 'schema.prisma'));

console.log(`✓ prisma engine: copied ${engines.length} engine(s) + schema.prisma into api/`);
