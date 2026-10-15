import { render, screen } from '@testing-library/react-native';
import PayDesk from '../(tabs)/paydesk/index';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
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
  jest.clearAllMocks();
  clearCache();
});

/**
 * Empty kind "locked" (UI v2): a locked door still shows what is behind it.
 * The accounts officer without the Pay right must see the lock AND the three
 * things Pay would show, so the page is never 80% blank and they know what to
 * ask the admin for.
 */
describe('Pay desk without the right', () => {
  it.each([403, 404])('on a %s shows the lock and lists what Pay shows', async (status) => {
    (api.request as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('/payroll/overview')) throw new ApiError(status, 'No right');
      throw new Error(`unmocked ${path}`);
    });
    render(<PayDesk />);
    expect(await screen.findByText('Pay opens when the admin allows it')).toBeTruthy();
    const preview = screen.getByTestId('paydesk-preview');
    expect(preview).toHaveTextContent(/What Pay shows/);
    expect(preview).toHaveTextContent(/The month in one figure/);
    expect(preview).toHaveTextContent(/Leave that changes pay/);
    expect(preview).toHaveTextContent(/Each person’s payslip/);
  });

  it('a real server fault is an error state, not the locked door', async () => {
    (api.request as jest.Mock).mockImplementation(async () => {
      throw new ApiError(500, 'The server had a problem.');
    });
    render(<PayDesk />);
    expect((await screen.findAllByText(/server had a problem/)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('paydesk-preview')).toBeNull();
  });
});
