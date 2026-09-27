import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Login from '../login';
import { session } from '@/lib/session';
import { family } from '@/lib/family-store';
import { api, ApiError } from '@/lib/api';

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
  return { ...actual, api: { ...actual.api, login: jest.fn(), resolveSchool: jest.fn(), otpRequest: jest.fn(), otpVerify: jest.fn(), otpChoose: jest.fn(), sessionFor: jest.fn() } };
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
  fireEvent.press(getByTestId('login-mode-password'));
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
  fireEvent.press(getByTestId('login-mode-password'));
  fireEvent.changeText(getByTestId('login-id'), 'teacher@raffles.sckools.com');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(staff)/(tabs)/home');
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
  fireEvent.press(getByTestId('login-mode-password'));
  fireEvent.changeText(getByTestId('login-id'), 'RAF-00042');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(family)/(tabs)/home');
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
  fireEvent.press(getByTestId('login-mode-password'));
  fireEvent.changeText(getByTestId('login-id'), 'teacher@acme.edu');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('/(staff)/(tabs)/home');
  });
  // Cache first (offline-friendly), then the resolved candidate.
  expect(api.login).toHaveBeenNthCalledWith(1, 'raffles.sckools.com', 'teacher@acme.edu', 'password');
  expect(api.login).toHaveBeenNthCalledWith(2, 'acme.sckools.com', 'teacher@acme.edu', 'password');
});

it('shows a neutral error when the identifier resolves nowhere', async () => {
  await session.setSchoolHost('');
  // resolveSchool already returns [] from beforeEach.

  const { getByTestId, findByText } = render(<Login />);
  fireEvent.press(getByTestId('login-mode-password'));
  fireEvent.changeText(getByTestId('login-id'), 'ZZZ-99999');
  fireEvent.changeText(getByTestId('login-pw'), 'password');
  fireEvent.press(getByTestId('login-btn'));

  expect(await findByText(/check your details/i)).toBeTruthy();
  // No candidates → no login attempt was ever made anywhere.
  expect(api.login).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

// ── The phone door (design §4–§5) ─────────────────────────────────────────
const REQ = { challengeId: '11111111-1111-1111-1111-111111111111', phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 };
const ravi = { userId: 'u-ravi', kind: 'FAMILY', role: 'STUDENT', label: 'Ravi Sharma', sub: 'Class 5-B', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const priya = { userId: 'u-priya', kind: 'TEACHER', role: 'TEACHER', label: 'Priya Nair', sub: 'Teacher', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const sessionOf = (role: string, name: string, host = 'raffles.sckools.com') => ({ accessToken: 'a', refreshToken: 'r', role, schoolHost: host, displayName: name, features: [] });

it('phone door: number → code → one profile → straight to that role\'s home, on the shelf', async () => {
  (api.otpRequest as jest.Mock).mockResolvedValue(REQ);
  (api.otpVerify as jest.Mock).mockResolvedValue({ choose: false, host: 'raffles.sckools.com', profile: { ...ravi }, accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
  (api.sessionFor as jest.Mock).mockImplementation(async () => { const s = sessionOf('STUDENT', 'Ravi Sharma'); await session.set(s as never); return s; });
  const { getByTestId, findByTestId } = render(<Login />);
  fireEvent.changeText(getByTestId('otp-phone'), '98765 43210');
  fireEvent.press(getByTestId('otp-send'));
  await findByTestId('otp-code');
  expect(api.otpRequest).toHaveBeenCalledWith('98765 43210');
  fireEvent.changeText(getByTestId('otp-code'), '482911');
  fireEvent.press(getByTestId('otp-verify'));
  await waitFor(() => expect(api.otpVerify).toHaveBeenCalledWith(REQ.challengeId, '482911'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(family)/(tabs)/home'));
  expect((await family.list()).find((c) => c.displayName === 'Ravi Sharma')).toMatchObject({ role: 'STUDENT', schoolHost: 'raffles.sckools.com' });
});

it('phone door: two profiles → the chooser; picking the teacher opens the staff room', async () => {
  (api.otpRequest as jest.Mock).mockResolvedValue(REQ);
  (api.otpVerify as jest.Mock).mockResolvedValue({ choose: true, ticket: 't-1', profiles: [ravi, priya] });
  (api.otpChoose as jest.Mock).mockImplementation(async (_t: string, p: { role: string; label: string }) => { const s = sessionOf(p.role, p.label); await session.set(s as never); return s; });
  const { getByTestId, findByTestId } = render(<Login />);
  fireEvent.changeText(getByTestId('otp-phone'), '9876543210');
  fireEvent.press(getByTestId('otp-send'));
  await findByTestId('otp-code');
  fireEvent.changeText(getByTestId('otp-code'), '482911');
  fireEvent.press(getByTestId('otp-verify'));
  await findByTestId('otp-choose');
  fireEvent.press(getByTestId('otp-choice-u-priya'));
  await waitFor(() => expect(api.otpChoose).toHaveBeenCalledWith('t-1', expect.objectContaining({ userId: 'u-priya' })));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(staff)/(tabs)/home'));
});

it('phone door: a wrong code shows the server\'s words and stays on the code step', async () => {
  (api.otpRequest as jest.Mock).mockResolvedValue(REQ);
  (api.otpVerify as jest.Mock).mockRejectedValue(new ApiError(400, 'That code is not right. 4 tries left.'));
  const { getByTestId, findByTestId, findByText } = render(<Login />);
  fireEvent.changeText(getByTestId('otp-phone'), '9876543210');
  fireEvent.press(getByTestId('otp-send'));
  await findByTestId('otp-code');
  fireEvent.changeText(getByTestId('otp-code'), '000000');
  fireEvent.press(getByTestId('otp-verify'));
  await findByText('That code is not right. 4 tries left.');
  expect(getByTestId('otp-code')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});
