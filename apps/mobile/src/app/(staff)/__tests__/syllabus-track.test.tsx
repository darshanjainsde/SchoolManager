import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { api } from '@/lib/api';
import { TRACK } from '@/test-utils/syllabus-fixtures';
import TrackScreen from '../(tabs)/home/syllabus/[classSectionId]';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => { const R = jest.requireActual('react'); R.useEffect(effect, []); },
  useLocalSearchParams: () => ({ classSectionId: 'cs-9a', subjectId: 's-mat' }),
  useSegments: () => ['(staff)', '(tabs)', 'home', 'syllabus', '[classSectionId]'],
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/lib/api', () => { const actual = jest.requireActual('@/lib/api'); return { ...actual, api: { ...actual.api, request: jest.fn() } }; });

const BASE = '/manage/syllabus/tracks/cs-9a/s-mat';
const serve = (t = TRACK) =>
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === BASE) return Promise.resolve(t);
    if (path.startsWith(`${BASE}/progress/`) || path.startsWith(`${BASE}/reach/`)) return Promise.resolve({ ...t, summary: { ...t.summary, pct: 50 } });
    if (path === '/manage/syllabus/chapters' && opts?.method === 'POST') return Promise.resolve({ id: 'new' });
    throw new Error(`unexpected path: ${path}`);
  });

describe('teacher track screen', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('shows the rings, the gap in points, and every chapter with its derived status', async () => {
    serve();
    const { findByTestId, getByText, getByLabelText, getAllByText } = render(<TrackScreen />);
    await findByTestId('track-hero');
    expect(getByLabelText('Taught 42%, Expected by today 55%')).toBeTruthy();
    expect(getByText('13 pts behind')).toBeTruthy();
    expect(getByText('Now: Coordinate geometry')).toBeTruthy();
    expect(getByText('2. Polynomials')).toBeTruthy();
    expect(getByText('1 of 2 sub-topics done')).toBeTruthy();
    expect(getByText('Note: Revise Q4 before the test')).toBeTruthy();
    expect(getAllByText('Teaching').length).toBeGreaterThan(0);
    expect(getByText('Where the class is now')).toBeTruthy();
  });

  it('tapping a topic opens the sheet; a new status is PUT on save, and the answer replaces the track', async () => {
    serve();
    const { findByTestId, getByTestId, queryByTestId, getByText } = render(<TrackScreen />);
    fireEvent.press(await findByTestId('track-leaf-c2b'));
    expect(getByTestId('mark-sheet')).toBeTruthy();
    expect(getByTestId('mark-save')).toBeDisabled();
    fireEvent.press(getByTestId('mark-status-DONE'));
    fireEvent.press(getByTestId('mark-save'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`${BASE}/progress/c2b`, { method: 'PUT', body: { status: 'DONE' } }));
    await waitFor(() => expect(queryByTestId('mark-sheet')).toBeNull());
    expect(getByTestId('track-toast')).toBeTruthy();
    expect(getByText('5 pts behind')).toBeTruthy();
  });

  it('a note alone is PUT trimmed; "Reached here" POSTs', async () => {
    serve();
    const { findByTestId, getByTestId } = render(<TrackScreen />);
    fireEvent.press(await findByTestId('track-leaf-c3'));
    fireEvent.changeText(getByTestId('mark-note'), '  Skipped exercise 3.2 ');
    fireEvent.press(getByTestId('mark-save'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`${BASE}/progress/c3`, { method: 'PUT', body: { note: 'Skipped exercise 3.2' } }));
    fireEvent.press(await findByTestId('track-leaf-c3'));
    fireEvent.press(getByTestId('mark-reach'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(`${BASE}/reach/c3`, { method: 'POST', body: {} }));
  });

  it("today's substitute reads everything and can open nothing", async () => {
    serve({ ...TRACK, canEdit: false });
    const { findByTestId, getByTestId, queryByTestId } = render(<TrackScreen />);
    expect(await findByTestId('track-readonly')).toBeTruthy();
    fireEvent.press(getByTestId('track-leaf-c2b'));
    expect(queryByTestId('mark-sheet')).toBeNull();
    expect(queryByTestId('track-add-chapter')).toBeNull();
  });

  it('adds a chapter for the whole class, optionally under a chapter', async () => {
    serve();
    const { findByTestId, getByTestId } = render(<TrackScreen />);
    fireEvent.press(await findByTestId('track-add-chapter'));
    fireEvent.changeText(getByTestId('add-chapter-title'), ' Triangles ');
    fireEvent.press(getByTestId('add-chapter-save'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/syllabus/chapters', { method: 'POST', body: { gradeId: 'g9', subjectId: 's-mat', title: 'Triangles' } }));
  });
});
