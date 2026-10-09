import { fireEvent, render, screen } from '@testing-library/react-native';
import { HeroDeck, RoleHero } from '../HeroDeck';
import { ThemeProvider } from '@/theme/theme-context';

const mount = (n: React.ReactElement) => render(<ThemeProvider>{n}</ThemeProvider>);

describe('HeroDeck — quick actions on every role hero (9 Oct 2026)', () => {
  it('draws each action with its word and fires it', () => {
    const go = jest.fn();
    mount(<HeroDeck actions={[{ label: 'Homework', icon: 'assignments', onPress: go, testID: 'a1' }]} />);
    expect(screen.getByText('Homework')).toBeTruthy();
    fireEvent.press(screen.getByTestId('a1'));
    expect(go).toHaveBeenCalled();
  });

  it('says a badge out loud', () => {
    mount(<HeroDeck actions={[{ label: 'Register', icon: 'take', onPress: jest.fn(), badge: 3 }]} />);
    expect(screen.getByLabelText('Register, 3 waiting')).toBeTruthy();
  });

  it('caps at three figures and four actions so the card never wraps', () => {
    const fig = (n: number) => ({ value: String(n), label: `f${n}` });
    const act = (n: number) => ({ label: `a${n}`, icon: 'take' as const, onPress: jest.fn() });
    mount(<HeroDeck figures={[1, 2, 3, 4].map(fig)} actions={[1, 2, 3, 4, 5].map(act)} />);
    expect(screen.queryByText('f4')).toBeNull();
    expect(screen.queryByText('a5')).toBeNull();
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

describe('RoleHero', () => {
  it('shows the headline, the line and the primary action', () => {
    const go = jest.fn();
    mount(<RoleHero eyebrow="Leave desk" title="3 requests waiting" line="Every class is covered" primary={{ label: 'Decide', onPress: go, testID: 'p' }} />);
    expect(screen.getByText('3 requests waiting')).toBeTruthy();
    fireEvent.press(screen.getByTestId('p'));
    expect(go).toHaveBeenCalled();
  });
});
