import * as fs from 'fs';
import * as path from 'path';
import config from '../../app.config';

/**
 * THE KEYBOARD STANDARD, HELD BY A TEST.
 *
 * vc24 on Android 16: the keyboard covered the login form, every note, every
 * mark and every password box, because edge-to-edge (forced at targetSdk 36)
 * stops Android resizing the window for the keyboard. The fix is ONE native
 * pad (plugins/with-keyboard-insets.js) plus screens that scroll. These checks
 * keep each half of that true: a new screen with a box that cannot scroll, or
 * a second keyboard lift that fights the native pad, fails here with the file.
 */
const SRC = path.join(__dirname, '..');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) && !/ \d+\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = [...listFiles(path.join(SRC, 'app')), ...listFiles(path.join(SRC, 'components'))];
const rel = (f: string) => path.relative(SRC, f);
const read = (f: string) => fs.readFileSync(f, 'utf8');

// Anything a person types into: the RN primitive and every wrapper we ship.
const TYPES_INTO = /<(TextInput|TextField|MoneyField|SearchBox|NumberBox|Composer|ChangePasswordCard|ClassNotesPanel|LockedDayCard|StudentPicker|ConcernThread)\b/;
// What lets the focused box scroll into the space above the keyboard.
const SCROLLS = /<(Screen|ListScreen|ScrollView|FlatList|SectionList|AuthScaffold|Sheet)\b/;

describe('Android keyboard — app config', () => {
  it('is edge-to-edge on every Android version, so one build looks one way', () => {
    expect(config.android?.edgeToEdgeEnabled).toBe(true);
  });

  it('keeps adjustResize (the default): the content padding is what raises RN keyboard events', () => {
    expect((config.android as { softwareKeyboardLayoutMode?: string })?.softwareKeyboardLayoutMode ?? 'resize').toBe('resize');
  });
});

describe('Android keyboard — the native half (plugins/with-keyboard-insets.js)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { addKeyboardInsets } = require('../../plugins/with-keyboard-insets.js') as { addKeyboardInsets: (src: string) => string };
  const ACTIVITY = [
    'package com.sckools.app',
    '',
    'import android.os.Bundle',
    '',
    'class MainActivity : ReactActivity() {',
    '  override fun onCreate(savedInstanceState: Bundle?) {',
    '    setTheme(R.style.AppTheme);',
    '    super.onCreate(null)',
    '  }',
    '}',
  ].join('\n');

  it('is registered in the app config', () => {
    expect(read(path.join(SRC, '..', 'app.config.ts'))).toMatch(/['"]\.\/plugins\/with-keyboard-insets['"]/);
  });

  it('pads the content view by the keyboard inset, right after super.onCreate, insets passed on', () => {
    const out = addKeyboardInsets(ACTIVITY);
    const after = out.slice(out.indexOf('super.onCreate(null)'));
    expect(after).toMatch(/setOnApplyWindowInsetsListener\(content\)/);
    expect(after).toMatch(/WindowInsetsCompat\.Type\.ime\(\)\)\.bottom/);
    expect(after).toMatch(/view\.setPadding\(view\.paddingLeft, view\.paddingTop, view\.paddingRight, keyboard\)/);
    // Not consumed: Screen, ListScreen and the tab bar still read the bar insets.
    expect(after).toMatch(/\n\s*insets\n\s*\}/);
    for (const i of ['import android.view.View', 'import androidx.core.view.ViewCompat', 'import androidx.core.view.WindowInsetsCompat']) {
      expect(out).toContain(i);
    }
  });

  it('is idempotent and refuses an activity it cannot place itself in', () => {
    const once = addKeyboardInsets(ACTIVITY);
    expect(addKeyboardInsets(once)).toBe(once);
    expect(() => addKeyboardInsets('class MainActivity {}')).toThrow(/super\.onCreate/);
  });

  // Why it is native: RN raises keyboardDidShow only from the root view's
  // onGlobalLayout, and edge-to-edge gives the keyboard no layout. When an
  // installed React Native listens for insets itself, this fails on purpose
  // so whoever upgrades can reconsider the plugin.
  it('is still needed: the installed react-native finds the keyboard only on a layout pass', () => {
    const rnRoot = path.join(require.resolve('react-native/package.json'), '..', 'ReactAndroid', 'src', 'main', 'java', 'com', 'facebook', 'react');
    const rootView = fs.readFileSync(path.join(rnRoot, 'ReactRootView.java'), 'utf8');
    expect(rootView).toMatch(/public void onGlobalLayout\(\)[\s\S]{0,400}checkForKeyboardEvents\(\)/);
    expect(rootView).not.toMatch(/WindowInsetsAnimation/);
  });

  it('the shared tab bar steps aside while someone types', () => {
    const bar = read(path.join(SRC, 'components', 'PortalTabBar.tsx'));
    expect(bar).toMatch(/useKeyboardVisible\(\)/);
  });
});

describe('Android keyboard — no second lift fights the native pad', () => {
  // A KeyboardAvoidingView that acts on Android on top of the native pad
  // measures the keyboard a second time and squeezes its own content. Only Sheet may: a
  // Modal is its own window, outside the activity content.
  const MAY_LIFT_ON_ANDROID = new Set(['components/Sheet.tsx']);
  const withKav = files.filter((f) => /<KeyboardAvoidingView\b/.test(read(f)));

  it('finds the KeyboardAvoidingViews it is guarding', () => {
    expect(withKav.length).toBeGreaterThan(2);
  });

  it.each(withKav.map((f) => [rel(f), f] as const))('%s lifts on iOS only', (label, file) => {
    if (MAY_LIFT_ON_ANDROID.has(label)) return;
    const src = read(file);
    const behaviours = [...src.matchAll(/behavior=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(behaviours.length).toBeGreaterThan(0);
    for (const b of behaviours) {
      expect(b.replace(/\s+/g, ' ')).toMatch(/Platform\.OS === 'ios' \? '(padding|height|position)' : undefined/);
    }
  });
});

describe('Android keyboard — every screen with a box can scroll it into view', () => {
  const screens = listFiles(path.join(SRC, 'app')).filter((f) => !/_layout\.tsx$/.test(f) && TYPES_INTO.test(read(f)));

  it('finds the screens people type on', () => {
    expect(screens.length).toBeGreaterThan(15);
  });

  it.each(screens.map((f) => [rel(f), f] as const))('%s renders inside a scroll container', (_label, file) => {
    expect(read(file)).toMatch(SCROLLS);
  });
});

describe('Android keyboard — the containers that count as "scrolls" really do', () => {
  // The screen check above trusts these by name, so each must own a scroller.
  it.each([
    ['components/AuthScaffold.tsx', /<ScrollView\b/],
    ['components/Sheet.tsx', /<ScrollView\b/],
    ['components/ui.tsx', /<ScrollView\b[\s\S]*<FlatList\b|<FlatList\b[\s\S]*<ScrollView\b/],
  ])('%s', (file, scroller) => {
    expect(read(path.join(SRC, file))).toMatch(scroller);
  });
});

describe('Android edge-to-edge — nothing scrolls through the status bar', () => {
  // With edge-to-edge on every version the status bar is transparent. If the
  // top inset is padding INSIDE the scroller, rows scroll through the clock
  // (re-audit 2026-10-08: student Home, Results, Fines, Leave desk). The
  // inset belongs on the frame around the scroller.
  const ui = read(path.join(SRC, 'components', 'ui.tsx'));
  it('Screen and ListScreen never pad their scrolling content by insets.top', () => {
    const containers = [...ui.matchAll(/contentContainerStyle=\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
    expect(containers.length).toBeGreaterThanOrEqual(2);
    for (const c of containers) expect(c).not.toMatch(/insets\.top/);
  });
  it('both put the status-bar inset on the frame instead', () => {
    expect(ui.match(/paddingTop: insets\.top, backgroundColor: tokens\.color\.appBg/g)?.length).toBe(2);
  });
});
