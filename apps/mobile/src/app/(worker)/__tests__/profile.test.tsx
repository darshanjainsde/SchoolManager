import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import WorkerProfile from '../(tabs)/profile/index';
import { api } from '@/lib/api';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});
const mockSignOut = jest.fn();
jest.mock('@/lib/sign-out', () => ({ signOut: () => mockSignOut() }));

beforeEach(() => {
  jest.clearAllMocks();
  (api.request as jest.Mock).mockResolvedValue({ userId: 'u1', role: 'STAFF', staffRole: 'DRIVER', name: 'Sam Kumar' });
});

/**
 * Before this screen existed, a driver or a security guard could not sign
 * out of the app at all — a real problem on a school's shared handset
 * (UI audit 2026-09-22, #5).
 */
it('shows the person and their role in words, not a code', async () => {
  const { findByTestId, getByText } = render(<WorkerProfile />);
  expect(await findByTestId('worker-profile-name')).toHaveTextContent('Sam Kumar');
  expect(getByText('Driver')).toBeTruthy();
});

it('names a sports teacher properly — the label map used to fall through to "Staff"', async () => {
  (api.request as jest.Mock).mockResolvedValue({ userId: 'u2', role: 'STAFF', staffRole: 'SPORTS', name: 'Ravi Menon' });
  const { findByText } = render(<WorkerProfile />);
  expect(await findByText('Sports teacher')).toBeTruthy();
});

it('offers the same four doors the teacher has', async () => {
  const { findByTestId, getByTestId } = render(<WorkerProfile />);
  await findByTestId('profile-menu-appearance');
  for (const [id, route] of [
    ['profile-menu-appearance', '/(worker)/(tabs)/profile/appearance'],
    ['profile-menu-password', '/(worker)/(tabs)/profile/password'],
    ['profile-menu-phone', '/(worker)/(tabs)/profile/phone'],
    ['profile-menu-switch', '/(worker)/(tabs)/profile/switch'],
  ] as const) {
    fireEvent.press(getByTestId(id));
    expect(mockPush).toHaveBeenCalledWith(route);
  }
});

it('signs out, and asks first because it clears every profile on the phone', async () => {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const { findByTestId } = render(<WorkerProfile />);
  fireEvent.press(await findByTestId('profile-signout'));
  expect(spy).toHaveBeenCalled();
  const [title, , buttons] = spy.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
  expect(title).toBe('Sign out?');
  buttons.find((b) => b.text === 'Sign out')?.onPress?.();
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  spy.mockRestore();
});
