import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperRuling } from '../PaperRuling';
import { SettingsButton } from '../SettingsButton';

// Jest only lets a module factory close over names beginning `mock`.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

describe('the ruling behind a screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('draws nothing at all when the person wants plain paper', () => {
    // Not "draws an invisible layer" — renders NOTHING, so plain paper costs no
    // nodes and no SVG surface on every screen in the app.
    render(<PaperRuling pattern="plain" ink="#171412" />);
    expect(screen.queryByTestId('paper-ruling')).toBeNull();
  });

  it('draws the ruling when asked for it', () => {
    render(<PaperRuling pattern="ruled" ink="#171412" />);
    expect(screen.getByTestId('paper-ruling', { includeHiddenElements: true })).toBeTruthy();
  });

  it('draws the quad grid too', () => {
    render(<PaperRuling pattern="quad" ink="#171412" />);
    expect(screen.getByTestId('paper-ruling', { includeHiddenElements: true })).toBeTruthy();
  });

  it('never intercepts a touch meant for the content above it', () => {
    // It is texture. A tap that lands on the paper instead of the button under
    // the cursor would make every screen feel broken in a way nobody could name.
    render(<PaperRuling pattern="quad" ink="#171412" />);
    const paper = screen.getByTestId('paper-ruling', { includeHiddenElements: true });
    expect(paper.props.pointerEvents).toBe('none');
  });

  it('is invisible to a screen reader — asserted by the query, not the prop', () => {
    // Testing Library omits accessibility-hidden nodes from its default
    // queries, so "the plain lookup misses it and the hidden-inclusive one
    // finds it" IS the assertion that it is hidden. Reading the prop would only
    // prove we set an attribute, not that the tree honours it.
    render(<PaperRuling pattern="ruled" ink="#171412" />);
    expect(screen.queryByTestId('paper-ruling')).toBeNull();
    expect(screen.getByTestId('paper-ruling', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('the settings gear', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is labelled for a screen reader, since a gear glyph says nothing aloud', () => {
    render(<SettingsButton group="(family)" />);
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('routes each portal to its OWN settings route, not a shared one', () => {
    const { unmount } = render(<SettingsButton group="(staff)" />);
    fireEvent.press(screen.getByTestId('settings-button'));
    expect(mockPush).toHaveBeenCalledWith('/(staff)/settings');
    unmount();

    render(<SettingsButton group="(family)" />);
    fireEvent.press(screen.getByTestId('settings-button'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/settings');
  });
});
