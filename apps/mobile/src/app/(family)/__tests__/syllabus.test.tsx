import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '@/lib/api';
import { STUDENT_HOME, STUDENT_SUBJECT } from '@/test-utils/syllabus-fixtures';
import FamilySyllabus from '../(tabs)/home/syllabus';
import SubjectScreen from '../(tabs)/home/syllabus/[subjectId]';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => { const R = jest.requireActual('react'); R.useEffect(effect, []); },
  useLocalSearchParams: () => ({ subjectId: 's-mat' }),
  useSegments: () => ['(family)', '(tabs)', 'home', 'syllabus'],
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
}));
jest.mock('@/lib/api', () => { const actual = jest.requireActual('@/lib/api'); return { ...actual, api: { ...actual.api, request: jest.fn() } }; });

describe('family Syllabus', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('one card per subject with taught vs revised rings; the hero counts what is left to revise', async () => {
    (api.request as jest.Mock).mockResolvedValue(STUDENT_HOME);
    const { findByTestId, getByText, getByLabelText } = render(<FamilySyllabus />);
    await findByTestId('syllabus-subject-s-mat');
    expect(getByLabelText('Taught 42%, Revised by me 17%')).toBeTruthy();
    expect(getByText('Rajeshwari Balasubramanian · 5 of 12 taught · 2 revised')).toBeTruthy();
    expect(getByText('Teacher not on the timetable · 10 of 10 taught · 10 revised')).toBeTruthy();
    expect(getByText('3 taught topics to revise')).toBeTruthy();
    fireEvent.press(await findByTestId('syllabus-subject-s-mat'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/syllabus/s-mat');
  });

  it('no class, no chapters, and the feature off each say so', async () => {
    (api.request as jest.Mock).mockResolvedValue({ className: null, year: null, subjects: [] });
    const r1 = render(<FamilySyllabus />);
    expect(await r1.findByTestId('syllabus-no-class')).toBeTruthy();
    r1.unmount();
    (api.request as jest.Mock).mockResolvedValue({ ...STUDENT_HOME, subjects: [] });
    const r2 = render(<FamilySyllabus />);
    expect(await r2.findByTestId('syllabus-empty')).toBeTruthy();
    r2.unmount();
    (api.request as jest.Mock).mockRejectedValue(new ApiError(403, 'off'));
    const r3 = render(<FamilySyllabus />);
    await waitFor(() => expect(r3.getByText('The syllabus tracker is not on for your school')).toBeTruthy());
  });
});

describe('family subject screen', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  const serve = () =>
    (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string; body?: { body: string } }) => {
      if (path === '/me/syllabus/subjects/s-mat') return Promise.resolve(STUDENT_SUBJECT);
      if (path.startsWith('/me/syllabus/notes/') && opts?.method === 'PUT') return Promise.resolve({ chapterId: 'x', myNote: opts.body?.body || null });
      throw new Error(`unexpected path: ${path}`);
    });

  it("shows the teacher's note and my note; 'To revise' keeps only taught topics without a note", async () => {
    serve();
    const { findByTestId, getByText, getByTestId, queryByTestId } = render(<SubjectScreen />);
    await findByTestId('subject-hero');
    expect(getByText('Teacher: Read the summary box')).toBeTruthy();
    expect(getByText('My note: Rational vs irrational')).toBeTruthy();
    expect(getByText('3 topics to revise')).toBeTruthy();
    fireEvent.press(getByTestId('subject-filter-REVISE'));
    expect(queryByTestId('subject-leaf-c1')).toBeNull();
    expect(getByTestId('subject-leaf-c2a')).toBeTruthy();
    expect(queryByTestId('subject-leaf-c2b')).toBeNull();
  });

  it('a note is PUT trimmed from the sheet, and removed with an empty body', async () => {
    serve();
    const { findByTestId, getByTestId } = render(<SubjectScreen />);
    fireEvent.press(await findByTestId('subject-leaf-c2a'));
    expect(getByTestId('note-save')).toBeDisabled();
    fireEvent.changeText(getByTestId('note-body'), '  Zero = where the graph cuts the x-axis ');
    fireEvent.press(getByTestId('note-save'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/syllabus/notes/c2a', { method: 'PUT', body: { body: 'Zero = where the graph cuts the x-axis' } }));
    fireEvent.press(await findByTestId('subject-leaf-c1'));
    fireEvent.press(getByTestId('note-clear'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/syllabus/notes/c1', { method: 'PUT', body: { body: '' } }));
  });
});
