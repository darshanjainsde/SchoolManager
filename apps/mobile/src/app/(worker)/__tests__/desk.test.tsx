import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SportsToday from '../(tabs)/desk/index';
import Records from '../(tabs)/records/index';
import { api } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const routes: Record<string, unknown> = {};
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  for (const k of Object.keys(routes)) delete routes[k];
  (api.request as jest.Mock).mockImplementation(async (path: string) => {
    const key = path.split('?')[0];
    if (key in routes) return routes[key];
    throw new Error(`unmocked ${path}`);
  });
});

/**
 * The sports desk draws only the verbs its rights allow — `GET /sports/me`
 * decides, exactly as the web desk's `can()` does — and its Today counts
 * the three things a sports teacher asks about at 7:55.
 */
describe('sports desk — Today', () => {
  it('counts live meets, pending verifications and the leading house, each opening its tab', async () => {
    routes['/sports/me'] = { perms: ['ENTER', 'VERIFY'], isAdmin: false };
    routes['/sports/tournaments'] = [
      { id: 't1', name: 'Annual Meet', startsOn: '2026-10-01', endsOn: '2026-10-03', status: 'LIVE', published: true, version: 1, events: 12 },
      { id: 't2', name: 'Inter-house', startsOn: '2026-11-01', endsOn: '2026-11-01', status: 'DRAFT', published: false, version: 1, events: 3 },
    ];
    routes['/sports/records'] = { records: [], pending: 4 };
    routes['/sports/houses'] = [
      { id: 'h1', name: 'Red', color: '#c00', order: 0, members: 300, points: 120 },
      { id: 'h2', name: 'Blue', color: '#00c', order: 1, members: 310, points: 150 },
    ];
    render(<SportsToday />);
    // A pressable Figure announces itself as "label, value, hint".
    expect(await screen.findByLabelText(/^Live meets, 1,/)).toBeTruthy();
    expect(screen.getByLabelText(/^To verify, 4,/)).toBeTruthy();
    expect(screen.getByLabelText(/^Leading, Blue, 150 pts/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('desk-pending'));
    expect(mockPush).toHaveBeenCalledWith('/(worker)/(tabs)/records');
    fireEvent.press(screen.getByTestId('desk-meet-t1'));
    expect(mockPush).toHaveBeenCalledWith('/(worker)/(tabs)/meets/t1');
  });
});

describe('sports desk — Records', () => {
  const attempt = { id: 'a1', sportKey: 'shot-put', sportName: 'Shot put', groupKey: 'sen', category: 'Boys', value: 12.4, unit: 'm', text: '12.40 m', source: 'TRIAL', witnessed: true, createdAt: '2026-09-20T05:00:00.000Z', student: { id: 's1', name: 'Arjun Mehta', classLabel: '10 B' } };

  it('a teacher without the verify right never sees the waiting list or its buttons', async () => {
    routes['/sports/me'] = { perms: ['ENTER'], isAdmin: false };
    routes['/sports/records'] = { records: [{ id: 'r1', sportKey: 'shot-put', sportName: 'Shot put', groupKey: 'sen', category: 'Boys', value: 12, unit: 'm', text: '12.00 m', holderName: 'Old Boy', holderStudentId: null, setOn: null, sinceYear: 2019, untilYear: null, status: 'STANDING', source: 'MEET', note: null }], pending: 1 };
    render(<Records />);
    expect(await screen.findByTestId('record-r1')).toBeTruthy();
    expect(screen.queryByTestId('records-pending')).toBeNull();
    expect((api.request as jest.Mock).mock.calls.some(([p]: [string]) => p === '/sports/records/attempts')).toBe(false);
  });

  it('with the verify right, approving asks first and then posts the decision', async () => {
    routes['/sports/me'] = { perms: ['ENTER', 'VERIFY'], isAdmin: false };
    routes['/sports/records'] = { records: [], pending: 1 };
    routes['/sports/records/attempts'] = [attempt];
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<Records />);
    fireEvent.press(await screen.findByTestId('approve-a1'));
    expect(spy).toHaveBeenCalled();
    const [title, , buttons] = spy.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toMatch(/Approve/);
    (api.request as jest.Mock).mockImplementationOnce(async () => ({ status: 'APPROVED', recordId: 'r9' }));
    buttons.find((b) => b.text === 'Approve')?.onPress?.();
    await waitFor(() => expect((api.request as jest.Mock).mock.calls.some(([p, o]: [string, { method?: string; body?: { approve?: boolean } }]) => p === '/sports/records/attempts/a1/decide' && o?.method === 'POST' && o.body?.approve === true)).toBe(true));
    spy.mockRestore();
  });
});
