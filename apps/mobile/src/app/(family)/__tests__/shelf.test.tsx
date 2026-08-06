import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Shelf from '../(tabs)/home/shelf';
import { family } from '@/lib/family-store';
import { session } from '@/lib/session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

const aarav = {
  accessToken: 'at-a',
  refreshToken: 'rt-a',
  role: 'STUDENT' as const,
  schoolHost: 'raffles.sckools.com',
  displayName: 'Aarav Sharma',
};
const diya = { ...aarav, schoolHost: 'gvs.sckools.com', displayName: 'Diya Sharma' };

beforeEach(async () => {
  mockPush.mockReset();
  mockReplace.mockReset();
  await family.clearAll();
  await session.clear();
});

it('renders one spine per child (school-coloured) plus the add tile', async () => {
  await family.add(aarav);
  await family.add(diya);

  const { findByTestId, getByTestId, getByText } = render(<Shelf />);

  expect(await findByTestId('spine-raffles.sckools.com::Aarav Sharma')).toBeTruthy();
  expect(getByTestId('spine-gvs.sckools.com::Diya Sharma')).toBeTruthy();
  expect(getByTestId('shelf-add')).toBeTruthy();
  expect(getByText('Aarav')).toBeTruthy();
  expect(getByText('Diya')).toBeTruthy();
});

it('tapping a spine switches the active child and opens their home', async () => {
  await family.add(aarav);
  await family.add(diya); // Diya active

  const { findByTestId } = render(<Shelf />);
  fireEvent.press(await findByTestId('spine-raffles.sckools.com::Aarav Sharma'));

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(family)/(tabs)/home'));
  expect((await session.get())?.displayName).toBe('Aarav Sharma');
  expect(await session.getSchoolHost()).toBe('raffles.sckools.com');
});

it('the add tile routes through the normal front door (the gate)', async () => {
  await family.add(aarav);

  const { findByTestId } = render(<Shelf />);
  fireEvent.press(await findByTestId('shelf-add'));

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
  // The cached host must be cleared so the gate resolves the NEW child's
  // school from their code instead of trying this family's school first.
  expect(await session.getSchoolHost()).toBe('');
});
