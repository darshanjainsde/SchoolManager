import { realpathSync, rmSync, cpSync } from 'fs';
// @vercel/node's nft cannot bundle pnpm symlinks that resolve outside rootDirectory.
// Replace symlinks in apps/api/node_modules with real copies so nft finds them.
const pkg = 'reflect-metadata';
const link = `apps/api/node_modules/${pkg}`;
try {
  const real = realpathSync(link);
  rmSync(link, { recursive: true, force: true });
  cpSync(real, link, { recursive: true });
  console.log(`deref: ${link} → ${real}`);
} catch (e) {
  console.log(`deref skipped (${pkg}): ${e.message}`);
}
