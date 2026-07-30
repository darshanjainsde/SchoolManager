import { render, fireEvent, waitFor } from '@testing-library/react-native';
import More from '../more';
import { session } from '@/lib/session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

beforeEach(async () => {
  mockPush.mockReset();
  mockReplace.mockReset();
  await session.set({
    accessToken: 'at', refreshToken: 'rt', role: 'TEACHER',
    schoolHost: 'raffles.sckools.com', displayName: 'A Teacher',
  });
});

it('navigates to the tests screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Tests'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/tests');
});

it('navigates to the holidays screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Holidays'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/holidays');
});

it('navigates to the requests screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Requests'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/requests');
});

/**
 * Regression net for F2 (no logout affordance): there was previously no
 * user-initiated way to sign out, which blocked closed-test testers from
 * switching roles/schools on the same device.
 */
it('logging out clears the session and routes to the connect screen', async () => {
  const { findByText } = render(<More />);

  fireEvent.press(await findByText('Log out'));

  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/connect');
});
