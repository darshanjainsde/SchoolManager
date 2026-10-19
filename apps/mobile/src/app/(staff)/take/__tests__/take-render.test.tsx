import { act, fireEvent, render } from '@testing-library/react-native';
import TakeAttendance from '../[classSectionId]';
import { api } from '@/lib/api';

/**
 * ONE TAP REDRAWS ONE CELL (perf, 19 Oct 2026). Every cell used to get a fresh
 * closure on every tap, so marking one child absent redrew the whole class.
 * Counted on the Touchable each cell is drawn with.
 */
const mockDraws: Record<string, number> = {};
jest.mock('@/components/Touchable', () => {
  const actual = jest.requireActual('@/components/Touchable');
  return {
    Touchable: (props: { testID?: string }) => {
      if (props.testID) mockDraws[props.testID] = (mockDraws[props.testID] ?? 0) + 1;
      return actual.Touchable(props);
    },
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

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

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ classSectionId: 'cs1', name: '5-B' }),
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const STUDENTS = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  firstName: `Child${i + 1}`,
  lastName: 'Rao',
  rollNo: String(i + 1),
}));

it('tapping one cell redraws that cell only, and the mark still lands', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance/rates')) {
      return Promise.resolve({ classSectionId: 'cs1', className: '5-B', from: '2026-05-05', to: '2026-08-03', daysMarked: 0, students: [] });
    }
    if (path.startsWith('/manage/attendance?')) return Promise.resolve([]);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId, getByTestId, findByText } = render(<TakeAttendance />);
  await findByTestId('cell-s6');
  await act(async () => {});

  const before = { ...mockDraws };
  await act(async () => {
    fireEvent.press(getByTestId('cell-s2'));
  });

  expect(getByTestId('cell-s2').props.accessibilityLabel).toBe('Child2 Rao, roll 2, absent');
  expect(await findByText(/6 students · 5 present · 1 absent · 0 late/)).toBeTruthy();
  expect(mockDraws['cell-s2']).toBeGreaterThan(before['cell-s2']);
  for (const id of ['cell-s1', 'cell-s3', 'cell-s4', 'cell-s5', 'cell-s6']) {
    expect(mockDraws[id]).toBe(before[id]);
  }
});
