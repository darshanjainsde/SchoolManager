import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the EAS Android build failure fixed in commit 6cfd483.
 *
 * In this pnpm monorepo, pnpm's default *isolated* node_modules does not expose
 * `expo` / `expo-modules-autolinking` at the repo root. On EAS, Expo's Android
 * autolinking resolves from that root context, fails, and falls back to the
 * legacy `expo.core.ExpoModulesPackage` (removed in SDK 53) — the generated
 * PackageList.java then fails to compile with "cannot find symbol".
 *
 * The fix forces a hoisted (flat, npm-style) node_modules for EAS builds ONLY,
 * via NPM_CONFIG_NODE_LINKER=hoisted in each build profile's env — without
 * touching the repo root .npmrc the API's Vercel/nft build relies on. If this
 * env var is dropped from any build profile, EAS builds break again in a way
 * that NO local test / typecheck / lint reproduces. This test keeps it pinned.
 */

const EAS_JSON = path.join(__dirname, '..', '..', '..', 'eas.json');

describe('eas.json build profiles keep the hoisted node-linker (autolinking fix)', () => {
  const eas = JSON.parse(fs.readFileSync(EAS_JSON, 'utf8'));
  const profiles = Object.keys(eas.build ?? {});

  it('has at least the internal/preview/production build profiles', () => {
    expect(profiles).toEqual(expect.arrayContaining(['internal', 'preview', 'production']));
  });

  it.each(['internal', 'preview', 'production'])(
    'profile "%s" sets NPM_CONFIG_NODE_LINKER=hoisted',
    (name) => {
      const env = eas.build?.[name]?.env ?? {};
      expect(env.NPM_CONFIG_NODE_LINKER).toBe('hoisted');
    },
  );
});
