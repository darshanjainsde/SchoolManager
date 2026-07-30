import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import StaffHomePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('StaffHomePage', () => {
  it('renders a loading state while /manage/staff-attendance/mine is in flight', () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn(() => new Promise(() => {})) }) as never);
    renderWithProviders(<StaffHomePage />);
    expect(screen.getByText('Loading your attendance…')).toBeInTheDocument();
  });

  it("renders the server's error message verbatim on failure", async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: vi.fn().mockRejectedValue(new Error('Only staff can view their own attendance')) }) as never,
    );
    renderWithProviders(<StaffHomePage />);
    expect(await screen.findByText('Only staff can view their own attendance')).toBeInTheDocument();
  });

  it('renders an explicit empty state when nothing has been marked this month', async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({
        get: vi.fn().mockResolvedValue({
          person: { id: 'staff-1', firstName: 'Sam', lastName: 'Staff', role: 'OFFICE' },
          summary: { present: 0, absent: 0, late: 0, onLeave: 0, percent: 0, days: [] },
        }),
      }) as never,
    );
    renderWithProviders(<StaffHomePage />);
    expect(
      await screen.findByText('No attendance has been recorded for you yet this month.'),
    ).toBeInTheDocument();
  });

  it('renders the identity greeting, KPI tiles, and recent days when data is present', async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({
        get: vi.fn().mockResolvedValue({
          person: { id: 'staff-1', firstName: 'Sam', lastName: 'Staff', role: 'OFFICE' },
          summary: {
            present: 2,
            absent: 1,
            late: 0,
            onLeave: 0,
            percent: 67,
            days: [
              { date: '2026-07-01', status: 'PRESENT' },
              { date: '2026-07-02', status: 'ABSENT' },
              { date: '2026-07-03', status: 'PRESENT' },
            ],
          },
        }),
      }) as never,
    );
    renderWithProviders(<StaffHomePage />);

    expect(await screen.findByText(/Hi, Sam/)).toBeInTheDocument();
    expect(screen.getByText('Office staff')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    // Present/Absent/Late KPI tiles.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('always renders the honest "leave not available yet" note — v1 has no staff-leave path', async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({
        get: vi.fn().mockResolvedValue({
          person: { id: 'staff-1', firstName: 'Sam', lastName: 'Staff', role: 'OFFICE' },
          summary: { present: 0, absent: 0, late: 0, onLeave: 0, percent: 0, days: [] },
        }),
      }) as never,
    );
    renderWithProviders(<StaffHomePage />);
    expect(
      await screen.findByText(/Applying for leave isn.t available here yet/),
    ).toBeInTheDocument();
  });
});
