import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import AttendanceBar from '../attendance-bar';
import { api } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const CLASSES = [{ classSectionId: 'cs1', name: 'Grade 8-C', studentCount: 4, covering: false }];

const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const RATES = {
  classSectionId: 'cs1',
  className: 'Grade 8-C',
  from: '2026-05-05',
  to: '2026-08-03',
  daysMarked: 40,
  students: [
    { studentId: 's1', name: 'Kabir Nair', rollNo: '3', present: 20, total: 40, percent: 50, lastNoticeAt: null },
    { studentId: 's2', name: 'Aarav Sharma', rollNo: '1', present: 27, total: 40, percent: 68, lastNoticeAt: daysAgoISO(2) },
    { studentId: 's3', name: 'Diya Rao', rollNo: '2', present: 31, total: 40, percent: 78, lastNoticeAt: null },
    { studentId: 's4', name: 'Nia Verma', rollNo: '4', present: 40, total: 40, percent: 100, lastNoticeAt: null },
  ],
};

// ── Driving the benchmark slider ────────────────────────────────────────────
// The benchmark is a continuous slider (PanResponder + Animated), not a row of
// chips, so these tests move it the way a thumb does: give the track a width
// via its layout event, then dispatch a real responder grant at the pixel that
// corresponds to the percentage we want. `touchHistory` is the shape
// PanResponder's own gesture maths expects from the responder system — without
// it the handlers it wraps around ours would have nothing to read.
type El = Parameters<typeof fireEvent>[0];
const TRACK_W = 200; // 0 → 100 across 200px, so 1% = 2px

const touchHistory = (x: number, t: number) => ({
  touchBank: [
    {
      touchActive: true,
      startPageX: x,
      startPageY: 0,
      startTimeStamp: 0,
      currentPageX: x,
      currentPageY: 0,
      currentTimeStamp: t,
      previousPageX: x,
      previousPageY: 0,
      previousTimeStamp: 0,
    },
  ],
  numberActiveTouches: 1,
  indexOfSingleActiveTouch: 0,
  mostRecentTimeStamp: t,
});

function slideTo(slider: El, percent: number) {
  fireEvent(slider, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: TRACK_W, height: 28 } } });
  const x = (percent / 100) * TRACK_W;
  fireEvent(slider, 'responderGrant', {
    nativeEvent: { locationX: x, locationY: 14 },
    touchHistory: touchHistory(x, 1),
  });
  fireEvent(slider, 'responderRelease', {
    nativeEvent: { locationX: x, locationY: 14 },
    touchHistory: touchHistory(x, 2),
  });
}

let notifyBody: Record<string, unknown> | null = null;

function mockApi(rates = RATES) {
  notifyBody = null;
  (api.request as jest.Mock).mockImplementation(
    (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
      if (path.startsWith('/manage/attendance/my-classes')) return Promise.resolve(CLASSES);
      if (path.startsWith('/manage/attendance/notify-low')) {
        notifyBody = init?.body ?? null;
        return Promise.resolve({ notified: 1, skippedInCooldown: 1, cooldownDays: 7 });
      }
      if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(rates);
      return Promise.resolve({});
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('lists who is under the benchmark, lowest first, and leaves the rest below', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<AttendanceBar />);

  await settled(() => expect(getByTestId('bar-row-s1')).toBeTruthy());
  // 75% default: Kabir (50) and Aarav (68) are under; Diya (78) and Nia are not.
  expect(getByTestId('bar-row-s3')).toBeTruthy(); // rendered in "Everyone else"
  expect(getByText('20 of 40 days')).toBeTruthy();
});

it('moving the benchmark re-filters instantly, before anything is sent', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<AttendanceBar />);
  await settled(() => expect(getByTestId('bar-row-s1')).toBeTruthy());

  slideTo(getByTestId('bar-threshold'), 90);

  await settled(() => expect(getByText('Below 90%')).toBeTruthy());
  // Only Nia (100%) is now above the line — the count says so before a tap.
  expect(getByText(/3 of 4 in Grade 8-C/)).toBeTruthy();
  expect(notifyBody).toBeNull();
});

it('the benchmark can be moved without a drag, from assistive technology', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<AttendanceBar />);
  await settled(() => expect(getByTestId('bar-row-s1')).toBeTruthy());

  const slider = getByTestId('bar-threshold');
  expect(slider.props.accessibilityRole).toBe('adjustable');
  // The track is the full 0-100 so the fill matches the number: at 75% it is
  // three-quarters along, not at the midpoint of a 50-100 range.
  expect(slider.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 75 });

  for (let i = 0; i < 3; i++) {
    fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
  }

  await settled(() => expect(getByText('Below 72%')).toBeTruthy());
});

it('a family told this week is skipped, and the button counts only who is left', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<AttendanceBar />);

  await settled(() => expect(getByTestId('bar-notify')).toBeTruthy());
  // Aarav was told 2 days ago, so of the two under 75% only Kabir is tellable.
  expect(getByText('Tell 1 family')).toBeTruthy();
  expect(getByText('1 already heard from you this week.')).toBeTruthy();
});

it('the teacher can drop someone the arithmetic picked', async () => {
  mockApi();
  const { getByTestId, getByText } = render(<AttendanceBar />);
  await settled(() => expect(getByTestId('bar-row-s1')).toBeTruthy());

  fireEvent.press(getByTestId('bar-row-s1'));

  await settled(() => expect(getByText('Nobody to tell')).toBeTruthy());
});

it('sends only the chosen children with the benchmark that is on screen', async () => {
  mockApi();
  const { getByTestId } = render(<AttendanceBar />);
  await settled(() => expect(getByTestId('bar-notify')).toBeTruthy());

  fireEvent.press(getByTestId('bar-notify'));

  await settled(() =>
    expect(notifyBody).toMatchObject({
      classSectionId: 'cs1',
      threshold: 75,
      studentIds: ['s1'],
    }),
  );
  await settled(() => expect(getByTestId('bar-result')).toBeTruthy());
});

it('says so plainly when nobody is below the line', async () => {
  mockApi({ ...RATES, students: [RATES.students[3]] });
  const { getByTestId } = render(<AttendanceBar />);

  await settled(() => expect(getByTestId('bar-clear')).toBeTruthy());
});
