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

describe('duotone objects (16 Oct 2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { render } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Icon, isIconName } = require('../icons') as typeof import('../icons');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Path } = require('react-native-svg') as typeof import('react-native-svg');

  it('every door on every Home has a glyph of its own', () => {
    for (const n of ['test', 'pay', 'ask', 'books', 'hall', 'fines', 'members', 'meets', 'records', 'houses', 'rules', 'decide', 'cover', 'staff', 'present', 'syllabus']) {
      expect(isIconName(n)).toBe(true);
    }
  });

  it('Messages carries its three dots as solid ink over the soft bubble', () => {
    const v = render(<Icon name="messages" color="#1C3B5A" />);
    const paths = v.UNSAFE_getAllByType(Path);
    const solid = paths.filter((p) => p.props.fill === '#1C3B5A' && p.props.fillOpacity === undefined);
    expect(solid.length).toBeGreaterThanOrEqual(3);
  });

  it('a cut-out layer takes the tile colour only when one is given', () => {
    const bare = render(<Icon name="requests" color="#111111" />).UNSAFE_getAllByType(Path).filter((p) => p.props.fill === '#EEEEEE');
    expect(bare).toHaveLength(0);
    const knocked = render(<Icon name="requests" color="#111111" knockColor="#EEEEEE" />).UNSAFE_getAllByType(Path).filter((p) => p.props.fill === '#EEEEEE');
    expect(knocked.length).toBeGreaterThanOrEqual(1);
  });
});
