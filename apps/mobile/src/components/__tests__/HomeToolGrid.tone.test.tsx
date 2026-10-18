import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HomeToolGrid } from '../HomeToolGrid';
import { palette } from '@/theme/tokens';
import { toneFamily, toneFill } from '@/theme/families';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

type Node = ReturnType<typeof screen.getByTestId>;

// 18 Oct 2026: tool tiles carry vc24's meaning colours again — amber for
// what waits on you, green for good news — and every other tile stays on the
// school's accent.
const tileBg = (label: string) => {
  const tile = screen.getByTestId(`hometool-${label}`);
  // The squircle is the first View inside the touchable's inner wrapper.
  const views = tile.findAll((n: Node) => n.props.style && StyleSheet.flatten(n.props.style)?.width === 58);
  return StyleSheet.flatten(views[0].props.style).backgroundColor as string;
};

it('an amber tool, a green tool and an untoned tool each take their own tile colour', () => {
  render(
    <HomeToolGrid
      tools={[
        { label: 'Messages', icon: 'messages', tone: 'amber', route: '/x' },
        { label: 'Holidays', icon: 'holidays', tone: 'green', route: '/x' },
        { label: 'Library', icon: 'library', route: '/x' },
      ]}
    />,
  );
  const c = palette.light;
  expect(tileBg('Messages')).toBe(toneFamily('amber', c, 'light').soft);
  expect(tileBg('Holidays')).toBe(toneFamily('green', c, 'light').soft);
  expect(tileBg('Library')).not.toBe(toneFamily('amber', c, 'light').soft);
  expect(tileBg('Library')).not.toBe(toneFamily('green', c, 'light').soft);
});

it('the live amber tile fills amber, as vc24’s register tile did', () => {
  render(<HomeToolGrid tools={[{ label: 'Register', icon: 'take', tone: 'amber', live: true, route: '/x' }]} />);
  const live = screen.getByTestId('hometool-live-Register');
  expect(StyleSheet.flatten(live.props.style).backgroundColor).toBe(toneFill('amber', palette.light).bg);
});
