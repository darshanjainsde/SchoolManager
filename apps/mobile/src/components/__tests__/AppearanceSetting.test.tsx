import * as ReactNative from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AppearanceSetting } from '../AppearanceSetting';
import { ThemeProvider } from '@/theme/theme-context';

// See theme-context.test.tsx for why this is jest.spyOn, not
// jest.mock('react-native', () => ({ ...jest.requireActual(...) })).
const mockUseColorScheme = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');

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
  };
});

function renderWithTheme() {
  return render(
    <ThemeProvider>
      <AppearanceSetting />
    </ThemeProvider>,
  );
}

it('renders System / Light / Dark options with System selected by default', () => {
  const { getByTestId } = renderWithTheme();
  expect(getByTestId('appearance-system').props.accessibilityState).toMatchObject({ selected: true });
  expect(getByTestId('appearance-light').props.accessibilityState).toMatchObject({ selected: false });
  expect(getByTestId('appearance-dark').props.accessibilityState).toMatchObject({ selected: false });
});

it('tapping Dark selects it and applies immediately', async () => {
  const { getByTestId } = renderWithTheme();
  fireEvent.press(getByTestId('appearance-dark'));
  await waitFor(() =>
    expect(getByTestId('appearance-dark').props.accessibilityState).toMatchObject({ selected: true }),
  );
  expect(getByTestId('appearance-system').props.accessibilityState).toMatchObject({ selected: false });
});
