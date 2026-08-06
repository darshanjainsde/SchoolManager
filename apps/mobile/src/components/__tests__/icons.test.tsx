import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import { Icon, ICON_NAMES, isIconName } from '../icons';
import { MORE_ITEMS as STAFF_MORE, VISIBLE_TABS as STAFF_TABS } from '@/lib/staff-nav';
import { MORE_ITEMS as FAMILY_MORE, VISIBLE_TABS as FAMILY_TABS } from '@/lib/family-nav';

/**
 * TWO ICON VOCABULARIES, AND THEY MUST NOT BE CONFUSED.
 *
 * Drawer tools use our duotone set; the tab bar still uses Ionicons. A rename
 * once put a duotone name ('timetable') into VISIBLE_TABS, where Ionicons
 * silently rendered nothing — no test noticed, because a missing glyph throws
 * no error. These pin both directions.
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
  ])('every %s TAB icon stays an Ionicons name, never a duotone one', (_p, tabs) => {
    // The tab bar renders through Ionicons. A duotone name here draws nothing
    // at all, which is invisible in tests and obvious on a device.
    for (const tab of tabs) {
      expect(`${tab.title}: ${tab.icon.endsWith('-outline')}`).toBe(`${tab.title}: true`);
      expect(`${tab.title} is duotone: ${isIconName(tab.icon)}`).toBe(`${tab.title} is duotone: false`);
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
