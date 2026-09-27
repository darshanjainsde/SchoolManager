// ANDROID BACK MUST WALK HOME, NOT SHUT THE APP — the manifest half.
//
// Android 16 changed the rule for apps that target API 36: the system stops
// calling `Activity.onBackPressed()` and stops dispatching KEYCODE_BACK, and
// expects the app to register an OnBackInvokedCallback instead. React Native
// 0.79 has only the old path (ReactActivity.onBackPressed → BackHandler →
// react-navigation pops). Measured 2026-09-27: zero references to
// OnBackInvoked anywhere in react-native@0.79.6's Android sources. So on an
// Android 16 handset the back gesture never reached JS, nothing popped, and
// the system default — finish the Activity — closed the app from the middle
// of taking a register. `back-behavior.test.ts` cannot see this: the fault is
// in the platform dispatch, not the route tree.
//
// Google's documented opt-out keeps the legacy dispatch. It is a manifest
// attribute, and with CNG there is no android/ directory to put it in, so it
// is a config plugin. Remove it only after moving to a React Native that
// registers OnBackInvokedCallback itself (0.81+ / Expo SDK 54+).
// https://developer.android.com/about/versions/16/behavior-changes-16
const { withAndroidManifest } = require('expo/config-plugins');

/** Pure: sets the attribute on <application>. Exported so a test can run it over a fixture. */
function setLegacyBackDispatch(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('with-legacy-back: AndroidManifest has no <application>');
  app.$ = { ...app.$, 'android:enableOnBackInvokedCallback': 'false' };
  return manifest;
}

const withLegacyBack = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults = setLegacyBackDispatch(c.modResults);
    return c;
  });

module.exports = withLegacyBack;
module.exports.setLegacyBackDispatch = setLegacyBackDispatch;
