import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { ResultRoomBoard } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import ResultRoomPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

const BOARD: ResultRoomBoard = {
  window: {
    id: 'w1', name: 'Term I', academicYearId: 'y1', academicYearName: '2026-27',
    startDate: '2026-06-01', endDate: '2026-09-30', resultDay: '2026-09-20',
  },
  classes: [
    {
      id: 'c1', label: 'VII-B', students: 22, issued: 0, ready: false, noExams: false,
      subjects: [
        { subjectId: 'sub1', subjectName: 'Mathematics', teacherUserId: 't1', teacherName: 'R. Gupta', exams: 2, expected: 44, entered: 44, published: 44, abCount: 1, exCount: 0, missingStudents: [], state: 'PUBLISHED', lastNudge: null },
        { subjectId: 'sub2', subjectName: 'Hindi', teacherUserId: 't2', teacherName: 'M. Joshi', exams: 1, expected: 22, entered: 14, published: 0, abCount: 0, exCount: 0, missingStudents: ['Kavya Pillai', 'Yash Verma'], state: 'MISSING', lastNudge: { at: '2026-09-02T10:40:00Z', kind: 'ENTER' } },
        { subjectId: 'sub3', subjectName: 'English', teacherUserId: 't3', teacherName: 'K. Verma', exams: 1, expected: 22, entered: 22, published: 0, abCount: 0, exCount: 0, missingStudents: [], state: 'ENTERED', lastNudge: null },
      ],
    },
    { id: 'c2', label: 'VII-A', students: 27, issued: 0, ready: true, noExams: false, subjects: [] },
  ],
  absentees: [
    { studentId: 's9', studentName: 'Aarav Sharma', classLabel: 'VII-B', subjectName: 'Mathematics', examTitle: 'PT-1' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

function apiWithBoard(extra: Partial<ApiStub> = {}) {
  return mockApi({
    get: vi.fn().mockImplementation((path: string) =>
      path.startsWith('/manage/press/results')
        ? Promise.resolve(BOARD)
        : Promise.resolve([])),
    ...extra,
  });
}

describe('the Result Room', () => {
  it('shows three different states as three different facts, with the missing children named', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(apiWithBoard());
    renderWithProviders(<ResultRoomPage />);

    await waitFor(() => expect(screen.getByText('VII-B')).toBeInTheDocument());
    expect(screen.getByText(/Published · 44\/44/)).toBeInTheDocument();
    expect(screen.getByText(/Missing · 8 unmarked/)).toBeInTheDocument();
    expect(screen.getByText(/Entered · not published/)).toBeInTheDocument();
    expect(screen.getByText(/Kavya Pillai, Yash Verma/)).toBeInTheDocument();
    expect(screen.getByText('1 AB')).toBeInTheDocument();
    // the nudge memory
    expect(screen.getByText(/nudged 2 Sept 2026/)).toBeInTheDocument();
    // the ready class + the result-day clock
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByText(/Result day 20 Sept 2026/)).toBeInTheDocument();
  });

  it('a nudge posts the real endpoint with the subject and the right kind', async () => {
    const api = apiWithBoard({ post: vi.fn().mockResolvedValue({ notified: [{ teacherUserId: 't3', teacherName: 'K. Verma' }] }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    renderWithProviders(<ResultRoomPage />);

    await waitFor(() => expect(screen.getByText('English')).toBeInTheDocument());
    // English is ENTERED — its nudge asks to PUBLISH, not to enter.
    fireEvent.click(screen.getByRole('button', { name: /Nudge to publish/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/press/results/nudge', {
      windowId: 'w1', classSectionId: 'c1', subjectId: 'sub3', kind: 'PUBLISH',
    }));
  });

  it('generating an unready class demands a written reason and sends it as the override', async () => {
    const api = apiWithBoard({ post: vi.fn().mockResolvedValue({ issued: [{ studentId: 's1', serial: 'REP/2026/0001' }], skipped: [] }) });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    renderWithProviders(<ResultRoomPage />);

    await waitFor(() => expect(screen.getByText('VII-B')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Generate anyway/ }));
    expect(api.post).not.toHaveBeenCalled(); // no silent override

    const reason = screen.getByPlaceholderText(/principal ordered/);
    fireEvent.change(reason, { target: { value: 'principal ordered — teacher on leave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate with gaps' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/press/results/generate', {
      windowId: 'w1', classSectionId: 'c1', overrideNote: 'principal ordered — teacher on leave',
    }));
  });

  it('the absentee register lists every AB with its exam', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(apiWithBoard());
    renderWithProviders(<ResultRoomPage />);
    await waitFor(() => expect(screen.getByText(/The absentee register · 1/)).toBeInTheDocument());
    expect(screen.getByText(/VII-B · Mathematics · PT-1/)).toBeInTheDocument();
  });
});
