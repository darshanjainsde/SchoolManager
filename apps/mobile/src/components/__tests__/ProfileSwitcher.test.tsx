import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ProfileSwitcher } from '../ProfileSwitcher';
import { api } from '@/lib/api';
import { family } from '@/lib/family-store';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
});
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), push: jest.fn() },
  useFocusEffect: (effect: () => void) => { const React = jest.requireActual('react'); React.useEffect(effect, []); },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, profiles: jest.fn(), switchProfile: jest.fn() } };
});

const priya = { userId: 'u-priya', kind: 'TEACHER', role: 'TEACHER', label: 'Priya Nair', sub: 'Teacher', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const arjun = { userId: 'u-arjun', kind: 'FAMILY', role: 'STUDENT', label: 'Arjun Sharma', sub: 'Class 3-A', schoolName: 'Beacon High', host: 'beacon.sckools.com' };

beforeEach(() => { jest.clearAllMocks(); });

it('renders nothing when the number opens only this profile', async () => {
  (api.profiles as jest.Mock).mockResolvedValue({ current: 'u-ravi', profiles: [{ ...priya, userId: 'u-ravi' }] });
  const { queryByTestId } = render(<ProfileSwitcher />);
  await waitFor(() => expect(api.profiles).toHaveBeenCalled());
  await waitFor(() => expect(queryByTestId('profile-switcher')).toBeNull());
});

it('lists the others; a tap opens that profile on ITS host, adds a spine, and lands on its home', async () => {
  (api.profiles as jest.Mock).mockResolvedValue({ current: 'u-ravi', profiles: [{ ...priya, userId: 'u-ravi' }, priya, arjun] });
  (api.switchProfile as jest.Mock).mockImplementation(async (p: { role: string; label: string; host: string }) => ({ accessToken: 'a2', refreshToken: 'r2', role: p.role, schoolHost: p.host, displayName: p.label, features: [] }));
  const { findByTestId, getByTestId } = render(<ProfileSwitcher />);
  await findByTestId('switch-u-arjun');
  fireEvent.press(getByTestId('switch-u-arjun'));
  await waitFor(() => expect(api.switchProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-arjun' })));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(family)/(tabs)/home'));
  const shelf = await family.list();
  expect(shelf.find((c) => c.displayName === 'Arjun Sharma')).toMatchObject({ schoolHost: 'beacon.sckools.com', role: 'STUDENT' });
});
