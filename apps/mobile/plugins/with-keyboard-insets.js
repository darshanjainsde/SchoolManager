// THE KEYBOARD MUST NOT COVER WHAT IS BEING TYPED — the native half.
//
// Android used to make room for the keyboard itself: `adjustResize` shrank
// the window, every ScrollView shrank with it and Android scrolled the
// focused box into what was left. Edge-to-edge ends that: the window keeps
// its full height and the keyboard is drawn OVER the app. Android 16 forces
// edge-to-edge on apps that target API 36 (we do), and since 2026-10-08 the
// app is edge-to-edge on every version. Measured on an API 36 emulator with
// the vc24 bundle: tapping the login password box hid both boxes and the
// Log in button.
//
// It cannot be fixed in JavaScript on React Native 0.79. RN's Android
// keyboard events (`keyboardDidShow`) are raised from the root view's
// onGlobalLayout — and under edge-to-edge the keyboard causes no layout, so
// the event never fires (a JS frame that padded on it stayed at 0 on the
// emulator). See ReactRootView.CustomGlobalLayoutListener.
//
// So this does natively what adjustResize did: the activity's content view
// pads its bottom by the keyboard's inset. The React root lays out in the
// space that is really visible, ScrollViews keep the focused box on screen,
// and — because the padding IS a layout — RN's keyboard events fire again
// for the JS that listens to them (the tab bar stepping aside, the
// conversation pinning to its newest line). The insets are passed on
// unconsumed, so the system-bar insets every screen pads for are unchanged.
//
// With CNG there is no android/ directory to edit, so it is a config plugin.
const { withMainActivity } = require('expo/config-plugins');

const MARK = '// sckools:keyboard-insets';

const IMPORTS = [
  'import android.view.View',
  'import androidx.core.view.ViewCompat',
  'import androidx.core.view.WindowInsetsCompat',
];

const BODY = `
    ${MARK} — pad the content by the keyboard; see plugins/with-keyboard-insets.js
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      if (view.paddingBottom != keyboard) {
        view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, keyboard)
      }
      insets
    }`;

/** Pure: adds the listener after `super.onCreate(...)` in a Kotlin MainActivity. Idempotent. */
function addKeyboardInsets(src) {
  if (src.includes(MARK)) return src;
  const call = /^([ \t]*)super\.onCreate\([^)]*\)[ \t]*;?[ \t]*$/m;
  if (!call.test(src)) throw new Error('with-keyboard-insets: MainActivity has no super.onCreate(...) line');
  let out = src.replace(call, (line) => `${line}${BODY}`);
  const missing = IMPORTS.filter((i) => !new RegExp(`^${i.replace(/\./g, '\\.')}$`, 'm').test(out));
  if (missing.length) {
    out = out.replace(/^(package [^\n]+\n)/m, `$1\n${missing.join('\n')}\n`);
  }
  return out;
}

const withKeyboardInsets = (config) =>
  withMainActivity(config, (c) => {
    if (c.modResults.language !== 'kt') {
      throw new Error('with-keyboard-insets: expected a Kotlin MainActivity');
    }
    c.modResults.contents = addKeyboardInsets(c.modResults.contents);
    return c;
  });

module.exports = withKeyboardInsets;
module.exports.addKeyboardInsets = addKeyboardInsets;
