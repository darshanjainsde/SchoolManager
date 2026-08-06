import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Screen } from '../ui';

/**
 * Pitch №5 §3 — the back chip header. The rule is positional (see
 * `screen-titles.ts`): pushed screens inside a home stack get the chip, the
 * home index and the tab screens never do, and the carved-out register gets
 * it as its only visible exit besides Save.
 */
const mockBack = jest.fn();
let mockSegments: string[] = [];
jest.mock('expo-router', () => ({
  useSegments: () => mockSegments,
  router: { back: (...args: unknown[]) => mockBack(...args) },
}));

beforeEach(() => {
  mockBack.mockReset();
  mockSegments = [];
});

it('a pushed tool screen shows the chip and its nav label, and the chip goes back', () => {
  mockSegments = ['(family)', '(tabs)', 'home', 'diary'];
  const { getByTestId, getByText } = render(
    <Screen>
      <Text>body</Text>
    </Screen>,
  );
  expect(getByText('Diary')).toBeTruthy();
  fireEvent.press(getByTestId('back-chip'));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('the home index shows no chip — the tab bar is its navigation', () => {
  mockSegments = ['(staff)', '(tabs)', 'home'];
  const { queryByTestId } = render(
    <Screen>
      <Text>body</Text>
    </Screen>,
  );
  expect(queryByTestId('back-chip')).toBeNull();
});

it('a tab screen shows no chip', () => {
  mockSegments = ['(staff)', '(tabs)', 'attendance'];
  const { queryByTestId } = render(
    <Screen>
      <Text>body</Text>
    </Screen>,
  );
  expect(queryByTestId('back-chip')).toBeNull();
});

it('the carved-out register keeps the chip — its one exit besides Save', () => {
  mockSegments = ['(staff)', 'take', '[classSectionId]'];
  const { getByTestId, getByText } = render(
    <Screen>
      <Text>body</Text>
    </Screen>,
  );
  expect(getByTestId('back-chip')).toBeTruthy();
  expect(getByText('Attendance')).toBeTruthy();
});

it('a dynamic segment inherits its parent tool’s label', () => {
  mockSegments = ['(staff)', '(tabs)', 'home', 'results', '[examId]'];
  const { getByText } = render(
    <Screen>
      <Text>body</Text>
    </Screen>,
  );
  expect(getByText('Results')).toBeTruthy();
});
