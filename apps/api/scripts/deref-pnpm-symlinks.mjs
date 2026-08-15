import { realpathSync, rmSync, cpSync, lstatSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';

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

// ── Prisma query engine ──────────────────────────────────────────────────────
//
// TWO Prisma clients run in this lambda and they find their engine in very
// different ways:
//
//   @skoolos/db   generates into node_modules/.prisma/client. `@prisma/client`
//                 is --external, so nft traces it and the engine ships beside
//                 the client. This has always worked.
//
//   @library/db   generates into packages/library-db/generated/client (a custom
//                 `output`). ncc BUNDLES that client's JavaScript into
//                 api/index.js — and ncc cannot bundle a .node binary. Nothing
//                 shipped the engine, so every /manage/library/* route answered
//                 500 with "Prisma Client could not locate the Query Engine for
//                 runtime rhel-openssl-3.0.x" while Sckools routes were fine.
//
// The two engines are interchangeable: both clients are Prisma 5.22.0 targeting
// rhel-openssl-3.0.x, and the query engine is schema-agnostic — the schema is
// handed to it at runtime. So ONE binary serves both, and we copy it into every
// directory the failing client actually searched.
//
// Those directories, read verbatim off the runtime log, are:
//
//   /var/task/generated/client
//   /var/task/.prisma/client
//   /var/task/apps/api
//   /vercel/path0/packages/library-db/generated/client   ← a BUILD path; gone at runtime
//
// The project root (apps/api) maps to /var/task, so the relative targets below
// land on the first three. We write all of them rather than betting on one:
// each is a file copy, and the alternative is another deploy round-trip to
// learn which single guess was right. `includeFiles` in vercel.json must list
// each one, or the copy is made at build time and then dropped from the bundle.
const BINARY = 'libquery_engine-rhel-openssl-3.0.x.so.node';
const engineTargets = [
  `apps/api/${BINARY}`,
  `apps/api/generated/client/${BINARY}`,
  `apps/api/.prisma/client/${BINARY}`,
  `apps/api/apps/api/${BINARY}`,
];

/** First path that exists, or null. */
function firstExisting(candidates) {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

try {
  // Prefer the library client's own engine — it is the client that could not
  // find one. Fall back to the Sckools copy; either binary works.
  const candidates = [`packages/library-db/generated/client/${BINARY}`];
  try {
    const realPrismaPkg = realpathSync('apps/api/node_modules/@prisma/client');
    candidates.push(join(resolve(realPrismaPkg, '../../.prisma/client'), BINARY));
  } catch {
    // @prisma/client not resolvable here; the library copy above is enough.
  }

  const engineSrc = firstExisting(candidates);
  if (!engineSrc) {
    // Loud, not silent. A missing engine is not a degraded build — it is every
    // library route returning 500, and that must not reach a deploy quietly.
    console.error(`prisma-engine: FAILED — no engine found. Looked in:\n  ${candidates.join('\n  ')}`);
    process.exit(1);
  }

  for (const target of engineTargets) {
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) rmSync(target, { force: true });
    cpSync(engineSrc, target);
  }
  console.log(`prisma-engine: copied ${BINARY} from ${engineSrc} to:\n  ${engineTargets.join('\n  ')}`);
} catch (e) {
  console.error(`prisma-engine: FAILED — ${e.message}`);
  process.exit(1);
}
