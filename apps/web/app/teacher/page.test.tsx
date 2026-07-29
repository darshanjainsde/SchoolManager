import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
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

  describe('todayIso local-vs-UTC correctness', () => {
    const originalTZ = process.env.TZ;

    beforeAll(() => {
      // We pin the runner's TZ ourselves rather than deriving the expected
      // date from the frozen instant's local parts, so this test can only
      // pass if `todayIso()` genuinely reads the *local* calendar day —
      // deriving the expectation the same way the implementation does would
      // let a regression to `toISOString().slice(0, 10)` slip through
      // unnoticed on a UTC CI runner. Pinning TZ also makes the test's
      // outcome independent of whatever zone the host machine happens to be
      // in.
      process.env.TZ = 'Asia/Kolkata';
    });

    afterAll(() => {
      process.env.TZ = originalTZ;
    });

    it('requests the local calendar date, not the UTC one, when the two disagree', async () => {
      // IST is UTC+5:30, i.e. local = UTC + 5:30, so converting local -> UTC
      // subtracts 5:30. That only rolls the UTC day *backward* when the
      // local clock reads before 05:30 (e.g. 02:00 - 5:30 wraps past
      // midnight) — not late in the evening, since 23:30 - 5:30 = 18:00
      // stays on the same day. So the instant that actually exercises the
      // bug is an early-morning one: 2026-07-29 02:00 local is
      // 2026-07-28T20:30:00.000Z. A `toISOString().slice(0, 10)`
      // implementation would request '2026-07-28' here; the correct,
      // local-date implementation must request '2026-07-29'.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 6, 29, 2, 0));

      const api = mockApi({ get: vi.fn().mockResolvedValue({ date: '2026-07-29', dayOfWeek: 3, entries: [] }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderWithProviders(<TeacherHomePage />);

      await screen.findByText('No timetable has been set up for you yet — ask your school admin.');

      expect(api.get).toHaveBeenCalledWith('/manage/timetable/my-day?date=2026-07-29');
    });
  });
});
