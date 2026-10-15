import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import LeaveDesk from '../(tabs)/leavedesk/index';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';
import { CoverSheet } from '@/components/CoverSheet';

/**
 * COVER A LEAVE WITH ONE TEACHER, on the phone — the same three endpoints the
 * console drawer uses, so the phone, the console and WhatsApp agree on who is
 * free. The server's answers are stubbed with the shapes LeaveService returns
 * (apps/api/test/leave-cover-batch.e2e-spec.ts proves those).
 */
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

const LEAVE = 'leave-priya';
const gap = (id: string, date: string, cls: string, period: string, extra: Record<string, unknown> = {}) => ({
  id, date: `${date}T00:00:00.000Z`, classSectionId: `c-${id}`, classSectionName: cls, periodId: `p-${id}`, periodLabel: period, originalTeacherName: 'Priya Nair',
  substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null, leaveApplicationId: LEAVE, ...extra,
});
const row = (gapId: string, date: string, className: string, periodLabel: string, state: string, reason: string | null = null) => ({ gapId, date, periodLabel, time: '09:00–09:45', className, state, reason });
const PREVIEW = {
  leave: { id: LEAVE, teacherName: 'Priya Nair', dates: 'Mon 19 – Wed 21 Oct 2026' },
  teacher: { id: 'ta', name: 'Arun Mehta' },
  busyDayAt: 4,
  days: [
    { date: '2026-10-19', label: 'Mon 19 Oct', coversBefore: 2 },
    { date: '2026-10-20', label: 'Tue 20 Oct', coversBefore: 0 },
    { date: '2026-10-21', label: 'Wed 21 Oct', coversBefore: 0 },
  ],
  rows: [
    row('g1', '2026-10-19', '9-A', 'Period I', 'THEIRS', 'Already Arun Mehta\'s.'),
    row('g2', '2026-10-19', '9-B', 'Period II', 'FREE'),
    row('g3', '2026-10-20', '9-A', 'Period I', 'TAKEN', 'Lata Iyer already covers it.'),
    row('g4', '2026-10-20', '9-C', 'Period III', 'TEACHING', 'Arun Mehta teaches 10-B then.'),
    row('g5', '2026-10-21', '9-A', 'Period I', 'FREE'),
    row('g6', '2026-10-21', '9-B', 'Period II', 'FREE'),
  ],
};

type Route = unknown | (() => unknown);
const routes: Record<string, Route> = {};
let post: (path: string, body: unknown) => unknown;
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  for (const k of Object.keys(routes)) delete routes[k];
  post = (path) => (path.endsWith('/cover-batch') ? { given: 3, alreadyTheirs: 0, skipped: [], stillOpen: 1 } : {});
  routes['/manage/leave'] = [];
  routes['/manage/leave/coverage'] = [
    gap('g1', '2026-10-19', '9-A', 'Period I'),
    gap('g2', '2026-10-19', '9-B', 'Period II'),
    gap('h1', '2026-10-19', '6-D', 'Period IV', { originalTeacherName: 'Mohan Das', leaveApplicationId: null }),
  ];
  for (const g of ['g1', 'g2', 'h1']) routes[`/manage/substitution/${g}/candidates`] = [{ id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 }, { id: 'tb', name: 'Lata Iyer', teachesSubject: false, coversThatDay: 0 }];
  routes[`/manage/leave/${LEAVE}/cover-preview`] = () => PREVIEW;
  routes[`/manage/leave/${LEAVE}/cover-fit`] = { open: 4, teachers: [{ id: 'ta', name: 'Arun Mehta', free: 3 }, { id: 'tb', name: 'Lata Iyer', free: 1 }] };
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
async function pickArunFor(gapId: string) {
  render(<LeaveDesk />);
  fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
  fireEvent.press(await screen.findByTestId(`pick-${gapId}`));
  fireEvent.press(await screen.findByTestId(`candidate-${gapId}-ta`));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(`/manage/substitution/${gapId}/assign`, { method: 'POST', body: { substituteTeacherId: 'ta' } }));
}
async function openSheet() {
  await pickArunFor('g1');
  fireEvent.press(await screen.findByTestId('cover-offer-open'));
  return screen.findByTestId('cover-sheet');
}
const box = (gapId: string) => screen.getByTestId(`cover-row-${gapId}`).props.accessibilityState as { checked: boolean; disabled: boolean };

describe('the picker on a leave gap', () => {
  it('says how much of the leave each teacher could take', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    fireEvent.press(await screen.findByTestId('pick-g1'));
    expect(await screen.findByText('Teaches this subject · free for 3 of 4 in this leave')).toBeTruthy();
    expect(screen.getByText('No other covers that day · free for 1 of 4 in this leave')).toBeTruthy();
  });

  it('a hand-made gap never asks how much of a leave anyone could take', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    fireEvent.press(await screen.findByTestId('pick-h1'));
    await screen.findByTestId('candidate-h1-ta');
    expect(gets(`/manage/leave/${LEAVE}/cover-fit`)).toBe(0);
  });
});

describe('after a pick: "give them the rest?"', () => {
  it('asks under the gap just picked, with the real counts', async () => {
    await pickArunFor('g1');
    const offer = await screen.findByTestId('cover-offer');
    expect(within(offer).getByText("Give Arun Mehta the rest of Priya Nair's leave?")).toBeTruthy();
    expect(within(offer).getByText('Free for 3 of the 4 open periods. 1 clashes with their own day and stays open.')).toBeTruthy();
    expect(within(offer).getByText('See the 4 periods')).toBeTruthy();
  });

  it('asks the server fresh, not a preview cached before the pick', async () => {
    render(<LeaveDesk />);
    fireEvent.press(await screen.findByTestId('leavedesk-view-coverage'));
    const before = gets(`/manage/leave/${LEAVE}/cover-preview`);
    fireEvent.press(await screen.findByTestId('pick-g1'));
    fireEvent.press(await screen.findByTestId('candidate-g1-ta'));
    await screen.findByTestId('cover-offer');
    expect(gets(`/manage/leave/${LEAVE}/cover-preview`)).toBe(before + 1);
  });

  it('says nothing when the teacher is free for nothing else', async () => {
    routes[`/manage/leave/${LEAVE}/cover-preview`] = () => ({ ...PREVIEW, rows: PREVIEW.rows.map((r) => (r.state === 'FREE' ? { ...r, state: 'TEACHING', reason: 'x' } : r)) });
    await pickArunFor('g1');
    await waitFor(() => expect(gets(`/manage/leave/${LEAVE}/cover-preview`)).toBeGreaterThan(0));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });

  it('"No thanks" puts it away, and it is not asked again for that leave', async () => {
    await pickArunFor('g1');
    fireEvent.press(await screen.findByTestId('cover-offer-dismiss'));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
    fireEvent.press(await screen.findByTestId('pick-g2'));
    fireEvent.press(await screen.findByTestId('candidate-g2-ta'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/substitution/g2/assign', { method: 'POST', body: { substituteTeacherId: 'ta' } }));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });

  it('a pick on a hand-made gap asks nothing', async () => {
    await pickArunFor('h1');
    expect(gets(`/manage/leave/${LEAVE}/cover-preview`)).toBe(0);
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });
});

describe('the sheet', () => {
  it('ticks every free period, names every clash, leaves what others cover alone', async () => {
    await openSheet();
    expect(box('g2')).toEqual({ checked: true, disabled: false });
    expect(box('g5').checked && box('g6').checked).toBe(true);
    expect(box('g1')).toEqual({ checked: true, disabled: true }); // already theirs
    expect(box('g4')).toEqual({ checked: false, disabled: true }); // a clash
    expect(screen.getByText('Arun Mehta teaches 10-B then.')).toBeTruthy();
    expect(screen.queryByTestId('cover-row-g3')).toBeNull();
    expect(screen.getByText('1 period already covered by someone else — left as it is.')).toBeTruthy();
    expect(screen.getByText('Give Arun Mehta 3 periods')).toBeTruthy();
    expect(screen.getByText('1 period stays open — pick someone else for it.')).toBeTruthy();
  });

  it('a day can be unticked and ticked back whole, and Save sends only what is ticked', async () => {
    await openSheet();
    fireEvent.press(screen.getByTestId('cover-day-toggle-2026-10-21'));
    expect(screen.getByText('Give Arun Mehta 1 period')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cover-day-toggle-2026-10-21'));
    expect(screen.getByText('Give Arun Mehta 3 periods')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cover-day-toggle-2026-10-21'));
    fireEvent.press(screen.getByTestId('cover-sheet-save'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`/manage/leave/${LEAVE}/cover-batch`, { method: 'POST', body: { substituteTeacherId: 'ta', substitutionIds: ['g2'] } }));
  });

  it('nothing ticked: nothing is sent', async () => {
    await openSheet();
    fireEvent.press(screen.getByTestId('cover-day-toggle-2026-10-21'));
    fireEvent.press(screen.getByTestId('cover-row-g2'));
    fireEvent.press(screen.getByTestId('cover-sheet-save'));
    expect((api.request as jest.Mock).mock.calls.some((c) => String(c[0]).endsWith('/cover-batch'))).toBe(false);
  });

  it('flags a day that reaches the busy line, and drops the flag when unticked', async () => {
    routes[`/manage/leave/${LEAVE}/cover-preview`] = () => ({ ...PREVIEW, busyDayAt: 3 });
    await openSheet();
    expect(screen.getByTestId('cover-busy-2026-10-19')).toBeTruthy();
    expect(screen.getByText('Arun Mehta would have 3 covers that day.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cover-row-g2'));
    expect(screen.queryByTestId('cover-busy-2026-10-19')).toBeNull();
  });

  it('after saving: what was given, what was skipped and why, and the desk asks again for the gaps', async () => {
    post = (path) => (path.endsWith('/cover-batch')
      ? { given: 2, alreadyTheirs: 0, skipped: [{ gapId: 'g6', when: 'Wed 21 Oct, Period II', className: '9-B', why: 'TAKEN', reason: 'Someone else covered it a moment ago.' }], stillOpen: 2 }
      : {});
    await openSheet();
    const coverageBefore = gets('/manage/leave/coverage');
    fireEvent.press(screen.getByTestId('cover-sheet-save'));
    const result = await screen.findByTestId('cover-sheet-result');
    expect(within(result).getByText('Arun Mehta now covers 3 periods of this leave.')).toBeTruthy();
    expect(within(result).getByText('Wed 21 Oct, Period II, 9-B: Someone else covered it a moment ago.')).toBeTruthy();
    expect(within(result).getByText('2 periods of this leave still need a teacher.')).toBeTruthy();
    await waitFor(() => expect(gets('/manage/leave/coverage')).toBeGreaterThan(coverageBefore));
  });

  it("a refused save shows the server's sentence and keeps the ticks", async () => {
    post = (path) => {
      if (path.endsWith('/cover-batch')) throw new ApiError(409, 'This leave was withdrawn a moment ago, so its periods no longer need a teacher. Nothing was changed.');
      return {};
    };
    await openSheet();
    fireEvent.press(screen.getByTestId('cover-sheet-save'));
    expect((await screen.findByTestId('cover-sheet-error')).props.children).toMatch(/withdrawn a moment ago/);
    expect(screen.getByText('Give Arun Mehta 3 periods')).toBeTruthy();
  });

  it('a preview that fails says so with Try again, never an empty sheet', async () => {
    let fail = true;
    routes[`/manage/leave/${LEAVE}/cover-preview`] = () => {
      if (fail) throw new ApiError(503, 'Could not reach the school server');
      return PREVIEW;
    };
    render(<CoverSheet open leaveId={LEAVE} teacherId="ta" onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('Could not reach the school server')).toBeTruthy();
    expect(screen.queryByTestId('cover-sheet-save')).toBeNull();
    fail = false;
    fireEvent.press(screen.getByTestId('cover-sheet-retry'));
    expect(await screen.findByText('Give Arun Mehta 3 periods')).toBeTruthy();
  });
});
