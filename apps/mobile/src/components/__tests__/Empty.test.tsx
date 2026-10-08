import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import { Empty } from '../ui';
import { ThemeProvider } from '@/theme/theme-context';

function mount(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('Empty', () => {
  it('says its sentence plainly, upright and readable (UI v2)', () => {
    mount(<Empty>No upcoming holidays.</Empty>);
    const line = screen.getByText('No upcoming holidays.');
    // v2 dropped the diary italic: upright text at 13.5 scans faster, and the
    // `sub` tone now clears 4.5:1 (theme/__tests__/paper-light.test.ts).
    expect(line.props.style.fontStyle).toBeUndefined();
    expect(line.props.style.fontSize).toBeGreaterThanOrEqual(13.5);
  });

  it('draws the picture for a good-news empty when a scene is given, not the glyph', () => {
    mount(<Empty icon="fees" scene="feesPaid">Nothing due.</Empty>);
    expect(screen.getByTestId('illustration-feesPaid')).toBeTruthy();
  });

  it('draws nothing extra when no glyph was asked for', () => {
    const view = mount(<Empty>No upcoming holidays.</Empty>);
    expect(view.UNSAFE_queryAllByType(Path)).toHaveLength(0);
  });

  it('draws the glyph of the thing that is missing when one is given', () => {
    // An empty screen is the one screen with nothing on it to say WHICH screen
    // it is. The glyph is what makes "no messages" distinguishable from "this
    // page did not load".
    const view = mount(<Empty icon="messages">No messages yet.</Empty>);
    expect(view.UNSAFE_queryAllByType(Path).length).toBeGreaterThan(0);
  });
});
