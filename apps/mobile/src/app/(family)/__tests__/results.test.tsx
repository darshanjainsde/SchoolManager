import { render, act, within } from '@testing-library/react-native';
import Results from '../(tabs)/results';
import { api, ApiError } from '@/lib/api';

let capturedFocusEffect: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    capturedFocusEffect = effect;
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

function mockEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    '/me/results': [],
    '/me/exams': [],
    ...overrides,
  };
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path in defaults) return Promise.resolve(defaults[path]);
    throw new Error(`unexpected path: ${path}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

const EXAM_UNIT_1 = {
  id: 'ex1',
  title: 'Unit Test 1',
  subjectName: 'Science',
  scheduledAt: '2026-08-05T00:00:00.000Z',
  maxMarks: 50,
  syllabus: 'Chapters 1-3',
};

describe('published results', () => {
  it('renders marks vs class average for each published result', async () => {
    mockEndpoints({
      '/me/results': [
        { examId: 'ex0', title: 'Unit Test 0', subjectName: 'Mathematics', scheduledAt: '2026-07-01T00:00:00.000Z', marks: 42, maxMarks: 50, classAverage: 38 },
      ],
    });
    const { findByTestId } = render(<Results />);

    const card = await findByTestId('result-ex0');
    expect(within(card).getByText('Mathematics')).toBeTruthy();
    expect(within(card).getByText('Unit Test 0')).toBeTruthy();
    // marks/maxMarks render as one <Text> with a nested <Text> for the
    // denominator (for lighter styling) — RNTL's getByText matches the
    // FULL concatenated text of a node including nested children, so the
    // marks/max pair is asserted as one string, not two partial matches.
    expect(within(card).getByText('42/50')).toBeTruthy();
    expect(within(card).getByText('Class average: 38/50')).toBeTruthy();
    expect(within(card).getByText('4 above average')).toBeTruthy();
  });

  it('labels a below-average result correctly', async () => {
    mockEndpoints({
      '/me/results': [
        { examId: 'ex0', title: 'Unit Test 0', subjectName: 'Mathematics', scheduledAt: '2026-07-01T00:00:00.000Z', marks: 30, maxMarks: 50, classAverage: 38 },
      ],
    });
    const { findByTestId } = render(<Results />);
    const card = await findByTestId('result-ex0');
    expect(within(card).getByText('8 below average')).toBeTruthy();
  });

  it('shows an empty state when no results have been published', async () => {
    mockEndpoints();
    const { findByText } = render(<Results />);
    expect(await findByText('No results published yet.')).toBeTruthy();
  });
});

describe('next test detail', () => {
  it('shows the next test with syllabus, max marks and date when home\'s banner is tapped through', async () => {
    mockEndpoints({ '/me/exams': [EXAM_UNIT_1] });
    const { findByTestId } = render(<Results />);

    const card = await findByTestId('next-test-card');
    expect(within(card).getByText(/Science/)).toBeTruthy();
    expect(within(card).getByText(/Unit Test 1/)).toBeTruthy();
    expect(within(card).getByText(/out of 50/)).toBeTruthy();
    expect(within(card).getByText(/Chapters 1-3/)).toBeTruthy();
  });

  it('is absent when there are no upcoming exams', async () => {
    mockEndpoints();
    const { findByText, queryByTestId } = render(<Results />);
    await findByText('No results published yet.');
    expect(queryByTestId('next-test-card')).toBeNull();
  });
});

describe('fetch states', () => {
  it('shows a loading state before the fetch resolves', () => {
    (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByLabelText } = render(<Results />);
    expect(getByLabelText('Loading results…')).toBeTruthy();
  });

  it('shows the API error message verbatim when the fetch fails', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
    const { findByText } = render(<Results />);
    expect(await findByText('Could not reach the school server.')).toBeTruthy();
  });

  it('shows a generic message when a non-ApiError rejection occurs', async () => {
    (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByText } = render(<Results />);
    expect(await findByText('Something went wrong.')).toBeTruthy();
  });

  it('refetches on focus', async () => {
    mockEndpoints();
    const { findByText } = render(<Results />);
    await findByText('No results published yet.');

    mockEndpoints({
      '/me/results': [
        { examId: 'ex0', title: 'Fresh Test', subjectName: 'Mathematics', scheduledAt: '2026-07-01T00:00:00.000Z', marks: 20, maxMarks: 50, classAverage: 20 },
      ],
    });
    expect(capturedFocusEffect).toBeDefined();
    await act(async () => {
      capturedFocusEffect?.();
    });
    expect(await findByText('Fresh Test')).toBeTruthy();
  });
});
