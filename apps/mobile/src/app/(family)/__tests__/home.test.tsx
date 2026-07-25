import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Home from '../home';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const PROFILE = {
  firstName: 'Aarav',
  lastName: 'Sharma',
  admissionNo: 'A123',
  rollNo: '12',
  className: 'Grade 5-B',
  photoUrl: null,
};

beforeEach(() => {
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
});

function mockEndpoints(announcements: unknown[], attendance: unknown) {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/me/profile') return Promise.resolve(PROFILE);
    if (path === '/me/announcements') return Promise.resolve(announcements);
    if (path === '/me/attendance') return Promise.resolve(attendance);
    throw new Error(`unexpected path: ${path}`);
  });
}

it('shows the child status card and today\'s attendance state when present', async () => {
  mockEndpoints(
    [],
    { month: '2026-07', percent: 100, present: 1, absent: 0, late: 0, days: [{ date: todayISO(), status: 'PRESENT' }] },
  );

  const { findByText } = render(<Home />);

  expect(await findByText('Aarav Sharma')).toBeTruthy();
  expect(await findByText(/Grade 5-B/)).toBeTruthy();
  expect(await findByText('✓ Present today')).toBeTruthy();
});

it('shows a "needs attention" row when marked absent today and the latest notice', async () => {
  mockEndpoints(
    [
      {
        id: 'a1',
        schoolId: 's1',
        classSectionId: null,
        title: 'Annual Day on Aug 12',
        body: 'x',
        createdByUserId: 'u1',
        createdAt: new Date().toISOString(),
      },
    ],
    { month: '2026-07', percent: 90, present: 9, absent: 1, late: 0, days: [{ date: todayISO(), status: 'ABSENT' }] },
  );

  const { findByText } = render(<Home />);

  expect(await findByText('✕ Absent today')).toBeTruthy();
  expect(await findByText('Marked absent today')).toBeTruthy();
  expect(await findByText('Annual Day on Aug 12')).toBeTruthy();
});

it('navigates via the quick-action grid and shows "coming soon" for Holidays/Timetable', async () => {
  mockEndpoints([], { month: '2026-07', percent: 0, present: 0, absent: 0, late: 0, days: [] });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

  const { findByText } = render(<Home />);

  fireEvent.press(await findByText('Attendance'));
  expect(mockPush).toHaveBeenCalledWith('/(family)/attendance');

  fireEvent.press(await findByText('Notices'));
  expect(mockPush).toHaveBeenCalledWith('/(family)/notices');

  fireEvent.press(await findByText('Holidays'));
  fireEvent.press(await findByText('Timetable'));
  await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
  expect(alertSpy.mock.calls[0][0]).toBe('Coming soon');

  alertSpy.mockRestore();
});

it('shows the API error message when a fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Home />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});
