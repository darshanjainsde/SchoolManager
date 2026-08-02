import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { AttendanceRatesResult, MyClassSection } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AttendanceBarPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const CLASSES: MyClassSection[] = [
  { classSectionId: 'cs1', name: '8-C', studentCount: 4, covering: false },
];

const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const RATES: AttendanceRatesResult = {
  classSectionId: 'cs1',
  className: '8-C',
  from: '2026-05-05',
  to: '2026-08-03',
  daysMarked: 40,
  students: [
    { studentId: 's1', name: 'Kabir Nair', rollNo: '3', present: 20, total: 40, percent: 50, lastNoticeAt: null },
    { studentId: 's2', name: 'Aarav Sharma', rollNo: '1', present: 27, total: 40, percent: 68, lastNoticeAt: daysAgoISO(2) },
    { studentId: 's3', name: 'Diya Rao', rollNo: '2', present: 31, total: 40, percent: 78, lastNoticeAt: null },
    { studentId: 's4', name: 'Nia Verma', rollNo: '4', present: 40, total: 40, percent: 100, lastNoticeAt: null },
  ],
};

function mockGet(rates: AttendanceRatesResult = RATES) {
  return vi.fn().mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance/my-classes')) return Promise.resolve(CLASSES);
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(rates);
    throw new Error(`unexpected path: ${path}`);
  });
}

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return { get: mockGet(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over };
}

function renderPage() {
  return renderWithProviders(
    <>
      <AttendanceBarPage />
      <Toaster />
    </>,
  );
}

/**
 * Drag the benchmark to a value.
 *
 * `fireEvent.change` rather than userEvent: a range input has no keyboard or
 * pointer gesture in jsdom that lands on an exact value, and what the test is
 * about is the consequence of the benchmark moving, not how a mouse produces
 * the move.
 */
async function slideTo(percent: number) {
  fireEvent.change(await screen.findByTestId('bar-threshold'), {
    target: { value: String(percent) },
  });
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('AttendanceBarPage', () => {
  it('counts who is under the benchmark before anything is sent', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderPage();

    expect(await screen.findByText(/2 of 4 in 8-C, over 40 marked days/)).toBeInTheDocument();
  });

  it('moving the benchmark re-filters instantly', async () => {
    const post = vi.fn();
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderPage();

    // Wait for the class to load before sliding, so the count that follows is
    // the re-filter and not the first render.
    expect(await screen.findByText(/2 of 4 in 8-C/)).toBeInTheDocument();
    await slideTo(90);

    expect(await screen.findByText(/3 of 4 in 8-C/)).toBeInTheDocument();
    // Sliding is a preview, never a send.
    expect(post).not.toHaveBeenCalled();
  });

  it('the distribution repaints the tail as the benchmark moves', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderPage();

    const dist = await screen.findByTestId('bar-dist');
    const bars = () => [...dist.querySelectorAll('span')];

    // At 75: Kabir (50%) and Aarav (68%) are under the line.
    expect(bars().filter((b) => b.dataset.low === 'true')).toHaveLength(2);

    await slideTo(90);
    // At 90 Diya (78%) joins them; Nia (100%) still clears it.
    expect(bars().filter((b) => b.dataset.low === 'true')).toHaveLength(3);
  });

  it('skips a family told this week and counts only who is left', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderPage();

    // Kabir (50%) and Aarav (68%) are under 75, but Aarav was told 2 days ago.
    expect(await screen.findByText('Tell 1 family')).toBeInTheDocument();
    expect(screen.getByTestId('bar-cooling')).toHaveTextContent(
      '1 already heard from you this week.',
    );
  });

  it('the teacher can drop someone the arithmetic picked', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('bar-row-s1'));

    expect(await screen.findByText('Nobody to tell')).toBeInTheDocument();
  });

  it('sends only the chosen children with the benchmark on screen', async () => {
    const post = vi.fn().mockResolvedValue({ notified: 1, skippedInCooldown: 1, cooldownDays: 7 });
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('bar-notify'));

    expect(post).toHaveBeenCalledWith(
      '/manage/attendance/notify-low',
      expect.objectContaining({ classSectionId: 'cs1', threshold: 75, studentIds: ['s1'] }),
    );
  });

  it('a child with no register taken is never written to', async () => {
    const unmarked: AttendanceRatesResult = {
      ...RATES,
      students: [
        { studentId: 's9', name: 'New Joiner', rollNo: '9', present: 0, total: 0, percent: 0, lastNoticeAt: null },
      ],
    };
    vi.mocked(useApi).mockReturnValue(stub({ get: mockGet(unmarked) }) as never);
    renderPage();

    expect(await screen.findByText(/0 of 1 in 8-C/)).toBeInTheDocument();
    expect(screen.getByTestId('bar-notify')).toBeDisabled();
  });
});
