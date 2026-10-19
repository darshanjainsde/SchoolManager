import { render, screen } from '@testing-library/react-native';
import { AccountsToday } from '../AccountsToday';
import { api } from '@/lib/api';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  (api.request as jest.Mock).mockResolvedValue([]);
});

// 16 Oct 2026: every role Home's band shows the date and the person's name —
// the salutation ("Good afternoon, …") was dropped on the user's request.
it('the band names the accounts officer in full, with no salutation', async () => {
  render(<AccountsToday name="Meena Kapoor" />);
  expect(await screen.findByText('Meena Kapoor')).toBeTruthy();
  expect(screen.queryByText(/^(Hi,|Good (morning|afternoon|evening))/)).toBeNull();
  expect(screen.getByTestId('accounts-greeting')).toBeTruthy();
});
