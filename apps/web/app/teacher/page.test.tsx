import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { TeacherDayEntry } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherHomePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function classEntry(id: string, className: string, subjectName: string, startTime: string, endTime: string): TeacherDayEntry {
  return {
    periodId: id,
    label: id,
    startTime,
    endTime,
    kind: 'CLASS',
    slot: { classSectionId: `sec-${id}`, className, subjectName, covering: false, coveringFor: null },
    register: { taken: false, present: 0, total: 28, markedBy: null },
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeacherHomePage', () => {
  it('renders a loading state while my-day is in flight', () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn(() => new Promise(() => {})) }) as never);
    renderWithProviders(<TeacherHomePage />);
    expect(screen.getByText('Loading your day…')).toBeInTheDocument();
  });

  it("renders the server's error message verbatim when my-day fails", async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: vi.fn().mockRejectedValue(new Error('Timetable service is unavailable')) }) as never,
    );
    renderWithProviders(<TeacherHomePage />);
    expect(await screen.findByText('Timetable service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when entries is []', async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: vi.fn().mockResolvedValue({ date: '2026-07-29', dayOfWeek: 3, entries: [] }) }) as never,
    );
    renderWithProviders(<TeacherHomePage />);
    expect(
      await screen.findByText('No timetable has been set up for you yet — ask your school admin.'),
    ).toBeInTheDocument();
  });

  it('given a fixed day and a fixed clock, the correct period is the Now card', async () => {
    // Only Date is faked — real timers keep testing-library's `findBy*`
    // polling working; faking setTimeout too would hang it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 29, 8, 20));

    const entries: TeacherDayEntry[] = [
      classEntry('p1', '8-A', 'Mathematics', '08:00', '08:45'),
      {
        periodId: 'break',
        label: 'Break',
        startTime: '08:45',
        endTime: '09:05',
        kind: 'BREAK',
        slot: null,
        register: null,
      },
      classEntry('p2', '8-A', 'Science', '09:05', '09:50'),
    ];
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: vi.fn().mockResolvedValue({ date: '2026-07-29', dayOfWeek: 3, entries }) }) as never,
    );

    renderWithProviders(<TeacherHomePage />);

    const title = await screen.findByText('8-A · Mathematics', { selector: '.sk-now-title' });
    const nowCard = title.closest('.sk-now');
    expect(nowCard).not.toBeNull();
    expect(nowCard).not.toHaveTextContent('Science');
  });
});
