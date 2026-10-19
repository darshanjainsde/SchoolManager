import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { FIRST_PAINT_CAP_MS, useFirstPaint } from '../use-first-paint';
import { session } from '../session';
import { useSession } from '../use-session';

jest.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
  };
});

/**
 * ONE FIRST FRAME (user, 18 Oct 2026: "something is rendering fast and
 * something rendering slow"). A Home holds its skeleton until the page's
 * core answer is in and gives its badges a moment to land with it.
 */
function Probe({ core, extras }: { core: boolean; extras: boolean[] }) {
  const painted = useFirstPaint(core, extras);
  return <Text testID="probe">{painted ? 'page' : 'skeleton'}</Text>;
}
const shown = () => screen.getByTestId('probe').props.children;

describe('a Home draws in one go', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('holds the skeleton while the core answer is out, however long it takes', () => {
    render(<Probe core={false} extras={[]} />);
    act(() => jest.advanceTimersByTime(FIRST_PAINT_CAP_MS * 5));
    expect(shown()).toBe('skeleton');
  });

  it('waits for a badge that is still on its way, so it does not pop in after the page', () => {
    const { rerender } = render(<Probe core extras={[true]} />);
    expect(shown()).toBe('skeleton');
    rerender(<Probe core extras={[false]} />);
    expect(shown()).toBe('page');
  });

  it('never lets a slow badge hold the page past the cap', () => {
    render(<Probe core extras={[true, false]} />);
    act(() => jest.advanceTimersByTime(FIRST_PAINT_CAP_MS - 1));
    expect(shown()).toBe('skeleton');
    act(() => jest.advanceTimersByTime(1));
    expect(shown()).toBe('page');
  });

  it('draws at once when everything is already cached', () => {
    render(<Probe core extras={[false, false]} />);
    expect(shown()).toBe('page');
  });

  it('once drawn, a refetch never brings the skeleton back', () => {
    const { rerender } = render(<Probe core extras={[]} />);
    rerender(<Probe core={false} extras={[true]} />);
    expect(shown()).toBe('page');
  });
});

function Who() {
  const s = useSession();
  return <Text testID="who">{s?.displayName ?? '(nobody yet)'}</Text>;
}

describe('the session is there on the first frame', () => {
  const base = { accessToken: 'a', refreshToken: 'r', role: 'TEACHER' as const, schoolHost: 'raffles.sckools.com' };

  it('a Home drawn after sign-in names the person on its first frame, not a beat later', async () => {
    await session.set({ ...base, displayName: 'Rekha Sinha' });
    render(<Who />);
    // No awaiting: this is the very first frame.
    expect(screen.getByTestId('who').props.children).toBe('Rekha Sinha');
  });

  it('peek says "not read yet" until the store has been read, then hands back the same copy', async () => {
    await session.set({ ...base, displayName: 'Rekha Sinha' });
    session.forget();
    expect(session.peek()).toBeUndefined();
    const s = await session.get();
    expect(session.peek()).toBe(s);
  });

  it('a cold start (nothing read yet) still fills in once the store answers', async () => {
    await session.set({ ...base, displayName: 'Sam Staff' });
    session.forget();
    render(<Who />);
    expect(screen.getByTestId('who').props.children).toBe('(nobody yet)');
    expect(await screen.findByText('Sam Staff')).toBeTruthy();
  });
});
