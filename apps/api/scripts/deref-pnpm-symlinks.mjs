import { realpathSync, rmSync, cpSync, lstatSync } from 'fs';

// nft cannot trace pnpm symlinks that resolve outside rootDirectory (apps/api).
// Replace those symlinks with real copies so nft finds and bundles them correctly.
// Packages listed here are excluded from ncc bundling (--external) so nft handles them.

const packages = [
  'argon2',
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
