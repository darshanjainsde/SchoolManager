import { act, render, screen } from '@testing-library/react-native';
import Index from '../index';
import { family } from '@/lib/family-store';
import { session } from '@/lib/session';

/**
 * THE BOOT CHAIN (perf, 19 Oct 2026). The legacy-shelf migration and the
 * session read are independent store reads; run one after the other they
 * doubled the time the app sits on the logo.
 */
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = jest.requireActual('react-native');
    return <T testID="redirect">{href}</T>;
  },
}));

// Keep the boot frame out of the SVG renderer.
jest.mock('@/components/SckoolsLogo', () => ({ SckoolsLogo: () => null }));


it('reads the session while the shelf migration is still running, not after it', async () => {
  let finishMigration: () => void = () => {};
  jest.spyOn(family, 'migrateLegacy').mockImplementation(() => new Promise<void>((res) => { finishMigration = res; }));
  const get = jest.spyOn(session, 'get').mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
    role: 'TEACHER',
    schoolHost: 'raffles.sckools.com',
    displayName: 'Priya',
  });
  render(<Index />);
  await act(async () => {});
  // The migration has not finished, and the session has already been asked for.
  expect(get).toHaveBeenCalled();
  expect(screen.queryByTestId('redirect')).toBeNull();
  await act(async () => finishMigration());
  expect(screen.getByTestId('redirect').props.children).not.toBe('/(auth)/login');
});

it('a failed migration still lands on a real screen (the gate)', async () => {
  jest.spyOn(family, 'migrateLegacy').mockRejectedValue(new Error('torn write'));
  jest.spyOn(session, 'get').mockResolvedValue(null);
  jest.spyOn(session, 'clear').mockResolvedValue(undefined);
  render(<Index />);
  await act(async () => {});
  expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/login');
});
