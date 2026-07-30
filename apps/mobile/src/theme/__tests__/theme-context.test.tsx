import { Text } from 'react-native';
import * as ReactNative from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../theme-context';

// Spy on the hook via the module jest-expo's preset already provides
// (the same one every other test file imports with no special setup)
// rather than jest.mock('react-native', () => ({ ...jest.requireActual(...) })),
// which bypasses that preset-level native-module mocking and crashes with
// "TurboModuleRegistry.getEnforcing(...): DevMenu could not be found" (it
// pulls in the real react-native/index.js, which lazy-loads NativeDevMenu).
const mockUseColorScheme = jest.spyOn(ReactNative, 'useColorScheme');

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
    // test helper — not part of the real expo-secure-store API
    __store: store,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SecureStore = require('expo-secure-store');

function Probe() {
  const { scheme, preference, setPreference } = useTheme();
  return (
    <>
      <Text testID="scheme">{scheme}</Text>
      <Text testID="preference">{preference}</Text>
      <Text testID="set-light" onPress={() => setPreference('light')}>
        set-light
      </Text>
      <Text testID="set-dark" onPress={() => setPreference('dark')}>
        set-dark
      </Text>
      <Text testID="set-system" onPress={() => setPreference('system')}>
        set-system
      </Text>
    </>
  );
}

beforeEach(() => {
  mockUseColorScheme.mockReset();
  Object.keys(SecureStore.__store).forEach((k) => delete SecureStore.__store[k]);
});

describe('ThemeProvider — system mode', () => {
  it('resolves to dark when the OS reports dark and no override is set', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('dark'));
    expect(getByTestId('preference')).toHaveTextContent('system');
  });

  it('resolves to light when the OS reports light and no override is set', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('light'));
  });

  it('treats an unknown/null OS scheme as light rather than crashing', async () => {
    mockUseColorScheme.mockReturnValue(null);
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('light'));
  });
});

describe('ThemeProvider — manual override', () => {
  it('a manual "dark" override wins over a "light" OS scheme', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-dark'));
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('dark'));
    expect(getByTestId('preference')).toHaveTextContent('dark');
  });

  it('a manual "light" override wins over a "dark" OS scheme', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-light'));
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('light'));
  });

  it('persists the override so a fresh provider mount (e.g. app relaunch) picks it up', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const first = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(first.getByTestId('set-dark'));
    await waitFor(() => expect(first.getByTestId('scheme')).toHaveTextContent('dark'));
    first.unmount();

    // Fresh provider, fresh mount — simulates a cold app relaunch. Still
    // reports the OS as light, but the persisted override must still win.
    const second = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(second.getByTestId('preference')).toHaveTextContent('dark'));
    expect(second.getByTestId('scheme')).toHaveTextContent('dark');
  });

  it('switching back to "system" drops the override and follows the OS again', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-light'));
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('light'));
    fireEvent.press(getByTestId('set-system'));
    await waitFor(() => expect(getByTestId('scheme')).toHaveTextContent('dark'));
    expect(getByTestId('preference')).toHaveTextContent('system');
  });
});
