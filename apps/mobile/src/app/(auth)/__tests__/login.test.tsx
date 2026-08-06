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
  return { ...actual, api: { ...actual.api, login: jest.fn(), resolveSchool: jest.fn() } };
});

beforeEach(async () => {
  mockReplace.mockReset();
  (api.login as jest.Mock).mockReset();
  (api.resolveSchool as jest.Mock).mockReset().mockResolvedValue([]);
  await session.clear();
  await session.setSchoolHost('raffles.sckools.com');
});

/** api.login success double: persists the session before returning, exactly
 *  like the real one (which is what makes the OWNER cleanup test meaningful). */
function loginSucceedsAs(role: 'STUDENT' | 'TEACHER' | 'OWNER') {
  return async (host: string, identifier: string) => {
    const s = {
      accessToken: 'at', refreshToken: 'rt', role,
      schoolHost: host, displayName: identifier,
    };
    await session.set(s);
    await session.setSchoolHost(host);
    return s;
  };
}

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

// ---- the gate's no-school-code flows (the connect screen is deleted;
//      /auth/resolve-school turns the identifier into candidate hosts) ----

it('with no stored host, resolves the school from the identifier and logs in there', async () => {
  await session.setSchoolHost('');
  (api.resolveSchool as jest.Mock).mockResolvedValue(['raffles.sckools.com']);
  (api.login as jest.Mock).mockImplementation(loginSucceedsAs('STUDENT'));

  const { getByTestId } = render(<Login />);
  fireEvent.changeText(getByTestId('login-id'), 'RAF-00042');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(family)/home');
  });
  expect(api.resolveSchool).toHaveBeenCalledWith('RAF-00042');
  expect(api.login).toHaveBeenCalledWith('raffles.sckools.com', 'RAF-00042', 'password');
});

it('falls through a stale stored host to the resolved school', async () => {
  // Stored host is raffles (beforeEach); this teacher now belongs to acme.
  const { ApiError } = jest.requireActual('@/lib/api');
  (api.login as jest.Mock)
    .mockImplementationOnce(async () => {
      throw new ApiError(401, 'Invalid credentials');
    })
    .mockImplementation(loginSucceedsAs('TEACHER'));
  (api.resolveSchool as jest.Mock).mockResolvedValue(['acme.sckools.com']);

  const { getByTestId } = render(<Login />);
  fireEvent.changeText(getByTestId('login-id'), 'teacher@acme.edu');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(staff)/today');
  });
  // Cache first (offline-friendly), then the resolved candidate.
  expect(api.login).toHaveBeenNthCalledWith(1, 'raffles.sckools.com', 'teacher@acme.edu', 'password');
  expect(api.login).toHaveBeenNthCalledWith(2, 'acme.sckools.com', 'teacher@acme.edu', 'password');
});

it('shows a neutral error when the identifier resolves nowhere', async () => {
  await session.setSchoolHost('');
  // resolveSchool already returns [] from beforeEach.

  const { getByTestId, findByText } = render(<Login />);
  fireEvent.changeText(getByTestId('login-id'), 'ZZZ-99999');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  expect(await findByText(/check your details/i)).toBeTruthy();
  // No candidates → no login attempt was ever made anywhere.
  expect(api.login).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});
