/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Android 16 + targetSdk 36 stops calling onBackPressed(); React Native 0.79
 * has no other back path, so without the manifest opt-out every back press
 * closes the app. Two things must stay true until the RN upgrade that makes
 * this plugin unnecessary — see plugins/with-legacy-back.js.
 */
const root = join(__dirname, '..', '..');

it('the legacy-back plugin is in the app config', () => {
  const cfg = readFileSync(join(root, 'app.config.ts'), 'utf8');
  expect(cfg).toMatch(/['"]\.\/plugins\/with-legacy-back['"]/);
});

it('the plugin writes android:enableOnBackInvokedCallback="false" onto <application>', () => {
  const { setLegacyBackDispatch } = require('../../plugins/with-legacy-back.js') as {
    setLegacyBackDispatch: (m: { manifest: { application: { $: Record<string, string> }[] } }) => {
      manifest: { application: { $: Record<string, string> }[] };
    };
  };
  const out = setLegacyBackDispatch({ manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } });
  expect(out.manifest.application[0].$).toEqual({
    'android:name': '.MainApplication',
    'android:enableOnBackInvokedCallback': 'false',
  });
});

// The reason the opt-out exists: the moment the installed React Native has
// its own OnBackInvoked handling, this test fails on purpose, so whoever
// upgrades removes the plugin rather than carrying it forever.
it('is still needed: the installed react-native has no OnBackInvoked support', () => {
  const rnDir = join(require.resolve('react-native/package.json'), '..', 'ReactAndroid', 'src', 'main', 'java', 'com', 'facebook', 'react');
  const activity = readFileSync(join(rnDir, 'ReactActivity.java'), 'utf8');
  expect(activity).toMatch(/public void onBackPressed\(\)/);
  expect(activity).not.toMatch(/OnBackInvoked/);
});
