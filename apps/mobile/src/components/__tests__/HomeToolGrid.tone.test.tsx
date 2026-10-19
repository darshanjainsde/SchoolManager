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

/**
 * THE RULE, READ FROM THE SOURCE: amber only where someone waits on you, green
 * only for what is yours (pay, days off). A new amber or green tile has to be
 * added here on purpose — that is the point.
 */
describe('meaning colours stay on the tiles that mean something', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const root = path.resolve(__dirname, '../..');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p);
      return /\.tsx$/.test(d.name) ? [p] : [];
    });
  const found: Record<'amber' | 'green', string[]> = { amber: [], green: [] };
  // Only screens that draw a Home menu: status chips elsewhere ("Pending",
  // "Approved") also say tone, and are a different thing.
  const homes = [...files(path.join(root, 'app')), ...files(path.join(root, 'components'))].filter((f) => /<HomeMenu|<HomeToolGrid|<QuickActions/.test(fs.readFileSync(f, 'utf8')));
  it('reads the Homes it guards', () => expect(homes.length).toBeGreaterThanOrEqual(5));
  for (const f of homes) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/label: '([^']+)'[^}\n]*?tone: '(amber|green)'/g)) {
      found[m[2] as 'amber' | 'green'].push(`${path.relative(root, f).split(path.sep).slice(0, 2).join('/')}: ${m[1]}`);
    }
  }

  it('amber is only "someone is waiting on you"', () => {
    expect(found.amber.map((x) => x.split(': ')[1]).sort()).toEqual(['Complaint Box', 'Decide', 'Fines', 'Pay fees', 'Take register']);
  });

  it('green is only "yours": pay and days off', () => {
    expect([...new Set(found.green.map((x) => x.split(': ')[1]))].sort()).toEqual(['Holidays', 'My pay']);
  });
});
