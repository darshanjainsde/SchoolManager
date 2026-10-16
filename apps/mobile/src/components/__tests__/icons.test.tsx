import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import { Icon, ICON_NAMES, isIconName } from '../icons';
import { MORE_ITEMS as STAFF_MORE, VISIBLE_TABS as STAFF_TABS } from '@/lib/staff-nav';
import { MORE_ITEMS as FAMILY_MORE, VISIBLE_TABS as FAMILY_TABS } from '@/lib/family-nav';

/**
 * TWO ICON VOCABULARIES, AND THEY MUST NOT BE CONFUSED.
 *
 * ONE icon vocabulary now: the tab bar draws the same duotone set the drawer
 * tools do (second edition — Ionicons is gone, and its runtime font with it).
 * A tab icon that names a glyph we do not ship draws nothing, which is
 * invisible in tests and obvious on a device; this pins every tab to the set.
 */
describe('the icon vocabularies', () => {
  it.each([
    ['staff', STAFF_MORE],
    ['family', FAMILY_MORE],
  ])('every %s drawer tool names a duotone glyph we actually ship', (_p, items) => {
    for (const item of items) {
      expect(`${item.label}: ${isIconName(item.icon)}`).toBe(`${item.label}: true`);
    }
  });

  it.each([
    ['staff', STAFF_TABS],
    ['family', FAMILY_TABS],
  ])('every %s TAB icon names a duotone glyph we actually ship', (_p, tabs) => {
    for (const tab of tabs) {
      expect(`${tab.title}: ${isIconName(tab.icon)}`).toBe(`${tab.title}: true`);
      // Nothing left over from the Ionicons era.
      expect(`${tab.title} ionicon: ${tab.icon.endsWith('-outline')}`).toBe(`${tab.title} ionicon: false`);
    }
  });

  it('renders both layers — a body and at least one stroke', () => {
    // The whole point of duotone. One layer is what read as faint.
    const view = render(<Icon name="diary" color="#1C3B5A" testID="ic" />);
    const paths = view.UNSAFE_getAllByType(Path);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // One filled body, and strokes over it.
    expect(paths.some((n) => n.props.fill === '#1C3B5A')).toBe(true);
    expect(paths.some((n) => n.props.stroke === '#1C3B5A' && n.props.fill === 'none')).toBe(true);
  });

  it('draws every glyph in the set without throwing', () => {
    for (const name of ICON_NAMES) {
      const { unmount } = render(<Icon name={name} color="#1C3B5A" testID={`ic-${name}`} />);
      expect(screen.getByTestId(`ic-${name}`)).toBeTruthy();
      unmount();
    }
  });
});
