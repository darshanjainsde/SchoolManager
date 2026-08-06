import { fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsButton } from '../SettingsButton';

// Jest only lets a module factory close over names beginning `mock`.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

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
