import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { BandGreeting, BAND_HEIGHT } from '../BandHeader';
import { Screen } from '../ui';
import { ThemeProvider } from '@/theme/theme-context';

const mount = (n: React.ReactElement) => render(<ThemeProvider>{n}</ThemeProvider>);

describe('the band and the greeting on it (direction C, 16 Oct 2026)', () => {
  it('BandGreeting draws eyebrow, name, line and the right-hand slot', () => {
    mount(<BandGreeting eyebrow="Good afternoon" title="Rekha Sinha" line="4 classes today" titleTestID="nm" right={<Text testID="bell">b</Text>} />);
    expect(screen.getByText('Good afternoon')).toBeTruthy();
    expect(screen.getByTestId('nm')).toHaveTextContent('Rekha Sinha');
    expect(screen.getByText('4 classes today')).toBeTruthy();
    expect(screen.getByTestId('bell')).toBeTruthy();
  });

  it('a Screen with `band` paints its frame in the band colour; a plain Screen does not', () => {
    const a = mount(<Screen band><Text>x</Text></Screen>);
    expect(a.getByTestId('screen-band-frame')).toBeTruthy();
    a.unmount();
    const b = mount(<Screen><Text>y</Text></Screen>);
    expect(b.queryByTestId('screen-band-frame')).toBeNull();
  });

  it('the band is 236 dp, the number the sheet overlaps (sckools-ui-standards §3c)', () => {
    expect(BAND_HEIGHT).toBe(236);
  });
});
