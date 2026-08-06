import { Text } from 'react-native';
import * as ReactNative from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../theme-context';
import { GROUNDS } from '../grounds';

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

/** Reports the paper actually in force, so the shipped default is pinned. */
function PaperProbe() {
  const { ground, pattern, tokens, setGround } = useTheme();
  return (
    <>
      <Text testID="ground">{ground}</Text>
      <Text testID="pattern">{pattern}</Text>
      <Text testID="appBg">{tokens.color.appBg}</Text>
      <Text testID="set-sand" onPress={() => setGround('sand')}>
        set-sand
      </Text>
    </>
  );
}

describe('the paper a person opens the app on', () => {
  it('defaults to warm cream with feint ruling, not the old near-white', () => {
    // The decision, pinned. `classic` shipped first only so that ADDING grounds
    // could not restyle anyone before a shade had been judged on a real phone.
    mockUseColorScheme.mockReturnValue('light');
    const { getByTestId } = render(
      <ThemeProvider>
        <PaperProbe />
      </ThemeProvider>,
    );
    expect(getByTestId('ground').props.children).toBe('cream');
    expect(getByTestId('pattern').props.children).toBe('ruled');
    expect(getByTestId('appBg').props.children).toBe(GROUNDS.cream.light.appBg);
  });

  it('reaches the tokens, so every screen inherits the choice at once', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const { getByTestId } = render(
      <ThemeProvider>
        <PaperProbe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-sand'));
    await waitFor(() => {
      expect(getByTestId('appBg').props.children).toBe(GROUNDS.sand.light.appBg);
    });
  });

  it('remembers the choice across a restart', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const first = render(
      <ThemeProvider>
        <PaperProbe />
      </ThemeProvider>,
    );
    fireEvent.press(first.getByTestId('set-sand'));
    await waitFor(() => expect(SecureStore.__store['sckools.ground']).toBe('sand'));
    first.unmount();

    // A stored choice must beat the shipped default — somebody who picked their
    // paper does not get it taken back on the next launch.
    const second = render(
      <ThemeProvider>
        <PaperProbe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(second.getByTestId('ground').props.children).toBe('sand'));
  });
});
