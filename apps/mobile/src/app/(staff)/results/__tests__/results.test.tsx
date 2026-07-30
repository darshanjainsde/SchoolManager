import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import ExamResults from '../[examId]';
import { api, ApiError } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

let mockParams: { examId: string; classSectionId: string } = {
  examId: 'ex1',
  classSectionId: 'cs1',
};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const EXAM = {
  id: 'ex1',
  classSectionId: 'cs1',
  subjectId: 'sub1',
  title: 'Unit test 1',
  scheduledAt: '2020-01-01T09:00:00.000Z',
  syllabus: null,
  maxMarks: 100,
  createdById: 'u1',
  createdAt: '2019-12-01T00:00:00.000Z',
};
const EXAM_LIST = { upcoming: [], past: [EXAM] };
const STUDENTS = [
  { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 's2', firstName: 'Ben', lastName: 'Lee', rollNo: '2' },
];

function mockApi(opts: {
  examList?: unknown;
  students?: unknown;
  saved?: unknown;
  saveResult?: unknown;
  publishResult?: unknown;
}) {
  (api.request as jest.Mock).mockImplementation((path: string, reqOpts?: { method?: string }) => {
    if (path.startsWith('/manage/exams?classSectionId=')) return Promise.resolve(opts.examList ?? EXAM_LIST);
    if (path.startsWith('/manage/students?')) return Promise.resolve(opts.students ?? STUDENTS);
    if (path === `/manage/exams/${EXAM.id}/results` && (!reqOpts || reqOpts.method === undefined)) {
      return Promise.resolve(opts.saved ?? []);
    }
    if (path === `/manage/exams/${EXAM.id}/results` && reqOpts?.method === 'PUT') {
      if (opts.saveResult instanceof Error) return Promise.reject(opts.saveResult);
      return Promise.resolve(opts.saveResult ?? { saved: 1 });
    }
    if (path === `/manage/exams/${EXAM.id}/publish`) {
      if (opts.publishResult instanceof Error) return Promise.reject(opts.publishResult);
      return Promise.resolve(opts.publishResult ?? { published: 1 });
    }
    throw new Error(`unexpected path/opts: ${path} ${JSON.stringify(reqOpts)}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockParams = { examId: 'ex1', classSectionId: 'cs1' };
});

it('renders the roster with per-student mark inputs', async () => {
  mockApi({ saved: [] });
  const { findByText, findByTestId } = render(<ExamResults />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(await findByText('Ben Lee')).toBeTruthy();
  expect(await findByTestId('mark-s1')).toBeTruthy();
  expect(await findByTestId('mark-s2')).toBeTruthy();
});

it('seeds inputs from already-saved marks', async () => {
  mockApi({ saved: [{ studentId: 's1', marks: 40, publishedAt: null }] });
  const { findByTestId } = render(<ExamResults />);

  await waitFor(async () => expect((await findByTestId('mark-s1')).props.value).toBe('40'));
});

// ── Raw-string entry: never NaN mid-keystroke ───────────────────────────

it('keeps a leading-zero entry like "07" as typed, and allows a blank value', async () => {
  mockApi({ saved: [] });
  const { findByTestId } = render(<ExamResults />);

  const input = await findByTestId('mark-s1');
  fireEvent.changeText(input, '07');
  expect((await findByTestId('mark-s1')).props.value).toBe('07');

  fireEvent.changeText(input, '');
  expect((await findByTestId('mark-s1')).props.value).toBe('');
});

// ── Out-of-range guard ────────────────────────────────────────────────────

it('blocks Save when a mark exceeds maxMarks, firing no PUT', async () => {
  mockApi({ saved: [] });
  const { findByTestId } = render(<ExamResults />);

  fireEvent.changeText(await findByTestId('mark-s1'), '150');
  const save = await findByTestId('save-marks');
  expect(save.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(save);
  await flush();

  const putCalls = (api.request as jest.Mock).mock.calls.filter(
    ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
  );
  expect(putCalls.length).toBe(0);
  expect(await findByTestId('marks-range-error')).toBeTruthy();
});

it('blocks Save when a mark is negative, firing no PUT', async () => {
  mockApi({ saved: [] });
  const { findByTestId } = render(<ExamResults />);

  fireEvent.changeText(await findByTestId('mark-s1'), '-1');
  const save = await findByTestId('save-marks');
  expect(save.props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(save);
  await flush();

  const putCalls = (api.request as jest.Mock).mock.calls.filter(
    ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
  );
  expect(putCalls.length).toBe(0);
});

// ── Save payload ─────────────────────────────────────────────────────────

it('save sends the web-identical payload — only entered rows, numeric marks', async () => {
  mockApi({ saved: [], saveResult: { saved: 1 } });
  const { findByTestId } = render(<ExamResults />);

  fireEvent.changeText(await findByTestId('mark-s1'), '85');
  fireEvent.press(await findByTestId('save-marks'));

  await settled(() =>
    expect(
      (api.request as jest.Mock).mock.calls.some(
        ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
      ),
    ).toBe(true),
  );
  const putCall = (api.request as jest.Mock).mock.calls.find(
    ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
  );
  expect(putCall[1]).toEqual({ method: 'PUT', body: { marks: [{ studentId: 's1', marks: 85 }] } });
  expect(await findByTestId('save-success')).toBeTruthy();
});

it('saves only filled rows when some marks are left blank — a partial save', async () => {
  mockApi({ saved: [], saveResult: { saved: 1 } });
  const { findByTestId } = render(<ExamResults />);

  fireEvent.changeText(await findByTestId('mark-s1'), '85');
  // s2 left blank.
  fireEvent.press(await findByTestId('save-marks'));

  await settled(() =>
    expect(
      (api.request as jest.Mock).mock.calls.some(
        ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
      ),
    ).toBe(true),
  );
  const putCall = (api.request as jest.Mock).mock.calls.find(
    ([p, o]: [string, { method?: string }?]) => p === `/manage/exams/${EXAM.id}/results` && o?.method === 'PUT',
  );
  expect(putCall[1].body.marks).toEqual([{ studentId: 's1', marks: 85 }]);
});

it('a failed save shows the server VALIDATION message verbatim', async () => {
  mockApi({ saved: [], saveResult: new ApiError(400, 'marks must be between 0 and 100') });
  const { findByTestId, findByText } = render(<ExamResults />);

  fireEvent.changeText(await findByTestId('mark-s1'), '99');
  fireEvent.press(await findByTestId('save-marks'));

  expect(await findByText('marks must be between 0 and 100')).toBeTruthy();
});

// ── Publish confirm gate ─────────────────────────────────────────────────

it('publish is gated behind a confirmation that restates the web warning', async () => {
  mockApi({ saved: [{ studentId: 's1', marks: 90, publishedAt: null }] });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<ExamResults />);

  fireEvent.press(await findByTestId('publish-results'));

  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, message] = alertSpy.mock.calls[0];
  expect(String(title)).toMatch(/publish/i);
  expect(String(message)).toMatch(/visible to students and parents/i);
  expect(String(message)).toMatch(/emails them/i);
  // Edge case: restates that ONLY saved marks publish.
  expect(String(message)).toMatch(/only marks already saved get published/i);

  // No publish call fired merely by opening the dialog.
  const publishCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === `/manage/exams/${EXAM.id}/publish`);
  expect(publishCalls.length).toBe(0);

  alertSpy.mockRestore();
});

it('cancelling the publish confirmation fires no request', async () => {
  mockApi({ saved: [{ studentId: 's1', marks: 90, publishedAt: null }] });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<ExamResults />);

  fireEvent.press(await findByTestId('publish-results'));
  const buttons = alertSpy.mock.calls[0][2];
  const cancel = buttons?.find((b) => b.text === 'Cancel');
  act(() => {
    cancel?.onPress?.();
  });
  await flush();

  const publishCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === `/manage/exams/${EXAM.id}/publish`);
  expect(publishCalls.length).toBe(0);

  alertSpy.mockRestore();
});

it('confirming the publish dialog POSTs publish and shows the emailed-notification toast', async () => {
  mockApi({
    saved: [{ studentId: 's1', marks: 90, publishedAt: null }],
    publishResult: { published: 1 },
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<ExamResults />);

  fireEvent.press(await findByTestId('publish-results'));
  const buttons = alertSpy.mock.calls[0][2];
  const confirm = buttons?.find((b) => b.text === 'Yes, publish');
  act(() => {
    confirm?.onPress?.();
  });

  await settled(() =>
    expect((api.request as jest.Mock).mock.calls.some(([p]) => p === `/manage/exams/${EXAM.id}/publish`)).toBe(true),
  );
  const publishCall = (api.request as jest.Mock).mock.calls.find(([p]) => p === `/manage/exams/${EXAM.id}/publish`);
  expect(publishCall[1]).toEqual({ method: 'POST' });
  expect(await findByTestId('publish-success')).toBeTruthy();

  alertSpy.mockRestore();
});

// ── Published state ────────────────────────────────────────────────────

it('a published exam hides the publish button and shows the published date', async () => {
  mockApi({
    saved: [{ studentId: 's1', marks: 90, publishedAt: '2026-08-02T10:00:00.000Z' }],
  });
  const { findByText, queryByTestId } = render(<ExamResults />);

  expect(await findByText('Published')).toBeTruthy();
  await settled(() => expect(queryByTestId('publish-results')).toBeNull());
});
