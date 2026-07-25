import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Login from '../login';
import { session } from '@/lib/session';
import { api } from '@/lib/api';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, login: jest.fn() } };
});

beforeEach(async () => {
  mockReplace.mockReset();
  (api.login as jest.Mock).mockReset();
  await session.clear();
  await session.setSchoolHost('raffles.sckools.com');
});

// Regression: OWNER is a real tenant role. api.login() persists the session
// BEFORE login.tsx can route it, so a bad (unroutable) session must not be
// left behind — otherwise the next app launch bricks on it forever.
it('clears the persisted session and shows the real message when portalForRole rejects the role (OWNER)', async () => {
  (api.login as jest.Mock).mockImplementation(async (host: string, identifier: string) => {
    const s = {
      accessToken: 'at', refreshToken: 'rt', role: 'OWNER' as const,
      schoolHost: host, displayName: identifier,
    };
    await session.set(s); // mirrors the real api.login: persists before returning
    return s;
  });

  const { getByTestId, findByText } = render(<Login />);
  fireEvent.changeText(getByTestId('login-id'), 'owner@raffles.sckools.com');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  const error = await findByText(/web console/i);
  expect(error).toBeTruthy();

  // MINOR: must not masquerade as the generic connectivity error.
  expect(error.props.children).not.toMatch(/could not reach the school server/i);

  // IMPORTANT: the bad session must not survive — otherwise index.tsx bricks
  // on next launch.
  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).not.toHaveBeenCalled();
}, 10000);

it('still routes a valid role to its portal', async () => {
  (api.login as jest.Mock).mockImplementation(async (host: string, identifier: string) => {
    const s = {
      accessToken: 'at', refreshToken: 'rt', role: 'TEACHER' as const,
      schoolHost: host, displayName: identifier,
    };
    await session.set(s);
    return s;
  });

  const { getByTestId } = render(<Login />);
  fireEvent.changeText(getByTestId('login-id'), 'teacher@raffles.sckools.com');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(staff)/today');
  });
  expect(await session.get()).not.toBeNull();
});
