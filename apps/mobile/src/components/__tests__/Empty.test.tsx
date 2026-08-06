import { render, screen } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import { Empty } from '../ui';
import { ThemeProvider } from '@/theme/theme-context';

function mount(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('Empty', () => {
  it('says its sentence in the diary hand, not in system grey', () => {
    mount(<Empty>No upcoming holidays.</Empty>);
    const line = screen.getByText('No upcoming holidays.');
    // A page with nothing on it should still read as a page. The serif italic
    // is what does that — drop it and an empty diary reads as a failed load.
    expect(line.props.style.fontStyle).toBe('italic');
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
