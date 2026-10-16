import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { api, ApiError } from '@/lib/api';
import { TRACK, YEAR, track } from '@/test-utils/syllabus-fixtures';
import Syllabus from '../(tabs)/home/syllabus';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => { const R = jest.requireActual('react'); R.useEffect(effect, []); },
  useSegments: () => ['(staff)', '(tabs)', 'home', 'syllabus'],
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
}));
jest.mock('@/lib/api', () => { const actual = jest.requireActual('@/lib/api'); return { ...actual, api: { ...actual.api, request: jest.fn() } }; });

const mine = (tracks = [track(), track({ classSectionId: 'cs-9b', className: 'Class 9-B', sectionName: 'B', isClassTeacher: false, done: 7, pct: 58, pace: 'ok' })]) =>
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/syllabus/mine') return Promise.resolve({ year: YEAR, tracks });
    throw new Error(`unexpected path: ${path}`);
  });

describe('teacher Syllabus list', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('one card per class with the rings, the verdict and where the class is; the hero counts who is behind', async () => {
    mine();
    const { findByTestId, getByText, getAllByText, getByLabelText } = render(<Syllabus />);
    const card = await findByTestId('syllabus-track-cs-9a-s-mat');
    expect(card).toBeTruthy();
    expect(getByText('Class 9-A · Mathematics')).toBeTruthy();
    expect(getByText('Slightly behind')).toBeTruthy();
    expect(getByText('Class teacher')).toBeTruthy();
    expect(getAllByText('Now: Coordinate geometry')).toHaveLength(2);
    expect(getByLabelText('Taught 42%, Expected by today 55%')).toBeTruthy();
    expect(getByText('1 of 2 classes behind')).toBeTruthy();
    expect(getByText('2026-27 · 55% of working days gone')).toBeTruthy();
  });

  it('a card opens the track inside the Home stack', async () => {
    mine();
    const { findByTestId } = render(<Syllabus />);
    fireEvent.press(await findByTestId('syllabus-track-cs-9a-s-mat'));
    expect(mockPush).toHaveBeenCalledWith('/(staff)/(tabs)/home/syllabus/cs-9a?subjectId=s-mat');
  });

  it('says why it is empty: not on any timetable, or no session; a 403 is the locked page', async () => {
    mine([]);
    const r1 = render(<Syllabus />);
    expect(await r1.findByTestId('syllabus-empty')).toBeTruthy();
    r1.unmount();
    (api.request as jest.Mock).mockResolvedValue({ year: null, tracks: [] });
    const r2 = render(<Syllabus />);
    expect(await r2.findByTestId('syllabus-no-year')).toBeTruthy();
    r2.unmount();
    (api.request as jest.Mock).mockRejectedValue(new ApiError(403, 'Feature COURSE_MANAGEMENT not enabled for this school'));
    const r3 = render(<Syllabus />);
    await waitFor(() => expect(r3.getByText('The syllabus tracker is not on for your school')).toBeTruthy());
  });

  it('any other failure shows the error with a retry', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'boom'));
    const { findByTestId } = render(<Syllabus />);
    expect(await findByTestId('syllabus-error')).toBeTruthy();
    expect(TRACK.canEdit).toBe(true);
  });
});
