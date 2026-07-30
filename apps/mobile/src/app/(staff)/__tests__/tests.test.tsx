import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import Tests from '../tests';
import { api, ApiError } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const CLASSES = [
  { classSectionId: 'cs1', name: 'Grade 5-B', studentCount: 28, covering: false },
  { classSectionId: 'cs2', name: 'Grade 6-A', studentCount: 31, covering: false },
];
const SUBJECTS = [
  { id: 'sub1', code: 'MATH', name: 'Mathematics' },
  { id: 'sub2', code: 'ENG', name: 'English' },
];
const EXAM = {
  id: 'ex1',
  classSectionId: 'cs1',
  subjectId: 'sub1',
  title: 'Unit test 1',
  scheduledAt: '2026-08-10T09:00:00.000Z',
  syllabus: null,
  maxMarks: 100,
  createdById: 'u1',
  createdAt: '2026-07-01T00:00:00.000Z',
};
const PAST_EXAM = {
  ...EXAM,
  id: 'ex0',
  title: 'Unit test 0',
  scheduledAt: '2020-01-01T09:00:00.000Z',
};

function mockApi(opts: {
  classes?: unknown;
  subjects?: unknown;
  examList?: { upcoming: unknown[]; past: unknown[] };
  createResult?: unknown;
}) {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(opts.classes ?? CLASSES);
    if (path === '/manage/subjects') return Promise.resolve(opts.subjects ?? SUBJECTS);
    if (path.startsWith('/manage/exams?classSectionId=')) {
      return Promise.resolve(opts.examList ?? { upcoming: [], past: [] });
    }
    if (path === '/manage/exams') {
      if (opts.createResult instanceof Error) return Promise.reject(opts.createResult);
      return Promise.resolve(opts.createResult ?? EXAM);
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

it('shows an empty state when the teacher has no classes', async () => {
  mockApi({ classes: [] });
  const { findByText } = render(<Tests />);
  expect(await findByText(/no classes assigned/i)).toBeTruthy();
});

it('does not show the schedule form until a class is picked', async () => {
  mockApi({});
  const { findByText, queryByTestId } = render(<Tests />);
  await findByText('Grade 5-B');
  expect(queryByTestId('schedule-submit')).toBeNull();
});

// ── Schedule-form validation ────────────────────────────────────────────

it('blocks submit until subject, title and a positive integer maxMarks are all set', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  const submit = await findByTestId('schedule-submit');
  // maxMarks defaults to '100', but subject and title are still empty.
  expect(submit.props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(await findByTestId('subject-sub1'));
  expect(submit.props.accessibilityState?.disabled).toBe(true); // still no title

  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');
  expect(submit.props.accessibilityState?.disabled).toBe(false);
});

it('blocks submit for maxMarks of 0 and fires no request', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');
  fireEvent.changeText(await findByTestId('test-max-marks'), '0');

  const submit = await findByTestId('schedule-submit');
  expect(submit.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(submit);
  await flush();

  const postCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/exams');
  expect(postCalls.length).toBe(0);
});

it('the max-marks field strips non-digit characters, so a negative sign can never be typed', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  const input = await findByTestId('test-max-marks');
  fireEvent.changeText(input, '-5');
  // '-5'.replace(/\D/g, '') === '5' — the minus sign never survives.
  expect(input.props.value).toBe('5');
});

it('blocks submit for a blank maxMarks (cleared by the user) and fires no request', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');
  fireEvent.changeText(await findByTestId('test-max-marks'), '');

  const submit = await findByTestId('schedule-submit');
  expect(submit.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(submit);
  await flush();

  const postCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/exams');
  expect(postCalls.length).toBe(0);
});

it('blocks submit with no subject selected and fires no request', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');

  const submit = await findByTestId('schedule-submit');
  expect(submit.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(submit);
  await flush();

  const postCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/exams');
  expect(postCalls.length).toBe(0);
});

// ── Schedule submit ──────────────────────────────────────────────────────

it('schedules a test and shows a success toast noting the class is notified by email', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');

  fireEvent.press(await findByTestId('schedule-submit'));

  await settled(() => expect(api.request).toHaveBeenCalledWith('/manage/exams', expect.anything()));
  const call = (api.request as jest.Mock).mock.calls.find(([p]) => p === '/manage/exams');
  expect(call[1].method).toBe('POST');
  expect(call[1].body).toMatchObject({
    classSectionId: 'cs1',
    subjectId: 'sub1',
    title: 'Unit test 1',
    maxMarks: 100,
  });
  expect(typeof call[1].body.scheduledAt).toBe('string');

  expect(await findByTestId('schedule-success')).toBeTruthy();
  expect(await findByText(/notified by email/i)).toBeTruthy();
});

it('shows the server error message verbatim on a failed schedule', async () => {
  mockApi({ createResult: new ApiError(404, 'classSectionId not found') });
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('test-title'), 'Unit test 1');
  fireEvent.press(await findByTestId('schedule-submit'));

  expect(await findByText('classSectionId not found')).toBeTruthy();
});

// ── Upcoming / past split ────────────────────────────────────────────────

it('splits scheduled tests into upcoming and past groups', async () => {
  mockApi({ examList: { upcoming: [EXAM], past: [PAST_EXAM] } });
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));

  expect(await findByTestId(`exam-${EXAM.id}`)).toBeTruthy();
  expect(await findByTestId(`exam-${PAST_EXAM.id}`)).toBeTruthy();
  expect(await findByText('Upcoming')).toBeTruthy();
  expect(await findByText('Past')).toBeTruthy();
});

it('shows an empty state when the class has no tests yet', async () => {
  mockApi({ examList: { upcoming: [], past: [] } });
  const { findByText } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));

  expect(await findByText(/no tests for this class yet/i)).toBeTruthy();
});

// ── Navigation to results entry ─────────────────────────────────────────

it('tapping a scheduled test navigates to its results screen with the class section carried along', async () => {
  mockApi({ examList: { upcoming: [EXAM], past: [] } });
  const { findByText, findByTestId } = render(<Tests />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId(`exam-${EXAM.id}`));

  expect(mockPush).toHaveBeenCalledWith(`/(staff)/results/${EXAM.id}?classSectionId=cs1`);
});
