import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LeaveDesk from '../(tabs)/leavedesk/index';
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

type Route = unknown | (() => unknown);
const routes: Record<string, Route> = {};
let post: (path: string, body: unknown) => unknown;
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  for (const k of Object.keys(routes)) delete routes[k];
  post = () => ({});
  routes['/manage/leave'] = [];
  routes['/manage/leave/coverage'] = [
    { id: 'g1', date: '2026-10-07T00:00:00.000Z', classSectionId: 'c1', classSectionName: 'Grade 7 — B', periodId: 'p1', periodLabel: 'Period I', originalTeacherName: 'Asha Rao', substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null },
    { id: 'g2', date: '2026-10-07T00:00:00.000Z', classSectionId: 'c2', classSectionName: 'Grade 8 — A', periodId: 'p2', periodLabel: 'Period II', originalTeacherName: 'Asha Rao', substituteTeacherId: 't9', substituteTeacherName: 'Kavya Rao', acknowledgedAt: '2026-10-07T02:40:00.000Z' },
    { id: 'g3', date: '2026-10-08T00:00:00.000Z', classSectionId: 'c3', classSectionName: 'Grade 9 — C', periodId: 'p3', periodLabel: 'Period III', originalTeacherName: 'Asha Rao', substituteTeacherId: 't8', substituteTeacherName: 'Mohan Das', acknowledgedAt: null },
  ];
  routes['/manage/substitution/g1/candidates'] = [{ id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 }, { id: 'tb', name: 'Lata Iyer', teachesSubject: false, coversThatDay: 2 }];
  (api.request as jest.Mock).mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (init?.method === 'POST') return post(path, init.body);
    const key = path.split('?')[0];
    if (key in routes) {
      const r = routes[key];
      return typeof r === 'function' ? (r as () => unknown)() : r;
    }
    throw new Error(`unmocked ${path}`);
  });
});

const gets = (prefix: string) => (api.request as jest.Mock).mock.calls.filter((c) => !c[1]?.method && String(c[0]).startsWith(prefix)).length;
const openCoverage = async () => {
  render(<LeaveDesk />);
  fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
  await screen.findByText('Grade 7 — B · Period I');
};

describe("the accounts officer's leave desk", () => {
  it('Coverage lists the week\'s gaps, and a pick assigns a teacher the server says is free', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText('Grade 7 — B · Period I')).toBeTruthy();
    fireEvent.press(screen.getByTestId('pick-g1'));
    fireEvent.press(await screen.findByTestId('candidate-g1-ta'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/substitution/g1/assign', { method: 'POST', body: { substituteTeacherId: 'ta' } }));
  });

  it('a covered class says who, and whether they have seen it', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText(/Kavya Rao · seen 8:10\sam/i)).toBeTruthy();
    expect(screen.getByText('Mohan Das · not yet seen')).toBeTruthy();
    expect(screen.getByText('Asha Rao on leave')).toBeTruthy();
  });

  it('the coverage window starts today and spans a week', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    await screen.findByText('Grade 7 — B · Period I');
    const asked = (api.request as jest.Mock).mock.calls.map((c) => c[0] as string).find((p) => p.startsWith('/manage/leave/coverage'))!;
    expect(asked).toMatch(/^\/manage\/leave\/coverage\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    const [, from, to] = /from=([\d-]+)&to=([\d-]+)/.exec(asked)!;
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);
  });

  it('groups the week by day and counts what each day still needs', async () => {
    await openCoverage();
    expect(screen.getByText(/7 Oct · 1 needs a teacher/)).toBeTruthy();
    expect(screen.getByText(/8 Oct · all covered/)).toBeTruthy();
    expect(screen.getByText('1 class needs a teacher')).toBeTruthy();
  });

  it('asks who is free only once a picker opens, and lists them with why', async () => {
    await openCoverage();
    expect(gets('/manage/substitution')).toBe(0);
    fireEvent.press(screen.getByTestId('pick-g1'));
    expect(await screen.findByText('Teaches this subject')).toBeTruthy();
    expect(screen.getByText('2 covers that day')).toBeTruthy();
  });

  it('says it is looking while the answer is on its way', async () => {
    routes['/manage/substitution/g1/candidates'] = () => new Promise(() => {});
    await openCoverage();
    fireEvent.press(screen.getByTestId('pick-g1'));
    expect(await screen.findByText('Finding who is free…')).toBeTruthy();
  });

  it('says so when nobody is free', async () => {
    routes['/manage/substitution/g1/candidates'] = [];
    await openCoverage();
    fireEvent.press(screen.getByTestId('pick-g1'));
    expect(await screen.findByText('Nobody is free that period')).toBeTruthy();
  });

  it('a failed answer says so, and Try again asks again', async () => {
    let fail = true;
    routes['/manage/substitution/g1/candidates'] = () => {
      if (fail) throw new ApiError(500, 'The server had a problem.');
      return [{ id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 }];
    };
    await openCoverage();
    fireEvent.press(screen.getByTestId('pick-g1'));
    expect(await screen.findByTestId('candidates-error-g1')).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByTestId('candidates-retry-g1'));
    expect(await screen.findByTestId('candidate-g1-ta')).toBeTruthy();
  });

  it('a 409 shows the server sentence as it is under its gap, and asks again for the gaps and who is free', async () => {
    const sentence = 'Someone changed this cover a moment ago — it is now with Mohan Das. Nothing was changed; look again and pick.';
    post = () => { throw new ApiError(409, sentence, 'TEACHER_CONFLICT'); };
    await openCoverage();
    fireEvent.press(screen.getByTestId('pick-g1'));
    await screen.findByTestId('candidate-g1-ta');
    const gapsBefore = gets('/manage/leave/coverage');
    const candsBefore = gets('/manage/substitution/g1/candidates');
    fireEvent.press(screen.getByTestId('candidate-g1-ta'));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.getByTestId('coverage-error-g1')).toBeTruthy();
    await waitFor(() => expect(gets('/manage/leave/coverage')).toBeGreaterThan(gapsBefore));
    await waitFor(() => expect(gets('/manage/substitution/g1/candidates')).toBeGreaterThan(candsBefore));
  });

  it('a pick that lands closes the picker and asks again for the gaps', async () => {
    await openCoverage();
    fireEvent.press(screen.getByTestId('pick-g1'));
    await screen.findByTestId('candidate-g1-ta');
    const gapsBefore = gets('/manage/leave/coverage');
    fireEvent.press(screen.getByTestId('candidate-g1-ta'));
    await waitFor(() => expect(screen.queryByTestId('candidate-g1-ta')).toBeNull());
    await waitFor(() => expect(gets('/manage/leave/coverage')).toBeGreaterThan(gapsBefore));
  });

  it('Clear hands a covered period back', async () => {
    await openCoverage();
    fireEvent.press(screen.getByTestId('clear-g2'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/substitution/g2/clear', { method: 'POST', body: {} }));
  });

  it('an empty week says so', async () => {
    routes['/manage/leave/coverage'] = [];
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText('No approved leave leaves a class empty this week.')).toBeTruthy();
    expect(screen.getByText('Every class has a teacher')).toBeTruthy();
  });

  it('a desk without the right is told so, not shown an error', async () => {
    routes['/manage/leave/coverage'] = () => { throw new ApiError(403, 'Forbidden'); };
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByText('You do not have the right to cover classes.')).toBeTruthy();
  });

  it('a failed load shows the error with a retry, never an empty week', async () => {
    routes['/manage/leave/coverage'] = () => { throw new ApiError(500, 'The server had a problem.'); };
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    expect(await screen.findByTestId('error-state')).toBeTruthy();
    expect(screen.queryByText('No approved leave leaves a class empty this week.')).toBeNull();
  });
});

describe('Waiting', () => {
  const leave = (id: string, name: string, extra: Record<string, unknown>) => ({
    id, teacherName: name, type: 'CASUAL', startDate: '2026-10-08T00:00:00.000Z', endDate: '2026-10-08T00:00:00.000Z', halfDay: false, status: 'PENDING', reason: null, ...extra,
  });

  it('a half day names its half; an old one says just "Half day"', async () => {
    routes['/manage/leave'] = [
      leave('a', 'Asha Verma', { halfDay: true, halfDayPart: 'AM' }),
      leave('b', 'Kavya Rao', { halfDay: true, halfDayPart: 'PM' }),
      leave('c', 'Mohan Das', { halfDay: true, halfDayPart: null }),
      leave('d', 'Lata Iyer', { endDate: '2026-10-10T00:00:00.000Z' }),
    ];
    render(<LeaveDesk />);
    expect(await screen.findByText('CASUAL · 8 Oct · Half day · morning')).toBeTruthy();
    expect(screen.getByText('CASUAL · 8 Oct · Half day · afternoon')).toBeTruthy();
    expect(screen.getByText('CASUAL · 8 Oct · Half day')).toBeTruthy();
    expect(screen.getByText('CASUAL · 8 Oct – 10 Oct')).toBeTruthy();
  });

  it('a decision asks again, so the decided row leaves (a 30 s cache must not keep it)', async () => {
    routes['/manage/leave'] = [leave('a', 'Asha Verma', {})];
    render(<LeaveDesk />);
    await screen.findByText('Asha Verma');
    routes['/manage/leave'] = [];
    fireEvent.press(screen.getByTestId('approve-a'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/leave/a/approve', { method: 'POST', body: {} }));
    await waitFor(() => expect(screen.queryByText('Asha Verma')).toBeNull());
  });

  it('a 409 (decided on another desk) shows the sentence and drops the row', async () => {
    const sentence = 'Already approved by Darshan Jain at 9:42 am. Nothing changed.';
    routes['/manage/leave'] = [leave('a', 'Asha Verma', {})];
    post = () => { throw new ApiError(409, sentence, 'LEAVE_NOT_PENDING'); };
    render(<LeaveDesk />);
    await screen.findByText('Asha Verma');
    routes['/manage/leave'] = [];
    fireEvent.press(screen.getByTestId('reject-a'));
    expect(await screen.findByText(sentence)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Asha Verma')).toBeNull());
  });
});
