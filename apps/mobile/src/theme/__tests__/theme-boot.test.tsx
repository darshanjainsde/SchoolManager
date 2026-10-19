import { Text } from 'react-native';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../theme-context';
import { rolesFor } from '../accents';
import { readCachedBrand, refreshSchoolBrand } from '@/lib/school-brand-client';

/**
 * WHAT THE THEME COSTS AT BOOT (perf, 19 Oct 2026).
 *
 * The theme used to fetch the school's whole public site on every launch to
 * read one colour that only 'My school' paints with, and applied the three
 * stored choices on three separate ticks — three full-app re-renders before
 * the first screen had settled.
 */
jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');

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
    __store: store,
  };
});

jest.mock('@/lib/school-brand-client', () => ({
  readCachedBrand: jest.fn(async () => null),
  refreshSchoolBrand: jest.fn(async () => null),
  clearSchoolBrand: jest.fn(async () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SecureStore = require('expo-secure-store');
const mockRefresh = refreshSchoolBrand as jest.Mock;
const mockCached = readCachedBrand as jest.Mock;

let renders = 0;
function Probe() {
  renders += 1;
  const { preference, ground, accent, tokens, setAccent } = useTheme();
  return (
    <>
      <Text testID="look">{`${preference}/${ground}/${accent}`}</Text>
      <Text testID="fill">{tokens.color.indigo}</Text>
      <Text testID="set-school" onPress={() => setAccent('school')}>
        set-school
      </Text>
    </>
  );
}

beforeEach(() => {
  renders = 0;
  mockRefresh.mockReset().mockResolvedValue(null);
  mockCached.mockReset().mockResolvedValue(null);
  Object.keys(SecureStore.__store).forEach((k) => delete SecureStore.__store[k]);
});

describe('the school brand is fetched only for "My school"', () => {
  it('never asks the network for the brand under a named accent', async () => {
    SecureStore.__store['sckools.accent'] = 'navy';
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('look').props.children).toBe('system/fresh/navy'));
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not fetch under the shipped default (Green) either', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes once the stored accent turns out to be "school", and paints with it', async () => {
    SecureStore.__store['sckools.accent'] = 'school';
    mockRefresh.mockResolvedValue({ primary: '#7A1F2B', secondary: '#7A1F2B' });
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(getByTestId('fill').props.children).toBe(rolesFor('school', 'light', '#7A1F2B').fill),
    );
  });

  it('fetches when somebody chooses "My school" later', async () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(mockRefresh).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('set-school'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('still reads the cached brand (a local read), but it does not repaint a named accent', async () => {
    SecureStore.__store['sckools.accent'] = 'navy';
    mockCached.mockResolvedValue({ primary: '#7A1F2B', secondary: '#7A1F2B' });
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('look').props.children).toBe('system/fresh/navy'));
    await act(async () => {});
    expect(mockCached).toHaveBeenCalled();
    expect(getByTestId('fill').props.children).toBe(rolesFor('navy', 'light').fill);
  });
});

describe('the stored look lands in one go', () => {
  it('applies preference, ground and accent in ONE re-render, not three', async () => {
    SecureStore.__store['sckools.themePreference'] = 'dark';
    SecureStore.__store['sckools.ground'] = 'sand';
    SecureStore.__store['sckools.accent'] = 'navy';
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByTestId('look').props.children).toBe('dark/sand/navy'));
    await act(async () => {});
    // The first frame on the defaults, then the stored look — nothing between.
    expect(renders).toBe(2);
  });

  it('a choice made before the store answers is not overwritten by the stored one', async () => {
    SecureStore.__store['sckools.accent'] = 'navy';
    const { getByTestId } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.press(getByTestId('set-school'));
    await act(async () => {});
    await act(async () => {});
    expect(getByTestId('look').props.children).toBe('system/fresh/school');
  });
});
