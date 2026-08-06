import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LARGE SYSTEM TEXT MUST NOT BREAK THE CHROME.
 *
 * React Native scales every Text with the OS setting and does not cap it — iOS
 * accessibility sizes reach ~310%. This app is used by parents, who are exactly
 * the people who turn that setting up, so it is not a hypothetical.
 *
 * CONTENT should scale: a diary remark, a child's name, a notice. That is the
 * whole point of the setting and capping it would be user-hostile.
 *
 * CHROME cannot: a tab label under a 10px icon, a count inside an 18px badge
 * circle. Those live in fixed geometry and at 310% they render as a clipped
 * glyph or push the bar off the screen. They are capped, and only they.
 */
function src(rel: string): string {
  return readFileSync(join(__dirname, '../../', rel), 'utf8');
}

describe('chrome in fixed geometry is capped', () => {
  it('caps the tab bar labels', () => {
    const bar = src('components/PortalTabBar.tsx');
    // One capped label now, not two: the "Tools" caption went with the FAB it
    // sat under. The tab title remains — it is a word under an icon in a row of
    // fixed height, which is exactly where unbounded scaling breaks the chrome.
    const caps = bar.match(/maxFontSizeMultiplier/g) ?? [];
    expect(caps.length).toBeGreaterThanOrEqual(1);
  });

  it('caps the unread badge, which is a circle with a number in it', () => {
    expect(src('components/NotificationBell.tsx')).toContain('maxFontSizeMultiplier');
  });
});

describe('content is left alone', () => {
  it('does not cap the screens themselves — a remark or a name scales fully', () => {
    // If this starts failing, someone has capped body copy, which takes the
    // accessibility setting away from the people who need it.
    for (const rel of [
      'app/(family)/(tabs)/home/diary.tsx',
      'app/(family)/(tabs)/home/notices.tsx',
    ]) {
      expect(src(rel)).not.toContain('maxFontSizeMultiplier');
    }
  });
});
