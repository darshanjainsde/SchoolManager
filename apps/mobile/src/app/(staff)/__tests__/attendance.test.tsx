import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import StaffAttendance from '../attendance';
import { api, ApiError } from '@/lib/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // Test env has no NavigationContainer, so mimic focus-on-mount: run the
  // effect once, synchronously, like a plain useEffect would.
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const PENDING = {
  classSectionId: 'cs-pending',
  name: '5-B',
  total: 28,
  present: 0,
  taken: false,
  markedBy: null,
  markedAt: null,
};

const TAKEN = {
  classSectionId: 'cs-taken',
  name: '6-A',
  total: 30,
  present: 26,
  taken: true,
  markedBy: 'Mr. Rao',
  markedAt: '2026-07-24T05:00:00.000Z',
};

beforeEach(() => {
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
});

it('navigates to the take screen when a pending class is tapped', async () => {
  (api.request as jest.Mock).mockResolvedValue([PENDING]);
  const { findByTestId } = render(<StaffAttendance />);

  const takeBtn = await findByTestId('take-cs-pending');
  fireEvent.press(takeBtn);

  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/cs-pending?name=5-B');
});

it('shows a retake confirmation with the marker and prior counts before navigating', async () => {
  (api.request as jest.Mock).mockResolvedValue([TAKEN]);
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<StaffAttendance />);

  const retakeBtn = await findByTestId('retake-cs-taken');
  fireEvent.press(retakeBtn);

  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alertSpy.mock.calls[0];
  expect(title).toMatch(/6-A/);
  expect(message).toMatch(/Mr\. Rao/);
  expect(message).toMatch(/26\/30/);
  expect(message).toMatch(/audit log/i);
  expect(message).toMatch(/overwrites/i);

  // Confirming ("Retake") should be the only path into the take screen —
  // dismissing without pressing it must not navigate.
  expect(mockPush).not.toHaveBeenCalled();
  const retake = buttons?.find((b) => b.text === 'Retake');
  retake?.onPress?.();
  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/cs-taken?name=6-A');

  alertSpy.mockRestore();
});

it('shows the API error message when the status fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<StaffAttendance />);

  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

it('shows an empty state when the teacher has no classes', async () => {
  (api.request as jest.Mock).mockResolvedValue([]);
  const { findByText } = render(<StaffAttendance />);

  expect(await findByText(/no classes assigned/i)).toBeTruthy();
});
