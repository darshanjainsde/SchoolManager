import { render } from '@testing-library/react-native';
import Birthdays from '../(tabs)/home/birthdays';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

describe('Birthdays', () => {
  it('shows today and the days coming, never an age', async () => {
    (api.request as jest.Mock).mockImplementation((path: string) => {
      if (path === '/public/site') return Promise.resolve({ school: { name: 'Saraswati Public School' }, celebrations: { page: 'PARTY_WALL', wishLine: 'Happy birthday, {first name}! From all of us at {school}.' } });
      return Promise.resolve({
        generatedFor: '2026-09-17', window: 'MONTH', maxAge: 3600, next: null,
        today: [{ day: 17, month: 9, name: 'Rohan K.', classLabel: '7-B', photoUrl: null, key: 'a' }],
        upcoming: [{ day: 18, month: 9, name: 'Arjun Menon', classLabel: '8-C', photoUrl: null, key: 'b' }],
      });
    });
    const { findByText, getByText } = render(<Birthdays />);
    expect(await findByText('Rohan K.')).toBeTruthy();
    expect(getByText('18 Sep')).toBeTruthy();
    expect(getByText('Arjun Menon')).toBeTruthy();
    // The school's own wish line, filled for the child — the web wall's words.
    expect(await findByText('Happy birthday, Rohan! From all of us at Saraswati Public School.')).toBeTruthy();
  });

  it('a switched-off wall is a quiet page', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found'));
    const { findByText } = render(<Birthdays />);
    expect(await findByText(/hasn’t switched on the birthday wall/)).toBeTruthy();
  });
});
