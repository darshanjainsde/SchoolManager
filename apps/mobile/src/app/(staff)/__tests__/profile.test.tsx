import { clearCache } from '@/lib/query';
import { render, fireEvent } from '@testing-library/react-native';
import Profile from '../(tabs)/profile/index';
import StaffAppearance from '../(tabs)/profile/appearance';
import StaffPassword from '../(tabs)/profile/password';
import StaffPhone from '../(tabs)/profile/phone';
import { api, ApiError } from '@/lib/api';

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
  return { ...actual, api: { ...actual.api, request: jest.fn(), upload: jest.fn() } };
});

// EditableAvatar imports the native picker — mock it (drive-able if needed).
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

it('renders name, email, phone, subjects and class-teacher-of from GET /manage/teachers/me', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha.rao@raffles.sckools.com',
    phone: '+91 98765 43210',
    subjects: ['Mathematics', 'Physics'],
    classTeacherOf: ['8-C'],
  });

  const { findByText } = render(<Profile />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(await findByText('asha.rao@raffles.sckools.com')).toBeTruthy();
  expect(await findByText('+91 98765 43210')).toBeTruthy();
  expect(await findByText('Mathematics')).toBeTruthy();
  expect(await findByText('Physics')).toBeTruthy();
  expect(await findByText('8-C')).toBeTruthy();

  expect((api.request as jest.Mock).mock.calls[0][0]).toBe('/manage/teachers/me');
});

it('shows "Not on file" for a missing email or phone, and honest empty states for no subjects / not a class teacher', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't2',
    firstName: 'Vikram',
    lastName: 'Singh',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
  });

  const { findAllByText, findByText } = render(<Profile />);

  expect(await findByText('Vikram Singh')).toBeTruthy();
  expect(await findAllByText('Not on file')).toHaveLength(2);
  expect(await findByText('No subjects assigned')).toBeTruthy();
  expect(await findByText('Not a class teacher')).toBeTruthy();
});

it('renders the photo when the profile carries a photoUrl', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
    photoUrl: 'https://cdn.example.com/photos/asha.jpg',
  });

  const { findByTestId, queryByTestId } = render(<Profile />);

  const photo = await findByTestId('profile-photo');
  expect(photo.props.source).toEqual({ uri: 'https://cdn.example.com/photos/asha.jpg' });
  expect(queryByTestId('profile-initials')).toBeNull();
});

it('falls back to initials — never the literal string "null" — when photoUrl is absent', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
    photoUrl: null,
  });

  const { findByTestId, queryByTestId, queryByText } = render(<Profile />);

  const initials = await findByTestId('profile-initials');
  expect(initials).toHaveTextContent('AR');
  expect(queryByTestId('profile-photo')).toBeNull();
  expect(queryByText(/null/i)).toBeNull();
});

it('Appearance lives behind its own door now (pitch №7) — a menu row that pushes, not an unfolded panel', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
    photoUrl: null,
  });

  const { findByTestId, queryByTestId } = render(<Profile />);

  fireEvent.press(await findByTestId('profile-menu-appearance'));
  expect(mockPush).toHaveBeenCalledWith('/(staff)/(tabs)/profile/appearance');
  // The control surface itself no longer sits unfolded on this page.
  expect(queryByTestId('appearance-system')).toBeNull();
});

it('the Appearance door screen re-houses the same setting card unchanged', () => {
  const { getByTestId } = render(<StaffAppearance />);
  expect(getByTestId('appearance-system')).toBeTruthy();
});

it('shows the API error message when the fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Profile />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

/**
 * The v1 "change it on the web portal" dead end is gone: Profile now carries
 * the real change-password card (POST /auth/change-password works for every
 * school role). The card's own behaviour is covered in
 * components/__tests__/ChangePasswordCard.test.tsx — this pins its presence
 * on the teacher's profile.
 */
it('offers the change-password door, not a pointer at the web portal — the form lives one push away', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    id: 't1',
    firstName: 'Asha',
    lastName: 'Rao',
    email: null,
    phone: null,
    subjects: [],
    classTeacherOf: [],
  });

  const { findByTestId, queryByTestId, queryByText } = render(<Profile />);

  fireEvent.press(await findByTestId('profile-menu-password'));
  expect(mockPush).toHaveBeenCalledWith('/(staff)/(tabs)/profile/password');
  expect(queryByTestId('pw-submit')).toBeNull();
  expect(queryByText('Change your password on the web portal.')).toBeNull();
});

it('the Change-password door screen re-houses the real form', () => {
  const { getByTestId } = render(<StaffPassword />);
  expect(getByTestId('pw-submit')).toBeTruthy();
});

/**
 * "My WhatsApp number" — the door on Profile and the screen behind it. The
 * screen's three states mirror the web PhoneCard (components/phone-card.tsx):
 * nothing yet → Send code; code sent → Verify; verified → Change / Remove.
 */
it('offers the My WhatsApp number door', async () => {
  (api.request as jest.Mock).mockResolvedValue({ id: 't1', firstName: 'Asha', lastName: 'Rao', email: null, phone: null, subjects: [], classTeacherOf: [] });
  const { findByTestId } = render(<Profile />);
  fireEvent.press(await findByTestId('profile-menu-phone'));
  expect(mockPush).toHaveBeenCalledWith('/(staff)/(tabs)/profile/phone');
});

it('phone screen: nothing set → typing a number and sending posts /me/phone/request', async () => {
  (api.request as jest.Mock).mockImplementation(async (path: string) =>
    path === '/me/phone/request' ? { ok: true, pending: '+91 98••• •3210' } : { phone: null, verified: false, verifiedAt: null, pending: null, pendingUntil: null, platformReady: true },
  );
  const { findByTestId, getByTestId } = render(<StaffPhone />);
  fireEvent.changeText(await findByTestId('phone-input'), '98765 43210');
  fireEvent.press(getByTestId('phone-send'));
  await findByTestId('phone-note');
  expect((api.request as jest.Mock).mock.calls.find((c) => c[0] === '/me/phone/request')?.[1]).toEqual({ method: 'POST', body: { phone: '98765 43210' } });
});

it('phone screen: code sent → six digits and Verify post /me/phone/verify', async () => {
  (api.request as jest.Mock).mockImplementation(async (path: string) =>
    path === '/me/phone/verify' ? {} : { phone: null, verified: false, verifiedAt: null, pending: '+91 98••• •3210', pendingUntil: '2026-09-20T10:00:00Z', platformReady: true },
  );
  const { findByTestId, getByTestId } = render(<StaffPhone />);
  await findByTestId('phone-verify');
  fireEvent.changeText(getByTestId('phone-code'), '48a29b11');
  fireEvent.press(getByTestId('phone-verify-go'));
  await findByTestId('phone-note');
  expect((api.request as jest.Mock).mock.calls.find((c) => c[0] === '/me/phone/verify')?.[1]).toEqual({ method: 'POST', body: { code: '482911' } });
});

it('phone screen: verified → Remove deletes /me/phone; platform off disables sending', async () => {
  (api.request as jest.Mock).mockResolvedValue({ phone: '+91 98••• •3210', verified: true, verifiedAt: '2026-09-20T09:55:00Z', pending: null, pendingUntil: null, platformReady: true });
  const { findByTestId, getByTestId, unmount } = render(<StaffPhone />);
  expect(await findByTestId('phone-number')).toHaveTextContent('+91 98••• •3210');
  fireEvent.press(getByTestId('phone-remove'));
  await findByTestId('phone-note');
  expect((api.request as jest.Mock).mock.calls.find((c) => c[0] === '/me/phone' && c[1]?.method === 'DELETE')).toBeTruthy();
  unmount();
  clearCache(); // the second render must not be served the first one's 30-s-fresh answer

  (api.request as jest.Mock).mockResolvedValue({ phone: null, verified: false, verifiedAt: null, pending: null, pendingUntil: null, platformReady: false });
  const second = render(<StaffPhone />);
  await second.findByTestId('phone-platform-off');
  expect(second.getByTestId('phone-send')).toBeDisabled();
});
