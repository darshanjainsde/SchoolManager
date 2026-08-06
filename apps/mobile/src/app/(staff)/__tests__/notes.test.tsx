import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Notes from '../(tabs)/home/notes';
import { api, ApiError } from '@/lib/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const CLASS_TEACHER = {
  classSectionId: 'sec-1',
  className: '8-A',
  subjectId: 'subj-maths',
  subjectName: 'Mathematics',
  isClassTeacher: true,
  noteCount: 3,
  openTodoCount: 2,
};
const SUBJECT_TEACHER = {
  classSectionId: 'sec-2',
  className: '9-B',
  subjectId: 'subj-sci',
  subjectName: 'Science',
  isClassTeacher: false,
  noteCount: 1,
  openTodoCount: 0,
};

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

it('lists each class with its role label and counts', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/note-classes') return Promise.resolve([CLASS_TEACHER, SUBJECT_TEACHER]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText, getByText } = render(<Notes />);

  expect(await findByText('8-A · Mathematics')).toBeTruthy();
  expect(getByText('Class teacher')).toBeTruthy();
  expect(getByText('9-B · Science')).toBeTruthy();
  expect(getByText('Subject teacher')).toBeTruthy();
  // Counts, singular/plural aware.
  expect(getByText('📌 3 notes')).toBeTruthy();
  expect(getByText('✓ 2 open to-dos')).toBeTruthy();
  expect(getByText('📌 1 note')).toBeTruthy();
  expect(getByText('✓ 0 open to-dos')).toBeTruthy();
});

it('opens the detail with subjectId, className and subjectName params on tap', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/note-classes') return Promise.resolve([CLASS_TEACHER]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId } = render(<Notes />);
  fireEvent.press(await findByTestId('note-class-sec-1-subj-maths'));

  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith(
      '/(staff)/(tabs)/home/notes/sec-1?subjectId=subj-maths&className=8-A&subjectName=Mathematics',
    ),
  );
});

it('shows an empty state when the teacher keeps notes for no class', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/note-classes') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText } = render(<Notes />);
  expect(await findByText('You have no classes to keep notes for yet.')).toBeTruthy();
});

it('shows the API error message verbatim when the class list fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Notes service is unavailable'));
  const { findByTestId } = render(<Notes />);
  const err = await findByTestId('note-classes-error');
  expect(err.props.children).toBe('Notes service is unavailable');
});
