import { render, fireEvent } from '@testing-library/react-native';
import Profile from '../(tabs)/profile/index';
import StaffAppearance from '../(tabs)/profile/appearance';
import StaffPassword from '../(tabs)/profile/password';
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
