import { render, act, fireEvent } from '@testing-library/react-native';
import Profile from '../(tabs)/profile/index';
import FamilyAppearance from '../(tabs)/profile/appearance';
import FamilyPassword from '../(tabs)/profile/password';
import { api, ApiError } from '@/lib/api';

let capturedFocusEffect: (() => void) | undefined;
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => void) => {
    capturedFocusEffect = effect;
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn(), upload: jest.fn() } };
});

// EditableAvatar imports the native picker — mock it so tests can drive the
// pick→upload flow without a device.
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

const FULL_PROFILE = {
  firstName: 'Aarav',
  lastName: 'Sharma',
  admissionNo: 'ADM-2026-014',
  rollNo: '12',
  className: 'Grade 5-B',
  photoUrl: 'https://cdn.example.com/photos/aarav.jpg',
};

it('renders all profile fields: photo, name, admission no., roll and class', async () => {
  (api.request as jest.Mock).mockResolvedValue(FULL_PROFILE);
  const { findByText, findByTestId } = render(<Profile />);

  expect(await findByText('Aarav Sharma')).toBeTruthy();
  expect(await findByText('ADM-2026-014')).toBeTruthy();
  expect(await findByText('12')).toBeTruthy();
  expect(await findByText('Grade 5-B')).toBeTruthy();

  const photo = await findByTestId('profile-photo');
  expect(photo.props.source).toEqual({ uri: FULL_PROFILE.photoUrl });
});

it('falls back to initials — never the literal string "null" — when photoUrl is absent', async () => {
  (api.request as jest.Mock).mockResolvedValue({ ...FULL_PROFILE, photoUrl: null });
  const { findByTestId, queryByTestId, queryByText } = render(<Profile />);

  const initials = await findByTestId('profile-initials');
  expect(initials).toHaveTextContent('AS');
  expect(queryByTestId('profile-photo')).toBeNull();
  expect(queryByText(/null/i)).toBeNull();
});

it('shows a dash, not "null", for a missing roll number or class', async () => {
  (api.request as jest.Mock).mockResolvedValue({ ...FULL_PROFILE, rollNo: null, className: null });
  const { findByText, queryByText, getAllByText } = render(<Profile />);

  await findByText('Aarav Sharma');
  expect(queryByText(/null/i)).toBeNull();
  // Two dashes: one for roll, one for class.
  expect(getAllByText('—').length).toBeGreaterThanOrEqual(2);
});

it('Appearance and Change password live behind their own doors now (pitch №7)', async () => {
  (api.request as jest.Mock).mockResolvedValue(FULL_PROFILE);
  const { findByTestId, getByTestId, queryByTestId } = render(<Profile />);

  fireEvent.press(await findByTestId('profile-menu-appearance'));
  expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/profile/appearance');
  fireEvent.press(getByTestId('profile-menu-password'));
  expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/profile/password');
  // Neither control surface sits unfolded on this page any more.
  expect(queryByTestId('appearance-system')).toBeNull();
  expect(queryByTestId('pw-submit')).toBeNull();
});

it('the door screens re-house the same setting card and form unchanged', () => {
  expect(render(<FamilyAppearance />).getByTestId('appearance-system')).toBeTruthy();
  expect(render(<FamilyPassword />).getByTestId('pw-submit')).toBeTruthy();
});

describe('fetch states', () => {
  it('shows a loading state before the fetch resolves', () => {
    (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByLabelText } = render(<Profile />);
    expect(getByLabelText('Loading profile…')).toBeTruthy();
  });

  it('shows the API error message verbatim when the fetch fails', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
    const { findByText } = render(<Profile />);
    expect(await findByText('Could not reach the school server.')).toBeTruthy();
  });

  it('shows a generic message when a non-ApiError rejection occurs', async () => {
    (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByText } = render(<Profile />);
    expect(await findByText('Something went wrong.')).toBeTruthy();
  });

  it('refetches on focus', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce(FULL_PROFILE);
    const { findByText } = render(<Profile />);
    await findByText('Aarav Sharma');

    (api.request as jest.Mock).mockResolvedValueOnce({ ...FULL_PROFILE, firstName: 'Meera' });
    expect(capturedFocusEffect).toBeDefined();
    await act(async () => {
      capturedFocusEffect?.();
    });
    expect(await findByText('Meera Sharma')).toBeTruthy();
  });

  it('tapping the avatar picks a photo, POSTs it to /me/photo and swaps the image optimistically', async () => {
    const picker = jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///new.jpg', fileName: 'new.jpg', mimeType: 'image/jpeg' }],
    });
    (api.request as jest.Mock).mockResolvedValue({ ...FULL_PROFILE, photoUrl: null });
    (api.upload as jest.Mock).mockResolvedValue({ assetId: 'a1', photoUrl: 'https://cdn/new.jpg' });

    const { findByTestId } = render(<Profile />);
    fireEvent.press(await findByTestId('avatar-edit'));

    await act(async () => {});
    expect(api.upload).toHaveBeenCalledWith('/me/photo', expect.any(FormData));
    const photo = await findByTestId('profile-photo');
    expect(photo.props.source).toEqual({ uri: 'https://cdn/new.jpg' });
  });

  it('a cancelled picker uploads nothing', async () => {
    const picker = jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
    (api.request as jest.Mock).mockResolvedValue(FULL_PROFILE);
    (api.upload as jest.Mock).mockClear(); // not covered by the suite's beforeEach

    const { findByTestId } = render(<Profile />);
    fireEvent.press(await findByTestId('avatar-edit'));

    await act(async () => {});
    expect(api.upload).not.toHaveBeenCalled();
  });
});
