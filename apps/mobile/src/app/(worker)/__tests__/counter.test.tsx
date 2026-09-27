import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import Counter from '../(tabs)/counter/index';
import Member from '../(tabs)/counter/member/[kind]/[id]';
import Hall from '../(tabs)/hall/index';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const routes: Record<string, unknown | ((opts?: { method?: string; body?: Record<string, unknown> }) => unknown)> = {};
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  for (const k of Object.keys(routes)) delete routes[k];
  (api.request as jest.Mock).mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    const key = path.split('?')[0];
    if (key in routes) { const r = routes[key]; return typeof r === 'function' ? (r as (o?: unknown) => unknown)(opts) : r; }
    throw new Error(`unmocked ${path}`);
  });
});

const dashboard = { counts: { outNow: 42, dueSoon: 5, finesCollectedRupees: 800, finesDueRupees: 120 }, outNow: [], today: '2026-09-22' };

describe('library counter', () => {
  it('search opens the reader; two letters is the floor, like the web counter', async () => {
    routes['/library/dashboard'] = dashboard;
    routes['/library/members'] = [{ kind: 'STUDENT', id: 's1', name: 'Kavya Rao', code: 'RAF-00042', className: '7B', holding: 2 }];
    render(<Counter />);
    expect(await screen.findByTestId('counter-out')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('counter-search'), 'K');
    await new Promise((r) => setTimeout(r, 300));
    expect((api.request as jest.Mock).mock.calls.some(([p]: [string]) => p.startsWith('/library/members'))).toBe(false);
    fireEvent.changeText(screen.getByTestId('counter-search'), 'Ka');
    fireEvent.press(await screen.findByTestId('hit-s1'));
    expect(mockPush).toHaveBeenCalledWith('/(worker)/(tabs)/counter/member/student/s1');
  });

  it('issue: an at-limit 409 becomes "Issue anyway", which resends with override', async () => {
    mockParams = { kind: 'student', id: 's1' };
    routes['/library/dashboard'] = dashboard;
    routes['/library/members/student/s1'] = { borrower: { kind: 'STUDENT', id: 's1', name: 'Kavya Rao', code: 'RAF-00042', className: '7B', classSectionId: 'c1' }, limit: 2, holdings: [], duesRupees: 0 };
    routes['/library/titles'] = [{ id: 't1', title: 'Malgudi Days', author: 'R. K. Narayan', shelf: null, totalCopies: 2, inCopies: 1, lostCopies: 0, earliestBack: null, copies: [] }];
    const posts: Record<string, unknown>[] = [];
    routes['/library/issues'] = (o?: { body?: Record<string, unknown> }) => {
      posts.push(o?.body ?? {});
      if (!o?.body?.override) throw new ApiError(409, 'Already holding 2 of 2. Send override: true to issue anyway.', 'LIBRARY_LIMIT');
      return { id: 'i1', title: 'Malgudi Days', dueOn: '2026-10-06', accessionNo: 'A-1', titleId: 't1', author: '', borrower: {}, issuedOn: '2026-09-22', returnedOn: null, wasLost: false, accruedFineRupees: 0 };
    };
    render(<Member />);
    await screen.findByTestId('member-holding');
    fireEvent.press(screen.getByText('Issue a book'));
    fireEvent.changeText(await screen.findByTestId('issue-search'), 'Malg');
    fireEvent.press(await screen.findByTestId('title-t1'));
    fireEvent.press(screen.getByTestId('issue-go'));
    expect(await screen.findByTestId('issue-warn')).toHaveTextContent('Already holding 2 of 2.');
    fireEvent.press(screen.getByTestId('issue-anyway'));
    await waitFor(() => expect(posts.some((b) => b.override === true && b.titleId === 't1' && b.studentId === 's1')).toBe(true));
  });

  it('hall: a tap cycles Present → Absent → Late, and Save posts the whole roll as the library\'s own visit', async () => {
    routes['/library/hall'] = {
      date: '2026-09-22', period: { id: 'p3', label: 'P3', startTime: '10:00', endTime: '10:40' },
      hall: { capacityClasses: 2, inUse: 1, nowClasses: [{ id: 'c1', className: '7B' }] },
      section: { id: 'c1', className: '7B' },
      roster: [{ studentId: 's1', name: 'Kavya Rao', rollNo: 1, status: 'PRESENT' }, { studentId: 's2', name: 'Arjun Mehta', rollNo: 2, status: 'PRESENT' }],
      teacherRegister: { taken: true, takenBy: 'Priya' }, savedVisit: null, sections: [{ id: 'c1', className: '7B' }],
    };
    const posts: Record<string, unknown>[] = [];
    routes['/library/hall/visits'] = (o?: { body?: Record<string, unknown> }) => { posts.push(o?.body ?? {}); return { ok: true }; };
    render(<Hall />);
    // Each row announces "name, status" so a screen reader hears the change too.
    const row = await screen.findByLabelText(/^Arjun Mehta, Present/);
    fireEvent.press(row);
    fireEvent.press(screen.getByLabelText(/^Arjun Mehta, Absent/));
    expect(screen.getByLabelText(/^Arjun Mehta, Late/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('hall-save'));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toMatchObject({ classSectionId: 'c1', periodId: 'p3', source: 'RETAKEN', marks: [{ studentId: 's1', status: 'PRESENT' }, { studentId: 's2', status: 'LATE' }] });
  });
});
