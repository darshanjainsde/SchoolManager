import { realpathSync, rmSync, cpSync, lstatSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// nft cannot trace pnpm symlinks that resolve outside rootDirectory (apps/api).
// Replace those symlinks with real copies so nft finds and bundles them correctly.
// Packages listed here are excluded from ncc bundling (--external) so nft handles them.

const packages = [
  'argon2',
  '@prisma/client',
];

for (const pkg of packages) {
  const link = `apps/api/node_modules/${pkg}`;
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink()) { console.log(`deref skip (not symlink): ${link}`); continue; }
    const real = realpathSync(link);
    rmSync(link, { recursive: true, force: true });
    cpSync(real, link, { recursive: true });
    console.log(`deref: ${link} → ${real}`);
  } catch (e) {
    console.log(`deref skipped (${pkg}): ${e.message}`);
  }
}

// Copy the Prisma query engine binary to apps/api/ (the rootDirectory).
// At runtime in the Vercel Lambda the rootDirectory maps to /var/task/apps/api/,
// which is one of the directories Prisma searches for the query engine.
const BINARY = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const engineTarget = `apps/api/${BINARY}`;

try {
  const realPrismaPkg = realpathSync('apps/api/node_modules/@prisma/client');
  const dotPrismaDir = resolve(realPrismaPkg, '../../.prisma/client');
  const engineSrc = join(dotPrismaDir, BINARY);

  if (existsSync(engineSrc)) {
    if (existsSync(engineTarget)) rmSync(engineTarget, { force: true });
    cpSync(engineSrc, engineTarget);
    console.log(`prisma-engine: copied ${BINARY} to apps/api/`);
  } else {
    console.log(`prisma-engine: ${engineSrc} not found — skipping`);
  }
} catch (e) {
  console.log(`prisma-engine: ${e.message}`);
}
