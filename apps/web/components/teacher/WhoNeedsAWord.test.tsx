import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { AttendanceRatesResult } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { WhoNeedsAWord } from '@/components/teacher/WhoNeedsAWord';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const RATES: AttendanceRatesResult = {
  classSectionId: 'cs1', className: '8-C', from: '2026-05-05', to: '2026-08-03', daysMarked: 40,
  students: [
    { studentId: 's1', name: 'Kabir Nair', rollNo: '3', present: 20, total: 40, percent: 50, lastNoticeAt: null },
    { studentId: 's2', name: 'Aarav Sharma', rollNo: '1', present: 27, total: 40, percent: 68, lastNoticeAt: daysAgoISO(2) },
    { studentId: 's3', name: 'Diya Rao', rollNo: '2', present: 31, total: 40, percent: 78, lastNoticeAt: null },
    { studentId: 's4', name: 'Nia Verma', rollNo: '4', present: 40, total: 40, percent: 100, lastNoticeAt: null },
  ],
};

function stub(over: Partial<ApiStub> = {}, rates = RATES): ApiStub {
  return {
    get: vi.fn().mockResolvedValue(rates),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over,
  };
}
const render1 = () => renderWithProviders(<><WhoNeedsAWord classSectionId="cs1" className="8-C" /><Toaster /></>);
const slideTo = (v: number) => fireEvent.change(screen.getByTestId('bar-threshold'), { target: { value: String(v) } });

beforeEach(() => { vi.mocked(useHost).mockReturnValue('school.sckools.com'); });

describe('WhoNeedsAWord (inside Attendance)', () => {
  it('counts who is under the benchmark before anything is sent', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    render1();
    expect(await screen.findByText(/2 of 4 in 8-C below 75%/)).toBeInTheDocument();
  });

  it('moving the benchmark re-filters instantly, sending nothing', async () => {
    const post = vi.fn();
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    render1();
    await screen.findByTestId('bar-threshold');
    slideTo(90);
    expect(await screen.findByText(/3 of 4 in 8-C below 90%/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('skips a family told this week and counts only who is left', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    render1();
    expect(await screen.findByText('Tell 1 family')).toBeInTheDocument();
    expect(screen.getByTestId('bar-cooling')).toHaveTextContent('1 already heard from you this week.');
  });

  it('the teacher can drop someone the arithmetic picked', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    render1();
    await userEvent.click(await screen.findByTestId('bar-row-s1'));
    expect(await screen.findByText('Nobody to tell')).toBeInTheDocument();
  });

  it('sends only the chosen children with the benchmark on screen', async () => {
    const post = vi.fn().mockResolvedValue({ notified: 1, skippedInCooldown: 1, cooldownDays: 7 });
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    render1();
    await userEvent.click(await screen.findByTestId('bar-notify'));
    expect(post).toHaveBeenCalledWith('/manage/attendance/notify-low',
      expect.objectContaining({ classSectionId: 'cs1', threshold: 75, studentIds: ['s1'] }));
  });

  it('a child with no register taken is never written to', async () => {
    const unmarked: AttendanceRatesResult = { ...RATES, students: [
      { studentId: 's9', name: 'New Joiner', rollNo: '9', present: 0, total: 0, percent: 0, lastNoticeAt: null },
    ]};
    vi.mocked(useApi).mockReturnValue(stub({}, unmarked) as never);
    render1();
    expect(await screen.findByText(/Everyone in 8-C is above 75%/)).toBeInTheDocument();
    expect(screen.getByTestId('bar-notify')).toBeDisabled();
  });
});
