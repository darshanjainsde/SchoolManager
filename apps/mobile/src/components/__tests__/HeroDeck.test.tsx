import { fireEvent, render, screen } from '@testing-library/react-native';
import { HeroDeck, RoleHero } from '../HeroDeck';
import { ThemeProvider } from '@/theme/theme-context';

const mount = (n: React.ReactElement) => render(<ThemeProvider>{n}</ThemeProvider>);

describe('HeroDeck — the sheet\'s figures (direction C, 16 Oct 2026)', () => {
  it('draws figures on their family tint and says each out loud', () => {
    mount(<HeroDeck figures={[{ value: '0/4', label: 'registers', family: 'care', testID: 'f1' }, { value: '12', label: 'marked', tone: 'good' }]} />);
    expect(screen.getByLabelText('registers, 0/4')).toBeTruthy();
    expect(screen.getByLabelText('marked, 12')).toBeTruthy();
    expect(screen.getByTestId('hero-figures')).toBeTruthy();
  });

  it('no longer draws quick actions — the tool grid is the one place a door lives', () => {
    const go = jest.fn();
    const v = mount(<HeroDeck actions={[{ label: 'Homework', icon: 'assignments', onPress: go, testID: 'a1' }]} />);
    expect(v.toJSON()).toBeNull();
    expect(screen.queryByText('Homework')).toBeNull();
    expect(screen.queryByTestId('hero-actions')).toBeNull();
  });

  it('caps at three figures so the sheet never wraps', () => {
    const fig = (n: number) => ({ value: String(n), label: `f${n}` });
    mount(<HeroDeck figures={[1, 2, 3, 4].map(fig)} />);
    expect(screen.queryByText('f4')).toBeNull();
    expect(screen.getByText('f3')).toBeTruthy();
  });

  it('a figure with onPress opens its list', () => {
    const go = jest.fn();
    mount(<HeroDeck figures={[{ value: '4', label: 'to verify', onPress: go, testID: 'f' }]} />);
    fireEvent.press(screen.getByTestId('f'));
    expect(go).toHaveBeenCalled();
  });

  it('draws nothing at all when given nothing', () => {
    const v = mount(<HeroDeck />);
    expect(v.toJSON()).toBeNull();
  });
});

describe('RoleHero — the sheet', () => {
  it('shows the headline, the line and the one filled action', () => {
    const go = jest.fn();
    mount(<RoleHero eyebrow="Leave desk" title="3 requests waiting" line="Every class is covered" primary={{ label: 'Decide', onPress: go, testID: 'p' }} />);
    expect(screen.getByText('3 requests waiting')).toBeTruthy();
    expect(screen.getByText('Every class is covered')).toBeTruthy();
    fireEvent.press(screen.getByTestId('p'));
    expect(go).toHaveBeenCalled();
  });

  it('accepts (and ignores) the old actions prop so no desk home breaks', () => {
    mount(<RoleHero eyebrow="Desk" title="Quiet" actions={[{ label: 'Meets', icon: 'meets', onPress: jest.fn(), testID: 'old' }]} />);
    expect(screen.queryByTestId('old')).toBeNull();
    expect(screen.getByText('Quiet')).toBeTruthy();
  });
});
